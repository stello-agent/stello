---
name: server-storage
description: "@stello-ai/server 的 PG 持久化层：7 表 Schema、4 个 Storage Adapter 的公开 API 和实现模式。触发条件：修改或引用 server 存储层。"
---

# Server Storage Layer — PG 持久化

> 状态：**已实现**（2026-03-23）
>
> 相关 skill：**storage-design**（接口定义）、**server-design**（传输层）

---

## PG Schema — 7 张表

| 表 | 用途 | 主键 |
|----|------|------|
| `users` | API 认证 | UUID |
| `spaces` | Space 配置（label, system_prompt, consolidate_prompt, config） | UUID |
| `sessions` | Session 元数据超集（core + session 包共用） | UUID |
| `records` | L3 对话记录（session 包 Message + core TurnRecord 共用） | BIGSERIAL |
| `session_data` | 统一槽位（system_prompt / insight / memory / scope / index） | (session_id, key) |
| `session_refs` | 跨分支引用 | (from_id, to_id) |
| `core_data` | Space 级全局键值（L1-structured） | (space_id, path) |

### 设计决策

- **不需要 topology_nodes 表** — TopologyNode 从 sessions 表派生 `SELECT id, parent_id, label`
- **children/refs 不存列** — `WHERE parent_id=` 派生 children，JOIN session_refs 派生 refs
- **session_data 统一槽位** — 不同 key 存不同语义，避免列爆炸
- **records 表共享** — adapter 各自投影字段（Message 无 metadata，TurnRecord 有）
- **CASCADE 删除** — sessions ON DELETE CASCADE 级联到 records、session_data、session_refs

---

## 4 个 Storage Adapter

### 1. PgSessionStorage — 实现 `SessionStorage`（@stello-ai/session）

构造：`(client: Pool | PoolClient, spaceId: string)`

| 方法 | 说明 |
|------|------|
| `getSession(id)` → SessionMeta \| null | 投影为 session 包 SessionMeta（无 parentId/depth） |
| `putSession(session)` | UPSERT |
| `appendRecord(sessionId, record)` | INSERT INTO records |
| `listRecords(sessionId, options?)` | 支持 role/limit/offset 过滤 |
| `getSystemPrompt / putSystemPrompt` | session_data key='system_prompt' |
| `getInsight / putInsight / clearInsight` | key='insight' |
| `getMemory / putMemory` | key='memory' |
| `transaction(fn)` | BEGIN/COMMIT/ROLLBACK，传 PoolClient 版实例 |

### 2. PgMainStorage extends PgSessionStorage — 实现 `MainStorage`

| 方法 | 说明 |
|------|------|
| `getAllSessionL2s()` | JOIN sessions + session_data，status='active' role='standard' |
| `listSessions(filter?)` | 动态 WHERE（status/role/tags @> 数组包含） |
| `putNode / getChildren / removeNode` | sessions 表投影为 TopologyNode |
| `getGlobal / putGlobal` | core_data 表 UPSERT |

### 3. PgSessionTree — 实现 `SessionTree`（@stello-ai/core）

构造：`(client: Pool | PoolClient, spaceId: string)`

| 方法 | 说明 |
|------|------|
| `createRoot(label?)` | 额外方法，创建 space 时调用 |
| `createChild(options)` | 自动计算 index（兄弟 COUNT）和 depth（parent+1） |
| `get(id)` | 返回完整 core SessionMeta（含 children[] + refs[]） |
| `getRoot()` | WHERE parent_id IS NULL |
| `listAll()` | 全量，每个都水合 children/refs |
| `archive(id)` | SET status='archived' |
| `addRef(fromId, toId)` | 递归 CTE 校验祖先/后代，幂等 INSERT |
| `updateMeta(id, updates)` | 部分 UPDATE（label/scope/tags/metadata/turnCount） |
| `getAncestors(id)` | WITH RECURSIVE CTE |
| `getSiblings(id)` | 两步：查 parent → 查同 parent 兄弟 |

### 4. PgMemoryEngine — 实现 `MemoryEngine`（@stello-ai/core）

构造：`(client: Pool | PoolClient, spaceId: string)`

| 方法 | 说明 |
|------|------|
| `readCore(path?)` | 单路径或全量 core_data |
| `writeCore(path, value)` | UPSERT core_data |
| `readMemory / writeMemory` | session_data key='memory' |
| `readScope / writeScope` | key='scope' |
| `readIndex / writeIndex` | key='index' |
| `appendRecord / readRecords` | records 表（TurnRecord 有 metadata） |
| `assembleContext(sessionId)` | 递归 CTE 收集父链 memory + core + currentMemory + scope |

---

## 关键实现模式

### spaceId 隔离
所有 adapter 构造时绑定 spaceId，所有 SQL 查询 WHERE space_id = $1。多租户隔离在查询层保证。

### Slot 统一存储
`session_data (session_id, key)` 表存储 system_prompt / insight / memory / scope / index 五种数据，通过 key 区分。UPSERT 模式 `ON CONFLICT (session_id, key) DO UPDATE`。

### 两种 SessionMeta
PG 存 sessions 表超集。PgSessionStorage 投影为 session 包 SessionMeta（无 parentId/depth），PgSessionTree 投影为 core SessionMeta（含 parentId/children/refs/depth/turnCount/scope/lastActiveAt）。

### 递归 CTE
`getAncestors`、`getAllDescendantIds`、`assembleContext` 都用 `WITH RECURSIVE` 遍历树结构。

### 事务支持
`PgSessionStorage.transaction()` 通过类型判断 `'connect' in this.client` 区分 Pool 与 PoolClient。Pool 时获取独占 client 开事务，PoolClient 时直接执行（已在事务中）。

---

## SpaceManager + AgentPool

### SpaceManager
- `createSpace(userId, config)` — 事务内创建 space + root session + 可选写 system_prompt
- `updateSpace(spaceId, updates)` — 更新 spaces 表 + 同步 system_prompt 到 root session_data
- `deleteSpace(spaceId)` — CASCADE 删除

### AgentPool
- `getAgent(spaceId)` → StelloAgent — 懒创建，缓存命中直接返回
- 创建时组装 4 个 PG adapter + buildConfig 工厂
- TTL 驱逐（默认 5 min）、evict()、dispose()
