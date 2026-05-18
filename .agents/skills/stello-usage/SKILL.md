---
name: stello-usage
description: Stello 仓库总览入口。快速理解各包的关系、推荐入口、编排模型、单一 Session 模型。
---

# Stello 使用总览

---

## 包结构

- `@stello-ai/session` — 单个 Session 原语层（send / stream / consolidate）
- `@stello-ai/core` — 编排层（StelloAgent / SessionOrchestrator / Engine / SessionTree 拓扑）
- `@stello-ai/server` — 服务化适配层（PG 持久化 + REST/WS + 多租户 Space）
- `@stello-ai/visualizer` — 可视化层（星空图）

---

## 推荐入口

`createStelloAgent(config)` 是 `@stello-ai/core` 的唯一推荐入口。

开发者不需要手动装配 SessionOrchestrator、DefaultEngineFactory、DefaultEngineRuntimeManager——由 StelloAgent 构造时自动组装。

Server 层承接 StelloAgent，不重写编排逻辑。

---

## 单一 Session 模型

Stello 内部只有**一种 Session**。对话的起点是一个 `parentId === null` 的 root session，通过 `agent.createSession()` 创建（不传 `parentId`）；后续分支用 `agent.forkSession()` 创建子 session（`parentId` 指向父节点）。

拓扑允许多 root —— 同一个 agent 下可以并存多棵互相独立的对话树（森林）。所有 Session 共用同一套上下文组装规则、同一套 `SessionStorage` 接口；root 不具备任何特殊运行时行为，差异只体现在 `TopologyNode.parentId` 上。

跨 Session 的"全局意识层"由**应用层**承载——读取所有 Session 的 digest（memory + insight），用任意 LLM 反思后通过 `agent.putInsight(targetId, content)` 定向回写。详见 skill `session-usage`。

---

## 编排模型

```
StelloAgent（门面 + orchestrator-facing 数据 SDK）
  → SessionOrchestrator（多 Session 协调）
    → EngineRuntimeManager（runtime 生命周期）
      → DefaultEngineFactory（内联 consolidation 触发逻辑，闭包注入 hooks）
        → StelloEngine（单 Session 对话循环 + fire-and-forget hooks）
          → SessionRuntime（@stello-ai/session 适配）
```

一句话：Session 做单次调用，Engine 做对话循环，Factory 内联触发逻辑，Orchestrator 协调多 Session，Agent 是统一入口。

并发语义：同 sessionId 内串行，不同 sessionId 之间并行。

---

## Session 接入

`@stello-ai/core` 通过 `StelloAgentSessionConfig` 接入 `@stello-ai/session`：

- `sessionLoader(sessionId)` — 按 ID 解析真实 Session 实例（所有 Session 共用同一个 loader）
- `serializeSendResult` / `toolCallParser` — 序列化与工具解析

外加顶层 `StelloAgentConfig.storage` 用于 data-IO SDK（`listSessionDigests` / `putMemory` / `putInsight` 等）。应用层需保证 `sessions`（拓扑）与 `storage`（内容）指向同一份持久化后端。

---

## 与 server / sdk 的关系

- `core` = 库
- `server` = 服务化适配层
- `sdk` = 对 server API 的薄客户端封装（未来）

---

## 推荐继续阅读

Skills：stello-agent-creation / stello-agent-usage / orchestrator-usage / engine-design / scheduler-design / session-usage / fork-design / storage-design / server-design
