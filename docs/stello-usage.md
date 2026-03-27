# Stello 使用总览

## 目标

这份文档是当前代码仓库里的总入口文档。

它不展开所有设计细节，只回答 4 个问题：

1. Stello 现在有哪些核心包
2. `@stello-ai/core` 当前推荐怎么使用
3. `StelloAgent` 能做什么
4. 相关 demo 和深度文档分别在哪

如果你第一次进入这个仓库，建议先看这篇，再决定继续读哪一份设计稿。

---

## 一、仓库结构

当前仓库是一个 `pnpm` monorepo，主要有这几个包：

- `@stello-ai/core`
  - 当前最核心的库
  - 负责 Agent 应用的编排、Session 协调、Engine 运行时管理
- `@stello-ai/session`
  - 单个 Session 原语层
  - 负责单次 LLM 对话、messages、memory/consolidate、stream
- `@stello-ai/visualizer`
  - Session 拓扑可视化
- `demo/stello-agent-basic`
  - 最小 `StelloAgent` 使用示例
- `demo/stello-agent-chat`
  - 真实 LLM + React 前端的交互 demo

---

## 二、现在推荐的核心使用方式

当前不推荐直接从零手工组装：

- `SessionOrchestrator`
- `DefaultEngineFactory`
- `DefaultEngineRuntimeManager`

这些对象仍然存在，但正常使用时应该优先从最外层的 `StelloAgent` 开始。

也就是说，当前 `@stello-ai/core` 推荐的使用姿势是：

```ts
import { createStelloAgent } from '@stello-ai/core'
```

然后通过：

```ts
const agent = createStelloAgent(config)
```

拿到整个 Agent 应用的本地交互入口。

---

## 三、StelloAgent 是什么

`StelloAgent` 是 `@stello-ai/core` 当前推荐的最高层门面对象。

它的定位是：

- 不直接暴露 RESTful API
- 不直接暴露 WebSocket 协议
- 只暴露一组本地可调用的方法
- 作为未来 `@stello-ai/server` 的承接对象

你可以把它理解成：

> “整个 AgentApp 在本地代码中的控制台”

---

## 四、最小配置结构

当前推荐的 `StelloAgentConfig` 是分组式的，重点分成：

- `sessions`
- `memory`
- `session`
- `capabilities`
- `runtime`
- `orchestration`

一个典型形状如下：

```ts
const agent = createStelloAgent({
  sessions,
  memory,
  session: {
    sessionResolver,
    mainSessionResolver,
    consolidateFn,
    integrateFn,
  },
  capabilities: {
    lifecycle,
    tools,
    skills,
    confirm,
  },
  runtime: {
    resolver,
    recyclePolicy: {
      idleTtlMs: 30_000,
    },
  },
  orchestration: {
    strategy,
    hooks,
  },
})
```

这几组的语义分别是：

- `sessions`
  - Session Tree / Topology 数据来源
- `memory`
  - L1/L2/L3 memory 访问入口
- `session`
  - 接入真实 `@stello-ai/session` 的正式配置区
- `capabilities`
  - lifecycle / tools / skills / confirm 这类能力注入
- `runtime`
  - session engine 的创建、复用、回收策略
- `orchestration`
  - 多 Session 编排策略和 hooks

更详细的配置说明见：

- [config-design.md](/Users/bytedance/Github/stello/docs/config-design.md)
- [stello-agent-config.template.ts](/Users/bytedance/Github/stello/docs/stello-agent-config.template.ts)

---

## 五、StelloAgent 对外接口

当前最常用的接口有两组。

### 1. 普通交互接口

- `enterSession(sessionId)`
- `turn(sessionId, input)`
- `stream(sessionId, input)`
- `ingest(sessionId, message)`
- `leaveSession(sessionId)`
- `forkSession(sessionId, options)`
- `archiveSession(sessionId)`

这组接口用于：

- 进入一个 session
- 发送消息
- 实时流式展示回复
- 创建子 session
- 结束或归档某个 session

### 2. 运行时管理接口

- `attachSession(sessionId, holderId)`
- `detachSession(sessionId, holderId)`
- `hasActiveEngine(sessionId)`
- `getEngineRefCount(sessionId)`

这组接口更适合：

- WebSocket 连接管理
- 长连接场景
- runtime engine 保活和回收

更完整的 API 说明见：

- [stello-agent-api.md](/Users/bytedance/Github/stello/docs/stello-agent-api.md)

---

## 六、当前编排模型

现在 `@stello-ai/core` 的分层关系是这样的：

```text
StelloAgent
  -> SessionOrchestrator
    -> EngineRuntimeManager
      -> StelloEngine
        -> SessionRuntime
```

一句话解释：

- `SessionRuntime`
  - 单个 Session 的运行时能力
- `StelloEngine`
  - 单 Session 生命周期编排器
- `EngineRuntimeManager`
  - 单 Session engine 的创建、复用、回收
- `SessionOrchestrator`
  - 多 Session 协调器
- `StelloAgent`
  - 最外层统一入口

当前并发语义：

- 同一个 `sessionId` 内串行
- 不同 `sessionId` 之间并行

当前默认策略：

- `MainSessionFlatStrategy`
  - 主 Session 下的子节点平铺
- `HierarchicalOkrStrategy`
  - 只预留接口，暂未实现

更多说明见：

- [orchestrator-usage.md](/Users/bytedance/Github/stello/docs/orchestrator-usage.md)
- [orchestrator-strategies.md](/Users/bytedance/Github/stello/docs/orchestrator-strategies.md)

---

## 七、Session 接入现状

`@stello-ai/core` 现在已经支持正式接入 `@stello-ai/session`。

目前已经有桥接适配层，把真实 Session 适配成 core 需要的运行时接口。

也就是说：

- Session 同学负责单个 Session 的实现
- Core 这边负责把 Session 接成 Agent 应用

当前已经支持：

- `send()`
- `stream()`
- `consolidate()`
- `MainSession.integrate()`
- `toolCalls` 解析

但如果你要理解 Session 自身设计，建议继续读：

- [session-usage.md](/Users/bytedance/Github/stello/docs/session-usage.md)

---

## 八、Demo 怎么看

仓库里现在有两个最有用的 demo。

### 1. 最小本地 demo

目录：

- `demo/stello-agent-basic`

用途：

- 看 `createStelloAgent(config)` 的最小使用方式
- 看最基础的 `enter/turn/fork/attach/detach`

### 2. 真实聊天工作台 demo

目录：

- `demo/stello-agent-chat`

用途：

- 接真实 OpenAI 兼容模型
- React + TailwindCSS 前端
- 流式输出
- 工具调用组件
- Session 树展示
- 真实创建子 Session

运行：

```bash
export OPENAI_BASE_URL=https://api.minimaxi.com/v1
export OPENAI_API_KEY=你的key
export OPENAI_MODEL=MiniMax-M1

node --import tsx demo/stello-agent-chat/chat-devtools.ts
```

如果你只想验证装配：

```bash
OPENAI_API_KEY=fake DEMO_DRY_RUN=1 node --import tsx demo/stello-agent-chat/chat-devtools.ts
```

---

## 九、和未来 Server / SDK 的关系

当前这套代码主要还是“库”。

语义上要明确：

- `@stello-ai/core`
  - 库
- `@stello-ai/server`
  - 未来服务层
- `SDK`
  - 未来对 Server API 的薄客户端封装

所以当前：

- `StelloAgent` 是本地对象
- 不是网络协议层对象

未来 `@stello-ai/server` 会承接 `StelloAgent`，把这些本地方法映射成：

- HTTP 接口
- WebSocket 连接模型

相关设计见：

- [server-package-plan.md](/Users/bytedance/Github/stello/docs/server-package-plan.md)
- [server-ws-connection-model.md](/Users/bytedance/Github/stello/docs/server-ws-connection-model.md)

---

## 十、推荐阅读顺序

如果你是第一次接触这个仓库，建议按这个顺序：

1. 先看这篇总览
2. 再看 [stello-agent-api.md](/Users/bytedance/Github/stello/docs/stello-agent-api.md)
3. 再看 [config-design.md](/Users/bytedance/Github/stello/docs/config-design.md)
4. 需要理解编排时，再看 [orchestrator-usage.md](/Users/bytedance/Github/stello/docs/orchestrator-usage.md)
5. 需要理解长期目标时，再看 [sdk-final-vision.md](/Users/bytedance/Github/stello/docs/sdk-final-vision.md)

---

## 十一、当前一句话总结

当前 Stello 已经不是“单个聊天引擎”了，而是一套：

- Session 可自治
- Engine 负责编排单 Session 生命周期
- Orchestrator 负责编排多 Session
- StelloAgent 作为整个 AgentApp 本地入口

的会话拓扑库。
