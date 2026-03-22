---
name: stello-usage
description: Stello 仓库总览入口。用于快速理解 core、session、orchestrator、agent、demo 与未来 server/sdk 的关系，以及当前推荐的使用方式。
---

# Stello 使用总览

这份 skill 是仓库总入口，不展开所有设计细节，只回答：

1. 当前仓库有哪些核心包
2. `@stello-ai/core` 现在推荐怎么使用
3. `StelloAgent` 对外暴露什么
4. 更细的设计文档分别在哪

---

## 当前仓库结构

- `@stello-ai/core`
  - 当前最核心的库
  - 负责 `StelloAgent`、`SessionOrchestrator`、`StelloEngine`、runtime manager
- `@stello-ai/session`
  - 单个 Session 原语层
  - 负责 `send / stream / consolidate / integrate`
- `@stello-ai/visualizer`
  - 可视化层
- `demo/stello-agent-basic`
  - 最小本地示例
- `demo/stello-agent-chat`
  - 真实 LLM + React 前端示例

---

## 当前推荐入口

当前不推荐业务侧直接手工装配：

- `SessionOrchestrator`
- `DefaultEngineFactory`
- `DefaultEngineRuntimeManager`

正常使用应优先从：

```ts
const agent = createStelloAgent(config)
```

开始。

`StelloAgent` 是当前 `@stello-ai/core` 推荐的最高层本地对象。

它：

- 不直接暴露 REST / WebSocket
- 只暴露本地可调用方法
- 是未来 `@stello-ai/server` 的承接对象

---

## 最常用接口

- `enterSession(sessionId)`
- `turn(sessionId, input)`
- `stream(sessionId, input)`
- `ingest(sessionId, message)`
- `leaveSession(sessionId)`
- `forkSession(sessionId, options)`
- `archiveSession(sessionId)`

连接态补充接口：

- `attachSession(sessionId, holderId)`
- `detachSession(sessionId, holderId)`
- `hasActiveEngine(sessionId)`
- `getEngineRefCount(sessionId)`

---

## 当前编排模型

```text
StelloAgent
  -> SessionOrchestrator
    -> EngineRuntimeManager
      -> StelloEngine
        -> SessionRuntime
```

一句话：

- `SessionRuntime` 负责单 Session 运行时能力
- `StelloEngine` 负责编排单 Session 生命周期
- `SessionOrchestrator` 负责多 Session 协调
- `StelloAgent` 是统一入口

当前并发语义：

- 同一个 `sessionId` 内串行
- 不同 `sessionId` 之间并行

---

## Session 接入现状

`@stello-ai/core` 已经支持正式接入 `@stello-ai/session`：

- `sessionResolver`
- `mainSessionResolver`
- `consolidateFn`
- `integrateFn`
- `serializeSendResult`
- `toolCallParser`

也就是说，Session 团队负责单 Session 实现，Core 负责把它装成 Agent 应用。

---

## demo

最重要的 demo 有两个：

- `demo/stello-agent-basic`
- `demo/stello-agent-chat`

后者已经支持：

- 真实 OpenAI 兼容模型
- 流式输出
- 工具调用展示
- Session 树展示
- 创建子 Session

---

## 推荐继续阅读

如果需要更细设计，按这个顺序：

1. `docs/stello-usage.md`
2. `docs/stello-agent-api.md`
3. `docs/config-design.md`
4. `docs/orchestrator-usage.md`
5. `docs/sdk-final-vision.md`

---

## 与 server / sdk 的关系

术语固定：

- `core` = 库
- `server` = 服务化适配层
- `sdk` = 对 server API 的薄客户端封装

未来 `@stello-ai/server` 应承接 `StelloAgent`，而不是重写编排逻辑。
