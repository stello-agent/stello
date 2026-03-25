# StelloAgent 配置完全参考

> 本文档覆盖 `createStelloAgent(config)` 所需的全部配置字段，包括间接传入的 Session 层、LLM 层、存储层配置。
>
> 适用版本：`@stello-ai/core` + `@stello-ai/session` 当前 main 分支

---

## 目录

- [快速开始](#快速开始)
- [顶层配置 StelloAgentConfig](#顶层配置---stelloagentconfig)
- [1. sessions — 拓扑树](#1-sessions--sessiontree)
- [2. memory — 记忆系统](#2-memory--memoryengine)
- [3. capabilities — 能力注入](#3-capabilities--stelloagentcapabilitiesconfig)
  - [3.1 lifecycle](#31-lifecycle--enginelifecycleadapter)
  - [3.2 tools](#32-tools--enginetoolruntime)
  - [3.3 skills](#33-skills--skillrouter)
  - [3.4 confirm](#34-confirm--confirmprotocol)
- [4. session — Session 层接入](#4-session--stelloagentsessionconfig)
  - [4.1 SessionCompatible](#41-sessioncompatible--session-兼容接口)
  - [4.2 MainSessionCompatible](#42-mainsessioncompatible--mainsession-兼容接口)
  - [4.3 consolidateFn / integrateFn](#43-consolidatefn--integratefn)
- [5. runtime — 运行时管理](#5-runtime--stelloagentruntimeconfig)
- [6. orchestration — 编排层](#6-orchestration--stelloagentorchestrationconfig)
  - [6.1 strategy](#61-strategy--orchestrationstrategy)
  - [6.2 scheduler](#62-scheduler--调度器)
  - [6.3 splitGuard](#63-splitguard--拆分保护)
  - [6.4 hooks](#64-hooks--enginehookprovider)
- [Session 包配置](#session-包配置--stello-aisession)
  - [createSession / createMainSession](#createsession--createmainession)
  - [LLM 适配器](#llm-适配器)
  - [存储适配器](#存储适配器)
- [配置依赖关系图](#配置依赖关系图)
- [完整示例：最小配置](#完整示例最小配置)
- [完整示例：生产级配置](#完整示例生产级配置)

---

## 快速开始

```typescript
import { createStelloAgent } from '@stello-ai/core'

const agent = createStelloAgent({
  sessions,       // SessionTree 实例
  memory,         // MemoryEngine 实例
  capabilities: { lifecycle, tools, skills, confirm },
  session: {      // 接入 @stello-ai/session
    sessionResolver,
    consolidateFn,
  },
})

// 使用 agent
await agent.enterSession(rootId)
const result = await agent.turn(rootId, '你好')
await agent.leaveSession(rootId)
```

---

## 顶层配置 — StelloAgentConfig

```typescript
interface StelloAgentConfig {
  sessions: SessionTree                           // 必填 — 拓扑树
  memory: MemoryEngine                            // 必填 — 记忆系统
  capabilities: StelloAgentCapabilitiesConfig      // 必填 — 能力注入
  session?: StelloAgentSessionConfig               // 可选 — Session 层接入
  runtime?: StelloAgentRuntimeConfig               // 可选 — 运行时管理
  orchestration?: StelloAgentOrchestrationConfig   // 可选 — 编排策略
}
```

| 字段 | 必填 | 说明 |
|------|:----:|------|
| `sessions` | 是 | Session 拓扑树，管理所有 Session 的元数据和父子关系 |
| `memory` | 是 | 记忆系统，负责 L1/L2/L3 的读写 |
| `capabilities` | 是 | 能力注入：生命周期钩子、工具、技能、确认协议 |
| `session` | 否 | 接入 `@stello-ai/session` 的配置，提供真实 Session 实例 |
| `runtime` | 否 | 运行时配置：Session runtime 解析器和回收策略 |
| `orchestration` | 否 | 编排层配置：策略、调度、拆分保护、hooks |

> **两种接入方式**：
> - **方式 A**（推荐）：提供 `session.sessionResolver` + `session.consolidateFn`，StelloAgent 自动适配
> - **方式 B**（高级）：直接提供 `runtime.resolver`，自己实现 `EngineRuntimeSession`

---

## 1. sessions — SessionTree

拓扑树实例，管理所有 Session 的元数据和父子关系。通常使用内置的 `SessionTreeImpl`。

```typescript
import { NodeFileSystemAdapter, SessionTreeImpl } from '@stello-ai/core'

// 文件持久化
const fs = new NodeFileSystemAdapter('./data')
const sessions = new SessionTreeImpl(fs)

// 首次使用需创建根节点
const root = await sessions.createRoot('Main Session')
```

### SessionTree 接口

```typescript
interface SessionTree {
  createChild(options: CreateSessionOptions): Promise<TopologyNode>
  get(id: string): Promise<SessionMeta | null>
  getRoot(): Promise<SessionMeta>
  listAll(): Promise<SessionMeta[]>
  archive(id: string): Promise<void>
  updateMeta(id: string, updates: Partial<Pick<SessionMeta,
    'label' | 'scope' | 'tags' | 'metadata' | 'turnCount'
  >>): Promise<SessionMeta>
  getNode(id: string): Promise<TopologyNode | null>
  getTree(): Promise<SessionTreeNode>
  getAncestors(id: string): Promise<TopologyNode[]>
  getSiblings(id: string): Promise<TopologyNode[]>
  addRef(fromId: string, toId: string): Promise<void>
}
```

### SessionMeta — Session 元数据

```typescript
interface SessionMeta {
  readonly id: string
  label: string              // 显示名称
  scope: string | null       // 话题范围
  status: 'active' | 'archived'
  turnCount: number          // 已完成轮次
  metadata: Record<string, unknown>
  tags: string[]
  createdAt: string          // ISO 时间戳
  updatedAt: string
  lastActiveAt: string
}
```

### TopologyNode — 拓扑节点

```typescript
interface TopologyNode {
  readonly id: string
  parentId: string | null    // 根节点为 null
  children: string[]         // 子节点 ID 列表
  refs: string[]             // 引用关系
  depth: number              // 树深度
  index: number              // 同级序号
  label: string
}
```

### CreateSessionOptions — 创建子 Session

```typescript
interface CreateSessionOptions {
  parentId: string           // 父节点 ID
  label: string              // 显示名称
  scope?: string             // 话题范围
  metadata?: Record<string, unknown>
  tags?: string[]
}
```

---

## 2. memory — MemoryEngine

记忆系统，负责 L1（核心档案）、L2（Session 摘要）、L3（原始对话记录）的读写。

```typescript
interface MemoryEngine {
  // L1 核心档案
  readCore(path?: string): Promise<unknown>
  writeCore(path: string, value: unknown): Promise<void>

  // L2 Session 摘要（子 Session 存 L2，MainSession 存 synthesis）
  readMemory(sessionId: string): Promise<string | null>
  writeMemory(sessionId: string, content: string): Promise<void>

  // Scope — MainSession 推送给子 Session 的 insights
  readScope(sessionId: string): Promise<string | null>
  writeScope(sessionId: string, content: string): Promise<void>

  // Index — 辅助索引
  readIndex(sessionId: string): Promise<string | null>
  writeIndex(sessionId: string, content: string): Promise<void>

  // L3 原始对话记录
  appendRecord(sessionId: string, record: TurnRecord): Promise<void>
  readRecords(sessionId: string): Promise<TurnRecord[]>

  // 上下文组装
  assembleContext(sessionId: string): Promise<AssembledContext>
}
```

### TurnRecord — 对话记录

```typescript
interface TurnRecord {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string          // ISO 时间戳
  metadata?: Record<string, unknown>
}
```

### AssembledContext — 组装好的上下文

```typescript
interface AssembledContext {
  core: Record<string, unknown>    // L1 核心档案
  memories: string[]               // 按继承策略收集的父级记忆
  currentMemory: string | null     // 当前 Session 的 L2
  scope: string | null             // 当前 Session 的 scope/insights
}
```

### CoreSchema — L1 字段定义

```typescript
type CoreSchema = Record<string, CoreSchemaField>

interface CoreSchemaField {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object'
  default?: unknown
  bubbleable?: boolean       // 是否冒泡到全局
  requireConfirm?: boolean   // 变更是否需要确认
}
```

**示例**：

```typescript
const schema: CoreSchema = {
  name: { type: 'string', default: '', bubbleable: true },
  goal: { type: 'string', default: '', bubbleable: true },
  topics: { type: 'array', default: [], bubbleable: true },
}
```

### 内置实现

SDK 不提供固定的 MemoryEngine 实现——需要根据部署环境自行实现。参考 demo 中的两种模式：

- **内存模式**：用 `Map` 存储，进程退出丢失。见 `demo/stello-agent-basic/demo.ts`
- **文件模式**：用 `NodeFileSystemAdapter` 读写 JSON，支持重启恢复。见 `demo/stello-agent-chat/server.ts`

---

## 3. capabilities — StelloAgentCapabilitiesConfig

```typescript
interface StelloAgentCapabilitiesConfig {
  lifecycle: EngineLifecycleAdapter   // 生命周期适配器
  tools: EngineToolRuntime            // 工具执行器
  skills: SkillRouter                 // Skill 路由
  confirm: ConfirmProtocol            // 确认协议
}
```

所有字段均为必填。

---

### 3.1 lifecycle — EngineLifecycleAdapter

Engine 在关键节点调用的生命周期钩子。

```typescript
interface EngineLifecycleAdapter {
  /** 进入 Session 时做 bootstrap，返回组装好的上下文 */
  bootstrap(sessionId: string): Promise<BootstrapResult>

  /** turn 结束后持久化对话记录 */
  afterTurn(
    sessionId: string,
    userMsg: TurnRecord,
    assistantMsg: TurnRecord,
  ): Promise<AfterTurnResult>

  /** fork 时创建子 Session 并返回拓扑节点 */
  prepareChildSpawn(options: CreateSessionOptions): Promise<TopologyNode>
}
```

**返回类型**：

```typescript
interface BootstrapResult {
  context: AssembledContext
  session: SessionMeta
}

interface AfterTurnResult {
  coreUpdated: boolean       // L1 是否有更新
  memoryUpdated: boolean     // L2 是否有更新
  recordAppended: boolean    // L3 是否追加成功
}
```

**示例**：

```typescript
const lifecycle: EngineLifecycleAdapter = {
  async bootstrap(sessionId) {
    return {
      context: await memory.assembleContext(sessionId),
      session: await sessions.get(sessionId),
    }
  },
  async afterTurn(sessionId, userMsg, assistantMsg) {
    await memory.appendRecord(sessionId, userMsg)
    await memory.appendRecord(sessionId, assistantMsg)
    await sessions.updateMeta(sessionId, {
      turnCount: (await sessions.get(sessionId))!.turnCount + 1,
    })
    return { coreUpdated: false, memoryUpdated: false, recordAppended: true }
  },
  async prepareChildSpawn(options) {
    const child = await sessions.createChild(options)
    // 这里也要创建子 Session 的运行时实例
    return child
  },
}
```

---

### 3.2 tools — EngineToolRuntime

工具执行器，Engine 在 tool call 循环中调用。

```typescript
interface EngineToolRuntime {
  /** 返回所有可用工具的定义（传给 LLM） */
  getToolDefinitions(): ToolDefinition[]

  /** 执行指定工具 */
  executeTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolExecutionResult>
}

interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>  // JSON Schema
}

interface ToolExecutionResult {
  success: boolean
  data?: unknown
  error?: string
}
```

**示例**：

```typescript
const tools: EngineToolRuntime = {
  getToolDefinitions: () => [
    {
      name: 'search_web',
      description: 'Search the web for information',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
        },
        required: ['query'],
      },
    },
  ],
  async executeTool(name, args) {
    if (name === 'search_web') {
      const results = await searchWeb(String(args.query))
      return { success: true, data: results }
    }
    return { success: false, error: `Unknown tool: ${name}` }
  },
}
```

---

### 3.3 skills — SkillRouter

Skill 路由器，根据消息内容匹配已注册的 Skill。

```typescript
interface SkillRouter {
  register(skill: Skill): void
  match(message: TurnRecord): Skill | null
  getAll(): Skill[]
}

interface Skill {
  name: string
  description: string
  keywords: string[]          // 触发关键词
  guidancePrompt: string      // 匹配后注入的提示
  handler(ctx: SkillContext): Promise<SkillResult>
}
```

**内置实现**：

```typescript
import { SkillRouterImpl } from '@stello-ai/core'

const skills = new SkillRouterImpl()
// 可选：注册自定义 Skill
skills.register({
  name: 'code-review',
  description: 'Review code changes',
  keywords: ['review', 'code review', 'PR'],
  guidancePrompt: 'Focus on code quality and best practices.',
  async handler(ctx) { /* ... */ },
})
```

---

### 3.4 confirm — ConfirmProtocol

确认协议，当 Engine 需要确认拆分或 L1 更新时调用。

```typescript
interface ConfirmProtocol {
  /** 确认拆分，创建子 Session */
  confirmSplit(proposal: SplitProposal): Promise<TopologyNode>
  /** 拒绝拆分 */
  dismissSplit(proposal: SplitProposal): Promise<void>
  /** 确认 L1 更新 */
  confirmUpdate(proposal: UpdateProposal): Promise<void>
  /** 拒绝 L1 更新 */
  dismissUpdate(proposal: UpdateProposal): Promise<void>
}

interface SplitProposal {
  id: string
  parentId: string
  suggestedLabel: string
  suggestedScope?: string
  reason: string
}

interface UpdateProposal {
  id: string
  path: string               // L1 字段路径
  oldValue: unknown
  newValue: unknown
  reason: string
}
```

**常用模式——自动确认**：

```typescript
const confirm: ConfirmProtocol = {
  async confirmSplit(proposal) {
    return lifecycle.prepareChildSpawn({
      parentId: proposal.parentId,
      label: proposal.suggestedLabel,
      scope: proposal.suggestedScope,
    })
  },
  async dismissSplit() {},
  async confirmUpdate() {},
  async dismissUpdate() {},
}
```

---

## 4. session — StelloAgentSessionConfig

接入 `@stello-ai/session` 包的配置。这是将真实 Session 实例连接到 StelloAgent 的推荐方式。

```typescript
interface StelloAgentSessionConfig {
  /** 按 sessionId 解析 Session 实例 */
  sessionResolver?: (sessionId: string) => Promise<SessionCompatible>

  /** 解析 MainSession（需要 integration 时提供） */
  mainSessionResolver?: () => Promise<MainSessionCompatible | null>

  /** L3 → L2 的提炼函数 */
  consolidateFn?: SessionCompatibleConsolidateFn

  /** 所有 L2 → synthesis + insights */
  integrateFn?: SessionCompatibleIntegrateFn

  /** send() 结果序列化方式（默认 JSON） */
  serializeSendResult?: (result: SessionCompatibleSendResult) => string

  /** tool call 解析器 */
  toolCallParser?: ToolCallParser

  /** 透传给 Session 组件的配置 */
  options?: Record<string, unknown>
}
```

| 字段 | 必要性 | 说明 |
|------|--------|------|
| `sessionResolver` | 方式 A 必填 | 将 core 的 sessionId 映射到真实 Session 实例 |
| `consolidateFn` | 方式 A 必填 | 与 `sessionResolver` 配对使用 |
| `mainSessionResolver` | 可选 | 不提供则无 integration 能力 |
| `integrateFn` | 可选 | 与 `mainSessionResolver` 配对使用 |
| `serializeSendResult` | 可选 | 默认 JSON.stringify |
| `toolCallParser` | 可选 | 默认使用内置 sessionSendResultParser |
| `options` | 可选 | 预留扩展 |

---

### 4.1 SessionCompatible — Session 兼容接口

`sessionResolver` 返回的对象需满足此接口：

```typescript
interface SessionCompatible {
  meta: {
    id: string
    status: 'active' | 'archived'
  }

  /** 单次 LLM 调用 */
  send(content: string): Promise<SessionCompatibleSendResult>

  /** 流式 LLM 调用（可选） */
  stream?(content: string): AsyncIterable<string> & {
    result: Promise<SessionCompatibleSendResult>
  }

  /** 获取历史消息 */
  messages(): Promise<Array<{
    role: string
    content: string
    timestamp?: string
  }>>

  /** 执行 consolidation（L3 → L2） */
  consolidate(fn: SessionCompatibleConsolidateFn): Promise<void>
}

interface SessionCompatibleSendResult {
  content: string | null
  toolCalls?: Array<{
    id: string
    name: string
    input: Record<string, unknown>
  }>
  usage?: {
    promptTokens: number
    completionTokens: number
  }
}
```

> `@stello-ai/session` 的 `Session` 和 `MainSession` 都天然满足此接口。
> 你也可以自己实现——只要结构匹配即可（鸭子类型）。

---

### 4.2 MainSessionCompatible — MainSession 兼容接口

```typescript
interface MainSessionCompatible {
  integrate(fn: SessionCompatibleIntegrateFn): Promise<unknown>
}
```

---

### 4.3 consolidateFn / integrateFn

这两个是**配对函数**——consolidateFn 产出的 L2 格式必须与 integrateFn 读取的格式匹配。框架对 L2 内容格式完全无感知。

```typescript
/** L3 原始对话 → L2 技能描述 */
type SessionCompatibleConsolidateFn = (
  currentMemory: string | null,     // 当前 L2（首次为 null）
  messages: Array<{                 // L3 对话记录
    role: string
    content: string
    timestamp?: string
  }>,
) => Promise<string>                // 新的 L2

/** 所有子 Session 的 L2 → synthesis + insights */
type SessionCompatibleIntegrateFn = (
  children: Array<{                 // 所有子 Session 的 L2
    sessionId: string
    label: string
    l2: string
  }>,
  currentSynthesis: string | null,  // 当前 synthesis（首次为 null）
) => Promise<{
  synthesis: string                 // MainSession 的综合认知
  insights: Array<{                 // 定向推送给各子 Session
    sessionId: string
    content: string
  }>
}>
```

**内置默认实现**：

```typescript
import {
  createDefaultConsolidateFn,
  createDefaultIntegrateFn,
  DEFAULT_CONSOLIDATE_PROMPT,
  DEFAULT_INTEGRATE_PROMPT,
  type LLMCallFn,
} from '@stello-ai/core'

// LLM 调用函数
const llmCall: LLMCallFn = async (messages) => {
  const result = await llm.complete(messages.map(m => ({
    role: m.role as 'user' | 'assistant' | 'system',
    content: m.content,
  })))
  return result.content
}

// 使用内置提示词
const consolidateFn = createDefaultConsolidateFn(DEFAULT_CONSOLIDATE_PROMPT, llmCall)
const integrateFn = createDefaultIntegrateFn(DEFAULT_INTEGRATE_PROMPT, llmCall)

// 或自定义提示词
const consolidateFn = createDefaultConsolidateFn('你的自定义提示词...', llmCall)
```

---

## 5. runtime — StelloAgentRuntimeConfig

```typescript
interface StelloAgentRuntimeConfig {
  /** Session runtime 解析器（方式 B：直接提供） */
  resolver: SessionRuntimeResolver

  /** Engine 空闲回收策略 */
  recyclePolicy?: RuntimeRecyclePolicy
}

interface RuntimeRecyclePolicy {
  /**
   * 空闲回收延迟（毫秒）
   * - 0 或不传：引用归零立即回收
   * - > 0：延迟回收，期间重新 acquire 则取消回收
   */
  idleTtlMs?: number    // 默认 0
}
```

> **注意**：如果使用方式 A（`session.sessionResolver`），不需要手动提供 `runtime.resolver`——StelloAgent 会自动从 sessionResolver 构建。
>
> `recyclePolicy` 不依赖接入方式，两种方式都可以配。

**`idleTtlMs` 是唯一可在运行时动态修改的配置字段**，其余均为构造时注入的 immutable config。

---

## 6. orchestration — StelloAgentOrchestrationConfig

```typescript
interface StelloAgentOrchestrationConfig {
  strategy?: OrchestrationStrategy        // 编排策略
  splitGuard?: SplitGuard                 // 拆分保护
  mainSession?: SchedulerMainSession      // MainSession（方式 B）
  turnRunner?: TurnRunner                 // 自定义 turn runner
  scheduler?: Scheduler                   // 调度器
  hooks?: EngineHookProvider              // Engine hooks
}
```

全部可选。不配则使用合理默认值。

---

### 6.1 strategy — OrchestrationStrategy

决定 fork 时子 Session 挂到哪个父节点。

```typescript
interface OrchestrationStrategy {
  resolveForkParent(source: TopologyNode, sessions: SessionTree): Promise<string>
}
```

**内置策略**：

| 策略 | 行为 | 使用场景 |
|------|------|---------|
| `MainSessionFlatStrategy`（默认） | 所有子 Session 都挂在根节点下 | 扁平对话树 |
| `HierarchicalOkrStrategy` | 保持层级结构 | 目标分解 |

```typescript
import { MainSessionFlatStrategy } from '@stello-ai/core'

// 默认行为，可不配
orchestration: {
  strategy: new MainSessionFlatStrategy(),
}
```

---

### 6.2 scheduler — 调度器

控制 consolidation 和 integration 的自动触发时机。

```typescript
import { Scheduler } from '@stello-ai/core'

const scheduler = new Scheduler({
  consolidation: {
    trigger: 'everyNTurns',   // 触发时机
    everyNTurns: 5,           // 每 5 轮触发一次
  },
  integration: {
    trigger: 'afterConsolidate', // consolidation 完成后自动 integration
  },
})
```

#### ConsolidationTrigger — L3→L2 触发时机

| 值 | 说明 |
|----|------|
| `'manual'`（默认） | 不自动触发，需手动调用 |
| `'everyNTurns'` | 每 N 轮 turn 后自动触发，需配合 `everyNTurns` |
| `'onSwitch'` | 切换到其他 Session 时触发 |
| `'onArchive'` | 归档 Session 时触发 |
| `'onLeave'` | 离开 Session 时触发 |

#### IntegrationTrigger — 全局综合触发时机

| 值 | 说明 |
|----|------|
| `'manual'`（默认） | 不自动触发 |
| `'afterConsolidate'` | consolidation 完成后自动触发 |
| `'everyNTurns'` | 每 N 轮后触发 |
| `'onSwitch'` | Session 切换时触发 |
| `'onArchive'` | 归档时触发 |
| `'onLeave'` | 离开时触发 |

> 调度全部是 **fire-and-forget**，不阻塞 turn() 返回。

---

### 6.3 splitGuard — 拆分保护

防止 Session 过早或过于频繁地拆分。

```typescript
import { SplitGuard } from '@stello-ai/core'

const splitGuard = new SplitGuard(sessions, {
  minTurns: 3,         // 至少 3 轮后才允许拆分（默认 3）
  cooldownTurns: 5,    // 上次拆分后至少间隔 5 轮（默认 5）
  testMode: false,     // true 时跳过所有检查（默认 false）
})
```

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `minTurns` | `number` | `3` | 最少对话轮次 |
| `cooldownTurns` | `number` | `5` | 冷却期轮次 |
| `testMode` | `boolean` | `false` | 测试模式，跳过所有检查 |

---

### 6.4 hooks — EngineHookProvider

Engine 事件钩子。可传对象或工厂函数（per-session 配置）。

```typescript
// 方式 1：静态对象
type EngineHookProvider = Partial<EngineHooks>

// 方式 2：per-session 工厂函数
type EngineHookProvider = (sessionId: string) => Partial<EngineHooks>
```

#### EngineHooks 全部事件

```typescript
interface EngineHooks {
  /** 收到用户消息 */
  onMessageReceived(ctx: { sessionId: string; input: string }): void | Promise<void>

  /** LLM 回复 */
  onAssistantReply(ctx: {
    sessionId: string
    input: string
    content: string | null      // 文本内容（有 tool call 时为 null）
    rawResponse: string         // 原始响应
  }): void | Promise<void>

  /** 即将执行 tool call */
  onToolCall(ctx: { sessionId: string; toolCall: ToolCall }): void | Promise<void>

  /** tool call 执行结果 */
  onToolResult(ctx: { sessionId: string; result: ToolCallResult }): void | Promise<void>

  /** 进入 Session */
  onSessionEnter(ctx: { sessionId: string }): void | Promise<void>

  /** 离开 Session */
  onSessionLeave(ctx: { sessionId: string }): void | Promise<void>

  /** turn 开始（含 tool call 循环） */
  onRoundStart(ctx: { sessionId: string; input: string }): void | Promise<void>

  /** turn 结束 */
  onRoundEnd(ctx: {
    sessionId: string
    input: string
    turn: TurnRunnerResult      // 包含 finalContent / toolRoundCount 等
  }): void | Promise<void>

  /** Session 归档 */
  onSessionArchive(ctx: { sessionId: string }): void | Promise<void>

  /** Session fork */
  onSessionFork(ctx: { parentId: string; child: TopologyNode }): void | Promise<void>

  /** 错误 */
  onError(ctx: { source: string; error: Error }): void | Promise<void>
}
```

**示例——在 onRoundEnd 持久化对话**：

```typescript
orchestration: {
  hooks: {
    onRoundStart({ sessionId }) {
      currentToolSessionId = sessionId
    },
    onRoundEnd({ sessionId, input, turn }) {
      currentToolSessionId = null
      const userRecord = { role: 'user', content: input, timestamp: new Date().toISOString() }
      const assistantRecord = {
        role: 'assistant',
        content: turn.finalContent ?? turn.rawResponse,
        timestamp: new Date().toISOString(),
      }
      lifecycle.afterTurn(sessionId, userRecord, assistantRecord).catch(() => {})
    },
  },
}
```

> **Hooks 与 Scheduler 共存**：如果同时配了 hooks 和 scheduler，Factory 会将两者通过 `mergeHooks()` 合并，同一 key 下都能触发。

---

## Session 包配置 — @stello-ai/session

以下是 `@stello-ai/session` 包内部的配置，通过 `sessionResolver` 间接传入 core。

---

### createSession / createMainSession

```typescript
import { createSession } from '@stello-ai/session'
import { createMainSession } from '@stello-ai/session'

const session = await createSession({
  storage: sessionStorage,       // 必填 — SessionStorage 实例
  llm: llmAdapter,               // 可选 — LLM 适配器
  label: '子话题',                // 可选 — 显示名称
  systemPrompt: '你是...',       // 可选 — 系统提示词
  tags: ['topic-a'],             // 可选 — 标签
  metadata: {},                  // 可选 — 自定义元数据
  tools: [                       // 可选 — LLM 可用的工具
    {
      name: 'tool_name',
      description: '...',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
})

const mainSession = await createMainSession({
  storage: mainStorage,          // 必填 — MainStorage 实例
  llm: llmAdapter,
  label: 'Main Session',
  systemPrompt: '你是全局编排者...',
  tools: [...],
})
```

---

### LLM 适配器

```typescript
interface LLMAdapter {
  /** 单次完成 */
  complete(
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
    options?: LLMCompleteOptions,
  ): Promise<LLMResult>

  /** 流式完成（可选） */
  stream?(
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
    options?: LLMCompleteOptions,
  ): AsyncIterable<LLMChunk>
}

interface LLMCompleteOptions {
  maxTokens?: number
  temperature?: number
  tools?: Array<{
    name: string
    description: string
    inputSchema: Record<string, unknown>
  }>
}
```

**内置适配器——OpenAI 兼容协议**：

```typescript
import { createOpenAICompatibleAdapter } from '@stello-ai/session'

const llm = createOpenAICompatibleAdapter({
  apiKey: process.env.OPENAI_API_KEY!,
  baseURL: 'https://api.openai.com/v1',   // 或任何兼容端点
  model: 'gpt-4o',
})
```

环境变量配置（推荐用 `.env`）：

```env
OPENAI_API_KEY=sk-xxx
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o
```

---

### 存储适配器

Session 包的存储接口按消费者职责分层：

#### SessionStorage — 单个 Session 的存储

```typescript
interface SessionStorage {
  getSession(id: string): Promise<SessionMeta | null>
  putSession(session: SessionMeta): Promise<void>
  appendRecord(sessionId: string, record: Message): Promise<void>
  listRecords(sessionId: string, options?: ListRecordsOptions): Promise<Message[]>
  getSystemPrompt(sessionId: string): Promise<string | null>
  putSystemPrompt(sessionId: string, content: string): Promise<void>
  getInsight(sessionId: string): Promise<string | null>
  putInsight(sessionId: string, content: string): Promise<void>
  clearInsight(sessionId: string): Promise<void>
  getMemory(sessionId: string): Promise<string | null>
  putMemory(sessionId: string, content: string): Promise<void>
  transaction<T>(fn: (tx: SessionStorage) => Promise<T>): Promise<T>
}
```

#### MainStorage — 扩展存储（MainSession 使用）

```typescript
interface MainStorage extends SessionStorage {
  getAllSessionL2s(): Promise<Array<{ sessionId: string; label: string; l2: string }>>
  listSessions(filter?: SessionFilter): Promise<SessionMeta[]>
  putNode(node: TopologyNode): Promise<void>
  getChildren(parentId: string): Promise<TopologyNode[]>
  removeNode(nodeId: string): Promise<void>
  getGlobal(key: string): Promise<unknown>
  putGlobal(key: string, value: unknown): Promise<void>
}
```

**内置实现**：

```typescript
import { InMemoryStorageAdapter } from '@stello-ai/session'

// 内存存储——开发调试用
const storage = new InMemoryStorageAdapter()
```

---

## 配置依赖关系图

```
createStelloAgent(config)
│
├── sessions: SessionTree ◄─────────── SessionTreeImpl(NodeFileSystemAdapter)
│
├── memory: MemoryEngine ◄──────────── 自行实现（内存 / 文件 / PG）
│
├── capabilities
│   ├── lifecycle: EngineLifecycleAdapter ◄── 自行实现（调 memory + sessions）
│   ├── tools: EngineToolRuntime ◄─────────── 自行实现（定义 + 执行工具）
│   ├── skills: SkillRouter ◄──────────────── SkillRouterImpl()
│   └── confirm: ConfirmProtocol ◄─────────── 自行实现（通常自动确认）
│
├── session（推荐方式 A）
│   ├── sessionResolver ◄── (sessionId) => SessionCompatible
│   │                        └── createSession({ storage, llm, ... })
│   ├── mainSessionResolver ◄── () => MainSessionCompatible
│   │                            └── createMainSession({ storage, llm, ... })
│   ├── consolidateFn ◄──── createDefaultConsolidateFn(prompt, llmCall)
│   └── integrateFn ◄────── createDefaultIntegrateFn(prompt, llmCall)
│
├── runtime
│   └── recyclePolicy
│       └── idleTtlMs: number
│
└── orchestration
    ├── strategy ◄────── MainSessionFlatStrategy()
    ├── scheduler ◄───── new Scheduler({ consolidation, integration })
    ├── splitGuard ◄──── new SplitGuard(sessions, { minTurns, cooldownTurns })
    └── hooks ◄───────── { onRoundEnd, onError, ... }
```

---

## 完整示例：最小配置

适用于快速验证、单元测试。

```typescript
import {
  NodeFileSystemAdapter,
  SessionTreeImpl,
  SkillRouterImpl,
  createStelloAgent,
} from '@stello-ai/core'

const fs = new NodeFileSystemAdapter('./tmp/minimal')
const sessions = new SessionTreeImpl(fs)
const root = await sessions.createRoot('Main')

// Mock session（不接真实 LLM）
function createMockSession(id: string) {
  return {
    meta: { id, status: 'active' as const },
    async send(content: string) {
      return { content: `Echo: ${content}`, toolCalls: [] }
    },
    async messages() { return [] },
    async consolidate(fn: Function) {
      await fn(null, [])
    },
  }
}

const mockSessions = new Map()
mockSessions.set(root.id, createMockSession(root.id))

const agent = createStelloAgent({
  sessions,
  memory: createInMemoryMemoryEngine(),  // 见 demo/stello-agent-basic
  session: {
    sessionResolver: async (id) => mockSessions.get(id)!,
    consolidateFn: async (_mem, msgs) => `summary(${msgs.length})`,
  },
  capabilities: {
    lifecycle: {
      bootstrap: async (id) => ({
        context: { core: {}, memories: [], currentMemory: null, scope: null },
        session: (await sessions.get(id))!,
      }),
      afterTurn: async () => ({
        coreUpdated: false, memoryUpdated: false, recordAppended: true,
      }),
      prepareChildSpawn: async (opts) => sessions.createChild(opts),
    },
    tools: {
      getToolDefinitions: () => [],
      executeTool: async () => ({ success: false, error: 'No tools' }),
    },
    skills: new SkillRouterImpl(),
    confirm: {
      confirmSplit: async (p) => sessions.createChild({
        parentId: p.parentId, label: p.suggestedLabel,
      }),
      dismissSplit: async () => {},
      confirmUpdate: async () => {},
      dismissUpdate: async () => {},
    },
  },
  runtime: { recyclePolicy: { idleTtlMs: 0 } },
})

await agent.enterSession(root.id)
const result = await agent.turn(root.id, 'Hello')
console.log(result.turn.finalContent)  // "Echo: Hello"
```

---

## 完整示例：生产级配置

适用于接入真实 LLM、文件持久化、含调度策略的场景。

```typescript
import 'dotenv/config'
import {
  NodeFileSystemAdapter,
  SessionTreeImpl,
  SkillRouterImpl,
  createStelloAgent,
  Scheduler,
  createDefaultConsolidateFn,
  createDefaultIntegrateFn,
  DEFAULT_CONSOLIDATE_PROMPT,
  DEFAULT_INTEGRATE_PROMPT,
} from '@stello-ai/core'
import { createSession, createMainSession } from '@stello-ai/session'
import { createOpenAICompatibleAdapter } from '@stello-ai/session'
import { InMemoryStorageAdapter } from '@stello-ai/session'

// ─── 基础设施 ───
const fs = new NodeFileSystemAdapter('./data')
const sessions = new SessionTreeImpl(fs)
const memory = createFileMemoryEngine(fs, sessions)  // 见 demo 实现
const sessionStorage = new InMemoryStorageAdapter()

// ─── LLM ───
const llm = createOpenAICompatibleAdapter({
  apiKey: process.env.OPENAI_API_KEY!,
  baseURL: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
  model: process.env.OPENAI_MODEL ?? 'gpt-4o',
})

const llmCall = async (messages: Array<{ role: string; content: string }>) => {
  const result = await llm.complete(
    messages.map(m => ({ role: m.role as 'user' | 'assistant' | 'system', content: m.content }))
  )
  return result.content
}

// ─── Session 管理 ───
const sessionMap = new Map()
let root = await sessions.getRoot().catch(() => sessions.createRoot('Main Session'))

const mainSession = await createMainSession({
  storage: sessionStorage,
  llm,
  label: root.label,
  systemPrompt: '你是一个多功能 AI 助手。',
  tools: [
    {
      name: 'stello_create_session',
      description: '创建子 Session',
      inputSchema: {
        type: 'object',
        properties: { label: { type: 'string' }, scope: { type: 'string' } },
        required: ['label'],
      },
    },
  ],
})
sessionMap.set(root.id, mainSession)

// ─── 组装 config ───
const agent = createStelloAgent({
  sessions,
  memory,

  session: {
    sessionResolver: async (id) => wrapSession(id, sessionMap.get(id)!),
    mainSessionResolver: async () => mainSession,
    consolidateFn: createDefaultConsolidateFn(DEFAULT_CONSOLIDATE_PROMPT, llmCall),
    integrateFn: createDefaultIntegrateFn(DEFAULT_INTEGRATE_PROMPT, llmCall),
  },

  capabilities: {
    lifecycle,              // 见前文示例
    tools: {
      getToolDefinitions: () => [/* ... */],
      executeTool: async (name, args) => {/* ... */},
    },
    skills: new SkillRouterImpl(),
    confirm: {
      confirmSplit: async (p) => lifecycle.prepareChildSpawn({
        parentId: p.parentId,
        label: p.suggestedLabel,
        scope: p.suggestedScope,
      }),
      dismissSplit: async () => {},
      confirmUpdate: async () => {},
      dismissUpdate: async () => {},
    },
  },

  runtime: {
    recyclePolicy: { idleTtlMs: 30_000 },
  },

  orchestration: {
    scheduler: new Scheduler({
      consolidation: { trigger: 'everyNTurns', everyNTurns: 5 },
      integration: { trigger: 'afterConsolidate' },
    }),
    hooks: {
      onRoundEnd({ sessionId, input, turn }) {
        const user = { role: 'user', content: input, timestamp: new Date().toISOString() }
        const asst = { role: 'assistant', content: turn.finalContent ?? turn.rawResponse, timestamp: new Date().toISOString() }
        lifecycle.afterTurn(sessionId, user, asst).catch(() => {})
      },
    },
  },
})

// ─── 使用 ───
await agent.enterSession(root.id)
const result = await agent.turn(root.id, '帮我分析一下最近的项目进展')
console.log(result.turn.finalContent)

// 流式
const stream = await agent.stream(root.id, '继续')
for await (const chunk of stream) {
  process.stdout.write(chunk)
}

// Fork
const child = await agent.forkSession(root.id, { label: '技术调研', scope: 'tech' })
await agent.enterSession(child.id)
await agent.turn(child.id, '调研 WebSocket 方案')

// 离开
await agent.leaveSession(child.id)
await agent.leaveSession(root.id)
```
