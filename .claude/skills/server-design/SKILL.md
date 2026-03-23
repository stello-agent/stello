---
name: server-design
description: Server 层设计：传输层架构（REST/Hono + WS）、StelloAgent 映射、连接态管理。存储层见 server-storage，Engine 细节见 engine-design。
---

# Server 层（Service Layer）技术设计

> 状态：**Phase 1-3 已实现**（存储 + Space 管理 + Agent 池），**Phase 4-5 实现中**（传输层）
>
> 相关 skill：**server-storage**（PG 持久化）、**engine-design**（Engine 内部）、**orchestrator-usage**（StelloAgent API）

---

## 1. 架构总览

```
┌─────────────────────────────────────────────────┐
│  Transport Layer（Phase 4-5）                    │
│  Hono REST + ws WebSocket                       │
├─────────────────────────────────────────────────┤
│  Space 管理层（Phase 3，已实现）                  │
│  SpaceManager · AgentPool                       │
├─────────────────────────────────────────────────┤
│  PG Storage Layer（Phase 2，已实现）              │
│  PgSessionStorage · PgMainStorage               │
│  PgSessionTree · PgMemoryEngine                 │
├─────────────────────────────────────────────────┤
│  Core（@stello-ai/core）                         │
│  StelloAgent → SessionOrchestrator → Engine     │
└─────────────────────────────────────────────────┘
```

核心约束：**一个 space = 一个 StelloAgent = 一棵 session 树**。

---

## 2. REST API（Hono）

认证：`X-API-Key` header → users 表 → userId

### Space 路由

| 路由 | StelloAgent 映射 |
|------|-----------------|
| `POST /spaces` | SpaceManager.createSpace |
| `GET /spaces` | SpaceManager.listSpaces |
| `GET /spaces/:spaceId` | SpaceManager.getSpace + 所有权校验 |
| `PATCH /spaces/:spaceId` | SpaceManager.updateSpace |
| `DELETE /spaces/:spaceId` | SpaceManager.deleteSpace + AgentPool.evict |

### Session 路由

| 路由 | StelloAgent 映射 |
|------|-----------------|
| `GET /spaces/:spaceId/sessions` | PgSessionTree.listAll() |
| `GET /spaces/:spaceId/sessions/:id` | PgSessionTree.get(id) |
| `POST /spaces/:spaceId/sessions/:id/fork` | agent.forkSession(id, body) |
| `POST /spaces/:spaceId/sessions/:id/archive` | agent.archiveSession(id) |
| `GET /spaces/:spaceId/sessions/:id/messages` | PgMemoryEngine.readRecords(id) |
| `POST /spaces/:spaceId/sessions/:id/turn` | agent.turn(id, body.input) |

---

## 3. WebSocket 协议

URL: `ws://host/spaces/:spaceId/ws`
认证: `X-API-Key` header（升级请求时验证，不用 query param）
库: `ws`（Node.js 标准库，`noServer: true` 共享 HTTP server）

### 客户端 → 服务端

| 消息类型 | StelloAgent 映射 |
|---------|-----------------|
| `session.enter { sessionId }` | attachSession + enterSession |
| `session.message { input }` | turn(sessionId, input) |
| `session.stream { input }` | stream(sessionId, input) |
| `session.leave` | leaveSession + detachSession |
| `session.fork { options }` | forkSession(sessionId, options) |

### 服务端 → 客户端

| 消息类型 | 说明 |
|---------|------|
| `session.entered { bootstrap }` | enterSession 返回值 |
| `turn.complete { result }` | 非流式 turn 结果 |
| `stream.delta { chunk }` | 流式增量 token |
| `stream.end { result }` | 流式完成 + 完整结果 |
| `session.left { sessionId }` | leave 确认 |
| `session.forked { child }` | fork 后的新 SessionMeta |
| `error { message, code? }` | 错误 |

### 断连处理

socket close → 只执行 `agent.detachSession(sessionId, connectionId)`，不 leave。runtime 通过 recyclePolicy 自然回收。

---

## 4. 连接态管理

ConnectionManager（纯内存，不持久化）：

```
connectionId → { userId, spaceId, sessionId | null }
```

- WS upgrade 时 bind(connId, userId, spaceId)
- session.enter 时 attachSession(connId, sessionId)
- session.leave / socket close 时 detachSession(connId)
- socket close 时 unbind(connId)

---

## 5. createStelloServer 入口

```typescript
createStelloServer(options) → StelloServer
  .app          // Hono instance（可用 app.request() 测试）
  .listen(port) // 启动 HTTP + WS，返回 { port, close() }
  .spaceManager
  .agentPool
```

`listen()` 内部用 `@hono/node-server` 的 `serve()` 创建 HTTP server，再附着 `ws.WebSocketServer({ noServer: true })`。

---

## 6. 设计决策

- **WS 用 `ws` 库** — Hono 内置 WS 面向 edge，不适合 Node.js
- **WS 认证用 header** — API key 不暴露在 URL
- **stream 和 message 是独立消息类型** — 客户端显式选择
- **Space 级 WS 连接** — URL 中确定 spaceId，匹配 AgentPool per-space 缓存
- **REST 降级路径** — `/turn` 端点支持无 WS 的非流式对话
