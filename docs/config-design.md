# `@stello-ai/core` 配置设计

## 目标

这份文档说明当前 `core` 层推荐的配置设计方向，重点回答：

- 顶层配置应该长什么样
- 哪些配置是“用户策略”
- 哪些配置是“内部依赖注入”
- 新旧配置如何过渡

---

## 一、当前问题

在重构之前，`core` 里已经有多种配置对象，但语义混在一起：

- `StelloConfig`
  - 更偏旧版 `LifecycleManager` / memory 体系
- `DefaultEngineFactoryOptions`
  - 更偏内部装配依赖
- `StelloAgentConfig`
  - 最接近顶层使用入口，但之前仍然是扁平依赖堆叠

问题不是没有 config，而是：

- 用户策略
- 运行时策略
- 内部依赖注入

这三类东西之前没有分层。

---

## 二、推荐原则

配置设计先坚持 3 条原则：

1. 顶层对象只暴露分组后的配置，不暴露一堆散字段
2. “策略配置”和“依赖注入”必须分开
3. 允许旧配置兼容一段时间，但文档和示例应优先引导新形状

---

## 三、当前推荐的顶层配置形状

当前 `StelloAgent` 推荐使用下面这套分组结构：

```ts
interface StelloAgentConfig {
  sessions: SessionTree
  memory: MemoryEngine
  session?: {
    sessionResolver?: (sessionId: string) => Promise<SessionCompatible>
    mainSessionResolver?: () => Promise<MainSessionCompatible | null>
    consolidateFn?: SessionCompatibleConsolidateFn
    integrateFn?: SessionCompatibleIntegrateFn
    serializeSendResult?: (result: SessionCompatibleSendResult) => string
    toolCallParser?: ToolCallParser
    options?: Record<string, unknown>
  }
  capabilities: {
    lifecycle: EngineLifecycleAdapter
    tools: EngineToolRuntime
    skills: SkillRouter
    confirm: ConfirmProtocol
  }
  runtime: {
    resolver: SessionRuntimeResolver
    recyclePolicy?: RuntimeRecyclePolicy
  }
  orchestration?: {
    strategy?: OrchestrationStrategy
    splitGuard?: SplitGuard
    mainSession?: SchedulerMainSession | null
    turnRunner?: TurnRunner
    scheduler?: Scheduler
    hooks?: EngineHookProvider
  }
}
```

---

## 四、每一组的语义

### 1. `sessions` / `memory`

这两个仍然放在顶层，因为它们是系统最基础的核心依赖：

- `sessions`
  - Session Tree / Topology 数据来源
- `memory`
  - 跨 session 的 memory 访问入口

### 2. `capabilities`

这一组表示“能力注入”：

- `lifecycle`
- `tools`
- `skills`
- `confirm`

它们决定系统“能做什么”，而不是“怎么调度”。

### 3. `session`

这一组现在已经不只是预留位，而是开始承接正式的 Session 接入配置。

当前已经支持的正式字段有：

- `session.sessionResolver`
- `session.mainSessionResolver`
- `session.consolidateFn`
- `session.integrateFn`
- `session.serializeSendResult`
- `session.toolCallParser`

它们的作用是：

- 把真实 `@stello-ai/session` 的 Session / MainSession 接到 core
- 让 `core` 自动生成 `EngineRuntimeSession` / `SchedulerMainSession`
- 让 `TurnRunner` 理解真实 Session 的 `send()` 返回格式

当前仍然保留的透传区是：

- `session.options`

所以现在这一组的职责变成了两部分：

- 正式接入真实 Session
- 为 Session 团队后续字段继续留扩展位

### 4. `runtime`

这一组表示“单个 session runtime 怎么存活”：

- `resolver`
  - `sessionId -> SessionRuntime`
- `recyclePolicy`
  - 什么时候回收 engine runtime

这是专门留给：

- WebSocket
- 长连接
- 短断线重连

这类 runtime 生命周期问题的。

### 5. `orchestration`

这一组表示“多 session 编排策略”：

- `strategy`
- `splitGuard`
- `mainSession`
- `turnRunner`
- `scheduler`
- `hooks`

它们决定的是：

- 怎么 fork
- 怎么调度 consolidate / integrate
- tool loop 怎么跑
- hooks 怎么触发

---

## 五、为什么这样分组

这样拆的目的，是让配置能直接回答三个不同层面的问题：

### 1. 你接了哪些能力？

看 `capabilities`

### 2. 你的 runtime 怎么活？

看 `runtime`

### 3. 你的多 session 怎么编排？

看 `orchestration`

如果这些语义都放在一个扁平对象里，后面：

- 很难读
- 很难扩展
- 很难给不同层的用户提供不同抽象

---

## 六、旧配置兼容策略

当前实现里，`StelloAgent` 仍然兼容旧版扁平配置。

也就是说，下面这种旧写法暂时还可以继续用：

```ts
createStelloAgent({
  sessions,
  memory,
  lifecycle,
  tools,
  skills,
  confirm,
  sessionRuntimeResolver,
  splitGuard,
  scheduler,
  turnRunner,
  hooks,
  runtimeRecyclePolicy,
  strategy,
})
```

内部会自动 normalize 成新的分组式配置。

这样做的目的只有一个：

- 避免当前 smoke / demo / test 一次性全改

但从文档层面开始，应优先使用新的分组式配置。

---

## 七、什么暂时不放进顶层配置

当前先不把下面这些继续往顶层塞：

- HTTP / WS server 配置
- SDK 配置
- 前端连接配置
- MCP 的最终多层覆盖规则
- per-session 更细粒度的能力覆盖策略

这些后面都可能存在，但现在还没必要放进 `core` 顶层 config。

---

## 八、后续演进方向

当前这一步只是先把配置分层理顺，还没有把所有层次最终定稿。

下一步更可能的演进方向是：

### 1. 简化版配置

给普通用户再包一层更易用的配置：

```ts
createStelloAgentFromSimpleConfig({
  dataDir,
  coreSchema,
  callLLM,
  strategy: "main-flat",
  runtime: {
    idleTtlMs: 30_000,
  },
})
```

### 2. 更高级的 per-session 配置

以后如果 `Session` 组件化成熟，还可以继续支持：

- 不同 session 不同 tools
- 不同 session 不同 skills
- 不同 session 不同 system prompt
- 不同 session 不同 memory policy

但这一步不应该现在抢先塞进 `StelloAgentConfig`。

更准确地说：

- 现在已经有一部分 Session 配置被正式接入
- 但 `session.options` 仍然保留为未来字段的缓冲区
- 等 Session 配置字段进一步稳定后，再继续把它们从 `options` 收敛成正式强类型

---

## 九、当前结论

当前 `core` 的配置设计结论可以先固定成：

- 顶层对象是 `StelloAgent`
- 推荐配置形状是分组式 `StelloAgentConfig`
- 分组边界是：
  - `capabilities`
  - `runtime`
  - `orchestration`
- 旧扁平配置暂时兼容，但不再作为主推写法

一句话总结：

**先把配置分层理顺，再决定哪些层以后要进一步简化，哪些层要继续开放给高级用户。**
