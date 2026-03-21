---
name: storage-design
description: 当需要理解或实现 StorageAdapter（SessionStorage / MainStorage）、拓扑树、数据流向时，触发此 skill。
---

## 核心原则

**Session 是纯对话单元，不感知树结构。** 存储接口按消费者职责细分。

---

## 两层存储接口

### SessionStorage — 单个 Session 的数据操作

普通 Session 注入此接口。只能操作自身的数据，无法感知其他 Session 的存在。

```
SessionStorage:
  // Session 元数据
  getSession(id: string): SessionMeta | null
  putSession(session: SessionMeta): void

  // L3 对话记录
  appendRecord(sessionId: string, record: Message): void
  listRecords(sessionId: string, options?: ListRecordsOptions): Message[]

  // 上下文槽位（每个都对应上下文组装中的一个位置）
  getSystemPrompt(sessionId: string): string | null
  putSystemPrompt(sessionId: string, content: string): void
  getInsight(sessionId: string): string | null
  putInsight(sessionId: string, content: string): void
  getMemory(sessionId: string): string | null       // L2
  putMemory(sessionId: string, content: string): void

  // 事务
  transaction<T>(fn: (tx: SessionStorage) => T): T
```

### MainStorage extends SessionStorage — Main Session 额外能力

Main Session 注入此接口。除了自身数据操作外，还能：
1. 扁平收集所有子 Session 的 L2（用于 integration）
2. 操作拓扑树（用于前端渲染）
3. 读写全局状态

```
MainStorage extends SessionStorage:
  // 批量 L2 收集（integration 专用）
  getAllSessionL2s(): Array<{ sessionId: string; label: string; l2: string }>

  // 拓扑树（轻量，仅供前端渲染用）
  putNode(node: TopologyNode): void
  getChildren(parentId: string): TopologyNode[]
  removeNode(nodeId: string): void

  // Session 列举（管理用）
  listSessions(filter?: SessionFilter): SessionMeta[]

  // 全局键值（L1-structured）
  getGlobal(key: string): unknown
  putGlobal(key: string, value: unknown): void
```

### TopologyNode

```
TopologyNode:
  id: string            // = sessionId
  parentId: string | null  // 树中的父节点（null = 根节点，即 Main Session）
  label: string         // 冗余存储，避免渲染树时加载完整 SessionMeta
```

---

## 数据流向

```
普通 Session（注入 SessionStorage）
  send() → appendRecord, getSystemPrompt, getInsight, listRecords
  consolidate() → getMemory, putMemory, listRecords

Main Session（注入 MainStorage）
  send() → appendRecord, getSystemPrompt, getMemory(=synthesis), listRecords
  integrate() → getAllSessionL2s, putMemory(=synthesis), putInsight(各子session)

编排层 fork 流程:
  1. createSession() → SessionStorage.putSession
  2. 拷贝上下文 → SessionStorage.get*/put*
  3. MainStorage.putNode({ id, parentId, label }) → 拓扑树

前端渲染:
  MainStorage.getChildren(rootId) → 懒加载子节点
  点击节点 → SessionStorage.getSession(id) → 加载完整数据
```

---

## 实现说明

两个接口可以由同一个类实现（同一个数据库），接口分离只是约束注入范围：

```typescript
class PostgresStorage implements MainStorage {
  // 实现所有方法
}

// 注入时按需收窄
const session = await createSession({ storage: pgStorage as SessionStorage })
const main = await createMainSession({ storage: pgStorage as MainStorage })
```

InMemoryStorageAdapter 同理：实现 MainStorage，测试时按需注入。

---

## SessionMeta（无 parentId、无 depth）

```
SessionMeta:
  readonly id: string
  label: string
  role: 'standard' | 'main'
  status: 'active' | 'archived'
  turnCount: number
  consolidatedTurn: number
  tags: string[]
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
```

树状关系完全由 TopologyNode 维护，SessionMeta 不关心自己在树中的位置。
