# Main Session 解耦 — 架构设计文档

> **状态**：Spec（架构与 API 决策）
> **日期**：2026-05-16
> **范围**：架构层与 API 层定调，不含具体实现细节。实现层细节（具体方法签名、文件级改动清单、测试列表）放到后续 plan 文档。

---

## 1. 背景与目标

### 1.1 现状

Stello 当前存在两种 Session 类型：

- **普通 Session**：上下文组装为 `systemPrompt + identity + insight(消费) + memory + L3 + msg`
- **Main Session**：上下文组装为 `systemPrompt + synthesis(=memory) + L3 + msg`，并独占 `integrate()` 方法以收集所有子 Session 的 L2、调用 IntegrateFn、写回 synthesis 与 per-child insights

围绕 Main Session 还有一整套配套：`MainSession` 接口、`createMainSession`/`loadMainSession` 工厂、`MainStorage`（SessionStorage 的 superset）、`MainSessionConfig`、`MAIN_SESSION_ID = 'main'` 常量、`StelloAgent.createMainSession` / `StelloAgent.integrate` 方法、`mergeSessionConfig` 中的 main 分支、Engine 在 `fork-from-main` 时的特殊跳过等。

### 1.2 重构目标

**把 Main Session 概念从 Stello 中彻底删除**：

- Stello 内部只存在一种 Session
- "对话的起点" = root session = 拓扑中 `parentId === null` 的任一节点 = 普通 Session
- 原 Main Session 承担的"跨 Session 综合 + 定向 insight 推送"职责完全外包给**外部 orchestrator client**（Claude Code / Codex / 用户自写脚本）
- 跨会话能力通过 SDK 上若干**纯数据 API** 体现，不再有任何框架级 LLM 编排

### 1.3 非目标

- 不重做存储模型（getMemory/putMemory + getInsight/putInsight/clearInsight 等独立方法保持原结构）
- 不重做 tool loop、TurnRunner、ForkProfile、SkillRouter
- 不更新 demo、devtools、visualizer 等下游消费方（暂缓，CHANGELOG 标注）
- 不解决持久化数据从旧 'main' 目录到新 UUID root 的迁移工具

---

## 2. 架构鸟瞰

```
┌─────────────────────────────────────────────────────────────┐
│ Orchestrator Client（外部 — Claude Code / Codex / 用户脚本） │
│   ├─ 通过 Stello SDK 调用纯数据 API                          │
│   │   listSessions / getTopology / getSessionMetadata /     │
│   │   listSessionDigests / putMemory / putInsight ...       │
│   └─ 在自己的 LLM 上做 reflection，把结果写回 Stello         │
├─────────────────────────────────────────────────────────────┤
│ Core (StelloAgent / Engine / Orchestrator / Tools / Skills) │
│   ├─ 只持有一种 Session                                      │
│   ├─ SessionTree.createSession({ parentId? }) 统一入口        │
│   ├─ 不再有 MAIN_SESSION_ID / MainSessionConfig / integrate │
│   ├─ consolidate 仍由框架调度                                │
│   └─ 新增 orchestration-facing SDK 类别                     │
├─────────────────────────────────────────────────────────────┤
│ Session (`@stello-ai/session`)                              │
│   ├─ createSession / loadSession 唯一工厂                   │
│   ├─ SessionStorage 单接口                                  │
│   └─ 上下文组装规则全 Session 同构                           │
└─────────────────────────────────────────────────────────────┘
              依赖注入 ↓
    SessionStorage   LLMAdapter   ConsolidateFn   CompressFn
```

**核心立场**：Stello 退回"会话拓扑 + 单 Session 对话 + L2/L3 数据层"。原 Main Session 承担的职责完全外包；框架只暴露数据读写 API + 拓扑查询。

---

## 3. 删除清单（breaking, 不留 deprecated stub）

### 3.1 `@stello-ai/session` 层

| 删除项 | 性质 | 替代/迁移 |
|---|---|---|
| `MainSession` interface | 类型 | 用 `Session` |
| `createMainSession` / `loadMainSession` | 工厂 | 用 `createSession` / `loadSession` |
| `CreateMainSessionOptions` / `LoadMainSessionOptions` | 类型 | 用 `CreateSessionOptions` / `LoadSessionOptions` |
| `MainStorage` interface | 类型 | 用 `SessionStorage`（同时缩减） |
| `IntegrateFn` / `IntegrateResult` / `ChildL2Summary` | 类型/函数签名 | 外部 orchestrator 自定义 |
| `SessionMeta.role: 'standard' \| 'main'` | 字段 | 完全移除；root 由拓扑决定 |
| `SessionMeta.tags: string[]` | 字段 | 完全移除（见 §4.7 应用层扩展模式） |
| `SessionMeta.metadata: Record<unknown>` | 字段 | 完全移除（同上） |
| `SessionFilter.role` / `SessionFilter.tags` | 字段 | 移除 |
| `assembleMainSessionContext` | 内部函数 | 用 `assembleSessionContext`（统一规则） |
| `MainSession.synthesis()` 方法 | API | 不再存在；语义并入 `memory()` |
| `MainStorage.getAllSessionL2s` | 存储方法 | 提升为 SDK 级别批量 API |
| `MainStorage.listSessions` | 存储方法 | 提升为 SDK 级别 API |
| `MainStorage.putNode / getChildren / removeNode` | 存储方法 | 完全移除（拓扑统一由 core SessionTree 持有） |
| `MainStorage.getGlobal / putGlobal` | 存储方法 | 移除（未使用） |

### 3.2 `@stello-ai/core` 层

| 删除项 | 性质 | 替代/迁移 |
|---|---|---|
| `MAIN_SESSION_ID = 'main'` | 常量 | 完全移除 |
| `SessionTree.createRoot(label?)` | API | 统一为 `createSession({ parentId?, label? })` |
| `SessionTree.createChild(options)` | API | 同上，统一入口 |
| `SessionTree.getRoot()` | API | 替换为 `listRoots()` |
| `MainSessionConfig` / `SerializableMainSessionConfig` | 类型 | 删除；只保留 `SessionConfig` / `SerializableSessionConfig` |
| `StelloAgentConfig.mainSessionConfig` | 配置 | 删除 |
| `StelloAgentSessionConfig.mainSessionLoader` | 配置 | 删除 |
| `StelloAgent.createMainSession()` | 方法 | 统一为 `createSession({ parentId?, label? })` |
| `StelloAgent.integrate()` | 方法 | 完全移除 |
| `mergeSessionConfig` 中 MainSessionConfig 分支 | 逻辑 | 删除 |
| Engine `forkSession` 中 fork-from-main 跳过逻辑 | 逻辑 | 删除（root 配置正常被 fork 继承） |
| `MainSessionCompatible` / `SessionCompatibleIntegrateFn` | 适配类型 | 删除 |

### 3.3 保留（不删）

- `Session.consolidate()` 与 `ConsolidateFn` —— L3→L2 提炼仍在框架内调度
- `Session.insight()` / `setInsight()` / 存储层 `getInsight/putInsight/clearInsight`
- `Session.memory()` / 存储层 `getMemory/putMemory`
- `Session.fork()`、`ForkOptions`、`ForkProfile` 全套
- `assembleSessionContext`（成为唯一上下文组装函数）
- 上下文压缩、tool loop、TurnRunner、Engine hooks、SkillRouter

---

## 4. Session 层（`@stello-ai/session`）重塑

### 4.1 `SessionMeta` 极简化

```
SessionMeta {
  id, label, status, createdAt, updatedAt
}

SessionMetaUpdate {
  label?
}

SessionFilter {
  status?
}
```

无 role、无 tags、无 metadata。应用层若需扩展，见 §4.7。

### 4.2 唯一 Session 接口

`Session` 提供：

- `meta` / `send` / `stream` / `messages`
- `systemPrompt` / `setSystemPrompt`
- `insight` / `setInsight` / `memory` —— 读 insight 不消费（消费由 send 触发清除）
- `consolidate` —— L3→L2，按注入的 `consolidateFn` 提炼
- `trimRecords` / `fork` / `updateMeta` / `archive`
- `setLLM` / `tools` / `setTools`

**取消**：`synthesis()`、`integrate()`。root 不再有任何额外方法 —— 它就是个 Session。

### 4.3 工厂

唯一入口：

- `createSession(options): Promise<Session>`
- `loadSession(id, options): Promise<Session | null>`

Session 层**不感知拓扑**。`parentId` 是 core 层 SessionTree 的概念。

### 4.4 `SessionStorage` 单一接口

合并 MainStorage 后只剩一个接口，包含：

- SessionMeta CRUD（`getSession` / `putSession`）
- L3（`appendRecord` / `listRecords` / `trimRecords`）
- system prompt（`getSystemPrompt` / `putSystemPrompt`）
- insight（`getInsight` / `putInsight` / `clearInsight`）—— 一次性，send 消费后清除
- memory(L2)（`getMemory` / `putMemory`）—— 持久，每次 send 注入
- 事务（`transaction`）

不再有：拓扑节点 CRUD、`listSessions`、`getAllSessionL2s`、`getGlobal` / `putGlobal`。

### 4.5 上下文组装（全 Session 同构）

```
[system prompt]
+ [<session_identity> with label]
+ [insight if present, consume on send]
+ [memory if present]
+ [L3 history with sanitize]
+ [user message]
```

Root 与子 Session 同一套规则。Root 的"synthesis"语义自然由 `memory` 承担：orchestrator 调 `putMemory(rootId, ...)` 写综合认知，每次 root.send 注入。**框架对 memory 的语义无感知** —— 它只负责注入。

### 4.6 外部数据视图（语义统一）

无论 storage 怎么拆，对外语义统一为：

```
SessionMetadataView {
  memory:  string | null   // 持久
  insight: string | null   // 一次性
}
```

SDK 层在调用侧聚合 `getMemory + getInsight` 提供该视图（实现细节见 core 层 §5）。

### 4.7 应用层扩展模式（约定）

> 任何业务字段（conflicts / relations / priority / 自定义 flags ...）**不进入** Stello 的 SessionMeta。应用层定义自己的 wrapper：组合 Stello Session + 应用自己的 side-table 存储，向外暴露包装后的接口。
>
> Stello 不知道、不约束、不解释应用域字段。SessionMeta 内核接口对所有应用收敛、稳定。

理由：

1. Stello 不应模型化应用域 —— 各应用的 metadata schema 千差万别，强行用 `Record<unknown>` 既不安全也不便携
2. 跨会话关系（如 conflicts）天然是**边**而非节点属性；放节点上要应用层维护双向一致性
3. 应用通过 composition 持有 Session + 私有数据，类型与责任都清晰

---

## 5. Core 层重塑

### 5.1 `SessionTree` API 统一

**删除**：`createRoot`、`createChild`、`getRoot`、`MAIN_SESSION_ID`。

**新增/调整**：

- `createSession({ parentId?, label?, sourceSessionId? })` —— **唯一拓扑创建入口**。`parentId` 为空则为新 root。隐式支持多 root。
- `listRoots()` —— 列出所有 `parentId === null` 的节点
- `getTree()` —— 返回 `SessionTreeNode[]`（森林形态）

保留：`get / listAll / archive / addRef / updateMeta / getNode / getAncestors / getSiblings / getConfig / putConfig`。

### 5.2 `TopologyNode` 语义微调

结构不变，仅"root 唯一"假设取消。多个 `parentId === null` 的节点合法。`getTree` 返回森林。

### 5.3 `SessionConfig` 路径简化

- 删除 `MainSessionConfig` / `SerializableMainSessionConfig`
- 保留 `SessionConfig` / `SerializableSessionConfig` 不变
- `mergeSessionConfig` 删除 main 分支，所有 fork 走标准合成链：`defaults → parent → profile → forkOptions`
- **root 配置正常被子 fork 继承**（取消旧的"fork-from-main 跳过父配置"特殊逻辑）

### 5.4 `Engine` 调整

唯一改动：`forkSession` 中删除 `sourceSessionId === MAIN_SESSION_ID` 特殊跳过分支。其余 Engine 逻辑（tool loop、TurnRunner、hooks、consolidate 调度、ForkProfile）不动。

### 5.5 `StelloAgent` 顶层 API

**删除**：

- `agent.createMainSession()`
- `agent.integrate()`
- `StelloAgentConfig.mainSessionConfig`
- `StelloAgentSessionConfig.mainSessionLoader`

**新增/调整**：

- `agent.createSession({ parentId?, label? }): Promise<TopologyNode>` —— 取代 `createMainSession`。语义："起一个新会话"：parentId 为空建 root；非空挂在该节点下，但**不继承父 Session 上下文 / 配置**。需要继承上下文（含 system prompt、L3、config 合成）应走 `forkSession`
- **新增 orchestration-facing SDK 类别**（具体签名留下轮讨论，本 spec 仅定类别）：见 §6

**保留**：`enterSession / turn / stream / leaveSession / forkSession / archiveSession / attachSession / detachSession / consolidateSession / updateConfig / hasActiveEngine / getEngineRefCount`。

### 5.6 Adapter 层清理

- `MainSessionCompatible` 接口删除
- `SessionCompatibleIntegrateFn` 类型删除
- `adapters/session-runtime.ts` 中 MainSession 相关分支删除
- `EngineRuntimeSession` 接口不变（不区分 root/child）

---

## 6. Orchestrator-facing SDK 表面

> 本节定调"有哪些类别、挂在哪里、有什么约束"，**不定最终签名**。表中括号内的形参/返回是**示意**，便于理解类别边界；具体参数、过滤条件、批量形态留到下轮专门讨论。

### 6.1 类别清单

| 类别 | 用途 | 本 spec 状态 |
|---|---|---|
| 拓扑查询 | `getTopology` 森林、`getTopologyNode(id)`、`listRoots` | 类别确定 |
| 会话列举 | `listSessions(filter?)` → `SessionMeta[]` | 类别确定 |
| 单会话视图 | `getSessionMetadata(id)` → `{ memory, insight }` | 类别确定 |
| 批量视图 | `listSessionDigests(filter?)` → 每会话 `{ id, label, memory, insight, ... }` | 类别确定，取代 `getAllSessionL2s` |
| L3 读取 | `listMessages(id, opts?)` | 类别确定 |
| 单会话写 | `putMemory / putInsight / clearInsight` | 类别确定 |
| 批量原子写 | `applyMetadataBatch(updates[])` | **下轮再讨论** |
| consolidate 触发 | `consolidateSession(id)` | 已存在 |
| 未来 context 字段扩展 | 未定 | **下轮再讨论** |

### 6.2 约束（无须签名也可定）

- **零隐式 LLM 调用**：所有方法都是数据 IO，不会触发 send / integrate / 任何隐式 LLM。`consolidateSession` 是显式动作，consolidateFn 由应用注入
- **不感知 root/child**：方法对所有 Session 一视同仁，调用方靠拓扑自分
- **挂在 `StelloAgent` 上**：不开新顶层类
- **存储后端无关**：调用方只看 SDK，后端 SessionStorage 由应用注入

---

## 7. 范围、迁移、风险

### 7.1 范围**内**

- `@stello-ai/session` 与 `@stello-ai/core` 两包按本 spec 实施改动
- Orchestrator-facing SDK 类别与挂载点（具体签名下轮）

### 7.2 范围**外**（暂缓）

- `packages/devtools/server`、`packages/devtools/web`、`packages/visualizer`
- `demo/stello-agent-basic`、`demo/stello-agent-chat`
- 应用层 wrapper Session 的官方示例
- §6.1 中"下轮讨论"的批量原子写、未来 context 扩展
- 持久化数据（旧 'main' 目录）的自动迁移工具

### 7.3 风险与已知 break

| 风险 | 说明 | 处置 |
|---|---|---|
| demo/devtools 跑不通 | 删 createMainSession / integrate 后下游不编译 | 接受；CHANGELOG 列入 breaking |
| 旧持久化数据 | 已有 file-system 存储里 root 可能写在 'main' 目录下 | 不强制迁移；新版本默认读不到旧 root，应用自行处理 |
| 多 root 边界 | `listRoots()` 为空、跨 root fork、`getTree()` 森林空数组 | 实施时按"多 root 合法"加测试覆盖 |
| 应用层 wrapper 缺示例 | 首次接触 wrapper 模式会困惑 | 文档说明 + 后续 sample；本 spec 只立约定 |
| fork 配置链路变化 | 删除 fork-from-main 跳过后，root 配置被子 fork 继承，可能不是某些 demo 预期 | CHANGELOG 列入 breaking |
| `MAIN_SESSION_ID` 残留 | core/session 两包及 test 都有 import | 实施时全文 grep + typecheck 把关 |

### 7.4 版本与发布

- 直接发 minor，不发 deprecated alias（项目仍 0.x）
- 同时推 `core` 与 `session` 两包新 minor，CHANGELOG 集中说明
- 暂不升 1.0

### 7.5 已知未决问题（spec 不解决，备忘）

1. 批量原子写 API 形态（`applyMetadataBatch` 类）
2. 未来 context 字段扩展（除 memory/insight 外的新槽位）
3. 持久化文件迁移工具（旧 'main' 目录）
4. Storage 适配器命名（`InMemoryStorageAdapter` 等是否需要随接口收敛而重命名）
5. **StelloAgent 级共享 memory 机制**（Claude Code auto-memory 路线）：所有 Session 共享一份 agent-writable memory，索引随 send 注入、详情用内置 tool 懒加载。本次 refactor 不实现，落地后单独 spec。预期影响面：(a) §4.5 在 system prompt 之上插入一个 agent-shared memory index 槽；(b) 新增 AgentStorage 兄弟接口（不挂 SessionStorage），或在 StelloAgent 注入处独立配置；(c) 两个新内置 tool（recall / remember）；(d) 并发写策略（沿用 writeLock 模式还是新机制）。Refactor 实施时避免把这些扩展位封死。

---

## 8. 设计原则回顾

本次重构遵循的若干 KISS 立场，便于实施时落到细节决策：

1. **职责单一** —— Stello 只做拓扑 + 数据 + Session 内调度；跨 Session 的综合判断完全外包
2. **接口收敛** —— Session 只剩一种、SessionStorage 只剩一个；MainXxx 全删
3. **composition 优于 data extension** —— 应用域字段通过 wrapper Session，不污染 SessionMeta
4. **不模型化应用域** —— 不预判 tags / metadata / conflicts / relations 等业务字段
5. **零隐式 LLM 调用** —— orchestrator-facing API 全是纯数据 IO
6. **多 root 自然支持** —— 删除 root 唯一性约束既是删除 MAIN_SESSION_ID 的副产品，也是拓扑 API 自洽的结果
