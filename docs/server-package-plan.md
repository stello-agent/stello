# `@stello-ai/server` 包规划

## 目标

`@stello-ai/server` 应该作为独立包存在，用来把 `@stello-ai/core` 的库能力服务化。

它的职责不是重新实现 Session / Engine / Orchestrator，而是：

- 承接一个由 `core` 装配出的高层对象
- 对外暴露 RESTful API
- 对外暴露 WebSocket 通信
- 管理连接态与会话进入 / 离开

一句话：

**`server` 是 transport / service adapter，不是新的业务核心层。**

---

## 一、推荐分层

```text
@stello-ai/core
  ├─ SessionRuntime
  ├─ StelloEngine
  ├─ DefaultEngineFactory
  ├─ SessionOrchestrator
  └─ OrchestrationStrategy

@stello-ai/server
  ├─ REST handlers
  ├─ WebSocket gateway
  ├─ connection manager
  └─ core adapter
```

### 边界

`core` 负责：

- Session
- Engine
- Orchestrator
- Strategy
- Factory

`server` 负责：

- HTTP 请求解析
- WebSocket 消息收发
- 连接态映射
- 请求 / 事件与 core 方法之间的转换

---

## 二、`server` 应承接什么对象

`server` 不应该直接承接一堆零散对象。

更合理的方式是承接一个高层 runtime，例如：

- `SessionOrchestrator`
- `DefaultEngineFactory`
- `SessionTree`

或者后续你们如果再包一层，也可以承接：

- `StelloRuntime`
- `StelloApp`

但无论名字叫什么，职责应稳定：

- 按 `sessionId` 找到对应 Session / Engine
- 调用 orchestrator
- 管理 enter / leave / turn / fork / archive

---

## 三、`server` 不应该做什么

`@stello-ai/server` 不应该：

- 重新实现 `Engine`
- 重新实现 tool loop
- 重新定义 Session 语义
- 重新定义 topology 语义
- 在 server 层偷偷加入另一套编排规则

否则就会出现：

- `core` 一套语义
- `server` 又一套语义

后续 SDK 会非常难维护。

---

## 四、第一版 REST API 建议

第一版先只暴露最小必要接口。

### Session 生命周期

- `POST /sessions/:id/enter`
- `POST /sessions/:id/leave`
- `POST /sessions/:id/archive`

### Session 对话

- `POST /sessions/:id/messages`

请求体示例：

```json
{
  "input": "继续分析这个任务"
}
```

### Session 分叉

- `POST /sessions/:id/fork`

请求体示例：

```json
{
  "label": "UI Exploration",
  "scope": "ui"
}
```

### 读取 Session 基础信息

- `GET /sessions/:id`

### 读取拓扑

- `GET /sessions`
- `GET /topology`

> 具体 URI 还可以调整，但核心思想是：REST 负责资源化入口，不重新定义业务行为。

---

## 五、第一版 WebSocket 建议

WebSocket 主要解决两件事：

- 长连接消息收发
- 连接态下的 enter / leave 管理

这里的关键约束已经明确：

- `core` 里由 `StelloAgent.attachSession / detachSession / turn` 承担 runtime 语义
- `server` 只负责把 socket 生命周期映射到这组调用
- `server` 不直接 new `Engine`
- `server` 不自己维护另一套 session runtime

### 推荐模型

- 客户端连接后，声明当前要附着的 `sessionId`
- server 维护：
  - `connectionId -> sessionId`
- 收到用户消息后：
  - 转发给 `StelloAgent.turn(sessionId, input)`
- 收到结果后：
  - 推送给该连接

更具体地说，server 应该把连接态映射成下面这条链：

```text
WebSocket connected
  -> connectionManager.bind(connectionId, sessionId)
  -> agent.attachSession(sessionId, connectionId)
  -> agent.enterSession(sessionId)   // 可选：取决于协议设计

message received
  -> agent.turn(sessionId, input)
  -> ws.send(message.completed)

WebSocket closed
  -> agent.leaveSession(sessionId)   // 可选：是否在断线时自动触发，由 server 决定
  -> agent.detachSession(sessionId, connectionId)
  -> connectionManager.unbind(connectionId)
```

这套模型的目标是：

- session 数据保留在 `core` 的持久层
- engine runtime 只在有连接/请求时保活
- 同一个 session 上的多个连接可共享同一个 engine runtime
- 断线只释放 holder，不删除 session 数据

### 推荐事件

客户端发送：

- `session.enter`
- `session.leave`
- `session.message`
- `session.fork`

服务端推送：

- `session.entered`
- `session.left`
- `message.delta`（未来如支持流式）
- `message.completed`
- `tool.called`
- `tool.result`
- `session.forked`
- `error`

### 推荐事件载荷

客户端：

```json
{ "type": "session.enter", "sessionId": "s1" }
{ "type": "session.leave", "sessionId": "s1" }
{ "type": "session.message", "sessionId": "s1", "input": "继续分析这个任务" }
{ "type": "session.fork", "sessionId": "s1", "options": { "label": "UI", "scope": "ui" } }
```

服务端：

```json
{ "type": "session.entered", "sessionId": "s1", "bootstrap": { } }
{ "type": "session.left", "sessionId": "s1" }
{ "type": "message.completed", "sessionId": "s1", "result": { } }
{ "type": "session.forked", "sessionId": "s1", "child": { } }
{ "type": "error", "sessionId": "s1", "message": "..." }
```

第一版先不要设计太复杂的事件流，先保证：

- enter / leave / message / fork / archive 这几条主线是闭环的
- `message.completed` 能完整返回 turn 结果
- 未来如需流式，再补 `message.delta`

---

## 六、连接态建议

当前 `SessionOrchestrator` 是无状态的，这是对的。

连接态不应放进 `core`，而应放进 `server`。

推荐在 `server` 层单独维护：

- `connectionId -> sessionId`
- `connectionId -> userId`（未来需要时）
- 连接断开时触发 `leave`

如果未来允许一个连接同时附着多个 session，可以把映射拓展成：

- `connectionId -> Set<sessionId>`

但第一版建议坚持简单模型：

- 一个连接只附着一个活跃 session
- 切换 session 时必须显式 `leave old + enter new`

也就是说：

- `core` 不感知 socket
- `server` 不重写编排逻辑

### 连接管理职责

`server` 层建议单独放一个 `connection-manager`，职责只包含：

- 生成 / 清理 `connectionId`
- 维护 `connectionId -> sessionId`
- 在断线时触发对应的 `detach`
- 暴露只读查询，方便 debug / metrics

它不应该：

- 保存 session memory
- 自己缓存工具执行状态
- 自己调 `engineFactory`

### attach / detach 与回收策略

`server` 不需要自己发明回收策略，应该直接透传 `core` 的 `runtimeRecyclePolicy`。

例如：

- `idleTtlMs = 0`
  - 最适合短请求或完全无状态模式
- `idleTtlMs = 30_000`
  - 更适合 WebSocket，避免用户短暂断线后反复重建 engine

server 只需要做：

- 连接建立时调用 `attachSession(sessionId, connectionId)`
- 连接断开时调用 `detachSession(sessionId, connectionId)`
- 是否在断线时自动 `leaveSession(sessionId)`，由 server 配置决定

---

## 七、和 SDK 的关系

未来 `SDK` 应只封装 `server` 的 API。

也就是：

- SDK 不直接 import `core`
- SDK 不自己装配 `Engine`
- SDK 不在本地重跑编排逻辑

SDK 做的事只是：

- 发 HTTP 请求
- 建立 WebSocket 连接
- 把服务端协议变成更顺手的语言接口

---

## 八、第一版包结构建议

```text
packages/server/
├── src/
│   ├── index.ts
│   ├── types.ts
│   ├── create-server.ts
│   ├── stello-server.ts
│   ├── rest/
│   │   ├── sessions.ts
│   │   └── topology.ts
│   ├── ws/
│   │   ├── gateway.ts
│   │   └── connection-manager.ts
│   └── adapters/
│       └── core-runtime-adapter.ts
├── package.json
└── tsconfig.json
```

### 推荐的 server 承接对象

第一版可以让 `@stello-ai/server` 直接承接一个 `StelloAgent`：

```ts
const agent = createStelloAgent(config)
const server = createStelloServer({ agent })
```

这样：

- `core` 提供稳定语义
- `server` 只做协议映射
- REST / WS 共用同一个顶层对象

---

## 九、当前建议

当前最推荐的推进顺序是：

1. 先把 `core` 的 Session / Engine / Orchestrator 语义稳定
2. 再单独开 `@stello-ai/server`
3. `server` 第一版只做最小 REST / WS
4. SDK 最后再做薄封装

一句话总结：

**`@stello-ai/server` 应该是 `core` 的服务化适配层，承接由 `core` 导出的高层对象，并提供 RESTful API 与 WebSocket 通信。**
