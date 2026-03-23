---
name: orchestrator-usage
description: Orchestrator 层定位、公开 API、配置方式、与上下层的关系。开发者面向的 opinionated 库，Server 基于它构建。
---

# Orchestrator 层 — 面向开发者的编排库

> 状态：**已实现**（2026-03-23 更新）

---

## 定位

Orchestrator 是 Session/Engine 之上的**opinionated 多 Session 编排库**，面向开发者。

三层自由度递减：
- **Session 层**：纯库，完全 DI，零假设
- **Orchestrator 层**：库，但硬编码部分默认行为（串行队列、hook 合并、默认策略）
- **Server 层**（未来）：框架，基于 orchestrator，加传输层（WS/HTTP）

Orchestrator 和 Server 的分界线：**transport 和 coordination 是正交的**。串行队列、fork 路由、engine 生命周期管理跟"用 WS 还是 REST"无关。

---

## 入口

唯一推荐入口是 `createStelloAgent(config)`，返回 `StelloAgent` 实例。

开发者不需要手动装配 `SessionOrchestrator`、`DefaultEngineFactory`、`DefaultEngineRuntimeManager`——这些是内部实现，由 StelloAgent 构造时自动组装。

---

## StelloAgent 公开 API

**对话操作：**
- `enterSession(sessionId)` — 进入 session
- `turn(sessionId, input, options?)` — 非流式对话
- `stream(sessionId, input, options?)` — 流式对话
- `leaveSession(sessionId)` — 离开 session
- `ingest(sessionId, message)` — skill 匹配
- `forkSession(sessionId, options)` — 从指定 session 发起 fork
- `archiveSession(sessionId)` — 归档 session

**连接态管理（Server 层会用）：**
- `attachSession(sessionId, holderId)` — 附着 runtime（如 WS 连接建立）
- `detachSession(sessionId, holderId)` — 释放 runtime（如 WS 断开）
- `hasActiveEngine(sessionId)` — 是否有活跃 engine
- `getEngineRefCount(sessionId)` — 引用计数

**只读属性：**
- `sessions` — SessionTree 引用
- `config` — 归一化后的配置

内部组件（orchestrator / engineFactory / runtimeManager）不对外暴露。

---

## 配置结构 — StelloAgentConfig

唯一的配置形状，没有 legacy 兼容路径：

| 字段 | 说明 |
|------|------|
| `sessions` | SessionTree 实例 |
| `memory` | MemoryEngine 实例 |
| `capabilities` | 能力注入：lifecycle / tools / skills / confirm |
| `session?` | Session 组件接入：sessionResolver / consolidateFn / integrateFn |
| `runtime?` | Runtime 配置：resolver / recyclePolicy |
| `orchestration?` | 编排配置：strategy / scheduler / hooks / splitGuard |

### Session 接入的两种方式

1. **直接提供 runtime.resolver** — 开发者自己适配 EngineRuntimeSession
2. **提供 session.sessionResolver + consolidateFn** — StelloAgent 自动适配 @stello-ai/session

方式 2 是 @stello-ai/session 的推荐接入路径。

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
| `OrchestrationStrategy` | fork 路由策略 | MainSessionFlatStrategy |
| `Scheduler` | 调度时机（consolidate/integrate） | 手动触发 |
| `EngineHookProvider` | 开发者自定义 hook | 无 |
| `SplitGuard` | fork 前置校验 | 无限制 |
| `RuntimeRecyclePolicy` | 空闲回收策略 | 立即回收 |

---

## 与 Server 的关系

Server 承接 StelloAgent，不重写编排逻辑：

- Server 通过 `attachSession`/`detachSession` 管理 WS 连接态
- Server 通过 `turn`/`stream` 转发对话请求
- Server 负责 WS 协议解析、HTTP 路由、多租户隔离
- Orchestrator 不知道 transport 的存在

---

## 核心设计决策

### StelloAgent 是门面，不是组装器

StelloAgent 隐藏内部组件（orchestrator/factory/runtimeManager），只暴露操作方法。开发者通过 config 声明意图，不需要理解内部装配过程。

### 只有一种 config 形状

没有 legacy 兼容路径。StelloAgentConfig 是唯一入口，减少认知负担。

### hooks 是不可变的开发期配置

EngineHooks 在构造时一次性注入，运行期间不可修改。这与 CLAUDE.md "回调一次性注入（immutable config）"一致。
