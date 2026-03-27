---
name: stello-usage
description: Stello 仓库总览入口。快速理解各包的关系、推荐入口、编排模型。
---

# Stello 使用总览

---

## 包结构

- `@stello-ai/session` — 单个 Session 原语层（send / stream / consolidate / integrate）
- `@stello-ai/core` — 编排层（StelloAgent / SessionOrchestrator / Engine / Scheduler）
- `@stello-ai/server` — 服务化适配层（PG 持久化 + REST/WS + 多租户 Space）
- `@stello-ai/visualizer` — 可视化层（星空图）

---

## 推荐入口

`createStelloAgent(config)` 是 `@stello-ai/core` 的唯一推荐入口。

开发者不需要手动装配 SessionOrchestrator、DefaultEngineFactory、DefaultEngineRuntimeManager——由 StelloAgent 构造时自动组装。

Server 层承接 StelloAgent，不重写编排逻辑。

---

## 编排模型

```
StelloAgent（门面）
  → SessionOrchestrator（多 Session 协调）
    → EngineRuntimeManager（runtime 生命周期）
      → DefaultEngineFactory（持有 Scheduler + MainSession，闭包注入 hooks）
        → StelloEngine（单 Session 对话循环 + fire-and-forget hooks）
          → SessionRuntime（@stello-ai/session 适配）
```

一句话：Session 做单次调用，Engine 做对话循环，Factory 注入调度，Orchestrator 协调多 Session，Agent 是统一入口。

并发语义：同 sessionId 内串行，不同 sessionId 之间并行。

---

## Session 接入

`@stello-ai/core` 通过 `StelloAgentSessionConfig` 接入 `@stello-ai/session`：

- `sessionResolver` / `mainSessionResolver` — 按 ID 解析真实 Session
- `consolidateFn` / `integrateFn` — L3→L2 / all L2s→synthesis 的提炼函数
- `serializeSendResult` / `toolCallParser` — 序列化与工具解析

Session 团队负责单 Session 实现，Core 负责把它装成 Agent 应用。

---

## 与 server / sdk 的关系

- `core` = 库
- `server` = 服务化适配层
- `sdk` = 对 server API 的薄客户端封装（未来）

---

## 推荐继续阅读

Skills：orchestrator-usage / engine-design / scheduler-design / session-usage / server-design
