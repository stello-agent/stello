---
name: orchestrator-usage
description: Orchestrator 层定位、设计决策、与上下层的关系。开发者面向的 opinionated 库，Server 基于它构建。
---

# Orchestrator 层 — 面向开发者的编排库

---

## 定位

三层自由度递减：
- **Session 层**：纯库，完全 DI，零假设
- **Orchestrator 层**：库，但硬编码部分默认行为
- **Server 层**：框架，基于 orchestrator，加传输层

Orchestrator 和 Server 的分界线：**transport 和 coordination 是正交的**。串行队列、fork 路由、engine 生命周期管理跟"用 WS 还是 REST"无关。

---

## 入口

唯一推荐入口是 `createStelloAgent(config)`，返回 `StelloAgent` 实例。

StelloAgent 隐藏内部组件（orchestrator/factory/runtimeManager），只暴露操作方法。开发者通过 config 声明意图，不需要理解内部装配过程。

---

## 硬编码的 opinionated 行为

这些行为由 orchestrator 内部固定，开发者不能替换：

- **同 session 串行，不同 session 并行** — SessionOrchestrator 的 promise 链队列
- **Engine hooks 合并** — Factory 将用户 hooks 和 Scheduler 闭包合并，同 key 下都触发
- **Runtime ref-counting** — acquire/release 引用计数，归零回收（可配 idleTtlMs 延迟）
- **默认 MainSessionFlatStrategy** — fork 默认挂回根节点

### 可注入的扩展点

| 注入点 | 说明 | 默认值 |
|--------|------|--------|
| OrchestrationStrategy | fork 路由策略 | MainSessionFlatStrategy |
| Scheduler | 调度时机 | 手动触发 |
| EngineHookProvider | 开发者自定义 hook | 无 |
| SplitGuard | fork 前置校验 | 无限制 |
| RuntimeRecyclePolicy | 空闲回收策略 | 立即回收 |

---

## Session 接入的两种方式

1. **直接提供 runtime.resolver** — 开发者自己适配 EngineRuntimeSession
2. **提供 session.sessionResolver + consolidateFn** — StelloAgent 自动适配 @stello-ai/session

方式 2 是 @stello-ai/session 的推荐接入路径。

---

## 核心设计决策

- **StelloAgent 是门面，不是组装器** — 隐藏内部组件，只暴露操作方法
- **只有一种 config 形状** — 没有 legacy 兼容路径，减少认知负担
- **hooks 是不可变的开发期配置** — 构造时注入，运行期间不可修改
- **Server 承接 StelloAgent** — 通过 attach/detach 管理连接态，通过 turn/stream 转发请求
