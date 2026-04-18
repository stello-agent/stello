---
name: stello-agent-usage
description: StelloAgent 运行时使用教程。覆盖 Session 生命周期、turn/stream 对话、fork 配置合成链、createMainSession、runtime 管理、热更新等运行时 API。
---

# StelloAgent 运行时使用教程

> 前置知识：`createStelloAgent(config)` 的配置方式见 skill `stello-agent-creation`。
> 本文档聚焦于 Agent 构建完成后的**运行时操作**。

---

## 1. Main Session 初始化

Main session 是 Agent 的起始节点，必须显式创建，不通过 `forkSession` 创建。

```typescript
// 推荐：用 createMainSession()，框架会用 mainSessionConfig 固化配置
const mainNode = await agent.createMainSession({ label: 'Main' })

// 之后进入 session 开始对话
await agent.enterSession(mainNode.id)
```

**`createMainSession` 做了什么**：
1. 调用 `sessions.createRoot(label)` 创建根拓扑节点
2. 将 `mainSessionConfig` 的可序列化字段（`systemPrompt / skills`）固化写入存储
3. 返回 `TopologyNode`（含 `id / parentId / depth / label` 等）

---

## 2. Session 生命周期

```
createMainSession → enterSession → turn / stream (× N) → leaveSession → archiveSession
```

### 2.1 进入 Session

```typescript
const bootstrap = await agent.enterSession(sessionId)
// bootstrap.context — 组装好的上下文（L1 core + L2 memories + insight/synthesis）
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
  maxToolRounds: 5,  // 限制 tool call 循环轮数（默认无限）

  onToolCall: (toolCall) => {
    console.log(`调用工具: ${toolCall.name}`, toolCall.arguments)
  },

  onToolResult: (result) => {
    console.log(`工具结果: ${result.name}`, result.content)
  },
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
| LLM 发起 | LLM 调用 `stello_create_session` 内置 tool | 自动，无需代码 |
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
  skills: ['search', 'summarize'],  // 该子 session 的 skill 白名单
  consolidateFn: customConsolidateFn,
  compressFn: customCompressFn,

  // ── Fork 专属字段（可选）──
  prompt: '请深入分析半导体行业',    // fork 后立即发送的首条消息
  context: 'inherit',               // 'none'（默认）| 'inherit' | ForkContextFn
  topologyParentId: otherNodeId,    // 显式指定拓扑父节点（不传 = 当前 sessionId）
  profile: 'researcher',            // 引用预注册的 ForkProfile 名称
  profileVars: { region: '北美' },  // ForkProfile.systemPromptFn 的模板变量
})

// child: TopologyNode
// child.id             — 新 session 的 ID
// child.parentId       — 拓扑父节点 ID
// child.sourceSessionId — fork 时的上下文来源 session ID
// child.depth          — 拓扑深度（根 = 0）
// child.label          — 显示名称
```

Fork 后需要单独 `enterSession(child.id)` 才能在子 session 上 turn()。

### 3.3 上下文继承策略（`context`）

`context` 控制子 session 是否继承父 session 的 L3 对话历史：

```typescript
// 空白开始（默认）
await agent.forkSession(sessionId, { label: '子任务', context: 'none' })

// 完整继承父 session 的所有 L3 记录
await agent.forkSession(sessionId, { label: '深度研究', context: 'inherit' })

// 自定义：只继承最近 10 条消息
await agent.forkSession(sessionId, {
  label: '摘要子任务',
  context: async (parentMessages) => parentMessages.slice(-10),
})
```

### 3.4 Fork 配置合成链

fork 时各字段按以下优先级合成，**后者覆盖前者**：

```
sessionDefaults → 父 session 固化 config → ForkProfile → EngineForkOptions
```

- **从 main session fork**：不继承 main session 的配置，直接从 `sessionDefaults` 开始
- **从 regular session fork**：在 `sessionDefaults` 基础上叠加父 session 的固化配置

**`systemPrompt` 的特殊合成规则**（当使用 profile 时）：

| `systemPromptMode` | 结果 |
|-------------------|------|
| `'preset'` | 只用 profile 的 prompt，忽略 fork options 的 systemPrompt |
| `'prepend'`（默认） | `[profile prompt]\n[fork options prompt]` |
| `'append'` | `[fork options prompt]\n[profile prompt]` |

**合成后结果固化入存储**：session 创建时结算一次，不随 `sessionDefaults` 的后续变化而改变。

### 3.5 `skills` 白名单的合成

`skills` 字段遵循字段级覆盖，不做合并：

```typescript
// sessionDefaults.skills = undefined（继承全局）
// ForkProfile.skills = ['search', 'summarize']
// → 子 session skills = ['search', 'summarize']

// EngineForkOptions.skills = []
// → 子 session skills = []（禁用所有 skill，优先级最高）
```

### 3.6 `topologyParentId` 与 `sourceSessionId` 的区别

```typescript
await agent.forkSession(currentSessionId, {
  label: '子任务',
  topologyParentId: rootId,  // 拓扑树上挂在 root 下（星空图展示位置）
  // context 来源仍是 currentSessionId（sourceSessionId = currentSessionId）
})

// child.parentId       = rootId         （拓扑父节点）
// child.sourceSessionId = currentSessionId （上下文来源）
```

当不传 `topologyParentId` 时，`parentId` 和 `sourceSessionId` 都等于 `sessionId`。

### 3.7 使用 ForkProfile

```typescript
// 代码发起（指定 profile 名称）
await agent.forkSession(sessionId, {
  label: '北美市场专家',
  profile: 'region-expert',
  profileVars: { region: '北美' },
  // 可叠加 EngineForkOptions 字段覆盖 profile 的部分配置
  systemPrompt: '请特别关注科技行业',  // 在 profile 的 systemPromptMode 下合成
})

// LLM 发起：LLM 调用 stello_create_session tool 时传 profile 参数（自动）
// 需要 capabilities.profiles 中注册了对应 profile
```

---

## 4. Runtime 管理（多连接场景）

适用于 WebSocket 等多客户端连接场景，通过引用计数管理 Engine 生命周期。

### 4.1 Attach / Detach

```typescript
await agent.attachSession(sessionId, connectionId)  // WS 连接建立
await agent.detachSession(sessionId, connectionId)  // WS 连接断开
```

**语义**：
- 第一个 holder attach 时创建 Engine
- 最后一个 holder detach 后，按 `recyclePolicy.idleTtlMs` 决定回收时机

### 4.2 查询状态

```typescript
agent.hasActiveEngine(sessionId)   // 是否有活跃 Engine
agent.getEngineRefCount(sessionId) // 当前引用计数
```

### 4.3 回收策略

```typescript
createStelloAgent({
  runtime: {
    resolver: myResolver,
    recyclePolicy: { idleTtlMs: 30_000 }, // 最后 holder detach 后 30s 回收（默认 0 = 立即）
  },
})

// 运行时更新
agent.updateConfig({ runtime: { idleTtlMs: 60_000 } })
```

---

## 5. 典型使用模式

### 5.1 最简单的单 Session 对话

```typescript
const mainNode = await agent.createMainSession({ label: 'Main' })
await agent.enterSession(mainNode.id)

const r1 = await agent.turn(mainNode.id, '你好')
const r2 = await agent.turn(mainNode.id, '继续上个话题')

await agent.leaveSession(mainNode.id)
```

### 5.2 代码驱动的并行 Fork

```typescript
await agent.enterSession(mainNode.id)
await agent.turn(mainNode.id, '我需要研究三个市场')

// 并行创建子 session
const [child1, child2, child3] = await Promise.all([
  agent.forkSession(mainNode.id, {
    label: '美国市场',
    systemPrompt: '你是美国市场专家',
    skills: ['search'],
  }),
  agent.forkSession(mainNode.id, {
    label: '欧洲市场',
    systemPrompt: '你是欧洲市场专家',
    skills: ['search'],
  }),
  agent.forkSession(mainNode.id, {
    label: '亚洲市场',
    systemPrompt: '你是亚洲市场专家',
    skills: ['search'],
  }),
])

// 并行对话（不同 sessionId 之间天然并行安全）
await Promise.all(
  [child1, child2, child3].map(async (child) => {
    await agent.enterSession(child.id)
    await agent.turn(child.id, '分析半导体供应链')
    await agent.leaveSession(child.id)  // 触发 consolidation
  })
)
```

### 5.3 使用 ForkProfile 的分角色 Fork

```typescript
// 创建时注册 profile
profiles.register('regional-expert', {
  systemPromptFn: (vars) => `你是${vars.region}地区的留学顾问，只负责${vars.region}选校。`,
  systemPromptMode: 'preset',
  consolidateFn: createDefaultConsolidateFn('提炼该地区的选校建议', llmCall),
  skills: ['search', 'school-data'],
})

// fork 时引用 profile + 传模板变量
const usaExpert = await agent.forkSession(mainNode.id, {
  label: '美国选校专家',
  profile: 'regional-expert',
  profileVars: { region: '美国' },
})

const ukExpert = await agent.forkSession(mainNode.id, {
  label: '英国选校专家',
  profile: 'regional-expert',
  profileVars: { region: '英国' },
  // 在 profile 基础上叠加额外约束
  llm: ukSpecializedLlm,
})
```

### 5.4 WebSocket 连接管理

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

### 5.5 监听 Tool 调用（审计/UI）

```typescript
const result = await agent.turn(sessionId, input, {
  onToolCall: (tc) => {
    ws.send(JSON.stringify({ type: 'tool_start', name: tc.name }))
  },
  onToolResult: (tr) => {
    ws.send(JSON.stringify({ type: 'tool_end', name: tr.name }))
  },
})
```

---

## 6. 读写底层数据

### 6.1 拓扑树查询

```typescript
const root = await agent.sessions.getRoot()          // 根节点（TopologyNode）
const node = await agent.sessions.getNode(nodeId)    // 单个节点
const children = await agent.sessions.getChildren(nodeId)  // 子节点列表

// TopologyNode 结构
// node.id              — Session ID
// node.parentId        — 拓扑父节点 ID（null = 根）
// node.sourceSessionId — fork 时的上下文来源（可能 ≠ parentId）
// node.depth           — 层级深度（根 = 0）
// node.children        — 子节点 ID 列表
// node.label           — 显示名称
```

### 6.2 记忆读写

```typescript
const mem = agent.memory

// L1 核心档案（全局键值）
await mem.writeCore('user.name', '张三')
const name = await mem.readCore('user.name')

// L2 记忆（Session 级）
const l2 = await mem.readMemory(sessionId)

// L3 对话记录
const records = await mem.readRecords(sessionId)

// 组装上下文（给 LLM 的完整上下文）
const ctx = await mem.assembleContext(sessionId)
// ctx.core          — L1 全局键值
// ctx.memories      — 继承链上的 L2 列表
// ctx.currentMemory — 当前 session 的 L2
// ctx.scope         — 当前 session 的 scope（来自 memory engine）
```

---

## 7. 并发语义

- **同 sessionId 内串行**：同一 session 上的 turn() 不会并发执行
- **不同 sessionId 之间并行**：可同时在多个 session 上 turn()
- **所有异步副作用 fire-and-forget**：consolidation / integration / hooks 不阻塞 turn() 返回
- **错误不中断对话**：副作用抛错时 emit error 事件，对话循环继续

---

## 8. 公开方法速查

| 方法 | 返回值 | 说明 |
|------|--------|------|
| `createMainSession(opts?)` | `Promise<TopologyNode>` | 创建根节点，固化 mainSessionConfig |
| `enterSession(id)` | `Promise<BootstrapResult>` | 进入 session，触发 bootstrap |
| `turn(id, input, opts?)` | `Promise<EngineTurnResult>` | 同步对话轮次（含 tool call 循环） |
| `stream(id, input, opts?)` | `Promise<EngineStreamResult>` | 流式对话轮次 |
| `leaveSession(id)` | `Promise<{ sessionId }>` | 离开 session，触发 consolidation 调度 |
| `forkSession(id, opts)` | `Promise<TopologyNode>` | 创建子 session，执行配置合成链 |
| `archiveSession(id)` | `Promise<{ sessionId }>` | 归档 session |
| `attachSession(id, holderId)` | `Promise<OrchestratorEngine>` | 附着 runtime 持有者 |
| `detachSession(id, holderId)` | `Promise<void>` | 释放 runtime 持有者 |
| `hasActiveEngine(id)` | `boolean` | 是否有活跃 Engine |
| `getEngineRefCount(id)` | `number` | 当前引用计数 |
| `updateConfig(patch)` | `void` | 热更新运行时配置（仅值类型字段） |

只读属性：

| 属性 | 类型 | 说明 |
|------|------|------|
| `config` | `StelloAgentConfig` | 归一化后的完整配置 |
| `sessions` | `SessionTree` | 拓扑树，可做查询 |
| `memory` | `MemoryEngine` | 记忆引擎，可读写数据 |
