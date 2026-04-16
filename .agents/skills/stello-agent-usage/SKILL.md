---
name: stello-agent-usage
description: StelloAgent 运行时使用教程。覆盖 Session 生命周期、turn/stream 对话、fork 编排、runtime 管理、热更新等运行时 API。
---

# StelloAgent 运行时使用教程

> 前置知识：`createStelloAgent(config)` 的配置方式见 skill `stello-agent-creation`。
> 本文档聚焦于 Agent 构建完成后的**运行时操作**。

---

## 1. Session 生命周期

StelloAgent 以 Session 为单位管理对话。完整生命周期：

```
enterSession → turn / stream (× N) → leaveSession → archiveSession
```

### 1.1 进入 Session

```typescript
const bootstrap = await agent.enterSession(sessionId)
// bootstrap.context — 组装好的上下文（L1 core + L2 memories + insight/synthesis）
// bootstrap.session — SessionMeta（id, label, status 等）
```

**行为**：触发 `lifecycle.bootstrap()`，初始化 Engine runtime。如果该 session 已有活跃 Engine，复用而非重建。

### 1.2 运行对话轮次

#### 同步模式（turn）

```typescript
const result = await agent.turn(sessionId, '帮我分析市场趋势')

// result.turn.finalContent     — 最终文本回复（tool loop 结束后）
// result.turn.toolRoundCount   — 经历了几轮 tool call 循环
// result.turn.toolCallsExecuted — 实际执行了多少个 tool
// result.turn.rawResponse      — 原始最终 LLM 响应
```

#### 流式模式（stream）

```typescript
const streamResult = await agent.stream(sessionId, '帮我分析市场趋势')

// 逐 chunk 消费
for await (const chunk of streamResult) {
  process.stdout.write(chunk)
}

// 最终完整结果（等流结束后 resolve）
const result = await streamResult.result
console.log(result.turn.finalContent)
```

#### TurnRunnerOptions

两种模式都支持 options 参数：

```typescript
await agent.turn(sessionId, input, {
  // 限制 tool call 循环轮数（默认无限直到 LLM 不再调 tool）
  maxToolRounds: 5,

  // 观察 tool 调用（日志、审计、UI 展示）
  onToolCall: (toolCall) => {
    console.log(`调用工具: ${toolCall.name}`, toolCall.arguments)
  },

  // 观察 tool 结果
  onToolResult: (result) => {
    console.log(`工具结果: ${result.name}`, result.content)
  },
})
```

**Tool call 循环机制**：
1. Session.send() 调用 LLM，LLM 可能返回 tool_use
2. Engine 执行所有 tool call，将结果作为下一轮消息
3. 重复直到 LLM 不再调 tool 或达到 maxToolRounds
4. 最终文本回复作为 finalContent 返回

### 1.3 离开 Session

```typescript
await agent.leaveSession(sessionId)
```

**行为**：触发 Scheduler 的 `onSessionLeave` 事件。根据调度策略可能自动执行 consolidation / integration（fire-and-forget）。

### 1.4 归档 Session

```typescript
await agent.archiveSession(sessionId)
```

**行为**：触发 `onSessionArchive` 调度事件，标记 session 为归档状态。归档后不应再 turn()。

---

## 2. Fork — 创建子 Session

两种触发方式，效果等价：

| 方式 | 触发者 | 入口 |
|------|--------|------|
| LLM 发起 | LLM 调用 `stello_create_session` 内置 tool | 自动，无需代码 |
| 代码发起 | 应用层调用 `agent.forkSession()` | 手动编排 |

### 2.1 代码发起 Fork

```typescript
const child = await agent.forkSession(sessionId, {
  label: '市场分析-深度研究',           // 显示名称（必填）

  // ── 可选参数 ──
  systemPrompt: '你是市场分析专家...',  // 子 session 的 system prompt
  prompt: '请深入分析半导体行业',       // 创建后立即发送的首条消息
  context: 'inherit',                   // 'none' | 'inherit' | ForkContextFn
  scope: '半导体市场分析',              // scope 描述
  topologyParentId: parentId,           // 指定拓扑父节点（默认 = sessionId）
  tags: ['research', 'market'],
  metadata: { priority: 'high' },

  // 覆盖子 session 的提炼/压缩策略（不传则继承父 session）
  consolidateFn: customConsolidateFn,
  compressFn: customCompressFn,
})

// child: TopologyNode
// child.id       — 新 session 的 ID
// child.parentId — 拓扑父节点 ID
// child.label    — 显示名称
// child.depth    — 拓扑深度
```

### 2.2 上下文继承策略

`context` 参数控制子 session 是否继承父 session 的对话历史：

- `'none'`（默认）：空白开始，只有 systemPrompt
- `'inherit'`：完整继承父 session 的 L3 历史
- `ForkContextFn`：自定义函数，选择性继承

```typescript
// 自定义上下文继承：只继承最近 10 条消息
await agent.forkSession(sessionId, {
  label: '摘要子任务',
  context: async (parentMessages) => {
    return parentMessages.slice(-10)
  },
})
```

### 2.3 Fork 结果

`forkSession()` 返回 `TopologyNode`：

```typescript
interface TopologyNode {
  id: string           // Session ID
  parentId: string | null
  children: string[]
  refs: string[]
  depth: number        // 根 = 0
  index: number        // 兄弟节点排序
  label: string
}
```

Fork 后需要单独 `enterSession(child.id)` 才能在子 session 上 turn()。

---

## 3. Runtime 管理（多连接场景）

适用于 WebSocket 等多客户端连接场景。每个连接是一个 holder，通过引用计数管理 Engine 生命周期。

### 3.1 Attach / Detach

```typescript
// WS 连接建立 → attach
const engine = await agent.attachSession(sessionId, connectionId)

// WS 连接断开 → detach
await agent.detachSession(sessionId, connectionId)
```

**引用计数语义**：
- 第一个 holder attach 时创建 Engine
- 后续 holder attach 复用同一个 Engine
- 最后一个 holder detach 后，根据 recyclePolicy 决定回收时机

### 3.2 查询状态

```typescript
agent.hasActiveEngine(sessionId)       // 是否有活跃 Engine
agent.getEngineRefCount(sessionId)     // 当前持有者数量
```

### 3.3 回收策略

在创建 Agent 时配置：

```typescript
const agent = createStelloAgent({
  // ...
  runtime: {
    resolver: myResolver,
    recyclePolicy: {
      idleTtlMs: 30_000,  // 最后一个 holder detach 后 30s 回收
                            // 0 = 立即回收（默认）
    },
  },
})
```

运行时热更新：

```typescript
agent.updateConfig({
  runtime: { idleTtlMs: 60_000 },
})
```

---

## 4. 热更新配置

`updateConfig()` 支持运行时安全修改值类型字段（不支持函数/对象引用）：

```typescript
agent.updateConfig({
  // runtime 回收策略
  runtime: {
    idleTtlMs: 60_000,
  },

  // 调度策略
  scheduling: {
    consolidation: { trigger: 'everyNTurns', everyNTurns: 10 },
    integration: { trigger: 'afterConsolidate' },
  },

  // 拆分保护
  splitGuard: {
    minTurns: 5,
    cooldownTurns: 10,
  },
})
```

**不可热更新**：lifecycle、tools、skills、profiles、confirm、strategy 等对象/函数引用。这些需要重建 Agent。

---

## 5. 读写底层数据

StelloAgent 暴露 `sessions` 和 `memory` 属性，可直接操作底层数据。

### 5.1 拓扑树查询

```typescript
const tree = agent.sessions

// 获取根节点
const root = await tree.getRoot()

// 获取子节点
const children = await tree.getChildren(nodeId)

// 获取节点详情
const node = await tree.getNode(nodeId)
```

### 5.2 记忆读写

```typescript
const mem = agent.memory

// L1 core profile（全局键值）
await mem.writeCore('user.name', '张三')
const name = await mem.readCore('user.name')

// L2 记忆（Session 级）
const l2 = await mem.readMemory(sessionId)

// 对话记录（L3）
const records = await mem.readRecords(sessionId)

// 上下文组装（给 LLM 的完整上下文）
const ctx = await mem.assembleContext(sessionId)
// ctx.core       — L1 全局键值
// ctx.memories   — 继承链上的 L2 列表
// ctx.currentMemory — 当前 session 的 L2
// ctx.scope      — 当前 session 的 scope
```

---

## 6. 典型使用模式

### 6.1 最简单的单 Session 对话

```typescript
const agent = createStelloAgent({ /* config */ })

await agent.enterSession('root')
const r1 = await agent.turn('root', '你好')
const r2 = await agent.turn('root', '继续上个话题')
await agent.leaveSession('root')
```

### 6.2 多 Session 切换

```typescript
await agent.enterSession('session-a')
await agent.turn('session-a', '问题 A')

// 切换到另一个 session（不需要先 leave）
await agent.enterSession('session-b')
await agent.turn('session-b', '问题 B')

// 回到 session-a（Engine 可能还在缓存中）
await agent.turn('session-a', '继续 A 的话题')
```

### 6.3 代码驱动的 Fork 工作流

```typescript
await agent.enterSession('root')
await agent.turn('root', '我需要研究三个市场')

// 并行创建子 session
const [child1, child2, child3] = await Promise.all([
  agent.forkSession('root', { label: '美国市场', systemPrompt: '你是美国市场专家' }),
  agent.forkSession('root', { label: '欧洲市场', systemPrompt: '你是欧洲市场专家' }),
  agent.forkSession('root', { label: '亚洲市场', systemPrompt: '你是亚洲市场专家' }),
])

// 并行对话
await Promise.all([
  (async () => {
    await agent.enterSession(child1.id)
    await agent.turn(child1.id, '分析半导体供应链')
  })(),
  (async () => {
    await agent.enterSession(child2.id)
    await agent.turn(child2.id, '分析半导体供应链')
  })(),
  (async () => {
    await agent.enterSession(child3.id)
    await agent.turn(child3.id, '分析半导体供应链')
  })(),
])
```

### 6.4 WebSocket 连接管理

```typescript
// 服务端 WS handler
ws.on('connection', async (socket) => {
  const holderId = socket.id

  socket.on('enter', async ({ sessionId }) => {
    await agent.attachSession(sessionId, holderId)
    await agent.enterSession(sessionId)
  })

  socket.on('message', async ({ sessionId, input }) => {
    const stream = await agent.stream(sessionId, input)
    for await (const chunk of stream) {
      socket.send(JSON.stringify({ type: 'chunk', data: chunk }))
    }
    const result = await stream.result
    socket.send(JSON.stringify({ type: 'done', data: result }))
  })

  socket.on('close', async () => {
    // detach 所有持有的 session
    for (const sessionId of socket.sessions) {
      await agent.detachSession(sessionId, holderId)
    }
  })
})
```

### 6.5 监听 Tool 调用（审计/UI）

```typescript
const result = await agent.turn(sessionId, input, {
  onToolCall: (tc) => {
    // 推送到前端显示 "正在调用 search_knowledge..."
    ws.send(JSON.stringify({ type: 'tool_start', name: tc.name }))
  },
  onToolResult: (tr) => {
    ws.send(JSON.stringify({ type: 'tool_end', name: tr.name }))
  },
})
```

---

## 7. 并发语义

- **同 sessionId 内串行**：同一个 session 上的 turn() 不会并发执行
- **不同 sessionId 之间并行**：可以同时在多个 session 上 turn()
- **所有异步副作用 fire-and-forget**：consolidation / integration / hooks 不阻塞 turn() 返回
- **错误不中断对话**：副作用抛错时 emit error 事件，对话循环继续

---

## 8. 公开方法速查

| 方法 | 返回值 | 说明 |
|------|--------|------|
| `enterSession(id)` | `Promise<BootstrapResult>` | 进入 session，触发 bootstrap |
| `turn(id, input, opts?)` | `Promise<EngineTurnResult>` | 同步对话轮次（含 tool call 循环） |
| `stream(id, input, opts?)` | `Promise<EngineStreamResult>` | 流式对话轮次 |
| `leaveSession(id)` | `Promise<{ sessionId }>` | 离开 session，触发调度 |
| `forkSession(id, opts)` | `Promise<TopologyNode>` | 创建子 session |
| `archiveSession(id)` | `Promise<{ sessionId }>` | 归档 session |
| `attachSession(id, holderId)` | `Promise<OrchestratorEngine>` | 附着 runtime 持有者 |
| `detachSession(id, holderId)` | `Promise<void>` | 释放 runtime 持有者 |
| `hasActiveEngine(id)` | `boolean` | 是否有活跃 Engine |
| `getEngineRefCount(id)` | `number` | 当前引用计数 |
| `updateConfig(patch)` | `void` | 热更新运行时配置 |

只读属性：

| 属性 | 类型 | 说明 |
|------|------|------|
| `config` | `StelloAgentConfig` | 归一化后的完整配置 |
| `sessions` | `SessionTree` | 拓扑树，可做查询 |
| `memory` | `MemoryEngine` | 记忆引擎，可读写数据 |
