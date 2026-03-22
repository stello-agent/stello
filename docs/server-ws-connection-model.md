# `@stello-ai/server` WebSocket 承接模型

## 目标

这份文档只回答一件事：

`@stello-ai/server` 应该如何基于 `StelloAgent.attachSession / detachSession / turn`
承接 WebSocket 连接。

---

## 一、核心原则

先固定 4 条原则：

1. `core` 负责 session / engine / orchestrator 语义
2. `server` 负责 socket / connection / 协议映射
3. 连接断开只回收 runtime，不删除 session 持久数据
4. 同一个 session 的多个连接应允许复用同一个 engine runtime

---

## 二、最小模型

第一版建议只支持：

- 一个连接附着一个活跃 session
- 显式 enter / leave
- 非流式 `message.completed`

最小状态：

```ts
type ConnectionId = string

interface ConnectionState {
  connectionId: ConnectionId
  sessionId: string | null
  connectedAt: string
}
```

server 内部建议维护：

- `connections: Map<connectionId, ConnectionState>`

---

## 三、生命周期映射

### 1. 连接建立

WebSocket 连接建立时：

- server 生成 `connectionId`
- 先不默认进入 session
- 等客户端发送 `session.enter`

原因：

- 避免 server 擅自绑定错误 session
- 和未来多语言 SDK 的语义更一致

### 2. session.enter

收到：

```json
{ "type": "session.enter", "sessionId": "s1" }
```

server 应做：

1. 如果该连接已经附着旧 session，先拒绝或要求先 leave
2. `agent.attachSession("s1", connectionId)`
3. `agent.enterSession("s1")`
4. 记录 `connectionId -> sessionId`
5. 回推 `session.entered`

### 3. session.message

收到：

```json
{ "type": "session.message", "sessionId": "s1", "input": "继续分析这个任务" }
```

server 应做：

1. 校验该连接当前确实附着 `s1`
2. 调 `agent.turn("s1", input)`
3. 回推 `message.completed`

### 4. session.leave

收到：

```json
{ "type": "session.leave", "sessionId": "s1" }
```

server 应做：

1. 校验该连接当前确实附着 `s1`
2. `agent.leaveSession("s1")`
3. `agent.detachSession("s1", connectionId)`
4. 清理连接映射
5. 回推 `session.left`

### 5. socket close

socket 断开时：

1. 看该连接是否仍绑定某个 `sessionId`
2. 如果有：
   - 可选：`agent.leaveSession(sessionId)`
   - 必做：`agent.detachSession(sessionId, connectionId)`
3. 删除连接映射

---

## 四、推荐消息协议

### 客户端

```json
{ "type": "session.enter", "sessionId": "s1" }
{ "type": "session.leave", "sessionId": "s1" }
{ "type": "session.message", "sessionId": "s1", "input": "继续分析这个任务" }
{ "type": "session.fork", "sessionId": "s1", "options": { "label": "UI", "scope": "ui" } }
```

### 服务端

```json
{ "type": "session.entered", "sessionId": "s1", "bootstrap": { } }
{ "type": "session.left", "sessionId": "s1" }
{ "type": "message.completed", "sessionId": "s1", "result": { } }
{ "type": "session.forked", "sessionId": "s1", "child": { } }
{ "type": "error", "sessionId": "s1", "message": "..." }
```

---

## 五、回收策略

WS 场景推荐直接使用 `core` 暴露的 runtime 回收策略：

```ts
const agent = createStelloAgent({
  ...config,
  runtimeRecyclePolicy: {
    idleTtlMs: 30_000,
  },
})
```

推荐默认值：

- 本地 demo / REST-only：`idleTtlMs = 0`
- WebSocket server：`idleTtlMs = 30_000`

这样可以避免：

- 用户短暂断线后立刻重建 engine
- 高频重连导致 runtime 抖动

---

## 六、server 不该做什么

server 不应该：

- 直接 new `StelloEngine`
- 绕过 `StelloAgent` 直接操作 runtime
- 在 server 层重新实现 tool loop
- 在 server 层维护另一套 session 数据缓存

server 应坚持：

- `StelloAgent` 是唯一编排入口
- socket 生命周期只映射到 `attach / detach / turn / enter / leave`

---

## 七、第一版结论

第一版 `@stello-ai/server` 的 WS 承接模型，建议固定成：

- `connectionId -> sessionId`
- `session.enter -> attach + enter`
- `session.message -> turn`
- `session.leave -> leave + detach`
- `socket.close -> detach`

一句话总结：

**server 负责连接，agent 负责编排，runtime manager 负责 engine 生命周期。**
