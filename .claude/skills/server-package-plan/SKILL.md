---
name: server-package-plan
description: "@stello-ai/server 的职责边界和设计原则。Server 只做服务化适配，不重写编排逻辑。"
---

# `@stello-ai/server` 包设计

## 定位

`@stello-ai/server` 把 `@stello-ai/core` 的能力服务化。

**server 负责协议与连接，core 负责语义与编排。**

---

## Server 不该做的事

- 不重写 Engine / tool loop / topology 规则 / Session 语义
- 不自己发明第二套编排逻辑
- 连接态留在 server，不塞回 core
- 运行时回收复用 core 的 `runtimeRecyclePolicy`

---

## 与上下游的关系

- **Core** 先稳定语义 → **Server** 做服务化适配 → **SDK** 最后做薄封装
- Server 通过 `StelloAgent` 的公开 API 操作（turn/stream/enterSession/attachSession 等）
- Server 通过 `AgentPool.getAgent(spaceId)` 获取 per-space 的 StelloAgent

---

## 核心约束

- 一个 space = 一个 StelloAgent = 一棵 session 树
- 多租户隔离在 SQL 查询层保证（所有 adapter 绑定 spaceId）
- WS 认证用 header（API key 不暴露在 URL）
- 断连只 detach，不 leave（runtime 通过 recyclePolicy 自然回收）
