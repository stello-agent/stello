---
name: stello-agent-usage
description: StelloAgent 运行时使用教程。覆盖 Session 生命周期、createSession、turn/stream 对话、fork 配置合成链、orchestrator-facing 数据 SDK、runtime 管理、热更新等运行时 API。
---

# StelloAgent 运行时使用教程

> 前置知识：`createStelloAgent(config)` 的配置方式见 skill `stello-agent-creation`。
> 本文档聚焦于 Agent 构建完成后的**运行时操作**。

---

## 1. Root Session 创建

对话起点是一个普通 Session（`parentId === null`），由 `agent.createSession()` 创建——**不传** `parentId` 即为新 root。

```typescript
const root = await agent.createSession({ label: 'Main' })
await agent.enterSession(root.id)
```

`agent.createSession({ parentId?, label? })` 做了什么：
1. 调用 `sessions.createSession({ parentId, label })` 创建拓扑节点（`parentId` 缺省即 `parentId === null`）
2. 返回 `TopologyNode`（含 `id / parentId / children / refs / depth / label` 等）

Root 没有特殊待遇——它就是一个普通 Session。多个 root 合法（森林）。全局默认 systemPrompt / skills 等配置在 `sessionDefaults` 即可。

---

## 2. Session 生命周期

```
createSession → enterSession → turn / stream (× N) → leaveSession → archiveSession
```

### 2.1 进入 Session

```typescript
const bootstrap = await agent.enterSession(sessionId)
// bootstrap.context — 组装好的上下文（MemoryEngine 视角）
// bootstrap.session — SessionMeta（id, label, status, turnCount 等）
```

**行为**：触发 `lifecycle.bootstrap()`，初始化 Engine runtime。如果该 session 已有活跃 Engine，复用而非重建。

### 2.2 运行对话轮次（turn）

```typescript
const result = await agent.turn(sessionId, '帮我分析市场趋势')

// result.turn.finalContent      — 最终文本回复（tool loop 结束后）
// result.turn.toolRoundCount    — 经历了几轮 tool call 循环
// result.turn.toolCallsExecuted — 实际执行了多少个 tool
// result.turn.rawResponse       — 原始最终 LLM 响应
```

### 2.3 流式模式（stream）

```typescript
const streamResult = await agent.stream(sessionId, '帮我分析市场趋势')

for await (const chunk of streamResult) {
  process.stdout.write(chunk)
}

const result = await streamResult.result
console.log(result.turn.finalContent)
```

### 2.4 TurnRunnerOptions

```typescript
await agent.turn(sessionId, input, {
  maxToolRounds: 5,                       // 限制 tool call 循环轮数（默认无限）
  signal: abortController.signal,         // 支持取消（中断当前轮 LLM/tool 调用）
  onToolCall: (toolCall) => { /* ... */ },
  onToolResult: (result) => { /* ... */ },
})
```

### 2.5 离开与归档

```typescript
await agent.leaveSession(sessionId)   // 触发 consolidation 调度（fire-and-forget）
await agent.archiveSession(sessionId) // 标记归档，之后不应再 turn()
```

---

## 3. Fork — 创建子 Session

### 3.1 两种触发方式

| 方式 | 触发者 | 入口 |
|------|--------|------|
| LLM 发起 | LLM 调用 `stello_create_session` 内置 tool | 需在 `capabilities.tools` opt-in 注册 |
| 代码发起 | 应用层调用 `agent.forkSession()` | 手动编排 |

### 3.2 `forkSession` 参数

```typescript
const child = await agent.forkSession(sessionId, {
  // ── 必填 ──
  label: '市场分析-深度研究',

  // ── SessionConfig 字段（可选，参与合成链）──
  systemPrompt: '你是市场分析专家...',
  llm: specializedLlm,
  tools: customTools,
  skills: ['search', 'summarize'],
  consolidateFn: customConsolidateFn,
  compressFn: customCompressFn,

  // ── Fork 专属字段（可选）──
  prompt: '请深入分析半导体行业',   // fork 后立即发送的首条消息
  context: 'inherit',              // 'none'（默认）| 'inherit' | ForkContextFn
  topologyParentId: otherNodeId,   // 显式指定拓扑父节点（不传 = 当前 sessionId）
  profile: 'researcher',           // 引用预注册的 ForkProfile 名称
  profileVars: { region: '北美' }, // ForkProfile.systemPromptFn 的模板变量
})

// child: TopologyNode
// child.id              — 新 session 的 ID
// child.parentId        — 拓扑父节点 ID
// child.sourceSessionId — fork 时的上下文来源 session ID
// child.depth           — 拓扑深度（root = 0）
// child.label           — 显示名称
```

Fork 后需要单独 `enterSession(child.id)` 才能在子 session 上 turn()。

### 3.3 上下文继承策略（`context`）

```typescript
await agent.forkSession(sessionId, { label: '子任务', context: 'none' })    // 空白开始（默认）
await agent.forkSession(sessionId, { label: '深度研究', context: 'inherit' }) // 完整继承 L3
await agent.forkSession(sessionId, {
  label: '摘要子任务',
  context: async (parentMessages) => parentMessages.slice(-10),             // 自定义裁剪
})
```

### 3.4 Fork 配置合成链

fork 时按 `sessionDefaults → 父 session 固化 config → ForkProfile → EngineForkOptions` 顺序合成，后者覆盖前者。root 也是普通 session，从 root fork 会正常继承 root 的固化 config。

详见 skill `fork-design`。

---

## 4. Orchestrator-facing 数据 SDK

需要在创建 agent 时注入 `storage: SessionStorage`（顶层）。这套 API 让外部 orchestrator（应用层 / Claude Code / Codex / Kitkit 等）能够在对话之外直接读取和回写每个 Session 的数据。

### 4.1 拓扑与 Session 列表

```typescript
const roots = await agent.listRoots()                   // TopologyNode[]
const forest = await agent.getTopology()                // SessionTreeNode[]（嵌套森林）
const node = await agent.getTopologyNode(sessionId)     // 单个 TopologyNode
const sessions = await agent.listSessions({ status: 'active' })  // SessionMeta[]
```

### 4.2 单个 Session 视图

```typescript
const view = await agent.getSessionMetadata(sessionId)
// view.memory   — string | null（持久；不进 send 上下文）
// view.insight  — string | null（一次性 inbox；下次 send 注入并 clear）
```

### 4.3 批量 digest

```typescript
const digests = await agent.listSessionDigests({ status: 'active' })
// digests[i] = { id, label, status, memory, insight }
```

应用层把这份数据喂给反思层 LLM，由它产出 per-session insight，再调用 `agent.putInsight` 定向回写。完整模式见 skill `session-usage`。

### 4.4 L3 消息读取

```typescript
const messages = await agent.listMessages(sessionId, { limit: 100 })
```

### 4.5 写入

```typescript
await agent.putMemory(sessionId, '当前进展摘要...')       // 持久 memory（替换语义）
await agent.putInsight(sessionId, '需要重新评估方向...')  // 一次性 insight（send 消费后 clear）
await agent.clearInsight(sessionId)                       // 主动清除
```

未在 agent 创建时注入 `storage` 时，这些方法会抛错。

---

## 5. Runtime 管理（多连接场景）

适用于 WebSocket 等多客户端连接场景，通过引用计数管理 Engine 生命周期。

```typescript
await agent.attachSession(sessionId, connectionId)  // WS 连接建立
await agent.detachSession(sessionId, connectionId)  // WS 连接断开

agent.hasActiveEngine(sessionId)   // 是否有活跃 Engine
agent.getEngineRefCount(sessionId) // 当前引用计数
```

**回收策略**：

```typescript
createStelloAgent({
  runtime: {
    resolver: myResolver,
    recyclePolicy: { idleTtlMs: 30_000 },
  },
})

// 运行时更新
agent.updateConfig({ runtime: { idleTtlMs: 60_000 } })
```

---

## 6. 典型使用模式

### 6.1 单 root 对话

```typescript
const root = await agent.createSession({ label: 'Main' })
await agent.enterSession(root.id)
await agent.turn(root.id, '你好')
await agent.turn(root.id, '继续上个话题')
await agent.leaveSession(root.id)
```

### 6.2 代码驱动的并行 Fork

```typescript
const root = await agent.createSession({ label: 'Main' })
await agent.enterSession(root.id)
await agent.turn(root.id, '我需要研究三个市场')

const children = await Promise.all([
  agent.forkSession(root.id, { label: '美国市场', systemPrompt: '你是美国市场专家' }),
  agent.forkSession(root.id, { label: '欧洲市场', systemPrompt: '你是欧洲市场专家' }),
  agent.forkSession(root.id, { label: '亚洲市场', systemPrompt: '你是亚洲市场专家' }),
])

await Promise.all(
  children.map(async (child) => {
    await agent.enterSession(child.id)
    await agent.turn(child.id, '分析半导体供应链')
    await agent.leaveSession(child.id)  // 触发 consolidation
  }),
)
```

### 6.3 多 root 并存（森林）

```typescript
// 独立的研究/写作两条线，互不影响
const research = await agent.createSession({ label: 'Research' })
const writing  = await agent.createSession({ label: 'Writing' })

await agent.enterSession(research.id)
await agent.turn(research.id, '调研材料 ...')

await agent.enterSession(writing.id)
await agent.turn(writing.id, '基于已有材料写一份 ...')

const all = await agent.listRoots()  // 两个 root 都会出现
```

### 6.4 外部 reflection 循环（自行实现 integrate）

```typescript
async function reflect(agent: StelloAgent, llm: LLMAdapter): Promise<void> {
  const digests = await agent.listSessionDigests({ status: 'active' })
  // ... 应用层 prompt 把 digests 喂给 llm，解析出 per-target insight ...
  for (const [id, content] of Object.entries(insightsByTarget)) {
    await agent.putInsight(id, content)
  }
}
```

详见 stello-agent-creation §7。

### 6.5 WebSocket 连接管理

```typescript
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
    for (const sessionId of socket.sessions) {
      await agent.detachSession(sessionId, holderId)
    }
  })
})
```

---

## 7. 并发语义

- **同 sessionId 内串行**：同一 session 上的 turn() 不会并发执行
- **不同 sessionId 之间并行**：可同时在多个 session 上 turn()
- **所有异步副作用 fire-and-forget**：consolidation / hooks 不阻塞 turn() 返回
- **错误不中断对话**：副作用抛错时 emit error 事件，对话循环继续

---

## 8. 公开方法速查

### 编排

| 方法 | 返回值 | 说明 |
|------|--------|------|
| `createSession({ parentId?, label? })` | `Promise<TopologyNode>` | 创建拓扑节点（不传 parentId 即新 root；多 root 合法） |
| `enterSession(id)` | `Promise<BootstrapResult>` | 进入 session，触发 bootstrap |
| `turn(id, input, opts?)` | `Promise<EngineTurnResult>` | 同步对话轮次（含 tool call 循环） |
| `stream(id, input, opts?)` | `Promise<EngineStreamResult>` | 流式对话轮次 |
| `leaveSession(id)` | `Promise<{ sessionId }>` | 离开 session，触发 consolidation 调度 |
| `forkSession(id, opts)` | `Promise<TopologyNode>` | 创建子 session，执行配置合成链 |
| `archiveSession(id)` | `Promise<{ sessionId }>` | 归档 session |
| `consolidateSession(id)` | `Promise<void>` | 手动触发该 session 的 consolidation |
| `attachSession(id, holderId)` | `Promise<OrchestratorEngine>` | 附着 runtime 持有者 |
| `detachSession(id, holderId)` | `Promise<void>` | 释放 runtime 持有者 |
| `hasActiveEngine(id)` | `boolean` | 是否有活跃 Engine |
| `getEngineRefCount(id)` | `number` | 当前引用计数 |
| `updateConfig(patch)` | `void` | 热更新运行时配置 |

### Orchestrator-facing 数据 SDK（需注入 `storage`）

| 方法 | 返回值 | 说明 |
|------|--------|------|
| `listSessions(filter?)` | `Promise<SessionMeta[]>` | 列出所有 session |
| `listRoots()` | `Promise<TopologyNode[]>` | 列出所有 root |
| `getTopology()` | `Promise<SessionTreeNode[]>` | 完整森林（嵌套树） |
| `getTopologyNode(id)` | `Promise<TopologyNode \| null>` | 单个节点 |
| `getSessionMetadata(id)` | `Promise<{ memory, insight }>` | 单 session 的 memory + insight |
| `listSessionDigests(filter?)` | `Promise<SessionDigest[]>` | 批量收集所有 Session 的 digest |
| `listMessages(id, options?)` | `Promise<Message[]>` | 读取 L3 消息 |
| `putMemory(id, content)` | `Promise<void>` | 写入 memory |
| `putInsight(id, content)` | `Promise<void>` | 写入 insight（一次性） |
| `clearInsight(id)` | `Promise<void>` | 清除 insight |

### 只读属性

| 属性 | 类型 | 说明 |
|------|------|------|
| `config` | `StelloAgentConfig` | 归一化后的完整配置 |
| `sessions` | `SessionTree` | 拓扑树 |
| `memory` | `MemoryEngine` | 记忆引擎 |
| `storage` | `SessionStorage \| undefined` | 数据存储（未注入时 data-IO 方法不可用） |
| `profiles` | `ForkProfileRegistry \| undefined` | Fork 模板注册表 |
