---
name: server-package-plan
description: `@stello-ai/server` 的包设计约束：如何承接 core 对象、如何暴露 REST/WS、以及 server 不该做什么。
---

# `@stello-ai/server` 设计约束

## 定位

`@stello-ai/server` 应该作为独立包存在，用来把 `@stello-ai/core` 的能力服务化。

它不是新的编排核心，而是：

- transport adapter
- service adapter
- connection manager

一句话：

**server 负责协议与连接，core 负责语义与编排。**

---

## server 应该承接什么

推荐承接：

- `StelloAgent`
- 或由 `StelloAgent` 包装起来的高层 runtime 对象

或者后续更高层的 runtime 对象。

但重点不在名字，而在职责：

- 按 `sessionId` 找到对应 Session / Engine
- 调用 agent / orchestrator
- 对外暴露 REST / WS

---

## server 不应该做什么

绝对不要在 `server` 里：

- 重写 `Engine`
- 重写 tool loop
- 重写 topology 规则
- 重写 Session 语义
- 自己偷偷加第二套编排逻辑

否则 `core` 和 `server` 会出现双重语义源。

---

## 推荐接口映射

REST：

- `POST /sessions/:id/enter`
- `POST /sessions/:id/leave`
- `POST /sessions/:id/messages`
- `POST /sessions/:id/fork`
- `POST /sessions/:id/archive`
- `GET /sessions/:id`
- `GET /topology`

WebSocket：

- 客户端事件：
  - `session.enter`
  - `session.leave`
  - `session.message`
  - `session.fork`
- 服务端事件：
  - `session.entered`
  - `session.left`
  - `message.completed`
  - `tool.called`
  - `tool.result`
  - `session.forked`
  - `error`

推荐的 WS 生命周期映射：

- `session.enter` -> `agent.attachSession(sessionId, connectionId)` + `agent.enterSession(sessionId)`
- `session.message` -> `agent.turn(sessionId, input)`
- `session.leave` -> `agent.leaveSession(sessionId)` + `agent.detachSession(sessionId, connectionId)`
- `socket.close` -> 至少执行 `agent.detachSession(sessionId, connectionId)`

---

## 连接态原则

连接态应留在 `server`，不要塞回 `core`。

推荐映射：

- `connectionId -> sessionId`

断线时：

- 由 `server` 决定是否调用 `agent.leaveSession(sessionId)`
- 但必须调用 `agent.detachSession(sessionId, connectionId)`

运行时回收策略应直接复用 `core` 的 `runtimeRecyclePolicy`，不要在 server 里再发明一套。

---

## 与 SDK 的关系

SDK 只封装 `server` API。

不要让 SDK：

- 直接 import `core`
- 自己装配 Engine
- 本地重跑编排逻辑

SDK 只负责：

- HTTP client
- WebSocket client
- 协议薄封装

---

## 当前建议

如果后续任务涉及 server 设计，应坚持下面三条：

1. `core` 先稳定语义
2. `server` 只做服务化适配
3. `SDK` 最后做薄封装
