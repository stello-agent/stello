---
name: storage-design
description: 存储接口的设计原则、SessionMeta 与 TopologyNode 解耦、上下文槽位、单一 SessionStorage 接口。触发条件：理解或实现 SessionStorage / SessionTree。
---

## 核心原则

**Session 是纯对话单元，不感知树结构。** 数据职责切成两条独立的线：

- `SessionStorage` — 单个 Session 的内容数据（消息、上下文槽位等），由 `@stello-ai/session` 定义
- `SessionTree` — 拓扑结构（节点关系、固化配置），由 `@stello-ai/core` 定义

两者由应用层各自实现并注入；常见做法是共享同一份持久化后端，但接口分离让 Session 层（运行单条对话）和 Orchestrator 层（管理整棵森林）的职责互不耦合。

---

## 单一 `SessionStorage` 接口

所有 Session（含 root）共用同一个接口。Root 没有特权方法——它就是一个 `parentId === null` 的普通 Session。

职责：
- Session 元数据 CRUD（`getSession / putSession / listSessions`）
- L3 对话记录追加/查询/裁剪（`appendRecord / listRecords / trimRecords`）
- 三个上下文槽位的读写（`getSystemPrompt/putSystemPrompt` / `getInsight/putInsight/clearInsight` / `getMemory/putMemory`）
- 事务（`transaction(fn)`）

批量收集由 `StelloAgent.listSessionDigests()` 提供——它在 orchestrator-facing SDK 上聚合 `SessionTree.listAll()` 与 `SessionStorage.getMemory/getInsight`，由应用层在 agent 顶层注入 `storage: SessionStorage` 来启用。

---

## SessionMeta 与 TopologyNode 解耦

树状关系完全由 `TopologyNode` 维护，`SessionMeta` 不关心自己在树中的位置。

- **SessionMeta**（在 `SessionStorage`）：对话运行时数据（id、label、status、turnCount 等），无 parentId/children/depth
- **TopologyNode**（在 `SessionTree`）：纯树结构（id、parentId、children、refs、depth、index、label、sourceSessionId）

两种类型由两条独立接口提供。底层存储实现可以共享一张表/同一份 JSON，但消费侧（Session 层 vs 拓扑 / 前端）拿到的是经过职责裁剪的视图。

### 两个包的 SessionMeta

`@stello-ai/session` 和 `@stello-ai/core` 各有自己的 SessionMeta，字段集合不完全一致；持久化层（PG / FS）通常存超集，由各 adapter 按需投影。

---

## 上下文槽位

每个出现在 Session.send() 上下文中的元素都有对应的专用槽位（一对 get/put 方法），不复用通用键值：

| 槽位 | 写入者 | send() 消费 | 生命周期 |
|------|--------|------|---------|
| `systemPrompt` | fork 合成链固化 / 应用层 | 每次 send 注入 | 持久 |
| `insight` | 应用层（`agent.putInsight`） | 注入一次即 clear | 一次性 inbox |
| `memory` | 应用层（consolidate 写入 / `agent.putMemory`） | **不进入 send 上下文** | 持久（供 orchestrator 反思） |

`memory` 是**外部视角的槽位**——它是 orchestrator 层（应用层）用来对 Session 做综合反思的输入，但不会注入 Session 自身的 LLM 上下文。Session 的 LLM 看不到自己的 memory。

---

## 数据流向

```
Session.send()
  storage.getSystemPrompt → storage.getInsight → storage.listRecords → LLM → storage.appendRecord
                                  ↓
                            storage.clearInsight（若 insight 被消费）

Session.consolidate(fn)
  storage.listRecords + storage.getMemory → fn → storage.putMemory

Engine.forkSession(options)
  1. sessions.createSession({ parentId, label, sourceSessionId })  ← 拿到 ID
  2. sessions.putConfig(childId, serializable)                       ← 固化 systemPrompt + skills
  3. session.fork({ id: childId, context, prompt })                  ← 创建 Session 实例

应用层反思层（自行实现，每 N 分钟 / on demand）
  agent.listSessionDigests()    → 收集所有 Session 的 {id, label, memory, insight}
  → 任意 LLM → 派生 per-target insight
  → agent.putInsight(targetId, content)
```

---

## SessionTree 接口要点

- `createSession({ parentId?, label?, sourceSessionId? })` —— 唯一节点创建入口；`parentId` 缺省即建 root（`parentId === null`），多 root 合法
- `listRoots()` —— 列出所有 root，应用层据此显示森林
- `getTree()` —— 返回 `SessionTreeNode[]` 森林视图
- `addRef(from, to)` —— 跨树引用（非父子）
- `getConfig / putConfig` —— 持久化 `SerializableSessionConfig`（只含 `systemPrompt` / `skills`）

---

## 应用层实现策略

| 后端 | 推荐拆分 |
|------|---------|
| 文件系统（NodeFS） | `SessionTreeImpl` + `InMemoryStorageAdapter`（demo 用法） |
| PostgreSQL | 一个 PG schema，两个 wrapper 类（一个实现 `SessionStorage`，一个实现 `SessionTree`） |
| 多租户 server | 同上，再加 space_id 维度 |

要点：两个接口的 `id` 必须语义一致（同一个 Session 的 `SessionMeta.id` === `TopologyNode.id`）。应用层在创建/删除 Session 时需保证两条线同步。
