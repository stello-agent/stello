---
name: server-design
description: Server 层设计：传输层架构决策、StelloAgent 映射原则、连接态管理模式。存储层见 server-storage，Engine 细节见 engine-design。
---

# Server 层（Service Layer）设计

> 相关 skill：**server-storage**（PG 持久化）、**engine-design**（Engine 内部）、**orchestrator-usage**（StelloAgent API）

---

## 架构分层

```
Transport Layer（Hono REST + ws WebSocket）
  ↓
Space 管理层（SpaceManager · AgentPool）
  ↓
PG Storage Layer（4 个 Storage Adapter）
  ↓
Core（@stello-ai/core — StelloAgent → SessionOrchestrator → Engine）
```

---

## 设计决策

- **WS 用 `ws` 库** — Hono 内置 WS 面向 edge，不适合 Node.js
- **WS 认证用 header** — API key 不暴露在 URL
- **stream 和 message 是独立消息类型** — 客户端显式选择
- **Space 级 WS 连接** — URL 中确定 spaceId，匹配 AgentPool per-space 缓存
- **REST 降级路径** — `/turn` 端点支持无 WS 的非流式对话
- **断连只 detach 不 leave** — runtime 通过 recyclePolicy 自然回收

---

## 连接态管理

ConnectionManager（纯内存，不持久化）：

```
connectionId → { userId, spaceId, sessionId | null }
```

- WS upgrade 时 bind(connId, userId, spaceId)
- session.enter 时 attach
- session.leave / socket close 时 detach
- socket close 时 unbind

---

## AgentPool 默认 fn 注入

AgentPool 支持内置默认 consolidateFn / integrateFn：

- `AgentPoolOptions.llm` 提供最小 LLM 调用接口
- Space 表存 `consolidatePrompt` / `integratePrompt`
- 如果 buildConfig 未提供显式 fn，且 Space 有 prompt 且 llm 可用 → 自动注入默认实现
- buildConfig 提供的显式 fn 始终优先

---

## createStelloServer 入口

`createStelloServer(options)` 返回 `StelloServer`，内部用 `@hono/node-server` 的 `serve()` 创建 HTTP server，再附着 `ws.WebSocketServer({ noServer: true })`。
