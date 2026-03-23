# @stello-ai/server

Stello 的服务化层。基于 PostgreSQL 持久化，通过 REST（Hono）和 WebSocket 暴露 `@stello-ai/core` 的全部能力。

**核心约束：一个 space = 一个 StelloAgent = 一棵 session 树。**

---

## 快速开始

### 1. 启动 PostgreSQL

```bash
docker compose up -d   # 使用仓库内的 docker-compose.yml
```

### 2. 创建 Server

```typescript
import pg from 'pg'
import { createStelloServer } from '@stello-ai/server'

const pool = new pg.Pool({ connectionString: 'postgresql://stello:stello@localhost:5432/stello' })

const server = await createStelloServer({
  pool,
  agentPoolOptions: {
    buildConfig: (ctx) => ({
      // capabilities: 提供 lifecycle / tools / skills / confirm
      // session: 提供 sessionResolver / consolidateFn
      // 详见 @stello-ai/core 的 StelloAgentConfig
      capabilities: { /* ... */ },
      session: {
        sessionResolver: async (sessionId) => { /* ... */ },
        consolidateFn: async (currentMemory, messages) => { /* ... */ },
      },
    }),
    idleTtlMs: 5 * 60 * 1000, // 空闲 5 分钟驱逐 agent
  },
})

const { port, close } = await server.listen(3000)
console.log(`Stello server running on port ${port}`)
```

### 3. 调用 API

```bash
# 创建用户（直接写数据库，server 不提供注册接口）
# INSERT INTO users (api_key, name) VALUES ('my-api-key', 'Alice');

# 创建 Space
curl -X POST http://localhost:3000/spaces \
  -H "X-API-Key: my-api-key" \
  -H "Content-Type: application/json" \
  -d '{"label": "My Space", "systemPrompt": "You are helpful."}'
```

---

## 认证

所有 REST 和 WS 请求都需要 `X-API-Key` header。

Server 从 `users` 表校验 API key，提取 `userId`，再校验 space 所有权。

| 状态码 | 含义 |
|--------|------|
| 401 | API key 缺失或无效 |
| 403 | Space 不属于当前用户 |
| 404 | Space 或 Session 不存在 |

---

## REST API

### Space 管理

#### `POST /spaces` — 创建 Space

创建时自动创建 root session（role=main）。

请求体：
```json
{
  "label": "My Space",
  "systemPrompt": "You are helpful.",    // 可选
  "consolidatePrompt": "Summarize."      // 可选
}
```

响应 `201`：
```json
{
  "id": "uuid",
  "userId": "uuid",
  "label": "My Space",
  "systemPrompt": "You are helpful.",
  "consolidatePrompt": "Summarize.",
  "config": {},
  "createdAt": "2026-03-24T...",
  "updatedAt": "2026-03-24T..."
}
```

#### `GET /spaces` — 列出 Spaces

返回当前用户的所有 spaces。

响应 `200`：`Space[]`

#### `GET /spaces/:spaceId` — Space 详情

响应 `200`：`Space`

#### `PATCH /spaces/:spaceId` — 更新 Space

可更新字段：`label`、`systemPrompt`、`consolidatePrompt`。

更新 `systemPrompt` 时会同步写入 root session 的 session_data，无需重启 agent。

请求体：
```json
{
  "label": "New Name",
  "systemPrompt": "Updated prompt"
}
```

响应 `200`：更新后的 `Space`

#### `DELETE /spaces/:spaceId` — 删除 Space

级联删除所有 sessions、records、session_data。同时从 AgentPool 驱逐缓存的 agent。

响应 `204`：无 body

---

### Session 操作

#### `GET /spaces/:spaceId/sessions` — 列出 Sessions

返回 space 下所有 sessions（core SessionMeta 格式，含 parentId、children、refs、depth 等树结构信息）。

响应 `200`：`SessionMeta[]`

```json
[
  {
    "id": "uuid",
    "parentId": null,
    "children": ["uuid-1", "uuid-2"],
    "refs": [],
    "label": "Root",
    "index": 0,
    "scope": null,
    "status": "active",
    "depth": 0,
    "turnCount": 0,
    "metadata": {},
    "tags": [],
    "createdAt": "...",
    "updatedAt": "...",
    "lastActiveAt": "..."
  }
]
```

#### `GET /spaces/:spaceId/sessions/:id` — Session 详情

响应 `200`：`SessionMeta`

#### `GET /spaces/:spaceId/sessions/:id/messages` — 对话记录

返回 session 的 L3 对话历史（TurnRecord 格式）。

响应 `200`：`TurnRecord[]`

```json
[
  { "role": "user", "content": "hello", "timestamp": "..." },
  { "role": "assistant", "content": "hi there", "timestamp": "...", "metadata": { "model": "..." } }
]
```

#### `POST /spaces/:spaceId/sessions/:id/turn` — 非流式对话

REST 降级路径。适用于不需要流式输出的场景。

请求体：
```json
{ "input": "What is Stello?" }
```

响应 `200`：`EngineTurnResult`

#### `POST /spaces/:spaceId/sessions/:id/fork` — Fork Session

从指定 session 创建子分支。

请求体：
```json
{ "label": "Sub Topic", "scope": "coding" }
```

响应 `201`：新创建的 `SessionMeta`

#### `POST /spaces/:spaceId/sessions/:id/archive` — 归档 Session

将 session 状态设为 `archived`。

响应 `200`：`{ sessionId: string }`

---

## WebSocket API

### 连接

```
ws://host/spaces/:spaceId/ws
```

连接时通过 `X-API-Key` header 认证（在 WebSocket upgrade 请求中设置）。

```typescript
const ws = new WebSocket('ws://localhost:3000/spaces/{spaceId}/ws', {
  headers: { 'X-API-Key': 'my-api-key' },
})
```

每个 WS 连接绑定一个 space。同一连接上同一时刻只能 enter 一个 session。

### 客户端 → 服务端

所有消息均为 JSON 格式。

#### `session.enter` — 进入 Session

```json
{ "type": "session.enter", "sessionId": "uuid" }
```

服务端执行 `attachSession` + `enterSession`，返回 bootstrap 数据。

#### `session.message` — 非流式对话

```json
{ "type": "session.message", "input": "What is Stello?" }
```

需要先 `session.enter`，否则返回 `NOT_ENTERED` 错误。

#### `session.stream` — 流式对话

```json
{ "type": "session.stream", "input": "Explain in detail." }
```

服务端逐 chunk 推送 `stream.delta`，完成后推送 `stream.end`。

#### `session.fork` — Fork

```json
{ "type": "session.fork", "options": { "label": "Sub Topic", "scope": "coding" } }
```

#### `session.leave` — 离开 Session

```json
{ "type": "session.leave" }
```

服务端执行 `leaveSession` + `detachSession`。

### 服务端 → 客户端

#### `session.entered`

```json
{ "type": "session.entered", "sessionId": "uuid", "bootstrap": { "context": {...}, "session": {...} } }
```

#### `turn.complete`

```json
{ "type": "turn.complete", "result": { /* EngineTurnResult */ } }
```

#### `stream.delta`

```json
{ "type": "stream.delta", "chunk": "partial text..." }
```

#### `stream.end`

```json
{ "type": "stream.end", "result": { /* EngineTurnResult */ } }
```

#### `session.forked`

```json
{ "type": "session.forked", "child": { /* SessionMeta */ } }
```

#### `session.left`

```json
{ "type": "session.left", "sessionId": "uuid" }
```

#### `error`

```json
{ "type": "error", "message": "Not in a session", "code": "NOT_ENTERED" }
```

错误码：

| code | 含义 |
|------|------|
| `PARSE_ERROR` | 消息不是合法 JSON |
| `UNKNOWN_TYPE` | 未知的消息类型 |
| `NOT_ENTERED` | 未 enter session 就发送需要 session 的操作 |
| `ALREADY_ENTERED` | 已在 session 中，需先 leave |
| `HANDLER_ERROR` | 处理器内部错误 |

### 断连行为

客户端断开 WS 连接时，服务端只执行 `detachSession`（不执行 `leaveSession`）。engine runtime 通过 `runtimeRecyclePolicy` 自然回收。

---

## 典型流程

### REST: 创建 Space → 对话

```
POST /spaces              → 创建 space（自动创建 root session）
GET  /spaces/:id/sessions → 拿到 root session id
POST /spaces/:id/sessions/:rootId/turn → 发消息
GET  /spaces/:id/sessions/:rootId/messages → 读历史
```

### WS: 实时对话

```
WS /spaces/:id/ws                           → 建立连接
→ { type: "session.enter", sessionId }       → 进入 session
← { type: "session.entered", bootstrap }     → 收到 bootstrap
→ { type: "session.stream", input }          → 流式对话
← { type: "stream.delta", chunk }            → 逐 chunk 收到
← { type: "stream.delta", chunk }
← { type: "stream.end", result }             → 对话完成
→ { type: "session.fork", options }          → fork 子分支
← { type: "session.forked", child }
→ { type: "session.leave" }                  → 离开
← { type: "session.left", sessionId }
```

---

## 编程接口

除了 HTTP/WS，所有内部组件也可直接使用：

```typescript
import {
  // Server 入口
  createStelloServer,

  // 存储适配器
  PgSessionStorage,     // SessionStorage 实现
  PgMainStorage,        // MainStorage 实现（extends above）
  PgSessionTree,        // SessionTree 实现
  PgMemoryEngine,       // MemoryEngine 实现

  // 数据库
  createPool,           // pg.Pool 工厂
  migrate,              // 执行 SQL 迁移

  // Space 管理
  SpaceManager,         // Space CRUD
  AgentPool,            // per-space StelloAgent 缓存

  // WebSocket
  ConnectionManager,    // WS 连接态管理

  // 类型
  type Space,
  type SpaceConfig,
  type StelloServerOptions,
  type StelloServer,
  type AgentPoolOptions,
  type ConnectionState,
  type PoolOptions,
} from '@stello-ai/server'
```

---

## 数据库

Server 使用 PostgreSQL，7 张表：

| 表 | 用途 |
|----|------|
| `users` | API key 认证 |
| `spaces` | Space 配置 |
| `sessions` | Session 元数据（core + session 包共用） |
| `records` | L3 对话记录 |
| `session_data` | 统一槽位（system_prompt / insight / memory / scope / index） |
| `session_refs` | 跨分支引用 |
| `core_data` | Space 级全局键值 |

首次启动时 `createStelloServer()` 自动执行迁移（可通过 `skipMigrate: true` 跳过）。
