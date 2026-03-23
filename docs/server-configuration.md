# Server 配置参考

`@stello-ai/server` 的所有可配置项，按层级展开。

---

## 顶层：`createStelloServer(options)`

```typescript
interface StelloServerOptions {
  pool: pg.Pool                        // PostgreSQL 连接池（必填）
  agentPoolOptions: AgentPoolOptions   // Agent 缓存池配置（必填）
  skipMigrate?: boolean                // 跳过自动数据库迁移（默认 false）
}
```

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `pool` | `pg.Pool` | 是 | — | PostgreSQL 连接池，可用 `createPool()` 创建或自行构建 |
| `agentPoolOptions` | `AgentPoolOptions` | 是 | — | 控制 Agent 如何创建和缓存 |
| `skipMigrate` | `boolean` | 否 | `false` | 设为 `true` 跳过启动时自动执行 SQL 迁移 |

---

## `listen(port?)`

```typescript
server.listen(port?: number): Promise<{ port: number; close: () => Promise<void> }>
```

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `port` | `number` | `0` | 监听端口，`0` 表示随机分配 |

---

## 数据库连接池：`createPool(options)`

便捷工厂，也可以直接用 `new pg.Pool()`。

```typescript
interface PoolOptions {
  connectionString: string   // PostgreSQL 连接字符串（必填）
  max?: number               // 最大连接数（默认 20）
  idleTimeoutMillis?: number // 空闲连接超时毫秒（默认 30000）
}
```

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `connectionString` | `string` | — | `postgresql://user:pass@host:port/db` |
| `max` | `number` | `20` | 连接池最大连接数 |
| `idleTimeoutMillis` | `number` | `30000` | 空闲连接多久后断开 |

---

## Agent 缓存池：`AgentPoolOptions`

控制 per-space StelloAgent 的创建方式和生命周期。

```typescript
interface AgentPoolOptions {
  buildConfig: (ctx: AgentBuildContext) => Omit<StelloAgentConfig, 'sessions' | 'memory'>
  idleTtlMs?: number
}
```

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `buildConfig` | `(ctx) => ...` | 是 | — | 为每个 space 构建 Agent 配置（`sessions` 和 `memory` 由 pool 自动注入） |
| `idleTtlMs` | `number` | 否 | `300000`（5 分钟） | 空闲 Agent 驱逐时间（毫秒） |

### `AgentBuildContext` — buildConfig 回调参数

```typescript
interface AgentBuildContext {
  spaceId: string                      // 当前 space ID
  pool: pg.Pool                        // 数据库连接池
  sessionStorage: PgSessionStorage     // 单 Session 存储适配器
  mainStorage: PgMainStorage           // Main Session 存储适配器
  sessionTree: PgSessionTree           // Session 树（拓扑管理）
  memoryEngine: PgMemoryEngine         // 记忆引擎（core/memory/scope/index/records）
}
```

所有 PG 适配器已按 `spaceId` 隔离，可直接在 `buildConfig` 中引用。

---

## `buildConfig` 返回值：StelloAgentConfig（去掉 sessions / memory）

`buildConfig` 返回的配置等价于 `StelloAgentConfig` 去掉 `sessions` 和 `memory`（这两个由 AgentPool 自动提供）。

完整结构：

```typescript
{
  capabilities: StelloAgentCapabilitiesConfig  // 必填
  session?: StelloAgentSessionConfig           // 可选
  runtime?: StelloAgentRuntimeConfig           // 可选
  orchestration?: StelloAgentOrchestrationConfig // 可选
}
```

---

### `capabilities`（必填）

Agent 的四大能力适配器。

```typescript
interface StelloAgentCapabilitiesConfig {
  lifecycle: EngineLifecycleAdapter   // 生命周期钩子（必填）
  tools: EngineToolRuntime            // 工具运行时（必填）
  skills: SkillRouter                 // Skill 路由（必填）
  confirm: ConfirmProtocol            // 确认协议（必填）
}
```

#### `capabilities.lifecycle` — 生命周期适配器

```typescript
interface EngineLifecycleAdapter {
  /** 进入 session 时的初始化，返回上下文和 session 元数据 */
  bootstrap(sessionId: string): Promise<BootstrapResult>
  /** turn 结束后的副作用（写记录、更新 core 等） */
  afterTurn(sessionId: string, userMsg: TurnRecord, assistantMsg: TurnRecord): Promise<AfterTurnResult>
  /** fork 时准备子 session 的元数据 */
  prepareChildSpawn(options: CreateSessionOptions): Promise<SessionMeta>
}
```

#### `capabilities.tools` — 工具运行时

```typescript
interface EngineToolRuntime {
  /** 返回所有可用工具定义 */
  getToolDefinitions(): ToolDefinition[]
  /** 执行指定工具 */
  executeTool(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult>
}

interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>  // JSON Schema
}

interface ToolExecutionResult {
  success: boolean
  result?: unknown
  error?: string
}
```

#### `capabilities.skills` — Skill 路由

```typescript
interface SkillRouter {
  register(skill: Skill): void
  match(message: TurnRecord): Skill | null
  getAll(): Skill[]
}
```

#### `capabilities.confirm` — 确认协议

处理 session 拆分和更新的确认/拒绝。

```typescript
interface ConfirmProtocol {
  confirmSplit(proposal: SplitProposal): Promise<SessionMeta>
  dismissSplit(proposal: SplitProposal): Promise<void>
  confirmUpdate(proposal: UpdateProposal): Promise<void>
  dismissUpdate(proposal: UpdateProposal): Promise<void>
}
```

---

### `session`（可选）

Session 解析和数据处理的配置。

```typescript
interface StelloAgentSessionConfig {
  /** 从 sessionId 解析 Session 实例 */
  sessionResolver?: (sessionId: string) => Promise<SessionCompatible>
  /** 解析 MainSession 实例 */
  mainSessionResolver?: () => Promise<MainSessionCompatible | null>
  /** L3→L2 提炼函数 */
  consolidateFn?: SessionCompatibleConsolidateFn
  /** 全局整合函数（all L2s → synthesis + insights） */
  integrateFn?: SessionCompatibleIntegrateFn
  /** 自定义 send() 结果序列化 */
  serializeSendResult?: (result: SessionCompatibleSendResult) => string
  /** 自定义 tool call 解析器 */
  toolCallParser?: ToolCallParser
  /** 自由键值，传递给 Session 实现 */
  options?: Record<string, unknown>
}
```

| 字段 | 说明 |
|------|------|
| `sessionResolver` | 核心：把 sessionId 映射到可发送消息的 Session 实例 |
| `mainSessionResolver` | 解析 Main Session，用于 integration |
| `consolidateFn` | L3→L2 提炼逻辑，应用层自定义 L2 格式，fn 自行选择 LLM tier |
| `integrateFn` | 与 consolidateFn 配对，读取 L2 生成 synthesis + insights |
| `serializeSendResult` | 自定义 `send()` 返回值的序列化方式 |
| `toolCallParser` | 自定义 tool call 响应解析（默认内置解析器） |
| `options` | 自由键值，传递额外配置给 Session 实现 |

---

### `runtime`（可选）

Engine runtime 的创建和回收策略。

```typescript
interface StelloAgentRuntimeConfig {
  /** Session runtime 解析器 */
  resolver: SessionRuntimeResolver
  /** 回收策略 */
  recyclePolicy?: RuntimeRecyclePolicy
}
```

#### `runtime.resolver` — Session Runtime 解析器

```typescript
interface SessionRuntimeResolver {
  /** 从 sessionId 解析 engine 可消费的 runtime session */
  resolve(sessionId: string): Promise<EngineRuntimeSession>
}
```

#### `runtime.recyclePolicy` — 回收策略

```typescript
interface RuntimeRecyclePolicy {
  /** 空闲回收延迟（毫秒）。0 或不传 = 引用归零立即回收；> 0 = 延迟回收（适合 WS 场景） */
  idleTtlMs?: number
}
```

| 值 | 行为 |
|----|------|
| `0` / 不传 | 所有持有者释放后立即回收 engine |
| `> 0`（如 `30000`） | 释放后等待指定时间，期间若再次 acquire 则取消回收 |

---

### `orchestration`（可选）

编排层高级配置。全部可选，不传则使用默认行为。

```typescript
interface StelloAgentOrchestrationConfig {
  strategy?: OrchestrationStrategy     // fork 父节点解析策略
  splitGuard?: SplitGuard              // 拆分守卫
  mainSession?: SchedulerMainSession | null  // 调度器的 MainSession
  turnRunner?: TurnRunner              // 自定义 turn 执行器
  scheduler?: Scheduler                // 调度器
  hooks?: EngineHookProvider           // Engine 钩子
}
```

#### `orchestration.strategy` — Fork 策略

```typescript
interface OrchestrationStrategy {
  /** 给定源 session，决定 fork 的父节点 ID */
  resolveForkParent(source: SessionMeta, sessions: SessionTree): Promise<string>
}
```

不传时使用默认的 `MainSessionFlatStrategy`（所有 fork 都挂在 main session 下）。

#### `orchestration.splitGuard` — 拆分守卫

基于轮次数、冷却期、漂移阈值判断是否允许拆分。

构造参数：`SplitStrategy`

```typescript
interface SplitStrategy {
  minTurns?: number        // 最少轮次才允许拆分（默认 3）
  cooldownTurns?: number   // 拆分后冷却期轮次（默认 5）
  driftThreshold?: number  // 漂移阈值 0-1（默认 0.7），仅 embedder 启用时有效
}
```

#### `orchestration.scheduler` — 调度器

控制 consolidation 和 integration 的触发时机。

```typescript
const scheduler = new Scheduler(config: SchedulerConfig)

interface SchedulerConfig {
  consolidation?: ConsolidationPolicy
  integration?: IntegrationPolicy
}
```

##### Consolidation 策略

```typescript
interface ConsolidationPolicy {
  trigger: ConsolidationTrigger
  everyNTurns?: number          // trigger='everyNTurns' 时，每 N 轮触发
}

type ConsolidationTrigger =
  | 'manual'       // 不自动触发
  | 'everyNTurns'  // 每 N 轮
  | 'onSwitch'     // 切换 session 时
  | 'onArchive'    // 归档 session 时
  | 'onLeave'      // 离开 session 时
```

##### Integration 策略

```typescript
interface IntegrationPolicy {
  trigger: IntegrationTrigger
  everyNTurns?: number          // trigger='everyNTurns' 时，每 N 轮触发
}

type IntegrationTrigger =
  | 'manual'            // 不自动触发
  | 'afterConsolidate'  // consolidation 完成后自动触发
  | 'everyNTurns'       // 每 N 轮
  | 'onSwitch'          // 切换 session 时
  | 'onArchive'         // 归档 session 时
  | 'onLeave'           // 离开 session 时
```

#### `orchestration.hooks` — Engine 钩子

监听 engine 生命周期事件。可以是静态对象或按 sessionId 动态生成。

```typescript
type EngineHookProvider =
  | Partial<EngineHooks>
  | ((sessionId: string) => Partial<EngineHooks>)

interface EngineHooks {
  onMessageReceived(ctx: { sessionId: string; input: string }): Promise<void> | void
  onAssistantReply(ctx: { sessionId: string; input: string; content: string | null; rawResponse: string }): Promise<void> | void
  onToolCall(ctx: { sessionId: string; toolCall: ToolCall }): Promise<void> | void
  onToolResult(ctx: { sessionId: string; result: ToolCallResult }): Promise<void> | void
  onSessionEnter(ctx: { sessionId: string }): Promise<void> | void
  onSessionLeave(ctx: { sessionId: string }): Promise<void> | void
  onRoundStart(ctx: { sessionId: string; input: string }): Promise<void> | void
  onRoundEnd(ctx: { sessionId: string; input: string; turn: TurnRunnerResult }): Promise<void> | void
  onSessionArchive(ctx: { sessionId: string }): Promise<void> | void
  onSessionFork(ctx: { parentId: string; child: SessionMeta }): Promise<void> | void
  onError(ctx: { source: string; error: Error }): Promise<void> | void
}
```

所有 hook 都是可选的，只实现需要的即可。

---

## 完整示例

### 最小配置

```typescript
import pg from 'pg'
import { createStelloServer } from '@stello-ai/server'

const pool = new pg.Pool({ connectionString: 'postgresql://...' })

const server = await createStelloServer({
  pool,
  agentPoolOptions: {
    buildConfig: (ctx) => ({
      capabilities: {
        lifecycle: myLifecycleAdapter,
        tools: myToolRuntime,
        skills: mySkillRouter,
        confirm: myConfirmProtocol,
      },
    }),
  },
})

await server.listen(3000)
```

### 完整配置

```typescript
import pg from 'pg'
import { createStelloServer, createPool } from '@stello-ai/server'
import { Scheduler } from '@stello-ai/core'

const pool = createPool({
  connectionString: 'postgresql://stello:stello@localhost:5432/stello',
  max: 30,
  idleTimeoutMillis: 60_000,
})

const server = await createStelloServer({
  pool,
  skipMigrate: false,
  agentPoolOptions: {
    idleTtlMs: 10 * 60 * 1000,  // 10 分钟空闲驱逐
    buildConfig: (ctx) => ({
      capabilities: {
        lifecycle: myLifecycleAdapter,
        tools: myToolRuntime,
        skills: mySkillRouter,
        confirm: myConfirmProtocol,
      },
      session: {
        sessionResolver: async (sessionId) => resolveSession(sessionId),
        mainSessionResolver: async () => resolveMainSession(),
        consolidateFn: async (currentMemory, messages) => summarize(messages),
        integrateFn: async (allL2s) => synthesize(allL2s),
        toolCallParser: myCustomParser,
      },
      runtime: {
        resolver: myRuntimeResolver,
        recyclePolicy: { idleTtlMs: 30_000 },
      },
      orchestration: {
        scheduler: new Scheduler({
          consolidation: { trigger: 'everyNTurns', everyNTurns: 5 },
          integration: { trigger: 'afterConsolidate' },
        }),
        hooks: {
          onSessionEnter: ({ sessionId }) => console.log(`enter ${sessionId}`),
          onError: ({ source, error }) => console.error(`[${source}]`, error),
        },
      },
    }),
  },
})

const { port, close } = await server.listen(3000)
```

---

## 配置层级总览

```
createStelloServer(options)
├── pool                              pg.Pool
├── skipMigrate?                      boolean
└── agentPoolOptions
    ├── idleTtlMs?                    number (ms)
    └── buildConfig(ctx) → {
        ├── capabilities              ← 必填
        │   ├── lifecycle             EngineLifecycleAdapter
        │   ├── tools                 EngineToolRuntime
        │   ├── skills                SkillRouter
        │   └── confirm               ConfirmProtocol
        ├── session?                  ← 可选
        │   ├── sessionResolver?      (id) → SessionCompatible
        │   ├── mainSessionResolver?  () → MainSessionCompatible | null
        │   ├── consolidateFn?        L3→L2 提炼
        │   ├── integrateFn?          all L2s → synthesis
        │   ├── serializeSendResult?  自定义序列化
        │   ├── toolCallParser?       自定义解析
        │   └── options?              Record<string, unknown>
        ├── runtime?                  ← 可选
        │   ├── resolver              SessionRuntimeResolver
        │   └── recyclePolicy?
        │       └── idleTtlMs?        number (ms)
        └── orchestration?            ← 可选
            ├── strategy?             OrchestrationStrategy
            ├── splitGuard?           SplitGuard
            │   ├── minTurns?         number (默认 3)
            │   ├── cooldownTurns?    number (默认 5)
            │   └── driftThreshold?   number (默认 0.7)
            ├── mainSession?          SchedulerMainSession | null
            ├── turnRunner?           TurnRunner
            ├── scheduler?            Scheduler
            │   ├── consolidation?
            │   │   ├── trigger       manual | everyNTurns | onSwitch | onArchive | onLeave
            │   │   └── everyNTurns?  number
            │   └── integration?
            │       ├── trigger       manual | afterConsolidate | everyNTurns | onSwitch | onArchive | onLeave
            │       └── everyNTurns?  number
            └── hooks?                Partial<EngineHooks> | (sessionId) => Partial<EngineHooks>
    }
```
