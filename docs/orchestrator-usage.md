# StelloAgent 与 Orchestrator 用法

## 目的

这份文档说明当前库里推荐的装配方式：

- 最外层推荐直接使用 `StelloAgent`
- 单个 `Engine` 只绑定一个 `SessionRuntime`
- 多个 Session 之间的协调交给 `SessionOrchestrator`
- `DefaultEngineFactory` 负责把 `sessionId` 装配成对应的 `Engine`
- `DefaultEngineRuntimeManager` 负责运行时 `Engine` 的创建、复用和回收

---

## 一、分层关系

```text
StelloAgent
   |
   v
SessionOrchestrator
   |
   v
DefaultEngineRuntimeManager.acquire(sessionId, holderId)
   |
   v
StelloEngine(session runtime)
```

一句话：

- `StelloAgent` 是最高层门面对象
- `Engine` 是单 Session runner
- `EngineFactory` 是单 Session engine 的装配器
- `RuntimeManager` 是单 Session engine 的运行时池
- `SessionOrchestrator` 是多 Session 协调器

---

## 二、什么时候直接用 Engine

如果你只处理一个固定 Session，可以直接拿 engine 用：

```ts
const engine = await engineFactory.create(sessionId)

await engine.enterSession()
const result = await engine.turn("继续分析这个任务")
await engine.leaveSession()
```

适用场景：

- 单 Session 本地调试
- 单个 Session 的集成测试
- 不需要多 Session 协调时

---

## 三、什么时候直接用 StelloAgent

如果你是正常业务接入方，应该优先直接用 `StelloAgent`：

```ts
const agent = createStelloAgent({
  sessions,
  memory,
  capabilities: {
    lifecycle,
    tools,
    skills,
    confirm,
  },
  runtime: {
    resolver: sessionRuntimeResolver,
  },
})

await agent.enterSession(sessionId)
const result = await agent.turn(sessionId, "继续分析这个任务")
await agent.leaveSession(sessionId)
```

适用场景：

- 多 Session 并发
- fork 子 Session
- archive 指定 Session
- 需要一个统一的顶层入口对象

如果你有 WebSocket 连接态，还可以显式附着和释放 session runtime：

```ts
await agent.attachSession(sessionId, connectionId)
await agent.turn(sessionId, "继续分析这个任务")
await agent.detachSession(sessionId, connectionId)
```

这时：

- 连接建立时会自动创建或复用该 session 的 engine
- 连接断开时会释放引用
- 当引用归零时，engine 运行时会被回收
- `SessionTree` / memory 等持久数据不会被删除

如果你不想连接一断就立刻回收 engine，可以在顶层配置里设置空闲回收 TTL：

```ts
const agent = createStelloAgent({
  sessions,
  memory,
  capabilities: {
    lifecycle,
    tools,
    skills,
    confirm,
  },
  runtime: {
    resolver: sessionRuntimeResolver,
    recyclePolicy: {
      idleTtlMs: 30_000,
    },
  },
})
```

语义是：

- `idleTtlMs` 不传或为 `0`：引用归零立即回收
- `idleTtlMs > 0`：引用归零后延迟回收；TTL 内再次访问会取消回收

---

## 四、什么时候直接用 Orchestrator

如果你正在做更细粒度的编排扩展，或者要替换默认装配链，可以直接用 `SessionOrchestrator`：

```ts
const orchestrator = new SessionOrchestrator(sessions, runtimeManager)

await orchestrator.enterSession(sessionId)
const result = await orchestrator.turn(sessionId, "继续分析这个任务")
await orchestrator.leaveSession(sessionId)
```

适用场景：

- 自定义高阶编排层
- 更高层的 server / websocket 调度
- 自己管理 `EngineFactory` 和编排策略

---

## 五、并发语义

当前 orchestrator 的默认并发策略是：

- 同一个 `sessionId` 内串行
- 不同 `sessionId` 之间并行
- 单个 session 的 engine 运行时由 `RuntimeManager` 复用

这意味着：

```ts
await Promise.all([
  orchestrator.turn("s1", "A"),
  orchestrator.turn("s2", "B"),
])
```

上面两条可以并行执行。

但：

```ts
await Promise.all([
  orchestrator.turn("s1", "A"),
  orchestrator.turn("s1", "B"),
])
```

这两条会被编排层按顺序排队，避免同一个 Session 的 history / memory / turn 状态乱序。

---

## 六、默认 EngineFactory 的职责

`DefaultEngineFactory` 负责把公共依赖和 `sessionId` 组装成单个 `StelloEngine`。

它需要这些依赖：

- `sessions`
- `memory`
- `skills`
- `confirm`
- `lifecycle`
- `tools`
- `sessionRuntimeResolver`

可选依赖：

- `splitGuard`
- `mainSession`
- `turnRunner`
- `scheduler`
- `hooks`

其中最关键的是：

- `sessionRuntimeResolver.resolve(sessionId)`

它负责把 `sessionId` 解析成真正的 `SessionRuntime`。

---

## 七、默认 RuntimeManager 的职责

`DefaultEngineRuntimeManager` 负责管理 engine 运行时，不负责 session 数据存储。

它负责：

- 首次访问某个 session 时创建 engine
- 多个 holder 访问同一个 session 时复用 engine
- holder 全部释放后回收 engine

典型 holder：

- WebSocket `connectionId`
- 长轮询请求 ID
- 编排器内部的一次性任务 holder

---

## 八、最小装配示例

```ts
import {
  createStelloAgent,
} from "@stello-ai/core"

const agent = createStelloAgent({
  sessions,
  memory,
  capabilities: {
    lifecycle,
    tools,
    skills,
    confirm,
  },
  runtime: {
    resolver: sessionRuntimeResolver,
  },
})

await agent.enterSession("root")
const result = await agent.turn("root", "帮我继续拆解目标")
```

---

## 九、当前建议

当前推荐的使用方式是：

- 单 Session 场景：直接用 `Engine`
- 常规多 Session 场景：优先用 `StelloAgent`
- 需要自定义装配链时：用 `SessionOrchestrator`
- 不要再把“切换当前 Session”塞回 `Engine`

一句话总结：

**`StelloAgent` 是顶层门面，`EngineFactory` 负责装配，`Engine` 负责单 Session 生命周期，`Orchestrator` 负责多 Session 协调。**

补充：

- 当前推荐优先使用新的分组式 `StelloAgentConfig`
- 旧的扁平配置仍暂时兼容，但更适合作为过渡用法
