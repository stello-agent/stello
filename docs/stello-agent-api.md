# `StelloAgent` 对外接口

## 目标

这份文档说明 `@stello-ai/core` 里最外层对象 `StelloAgent` 当前对外暴露了哪些接口，以及这些接口的语义边界。

这里的“对外”指：

- 面向 AgentApp 使用者
- 面向未来 `@stello-ai/server`
- 面向更高层业务编排

不指：

- RESTful API
- WebSocket 协议

`StelloAgent` 只暴露可调用的方法，不直接暴露网络接口。

---

## 一、对象定位

`StelloAgent` 是当前 `@stello-ai/core` 推荐的最高层门面对象。

它内部已经装配了：

- `SessionOrchestrator`
- `DefaultEngineFactory`
- `DefaultEngineRuntimeManager`

使用者通常不需要自己直接操作这些底层对象，而是通过 `StelloAgent` 与整个 AgentApp 交互。

---

## 二、普通交互接口

下面这组接口是最推荐给外部直接调用的主路径。

### 1. `enterSession(sessionId)`

```ts
enterSession(sessionId: string): Promise<BootstrapResult>
```

语义：

- 进入指定 session 的一整轮对话
- 触发 bootstrap / 上下文准备
- 适合作为一次 session 交互的开始

典型场景：

- 用户打开某个 session
- WebSocket 完成 `session.enter`
- 业务代码显式开始某个 session round

### 2. `turn(sessionId, input, options?)`

```ts
turn(sessionId: string, input: string, options?: TurnRunnerOptions): Promise<EngineTurnResult>
```

语义：

- 在指定 session 上运行一轮消息处理
- 内部会调用单-session engine
- 内部会处理 tool loop
- 内部会触发 scheduler

这是当前最核心的交互入口。

典型场景：

- 用户向某个 session 发一条消息
- server 收到一条 `session.message`

### 3. `ingest(sessionId, message)`

```ts
ingest(sessionId: string, message: TurnRecord): Promise<IngestResult>
```

语义：

- 把一条结构化消息送入当前 session 的 ingest 流程
- 更偏内部 skill / lifecycle 预处理能力

典型场景：

- 高级编排扩展
- 需要在正式 turn 前做意图匹配或技能路由

### 4. `leaveSession(sessionId)`

```ts
leaveSession(sessionId: string): Promise<{ sessionId: string }>
```

语义：

- 离开指定 session
- 用于结束一整轮对话

典型场景：

- 用户关闭某个 session
- WebSocket 完成 `session.leave`
- 业务代码显式结束一个 round

### 5. `forkSession(sessionId, options)`

```ts
forkSession(
  sessionId: string,
  options: Omit<CreateSessionOptions, "parentId">,
): Promise<SessionMeta>
```

语义：

- 从指定 session 发起 fork
- 创建新的子 session
- 子节点最终挂到哪里，由 orchestrator strategy 决定

典型场景：

- 从主 session 拆出一个专题子 session
- 从某个任务节点继续展开分支

### 6. `archiveSession(sessionId)`

```ts
archiveSession(sessionId: string): Promise<{ sessionId: string; schedule: unknown }>
```

语义：

- 归档指定 session
- 结束该 session 的活跃状态

典型场景：

- 某个分支任务完成
- 用户主动关闭一个不再继续的 session

---

## 三、运行时管理接口

这组接口主要给连接态场景使用，例如未来的 WebSocket server。

### 1. `attachSession(sessionId, holderId)`

```ts
attachSession(sessionId: string, holderId: string): Promise<StelloEngine>
```

语义：

- 显式附着某个 session 的 engine runtime
- 如果该 session 的 runtime 不存在，则创建
- 如果已存在，则复用

典型场景：

- WebSocket 连接建立
- 长轮询任务开始
- 某个上层持有者需要“保活” session runtime

### 2. `detachSession(sessionId, holderId)`

```ts
detachSession(sessionId: string, holderId: string): Promise<void>
```

语义：

- 释放某个 session runtime 的持有者
- 当引用归零时，是否立即回收由 `runtimeRecyclePolicy` 决定

典型场景：

- WebSocket 连接断开
- 长轮询任务结束

### 3. `hasActiveEngine(sessionId)`

```ts
hasActiveEngine(sessionId: string): boolean
```

语义：

- 检查某个 session 当前是否存在活跃 engine runtime

### 4. `getEngineRefCount(sessionId)`

```ts
getEngineRefCount(sessionId: string): number
```

语义：

- 查看某个 session 当前 runtime 的引用计数

典型场景：

- debug
- metrics
- server 健康检查

---

## 四、高级扩展接口

### `createEngine(sessionId)`

```ts
createEngine(sessionId: string): Promise<StelloEngine>
```

语义：

- 直接拿到底层单-session engine
- 供高级扩展场景使用

不建议普通业务把它作为主交互路径，因为这样会绕开 `StelloAgent` 的门面语义。

---

## 五、只读暴露对象

当前 `StelloAgent` 还暴露了一些只读对象，方便高级调用方访问：

- `agent.config`
- `agent.sessions`
- `agent.orchestrator`
- `agent.engineFactory`
- `agent.runtimeManager`

这些对象主要用于：

- 高级装配
- debug
- server 适配层

普通业务代码不建议过度依赖这些内部对象。

---

## 六、推荐调用路径

### 普通业务调用

```ts
const agent = createStelloAgent(config)

await agent.enterSession(sessionId)
const result = await agent.turn(sessionId, "继续分析这个任务")
await agent.leaveSession(sessionId)
```

### 连接态调用

```ts
await agent.attachSession(sessionId, connectionId)
await agent.enterSession(sessionId)
const result = await agent.turn(sessionId, "继续分析这个任务")
await agent.leaveSession(sessionId)
await agent.detachSession(sessionId, connectionId)
```

### 分支调用

```ts
const child = await agent.forkSession(sessionId, {
  label: "UI Exploration",
  scope: "ui",
})
```

---

## 七、边界说明

`StelloAgent` 当前不负责：

- 暴露 HTTP 接口
- 暴露 WebSocket 协议
- 把结果序列化成网络事件

这些都属于未来 `@stello-ai/server` 的职责。

一句话：

**`StelloAgent` 是 AgentApp 的本地交互入口，不是网络服务入口。**
