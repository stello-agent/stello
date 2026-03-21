# 编排层（Orchestration Layer）技术设计

> 基于已实现的 `@stello-ai/session` Session 层，设计编排层的接口与执行机制。
>
> 状态：**设计草案**（2026-03-22）

---

## 目录

1. [定位与边界](#1-定位与边界)
2. [包结构](#2-包结构)
3. [核心接口 — EngineConfig](#3-核心接口--engineconfig)
4. [核心接口 — Engine](#4-核心接口--engine)
5. [turn() 执行流程](#5-turn-执行流程)
6. [Tool Call 循环](#6-tool-call-循环)
7. [Consolidation 调度](#7-consolidation-调度)
8. [Integration 调度](#8-integration-调度)
9. [Session 路由与切换](#9-session-路由与切换)
10. [Streaming + Tool Call](#10-streaming--tool-call)
11. [事件系统](#11-事件系统)
12. [错误处理](#12-错误处理)
13. [完整使用示例](#13-完整使用示例)
14. [实现前置依赖](#14-实现前置依赖)
15. [实现计划](#15-实现计划)

---

## 1. 定位与边界

### 编排层是什么

编排层是 Session 原语之上的**执行周期管理器**。它不创造新能力，而是把 Session 层的原语组合成完整的对话工作流。

```
用户 / 应用层
     │
     ▼
  Engine.turn(sessionId, input)
     │
     ├─ 解析 Session、检测切换
     │
     ├─ Tool Call 循环 ─────────────────┐
     │   session.send(input)             │
     │     ↓ 有 toolCalls?              │
     │   executeTools() → send(results)  │
     │     ↓ 继续直到无 toolCalls       │
     │   ← finalResult ────────────────┘
     │
     ├─ afterTurn 回调 (fire-and-forget)
     ├─ shouldConsolidate? → session.consolidate(fn)  (fire-and-forget)
     ├─ shouldIntegrate?   → main.integrate(fn)       (fire-and-forget)
     │
     └─ return TurnResult
```

### 职责分界

| 职责 | Session 层 | 编排层 | 应用层 |
|------|-----------|--------|--------|
| 上下文组装 | **session.send() 内部** | — | — |
| 单次 LLM 调用 | **session.send()** | — | — |
| L3 持久化 | **session.send() 自动** | — | — |
| Tool call 循环 | — | **Engine.turn()** | — |
| 工具执行 | — | **Engine** 调 Tool.execute() | 定义 Tool |
| Consolidation 调度 | — | **Engine** 判断时机 | 提供 ConsolidateFn |
| Integration 调度 | — | **Engine** 判断时机 | 提供 IntegrateFn |
| Session 切换检测 | — | **Engine** 追踪 | — |
| L2 格式 | — | — | **ConsolidateFn** 定义 |
| LLM tier 选择 | — | — | **fn 内部自行调用** |

---

## 2. 包结构

```
@stello-ai/session  ← Session 层（已实现）
@stello-ai/core     ← 编排层 + re-export session 公开类型
```

`@stello-ai/core` v0.2 依赖 `@stello-ai/session`。应用层只需：

```typescript
import { createEngine } from '@stello-ai/core'
```

Session 层的类型通过 `@stello-ai/core` 重新导出，应用层无需直接依赖 `@stello-ai/session`。

### 文件结构（预估）

```
packages/core/src/
├── types/
│   ├── engine.ts          ← EngineConfig, Engine, TurnResult, TurnOptions
│   ├── triggers.ts        ← ConsolidateTrigger, IntegrateTrigger
│   └── events.ts          ← EngineEventName, EngineEventPayloads
├── engine.ts              ← createEngine() 工厂 + Engine 实现
├── tool-loop.ts           ← tool call 循环逻辑
├── scheduler.ts           ← consolidation/integration 调度判断
├── context-builder.ts     ← 上下文组装（被 session.send() 内部调用）
└── index.ts               ← re-export session 类型 + 编排层 API
```

> `context-builder.ts` 可能不需要作为独立文件。Session.send() 实现时直接内联上下文组装规则即可。如果 send() 需要 maxTurns 等配置，通过 CreateSessionOptions 注入。

---

## 3. 核心接口 — EngineConfig

```typescript
/** 创建 Engine 的配置 */
interface EngineConfig {
  // ─── 必须 ───
  /** 存储适配器 */
  storage: StorageAdapter
  /** LLM 适配器，用于 Session 对话 */
  llm: LLMAdapter
  /** 全局系统提示词，所有 Session 共享 */
  systemPrompt: string

  // ─── 工具 ───
  /** 可用工具列表 */
  tools?: Tool[]

  // ─── Consolidation ───
  /** L3 → L2 提炼配置 */
  consolidate?: {
    /** 触发时机（默认 'manual'） */
    trigger: ConsolidateTrigger
    /** 转换函数，必须提供 */
    fn: ConsolidateFn
  }

  // ─── Main Session ───
  /** Main Session 配置（不配置则无 Main Session） */
  mainSession?: {
    /** 指定已有 Main Session ID（与 label 二选一） */
    id?: string
    /** 自动创建 Main Session 时的 label（与 id 二选一） */
    label?: string
    /** Main Session 专属 system prompt（不设则用全局 systemPrompt） */
    systemPrompt?: string
    /** Integration 配置 */
    integrate?: {
      trigger: IntegrateTrigger
      fn: IntegrateFn
    }
  }

  // ─── 上下文窗口 ───
  /** Session 对话上下文最多保留几轮 L3（默认 20） */
  maxTurns?: number

  // ─── 回调 ───
  /** 每轮 turn 完成后的通知（fire-and-forget） */
  afterTurn?: (result: TurnResult) => void
}
```

### 触发时机类型

```typescript
/** Consolidation 触发时机 */
type ConsolidateTrigger =
  | 'onSwitch'                           // 切换离开此 Session 时
  | { type: 'everyNTurns'; n: number }   // 每 N 轮对话后
  | 'onArchive'                          // 归档时
  | 'manual'                             // 仅 Engine.consolidate() 手动触发

/** Integration 触发时机 */
type IntegrateTrigger =
  | 'afterConsolidate'                   // 任何子 Session consolidation 完成后
  | 'onSwitch'                           // 切换到 Main Session 时
  | { type: 'everyNTurns'; n: number }   // Main Session 每 N 轮对话后
  | 'manual'                             // 仅 Engine.integrate() 手动触发
```

### 设计决策

**Q: 为什么 ConsolidateFn / IntegrateFn 没有 LLM 注入参数？**

原设计文档中 fn 接收 `llm` 参数（编排层注入 fast/strong tier）。但在实际 Session 层实现中，ConsolidateFn 签名为 `(currentMemory, messages) => Promise<string>`，不接收 LLM。

理由：**应用层拥有全部控制权**。应用层在定义 fn 时通过闭包捕获自己想用的 LLM 实例，不需要编排层中转。这更符合 "框架对 L2 格式完全无感知" 的原则——连用什么 LLM 生成 L2 都不关心。

```typescript
// 应用层自行选择 LLM tier
const fastLLM = new OpenAIAdapter('gpt-4o-mini')
const strongLLM = new OpenAIAdapter('o1')

const engine = createEngine({
  // ...
  consolidate: {
    trigger: 'onSwitch',
    fn: async (currentMemory, messages) => {
      // 闭包捕获 fastLLM
      const res = await fastLLM.complete([...])
      return res.content ?? ''
    },
  },
  mainSession: {
    label: '规划师',
    integrate: {
      trigger: 'afterConsolidate',
      fn: async (children, currentSynthesis) => {
        // 闭包捕获 strongLLM
        const res = await strongLLM.complete([...])
        return JSON.parse(res.content ?? '{}')
      },
    },
  },
})
```

**Q: 为什么没有 SplitPolicy？**

SplitPolicy（自动检测 Session 应该分裂）是高级特性，v0.2 暂不实现。应用层可通过 tool call 实现同样效果——定义一个 `createSubSession` 工具，LLM 自行决定何时创建子 Session。

---

## 4. 核心接口 — Engine

```typescript
interface Engine {
  // ─── 对话 ───

  /** 完整对话轮次 */
  turn(sessionId: string, input: string, options?: TurnOptions): Promise<TurnResult>

  /** 流式对话轮次 */
  turnStream(sessionId: string, input: string, options?: TurnOptions): TurnStreamResult

  // ─── Session 管理 ───

  /** 创建子 Session（自动设置 parentId 为 Main Session） */
  createSession(options?: CreateChildOptions): Promise<Session>

  /** 加载已有 Session */
  getSession(id: string): Promise<Session | null>

  /** 获取 Main Session（未配置返回 null） */
  getMainSession(): Promise<MainSession | null>

  /** 列举子 Session */
  listSessions(filter?: SessionFilter): Promise<SessionMeta[]>

  // ─── 手动触发 ───

  /** 手动触发某 Session 的 consolidation */
  consolidate(sessionId: string): Promise<void>

  /** 手动触发 integration */
  integrate(): Promise<IntegrateResult>

  // ─── 事件 ───
  on<E extends EngineEventName>(event: E, handler: EngineEventHandler<E>): void
  off<E extends EngineEventName>(event: E, handler: EngineEventHandler<E>): void
}

/** 创建子 Session 的选项（省略 storage/llm/systemPrompt，由 Engine 注入） */
interface CreateChildOptions {
  label?: string
  tags?: string[]
  metadata?: Record<string, unknown>
}
```

### TurnResult

```typescript
interface TurnOptions {
  /** 工具调用最大循环次数（默认 10） */
  maxToolRounds?: number
  /** 跳过自动调度（consolidation/integration） */
  skipScheduling?: boolean
}

interface TurnResult {
  /** LLM 最终文本响应 */
  content: string | null
  /** 目标 Session ID */
  sessionId: string
  /** 本轮所有 tool call 执行记录 */
  toolCalls?: Array<{ call: ToolCall; result: CallToolResult }>
  /** 累计 token 用量 */
  usage?: { promptTokens: number; completionTokens: number }
}

/** 流式 turn 结果 */
interface TurnStreamResult extends AsyncIterable<string> {
  result: Promise<TurnResult>
}
```

---

## 5. turn() 执行流程

```
Engine.turn(sessionId, input, options?)
  │
  │  ① 加载 Session
  │  session = await this.getSession(sessionId)
  │  if (!session || session.meta.status === 'archived') → throw
  │
  │  ② Session 切换检测 & onSwitch 调度
  │  if (lastActiveId !== sessionId) {
  │    maybeScheduleOnSwitch(lastActiveId, sessionId)
  │    lastActiveId = sessionId
  │  }
  │
  │  ③ Tool Call 循环
  │  result = await toolCallLoop(session, input, options)
  │
  │  ④ afterTurn 回调 (fire-and-forget)
  │  safeCall(() => config.afterTurn?.(result))
  │
  │  ⑤ everyNTurns 调度检查
  │  if (!options?.skipScheduling) {
  │    maybeScheduleEveryN(session)
  │  }
  │
  └─ return result
```

### 关键语义：turnCount 由谁维护？

`session.send()` 内部完成 L3 写入和 turnCount 递增。编排层只读取 `session.meta.turnCount` 做调度判断，**不修改 turnCount**。

---

## 6. Tool Call 循环

### 流程

```typescript
async function toolCallLoop(
  session: Session | MainSession,
  input: string,
  tools: Tool[],
  maxRounds: number,
): Promise<TurnResult> {
  let round = 0
  let result = await session.send(input)
  const allToolCalls: Array<{ call: ToolCall; result: CallToolResult }> = []

  while (result.toolCalls?.length) {
    round++
    if (round > maxRounds) throw new MaxToolRoundsError(maxRounds)

    for (const call of result.toolCalls) {
      const tool = tools.find(t => t.name === call.name)
      if (!tool) {
        // 未知工具 → 记录错误，返回错误给 LLM
        const errorResult = { output: `Unknown tool: ${call.name}`, isError: true }
        allToolCalls.push({ call, result: errorResult })
        continue
      }

      // 验证输入 + 执行
      const parsed = tool.inputSchema.safeParse(call.input)
      if (!parsed.success) {
        const errorResult = { output: `Invalid input: ${parsed.error.message}`, isError: true }
        allToolCalls.push({ call, result: errorResult })
        continue
      }

      const toolResult = await tool.execute(parsed.data)
      allToolCalls.push({ call, result: toolResult })
    }

    // 格式化工具结果，send 给 Session（Session 自动写入 L3）
    const toolResponseContent = formatToolResults(allToolCalls.slice(-result.toolCalls.length))
    result = await session.send(toolResponseContent)
  }

  return {
    content: result.content,
    sessionId: session.meta.id,
    toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
    usage: accumulateUsage(/* 所有轮次 */),
  }
}
```

### tool message 格式

tool call 结果作为单条 user message 发给 Session.send()，内含结构化的工具执行结果：

```
[Tool Results]
- tool_call_id: xxx
  output: { ... }
- tool_call_id: yyy
  output: { ... }
```

> **替代方案**：每个 tool result 单独发一条 `role: 'tool'` message。但这要求 session.send() 支持批量写入多条消息。当前 send() 签名是 `send(content: string)`，单条 string 输入。
>
> **决策**：v0.2 先用单条 user message 包装所有 tool results。如果未来需要精确的 `role: 'tool'` 语义，扩展 send() 签名为 `send(input: string | Message[])`.

---

## 7. Consolidation 调度

### 判断逻辑

```typescript
function shouldConsolidate(
  session: Session,
  trigger: ConsolidateTrigger,
  event: 'switch' | 'turn' | 'archive',
): boolean {
  switch (trigger) {
    case 'onSwitch':
      return event === 'switch'

    case 'onArchive':
      return event === 'archive'

    case 'manual':
      return false  // 只通过 Engine.consolidate() 手动触发

    default:  // { type: 'everyNTurns', n }
      if (event !== 'turn') return false
      const since = session.meta.turnCount - session.meta.consolidatedTurn
      return since >= trigger.n
  }
}
```

### 执行方式：fire-and-forget

```typescript
function scheduleConsolidate(sessionId: string): void {
  // 不 await，不阻塞 turn() 返回
  this.consolidate(sessionId).catch(err => {
    this.emit('error', { source: 'consolidate', sessionId, error: err })
  })
}
```

### 增量 vs 全量

ConsolidateFn 接收 `(currentMemory, messages)`：
- `currentMemory`：上次 consolidation 产出的 L2（null 表示首次）
- `messages`：**全部** L3 记录

应用层的 fn 自行决定增量还是全量。如果需要增量，fn 可以通过 `session.meta.consolidatedTurn` 自行切分新旧消息。编排层不介入格式判断。

---

## 8. Integration 调度

### 判断逻辑

```typescript
function shouldIntegrate(
  trigger: IntegrateTrigger,
  event: 'consolidateComplete' | 'switch' | 'turn',
): boolean {
  switch (trigger) {
    case 'afterConsolidate':
      return event === 'consolidateComplete'

    case 'onSwitch':
      // 切换目标是 Main Session 时触发
      return event === 'switch'

    case 'manual':
      return false

    default:  // { type: 'everyNTurns', n }
      if (event !== 'turn') return false
      // 针对 Main Session 的 turnCount
      return mainSession.meta.turnCount % trigger.n === 0
  }
}
```

### afterConsolidate 联动

当 consolidation 触发器配合 `afterConsolidate` integration 触发器时，形成链式调度：

```
turn 完成
  → consolidation (fire-and-forget)
    → consolidation 完成
      → integration (fire-and-forget)
        → synthesis 更新 + insights 推送
```

整个链条都不阻塞 turn() 返回。

```typescript
// scheduleConsolidate 内部
async consolidate(sessionId: string): Promise<void> {
  const session = await this.getSession(sessionId)
  await session.consolidate(this.config.consolidate.fn)

  // consolidation 完成后，检查是否需要触发 integration
  if (shouldIntegrate(integrateTrigger, 'consolidateComplete')) {
    this.scheduleIntegrate()
  }
}
```

---

## 9. Session 路由与切换

### 状态追踪

Engine 内部维护 `lastActiveSessionId: string | null`，表示最后一次 `turn()` 操作的 Session。

```typescript
class EngineImpl {
  private lastActiveSessionId: string | null = null

  async turn(sessionId: string, input: string, options?: TurnOptions) {
    // 切换检测
    if (this.lastActiveSessionId && this.lastActiveSessionId !== sessionId) {
      this.handleSwitch(this.lastActiveSessionId, sessionId)
    }
    this.lastActiveSessionId = sessionId

    // ... 正常 turn 流程
  }
}
```

### 切换时的调度

```typescript
private handleSwitch(fromId: string, toId: string): void {
  // 1. 离开旧 Session → 可能触发 consolidation
  if (consolidateTrigger === 'onSwitch') {
    this.scheduleConsolidate(fromId)
  }

  // 2. 进入新 Session → 如果是 Main Session，可能触发 integration
  if (integrateTrigger === 'onSwitch' && toId === this.mainSessionId) {
    this.scheduleIntegrate()
  }
}
```

### 无显式 "当前 Session"

Engine 不维护 "当前 Session" 状态。每次 `turn()` 显式传入 `sessionId`。`lastActiveSessionId` 仅用于切换检测。

这个设计让 Engine 无状态化（除了切换追踪）：多个并发 turn 调用可以各自独立运行。

---

## 10. Streaming + Tool Call

### 核心矛盾

Tool call 循环需要完整的 LLM 响应才能判断是否有下一轮 tool call，但 streaming 要求在 LLM 响应生成中就开始输出。二者在有 tool call 场景下存在根本冲突。

### 方案：分支策略

```
turnStream(sessionId, input)
  │
  ├─ 无工具场景 → session.stream(input) → 直接逐 chunk 输出
  │
  └─ 有工具场景 →
       ├─ 中间轮（有 tool call）→ session.send()（非流式，快速执行）
       └─ 末轮（无 tool call）→ session.stream()（流式输出给用户）
```

### 实现

```typescript
turnStream(sessionId: string, input: string, options?: TurnOptions): TurnStreamResult {
  const tools = this.config.tools ?? []

  if (tools.length === 0) {
    // 无工具，直接流式，零额外开销
    return this.directStream(sessionId, input)
  }

  // 有工具，需要 tool call 循环
  return this.toolAwareStream(sessionId, input, options)
}
```

**无工具路径**：

```typescript
private directStream(sessionId: string, input: string): TurnStreamResult {
  const session = this.getSessionSync(sessionId)
  const stream = session.stream(input)
  // 直接透传 session 的 stream
  return {
    [Symbol.asyncIterator]: () => stream[Symbol.asyncIterator](),
    result: stream.result.then(r => ({
      content: r.content,
      sessionId,
      usage: r.usage,
    })),
  }
}
```

**有工具路径**：

```typescript
private toolAwareStream(sessionId: string, input: string, options?: TurnOptions): TurnStreamResult {
  let resolveResult: (r: TurnResult) => void
  const resultPromise = new Promise<TurnResult>(r => { resolveResult = r })

  const iterator = async function* (this: EngineImpl) {
    const session = await this.getSession(sessionId)
    let res = await session.send(input)
    const allToolCalls = []

    // Tool call 循环（非流式，快速）
    while (res.toolCalls?.length) {
      // 执行工具...
      res = await session.send(toolResultsContent)
    }

    if (res.content) {
      // 末轮无 tool call，内容已拿到
      // 如果希望末轮也流式，可以重新调 stream()
      // 但内容已在 res.content 中，直接 yield
      yield res.content
    }

    resolveResult({ content: res.content, sessionId, toolCalls: allToolCalls })
  }.bind(this)

  return { [Symbol.asyncIterator]: iterator, result: resultPromise }
}
```

> **权衡**：有工具场景下，最终响应不是逐 token 流式输出，而是一次性 yield。这是可接受的权衡——tool call 场景中用户等待的主要时间在工具执行，而非最后一轮 LLM 输出。
>
> 如果未来需要末轮也流式，可以在 tool loop 最后一轮改用 `session.stream()` 替代 `session.send()`。但判断"这是最后一轮"需要投机执行或二阶段策略，复杂度较高，v0.2 不做。

---

## 11. 事件系统

### Engine 事件

```typescript
type EngineEventName =
  | 'turnComplete'          // 每轮 turn 完成后
  | 'consolidated'          // consolidation 完成后
  | 'integrated'            // integration 完成后
  | 'sessionSwitched'       // Session 切换发生时
  | 'error'                 // 异步操作出错时

interface EngineEventPayloads {
  turnComplete: { result: TurnResult }
  consolidated: { sessionId: string; memory: string }
  integrated: { result: IntegrateResult }
  sessionSwitched: { from: string; to: string }
  error: { source: 'consolidate' | 'integrate' | 'afterTurn' | 'toolExecute'; error: unknown }
}
```

### 事件与 Session 事件的关系

Engine 事件是编排层级别的。Session 层自己的事件（`session.on('consolidated', ...)`）仍然正常触发。两层事件独立，Engine 不转发 Session 事件。

应用层如需监听某个 Session 的细粒度事件，直接 `session.on()`。如需监听全局编排事件（所有 Session 的 consolidation），用 `engine.on('consolidated', ...)`。

---

## 12. 错误处理

### 原则

**回调失败不中断对话周期，只降低记忆质量。**

| 场景 | 处理方式 |
|------|----------|
| `session.send()` 失败 | **向上抛出**，turn() 失败。这是对话核心路径，不能静默吞掉 |
| `tool.execute()` 失败 | 捕获异常，将错误信息作为 tool result 返回给 LLM，继续循环 |
| `consolidate()` 失败 | 捕获异常，emit `error` 事件，不影响 turn() 返回 |
| `integrate()` 失败 | 捕获异常，emit `error` 事件，不影响 turn() 返回 |
| `afterTurn` 回调失败 | 捕获异常，emit `error` 事件 |

### 安全执行包装

```typescript
/** fire-and-forget 安全执行 */
function fireAndForget(
  fn: () => Promise<void>,
  source: string,
  emit: (event: 'error', payload: any) => void,
): void {
  fn().catch(error => {
    emit('error', { source, error })
  })
}
```

---

## 13. 完整使用示例

```typescript
import { createEngine } from '@stello-ai/core'
import { OpenAIAdapter } from './my-llm-adapter'
import { PostgresStorageAdapter } from './my-storage'
import { tool } from '@stello-ai/core'
import { z } from 'zod'

// LLM 适配器
const defaultLLM = new OpenAIAdapter('gpt-4o')
const fastLLM = new OpenAIAdapter('gpt-4o-mini')
const strongLLM = new OpenAIAdapter('o1')

// 工具定义
const webSearch = tool(
  'web_search',
  '搜索网页获取最新信息',
  { query: z.string().describe('搜索关键词') },
  async ({ query }) => {
    const results = await searchWeb(query)
    return { output: results }
  },
)

// 创建引擎
const engine = createEngine({
  storage: new PostgresStorageAdapter(DATABASE_URL),
  llm: defaultLLM,
  systemPrompt: '你是留学申请规划助手。',
  tools: [webSearch],

  consolidate: {
    trigger: 'onSwitch',
    fn: async (currentMemory, messages) => {
      // 用 fast LLM 生成 L2
      const res = await fastLLM.complete([
        { role: 'system', content: '分析对话，输出 JSON 格式的技能描述...' },
        { role: 'user', content: messages.map(m => `[${m.role}] ${m.content}`).join('\n') },
      ])
      return res.content ?? '{}'
    },
  },

  mainSession: {
    label: '留学申请规划师',
    integrate: {
      trigger: 'afterConsolidate',
      fn: async (children, currentSynthesis) => {
        // 用 strong LLM 综合分析
        const res = await strongLLM.complete([
          { role: 'system', content: '分析所有子任务状态，输出 synthesis + insights...' },
          { role: 'user', content: children.map(c => `[${c.label}] ${c.l2}`).join('\n\n') },
        ])
        return JSON.parse(res.content ?? '{}')
      },
    },
  },

  maxTurns: 30,
})

// ─── 使用 ───

// 创建子 Session
const schoolSession = await engine.createSession({ label: '选校讨论' })

// 对话（含自动 tool call 循环）
const result = await engine.turn(schoolSession.meta.id, 'MIT 和 Stanford 怎么选？')
console.log(result.content)

// 流式对话
const stream = engine.turnStream(schoolSession.meta.id, '分析 MIT CS 的研究方向')
for await (const chunk of stream) {
  process.stdout.write(chunk)
}

// 切换到另一个 Session（自动触发 onSwitch consolidation）
const essaySession = await engine.createSession({ label: '文书润色' })
await engine.turn(essaySession.meta.id, 'SOP 初稿怎么写？')

// 切换到 Main Session（自动触发 onSwitch integration）
const main = await engine.getMainSession()
const overview = await engine.turn(main!.meta.id, '整体进度如何？')

// 事件监听
engine.on('error', ({ source, error }) => {
  console.error(`[${source}] 异步操作失败:`, error)
})

engine.on('integrated', ({ result }) => {
  console.log('Integration 完成，insights 已推送')
})
```

---

## 14. 实现前置依赖

编排层依赖 Session 层的 `send()` 和 `stream()` 实现。当前它们抛出 `NotImplementedError`。

### Session.send() 实现清单

`send()` 是 Session 层的核心方法，需要完成：

1. **上下文组装**（固定规则，不可覆盖）

   **子 Session**：
   ```
   messages = [
     { role: 'system', content: systemPrompt + (insight ?? '') },
     ...最近 N 轮 L3,
     { role: 'user', content: input },
   ]
   ```

   **Main Session**：
   ```
   messages = [
     { role: 'system', content: systemPrompt + (synthesis ?? '') },
     ...最近 N 轮 L3,
     { role: 'user', content: input },
   ]
   ```

2. **调用 LLM**：`llm.complete(messages, { tools: toolSchemas })`

3. **写入 L3**：
   - `appendRecord(sessionId, { role: 'user', content: input })`
   - `appendRecord(sessionId, { role: 'assistant', content: result.content })`

4. **更新 turnCount**：`turnCount++`，`putSession(updatedMeta)`

5. **返回 SendResult**

### Session.stream() 实现清单

与 send() 相同流程，但：
- 使用 `llm.stream()` 替代 `llm.complete()`
- 逐 chunk yield
- L3 在流结束后（全部 chunks 收集完）才写入
- 如果 LLM 不支持 `stream()`，退化为 `complete()` + 单次 yield

### 需要的 CreateSessionOptions 扩展

send() 需要 `maxTurns` 和 `tools` 信息来组装上下文和传递给 LLM。当前 CreateSessionOptions 没有这些字段。

两种方案：

**方案 A：扩展 CreateSessionOptions**

```typescript
interface CreateSessionOptions {
  storage: StorageAdapter
  llm?: LLMAdapter
  systemPrompt?: string
  maxTurns?: number           // 新增
  tools?: Tool[]              // 新增
  // ...
}
```

**方案 B：send() 接受 options 参数**

```typescript
interface Session {
  send(content: string, options?: SendOptions): Promise<SendResult>
}

interface SendOptions {
  maxTurns?: number
  tools?: Tool[]
}
```

**推荐方案 A**：Session 创建时注入配置，send() 保持简洁。Engine 在创建 Session 时把自己的 config 传进去。

---

## 15. 实现计划

### Phase 1：Session.send() / stream()（在 @stello-ai/session 中）

```
1. 扩展 CreateSessionOptions，增加 maxTurns
2. 实现 Session.send()：上下文组装 + LLM 调用 + L3 写入 + turnCount 更新
3. 实现 Session.stream()：流式变体
4. 实现 MainSession.send() / stream()：上下文使用 synthesis
5. 测试：turn.test.ts 中的 todo 用例全部通过
```

### Phase 2：Engine 核心（新建 @stello-ai/core v0.2 或新包）

```
1. 定义 EngineConfig / Engine / TurnResult 等类型
2. 实现 createEngine()：初始化存储、创建/加载 Main Session
3. 实现 Engine.turn()：Session 解析 + tool call 循环 + 返回结果
4. 实现 Engine.turnStream()：无工具直接流式 + 有工具分支策略
5. 实现 Engine.createSession()：自动设置 parentId、注入 systemPrompt/llm
6. 测试：tool call 循环、MaxToolRoundsError、未知工具处理
```

### Phase 3：调度器

```
1. 实现 shouldConsolidate / shouldIntegrate 判断逻辑
2. 实现 Session 切换检测 + onSwitch 调度
3. 实现 everyNTurns 调度
4. 实现 afterConsolidate → integration 联动
5. 实现 fire-and-forget 执行 + error 事件
6. 测试：各触发时机、fire-and-forget 不阻塞、错误事件
```

### Phase 4：集成测试

```
1. 端到端场景：创建 Engine → 创建 Session → turn → 切换 → consolidation → integration
2. 流式场景：turnStream 有/无工具
3. 错误场景：LLM 失败、工具失败、consolidation 失败
4. 并发场景：多个 turn 并发执行（共享 Engine）
```
