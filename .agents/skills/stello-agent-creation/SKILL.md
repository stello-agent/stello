---
name: stello-agent-creation
description: StelloAgent 创建配置教程。完整说明 createStelloAgent 的每个配置项，包含 sessionDefaults、mainSessionConfig、tools、skills、forkProfiles、session 层接入等。
---

# StelloAgent 创建配置教程

## 最小可用示例

```typescript
import {
  createStelloAgent,
  ToolRegistryImpl,
  SkillRouterImpl,
  type EngineLifecycleAdapter,
  type ConfirmProtocol,
  type SessionTree,
  type MemoryEngine,
} from '@stello-ai/core'

const agent = createStelloAgent({
  sessions,        // SessionTree 实例
  memory,          // MemoryEngine 实例
  capabilities: {
    lifecycle,     // EngineLifecycleAdapter
    tools: new ToolRegistryImpl(),   // 空 registry = 无自定义 tool
    skills: new SkillRouterImpl(),   // 空 router = 无 skill（activate_skill 不注入）
    confirm: { ... },                // ConfirmProtocol
  },
  session: {
    sessionLoader: async (id) => ({ session: loadedSession, config: null }),
  },
})
```

---

## 配置结构总览

```typescript
interface StelloAgentConfig {
  sessions: SessionTree             // 拓扑树（必填）
  memory: MemoryEngine              // 记忆引擎（必填）
  sessionDefaults?: SessionConfig   // Regular session 的 agent 级默认配置
  mainSessionConfig?: MainSessionConfig  // Main session 的独立配置
  capabilities: {                   // 能力注入（必填）
    lifecycle: EngineLifecycleAdapter
    tools: EngineToolRuntime        // 用户自定义工具
    skills: SkillRouter             // Skill 注册表
    confirm: ConfirmProtocol
    profiles?: ForkProfileRegistry  // Fork 模板（可选）
  }
  session?: StelloAgentSessionConfig      // Session 层接入（可选）
  runtime?: StelloAgentRuntimeConfig      // Runtime 策略（可选）
  orchestration?: StelloAgentOrchestrationConfig  // 编排策略（可选）
}
```

---

## 1. `sessionDefaults` 与 `mainSessionConfig`

### `sessionDefaults` — Regular Session 的 Agent 级默认

`sessionDefaults` 是所有 regular session 的配置基线，是 fork 合成链的最低优先级层。

```typescript
createStelloAgent({
  sessionDefaults: {
    llm: defaultLlm,               // 所有子 session 使用的默认 LLM
    consolidateFn: defaultConsolidateFn,  // 默认 L3→L2 提炼函数
    compressFn: defaultCompressFn, // 默认上下文压缩函数
    systemPrompt: '你是一个助手。', // 所有子 session 的基础 prompt（可被 fork 覆盖）
    skills: undefined,             // undefined = 继承全局 SkillRouter（默认）
  },
  // ...
})
```

**`SessionConfig` 完整字段**：

```typescript
interface SessionConfig {
  systemPrompt?: string
  llm?: LLMAdapter
  tools?: LLMCompleteOptions['tools']
  skills?: string[]          // undefined=继承全局；[]=禁用所有 skill；['a','b']=白名单
  consolidateFn?: SessionCompatibleConsolidateFn
  compressFn?: SessionCompatibleCompressFn
}
```

### `mainSessionConfig` — Main Session 的独立配置

`mainSessionConfig` 是 main session 的专属配置，不参与 regular session 的 fork 合成链。

```typescript
createStelloAgent({
  mainSessionConfig: {
    systemPrompt: '你是全局协调者，负责统筹所有子任务。',
    llm: mainLlm,              // main session 可用更强的模型
    integrateFn: myIntegrateFn,  // all L2s → synthesis + insights
    compressFn: mainCompressFn,
  },
  // ...
})
```

**`MainSessionConfig` 字段**（与 `SessionConfig` 平行，但用 `integrateFn` 替代 `consolidateFn`）：

```typescript
interface MainSessionConfig {
  systemPrompt?: string
  llm?: LLMAdapter
  tools?: LLMCompleteOptions['tools']
  skills?: string[]
  integrateFn?: SessionCompatibleIntegrateFn  // main session 专属
  compressFn?: SessionCompatibleCompressFn
}
```

**与 `sessionDefaults` 的区别**：

| | `sessionDefaults` | `mainSessionConfig` |
|--|------------------|---------------------|
| 作用对象 | 所有 regular session | 仅 main session |
| 提炼函数 | `consolidateFn` | `integrateFn` |
| 参与 fork 合成链 | 是（最低优先级） | 否 |
| 固化时机 | 每次 fork | `createMainSession()` 调用时 |

---

## 2. `capabilities` — 能力注入

### 2.1 `tools` — 用户自定义工具

```typescript
import { ToolRegistryImpl } from '@stello-ai/core'

const toolRegistry = new ToolRegistryImpl()

toolRegistry.register({
  name: 'save_note',
  description: '保存笔记到当前会话',
  parameters: {
    type: 'object',
    properties: {
      note: { type: 'string', description: '笔记内容' },
    },
    required: ['note'],
  },
  execute: async (args) => {
    await db.saveNote(String(args.note))
    return { success: true, data: { saved: true } }
  },
})
```

**要点**：
- `parameters` 是 JSON Schema 格式，LLM 据此生成参数
- `execute` 返回 `{ success: true, data: ... }` 或 `{ success: false, error: '...' }`
- tool 执行失败时 Engine 自动将 error 作为 tool result 返回给 LLM，不中断对话
- **不需要注册 `stello_create_session` 和 `activate_skill`**——框架自动注入

### 2.2 `skills` — Skill 注册表

Skill 是两级渐进式加载的 prompt 片段：LLM 始终看到 name + description，主动调用 `activate_skill` 后注入完整 content。

```typescript
import { SkillRouterImpl, loadSkillsFromDirectory } from '@stello-ai/core'

const skillRouter = new SkillRouterImpl()

// 方式一：代码注册
skillRouter.register({
  name: 'code-review',
  description: '代码审查专家，激活后按标准流程审查代码质量',
  content: `你现在是代码审查专家。...`,
})

// 方式二：从目录批量加载（标准 agent skills 格式）
const fileSkills = await loadSkillsFromDirectory('./skills')
for (const skill of fileSkills) {
  skillRouter.register(skill)
}
```

**行为**：
- 有 skills 注册时，Engine 自动注入 `activate_skill` 内置 tool
- 无 skills 时，`activate_skill` 不出现在 LLM 的可用工具列表中

**per-session skill 白名单**通过 `SessionConfig.skills` 控制（见 fork 配置合成链一节）：
- `undefined`（默认）：该 session 继承全局 SkillRouter 的全部 skill
- `[]`：禁用该 session 的 `activate_skill`，LLM 看不到任何 skill
- `['search', 'summarize']`：只允许这两个 skill 对该 session 可见

### 2.3 `profiles` — Fork Profile 注册表（可选）

ForkProfile 是预定义的 fork 配置模板，extends `SessionConfig`。LLM 调用 `stello_create_session` 时可通过 `profile` 参数引用。

```typescript
import { ForkProfileRegistryImpl } from '@stello-ai/core'

const forkProfiles = new ForkProfileRegistryImpl()

// 基础 profile：固定角色
forkProfiles.register('poet', {
  systemPrompt: '你是一位诗人。所有回复必须用诗歌形式。',
  systemPromptMode: 'preset',      // 忽略 fork options 的 systemPrompt
})

// 动态 systemPrompt 模板
forkProfiles.register('region-expert', {
  systemPromptFn: (vars) => `你是${vars.region}地区的留学专家。`, // 优先于 systemPrompt
  systemPromptMode: 'preset',
  llm: cheaperLlmAdapter,
  skills: ['search', 'summarize'], // 白名单：只允许这两个 skill
  consolidateFn: researchConsolidateFn,
})

// prepend 合成 + 继承上下文
forkProfiles.register('researcher', {
  systemPrompt: '你是研究助手，善于深入分析。',
  systemPromptMode: 'prepend',     // profile prompt 在前，fork options 的 prompt 在后
  context: 'inherit',              // 继承父会话的对话历史
})
```

**`ForkProfile` 完整字段**（extends `SessionConfig`）：

```typescript
interface ForkProfile extends SessionConfig {
  // SessionConfig 字段（systemPrompt / llm / tools / skills / consolidateFn / compressFn）

  systemPromptFn?: (vars: Record<string, string>) => string  // 动态模板，优先于 systemPrompt
  systemPromptMode?: 'preset' | 'prepend' | 'append'        // 默认 'prepend'
  context?: 'none' | 'inherit' | ForkContextFn              // 上下文继承策略
  prompt?: string                                            // fork 后的开场消息（默认值）
}
```

**`systemPromptMode` 三种模式**：
- `'preset'`：只用 profile 的 systemPrompt，完全忽略 fork options 的 systemPrompt
- `'prepend'`（默认）：`[profile prompt]\n[fork options prompt]`
- `'append'`：`[fork options prompt]\n[profile prompt]`

**行为**：
- 有 profiles 注册时，`stello_create_session` 自动增加 `profile` 枚举参数和 `vars` 对象参数
- 无 profiles 时，`stello_create_session` 只有 `label / systemPrompt / prompt / context` 参数

### 2.4 `lifecycle` — 生命周期适配器

```typescript
const lifecycle: EngineLifecycleAdapter = {
  bootstrap: async (sessionId) => ({
    context: await memory.assembleContext(sessionId),
    session: await sessions.get(sessionId),
  }),

  afterTurn: async (sessionId, userMsg, assistantMsg) => {
    await memory.appendRecord(sessionId, userMsg)
    await memory.appendRecord(sessionId, assistantMsg)
    return { coreUpdated: false, memoryUpdated: false, recordAppended: true }
  },
}
```

### 2.5 `confirm` — 确认协议

```typescript
const confirm: ConfirmProtocol = {
  async confirmSplit(proposal) {
    // LLM 建议拆分时，创建子 session
    // proposal 含 parentId、suggestedLabel
    return agent.forkSession(proposal.parentId, {
      label: proposal.suggestedLabel,
      // 如需基于 LLM 建议的 prompt 约束子 session 行为，用 systemPrompt
    })
  },
  async dismissSplit() {},
  async confirmUpdate() {},
  async dismissUpdate() {},
}
```

---

## 3. `session` — Session 层接入

`StelloAgentSessionConfig` 的职责是**纯 I/O 数据加载**，不在 resolver 闭包里构造 session 行为配置（`consolidateFn` 等移到 `sessionDefaults`）。

```typescript
session: {
  // 按 ID 加载 Session 实例与其固化配置（必填）
  sessionLoader: async (sessionId) => {
    const session = await loadSession(sessionId, {
      storage: sessionStorage,
      llm: currentLlm,
    })
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    return {
      session,      // SessionCompatible 实例
      config: null, // SerializableSessionConfig | null（目前传 null 即可）
    }
  },

  // 加载 MainSession（可选，需要 integration 时提供）
  mainSessionLoader: async () => {
    if (!mainSession) return null
    return {
      session: mainSession,  // MainSessionCompatible 实例
      config: null,
    }
  },

  // 可选：自定义 send() 结果序列化（默认 JSON）
  serializeSendResult: (result) => JSON.stringify(result),

  // 可选：自定义 tool call 解析器（默认 sessionSendResultParser）
  toolCallParser: customParser,
}
```

**两种 session 接入方式**：

| 方式 | 配置 | 适用场景 |
|------|------|---------|
| Session 适配 | `session.sessionLoader` | 使用 `@stello-ai/session` 包（推荐） |
| 直接提供 runtime | `runtime.resolver` | 自定义 session 实现 |

---

## 4. `orchestration` — 编排策略（可选）

### `consolidateEveryNTurns` — 自动 consolidation

```typescript
orchestration: {
  consolidateEveryNTurns: 5,  // 每 5 轮自动 consolidate（fire-and-forget）
}
```

### `splitGuard` — 拆分保护

```typescript
import { SplitGuard } from '@stello-ai/core'

orchestration: {
  splitGuard: new SplitGuard(sessions, {
    minTurns: 3,       // 至少对话 3 轮才允许 fork
    cooldownTurns: 5,  // 上次 fork 后至少再对话 5 轮
  }),
}
```

### `hooks` — Engine 事件钩子

```typescript
orchestration: {
  hooks: {
    onRoundStart({ sessionId, input }) {},
    onRoundEnd({ sessionId, turn }) {},
    onSessionFork({ parentId, child }) {
      console.log(`Fork: ${parentId} → ${child.id}`)
    },
    onToolCall({ sessionId, toolCall }) {},
    onError({ source, error }) {},
  },
  // 也支持按 sessionId 动态生成
  // hooks: (sessionId) => ({ onRoundEnd({ turn }) { ... } }),
}
```

所有 hooks **fire-and-forget**：抛错时 emit error 事件，不中断对话。

---

## 5. 内置 Tool 的自动注册

用户**不需要**手动注册：

| 内置 Tool | 注入条件 |
|-----------|---------|
| `stello_create_session` | 始终注入 |
| `activate_skill` | `skills.getAll().length > 0` 时注入 |

---

## 6. 完整配置示例

```typescript
import {
  createStelloAgent,
  ToolRegistryImpl,
  SkillRouterImpl,
  ForkProfileRegistryImpl,
  SplitGuard,
  SessionTreeImpl,
  NodeFileSystemAdapter,
  createDefaultConsolidateFn,
  createDefaultIntegrateFn,
  loadSession,
  loadMainSession,
  type StelloAgentConfig,
} from '@stello-ai/core'
import { InMemoryStorageAdapter } from '@stello-ai/session'

// ─── 基础设施 ───
const fs = new NodeFileSystemAdapter('./data')
const sessions = new SessionTreeImpl(fs)
const memory = new FileSystemMemoryEngine(fs, sessions)
const sessionStorage = new InMemoryStorageAdapter()

const llm = createOpenAICompatibleAdapter({ apiKey: process.env.OPENAI_API_KEY!, model: 'gpt-4o' })
const llmCall: LLMCallFn = async (messages) => (await llm.complete(messages)).content ?? ''

// ─── 自定义 Tools ───
const toolRegistry = new ToolRegistryImpl()
toolRegistry.register({
  name: 'search_knowledge',
  description: '搜索知识库',
  parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  execute: async (args) => ({ success: true, data: await knowledgeBase.search(String(args.query)) }),
})

// ─── Skills ───
const skills = new SkillRouterImpl()
skills.register({
  name: 'data-analysis',
  description: '数据分析模式：激活后按结构化流程分析数据',
  content: '你是数据分析专家...',
})

// ─── Fork Profiles ───
const profiles = new ForkProfileRegistryImpl()
profiles.register('researcher', {
  systemPrompt: '你是研究助手，善于深入分析。',
  systemPromptMode: 'prepend',
  context: 'inherit',
  skills: ['search', 'data-analysis'],
  consolidateFn: createDefaultConsolidateFn('请提炼研究要点', llmCall),
})

// ─── 创建 Agent ───
let agent: ReturnType<typeof createStelloAgent>
agent = createStelloAgent({
  sessions,
  memory,

  // Regular session 的 agent 级默认配置
  sessionDefaults: {
    llm,
    consolidateFn: createDefaultConsolidateFn('请提炼对话要点', llmCall),
    compressFn: createDefaultCompressFn(llmCall),
  },

  // Main session 的独立配置
  mainSessionConfig: {
    systemPrompt: '你是全局协调者，负责统筹所有子任务。',
    llm,
    integrateFn: createDefaultIntegrateFn('请综合所有子任务的要点', llmCall),
  },

  session: {
    sessionLoader: async (sessionId) => {
      const session = await loadSession(sessionId, { storage: sessionStorage, llm })
      if (!session) throw new Error(`Session not found: ${sessionId}`)
      return { session, config: null }
    },
    mainSessionLoader: async () => {
      const mainSession = await loadMainSession({ storage: sessionStorage, llm })
      if (!mainSession) return null
      return { session: mainSession, config: null }
    },
  },

  capabilities: {
    lifecycle: {
      bootstrap: async (sessionId) => ({
        context: await memory.assembleContext(sessionId),
        session: await sessions.get(sessionId),
      }),
      afterTurn: async (sessionId, userMsg, assistantMsg) => {
        await memory.appendRecord(sessionId, userMsg)
        await memory.appendRecord(sessionId, assistantMsg)
        return { coreUpdated: false, memoryUpdated: false, recordAppended: true }
      },
    },
    tools: toolRegistry,
    skills,
    profiles,
    confirm: {
      confirmSplit: async (p) => agent.forkSession(p.parentId, { label: p.suggestedLabel }),
      dismissSplit: async () => {},
      confirmUpdate: async () => {},
      dismissUpdate: async () => {},
    },
  },

  orchestration: {
    consolidateEveryNTurns: 5,
    splitGuard: new SplitGuard(sessions, { minTurns: 3, cooldownTurns: 5 }),
    hooks: {
      onSessionFork({ parentId, child }) {
        console.log(`Fork: ${parentId} → ${child.id} (${child.label})`)
      },
    },
  },
})

// ─── 创建 Main Session（推荐入口）───
const mainNode = await agent.createMainSession({ label: 'Main' })

// ─── 开始对话 ───
await agent.enterSession(mainNode.id)
const result = await agent.turn(mainNode.id, '帮我分析一下市场趋势')
console.log(result.turn.finalContent)
```

---

## 7. 运行时使用

Agent 创建后的运行时操作（turn / stream / fork / attach / detach 等）见 skill `stello-agent-usage`。
