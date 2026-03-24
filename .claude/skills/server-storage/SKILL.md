---
name: server-storage
description: "@stello-ai/server 的 PG 持久化层设计决策和实现模式。触发条件：修改或引用 server 存储层。"
---

# Server Storage Layer — PG 持久化

> 相关 skill：**storage-design**（接口定义）、**server-design**（传输层）

---

## Schema 设计决策

7 张表：users, spaces, sessions, records, session_data, session_refs, core_data

- **不需要 topology_nodes 表** — TopologyNode 从 sessions 表派生（`SELECT id, parent_id, label`）
- **children/refs 不存列** — `WHERE parent_id=` 派生 children，JOIN session_refs 派生 refs
- **session_data 统一槽位** — 不同 key 存不同语义（system_prompt / insight / memory / scope / index），避免列爆炸
- **records 表共享** — session 包和 core 包各自投影字段（Message 无 metadata，TurnRecord 有）
- **CASCADE 删除** — sessions ON DELETE CASCADE 级联到 records、session_data、session_refs

---

## 4 个 Storage Adapter

| Adapter | 实现接口 | 职责 |
|---------|---------|------|
| PgSessionStorage | SessionStorage（@stello-ai/session） | 单个 Session 数据操作 |
| PgMainStorage | MainStorage（extends SessionStorage） | 额外：批量 L2 收集、拓扑树、全局键值 |
| PgSessionTree | SessionTree（@stello-ai/core） | 树操作：创建节点、递归树、祖先/兄弟查询 |
| PgMemoryEngine | MemoryEngine（@stello-ai/core） | 核心数据读写、递归上下文组装 |

---

## 关键实现模式

### spaceId 隔离
所有 adapter 构造时绑定 spaceId，所有 SQL 查询 WHERE space_id = $1。多租户隔离在查询层保证。

### Slot 统一存储
`session_data (session_id, key)` 表，UPSERT 模式 `ON CONFLICT (session_id, key) DO UPDATE`。

### 两种 SessionMeta 投影
PG 存 sessions 表超集。不同 adapter 投影为不同类型：
- PgSessionStorage → @stello-ai/session 的 SessionMeta（有 role，无 scope/turnCount）
- PgSessionTree → @stello-ai/core 的 SessionMeta（有 scope/turnCount，无树字段）+ TopologyNode（纯树结构）

### 递归 CTE
`getAncestors`、`getAllDescendantIds`、`assembleContext` 都用 `WITH RECURSIVE` 遍历树结构。

### 事务支持
`PgSessionStorage.transaction()` 通过类型判断区分 Pool 与 PoolClient。Pool 时获取独占 client 开事务，PoolClient 时直接执行。
