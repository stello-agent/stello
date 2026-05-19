---
name: stello-agent-creation
description: StelloAgent 创建配置教程。完整说明 createStelloAgent 的每个配置项，包含 sessionDefaults、storage、tools、skills、forkProfiles、session 层接入、orchestration 等。
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
} from '@stello-ai/core'
import type { SessionStorage } from '@stello-ai/session'

const agent = createStelloAgent({
  sessions,                       // SessionTree 实例（拓扑）
  storage: sessionStorage,        // SessionStorage 实例（内容；orchestrator-facing SDK 依赖）
  capabilities: {
    lifecycle,                    // EngineLifecycleAdapter
    tools: new ToolRegistryImpl(),
    skills: new SkillRouterImpl(),
    confirm: { ... },
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
  sessions: SessionTree                          // 拓扑树（必填）
  storage?: SessionStorage                       // 内容存储（orchestrator-facing 数据 SDK 依赖）
  sharedMemory?: SharedMemoryStore               // Agent 级共享 memory；注入后索引每 send 前由 adapter 自动注入
  sessionDefaults?: SessionConfig                // 所有 session 的 agent 级默认（fork 合成链最低优先级）
  capabilities: {                                // 能力注入（必填）
    lifecycle: EngineLifecycleAdapter
    tools: EngineToolRuntime                     // 用户自定义工具
    skills: SkillRouter                          // Skill 注册表
    confirm: ConfirmProtocol
    profiles?: ForkProfileRegistry               // Fork 模板（可选）
  }
  session?: StelloAgentSessionConfig             // Session 层接入（可选）
  runtime?: StelloAgentRuntimeConfig             // Runtime 策略（可选）
  orchestration?: StelloAgentOrchestrationConfig // 编排策略（可选）
}
```

> 所有 Session 共用 `sessionDefaults`。Root 没有专属配置，与子 session 走同一套 fork 合成链（详见 fork-design）。
> "全 memory → 反思 → 定向 insight" 的循环由应用层基于 orchestrator-facing SDK 自行实现（不在配置注入点里）。

---

## 1. `storage` —— Orchestrator-facing 数据 SDK

`storage: SessionStorage` 注入后，StelloAgent 暴露以下 data-IO 方法（详见 stello-agent-usage）：

- `listSessionDigests(filter?)` —— 批量收集所有 Session 的 `{ id, label, status, memory, insight }`
- `getSessionMetadata(id)` —— 单个 Session 的 `{ memory, insight }`
- `listMessages(id, options?)` —— 读取指定 Session 的 L3 消息
- `putMemory(id, content)` / `putInsight(id, content)` / `clearInsight(id)`

**重要**：应用层需保证 `sessions`（拓扑）与 `storage`（内容）指向**同一份后端**——`SessionTree.listAll()` 返回的 id 必须能在 `SessionStorage` 上 `getMemory`。

未注入 `storage` 时，上述方法会抛错；其余编排能力（turn / stream / fork / archive）不受影响。

---

## 2. `sessionDefaults` —— Agent 级默认配置

所有 Session 的配置基线，fork 合成链的最低优先级层。

```typescript
createStelloAgent({
  sessionDefaults: {
    llm: defaultLlm,                       // 默认 LLM
    consolidateFn: defaultConsolidateFn,   // 默认 L3→memory 提炼函数
    compressFn: defaultCompressFn,         // 默认上下文压缩函数
    systemPrompt: '你是一个助手。',        // 默认 system prompt（可被 fork 覆盖）
    skills: undefined,                     // undefined = 继承全局 SkillRouter（默认）
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

> Root session 的固化配置由你创建 root 时通过 `agent.createSession({ label })` + 后续 `sessions.putConfig(rootId, ...)` 设置——或在 `sessionDefaults` 给出全局默认即可。Root 没有特殊待遇。

---

## 3. `capabilities` — 能力注入

### 3.1 `tools` — 用户自定义工具

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
  execute: async (args, _ctx) => {
    await db.saveNote(String(args.note))
    return { success: true, data: { saved: true } }
  },
})
```

**要点**：
- `parameters` 是 JSON Schema 格式，LLM 据此生成参数
- `execute(args, ctx)` 返回 `{ success: true, data: ... }` 或 `{ success: false, error: '...' }`
- tool 执行失败时 Engine 自动将 error 作为 tool result 返回给 LLM，不中断对话
- 内置 tool（`stello_create_session` / `activate_skill`）需要在 `ToolRegistryImpl([...])` 构造时显式 opt-in（参考 `createSessionTool()` / `activateSkillTool(skills)` factory）

### 3.2 `skills` — Skill 注册表

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

`activate_skill` 是否对 LLM 可见取决于 `skills.getAll().length > 0`，以及该 session 的 `SessionConfig.skills` 白名单（详见 fork-design 的 skills 三态语义）。

### 3.3 `profiles` — Fork Profile 注册表（可选）

ForkProfile 是预定义的 fork 配置模板，extends `SessionConfig`。LLM 调用 `stello_create_session` 时可通过 `profile` 参数引用。

```typescript
import { ForkProfileRegistryImpl } from '@stello-ai/core'

const forkProfiles = new ForkProfileRegistryImpl()

forkProfiles.register('poet', {
  systemPrompt: '你是一位诗人。所有回复必须用诗歌形式。',
  systemPromptMode: 'preset',
})

forkProfiles.register('region-expert', {
  systemPromptFn: (vars) => `你是${vars.region}地区的留学专家。`,
  systemPromptMode: 'preset',
  llm: cheaperLlmAdapter,
  skills: ['search', 'summarize'],
  consolidateFn: researchConsolidateFn,
})

forkProfiles.register('researcher', {
  systemPrompt: '你是研究助手，善于深入分析。',
  systemPromptMode: 'prepend',
  context: 'inherit',
})
```

完整字段、合成规则、`systemPromptMode` 三种模式见 skill `fork-design`。

### 3.4 `lifecycle` — 生命周期适配器

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

### 3.5 `confirm` — 确认协议

```typescript
const confirm: ConfirmProtocol = {
  async confirmSplit(proposal) {
    return agent.forkSession(proposal.parentId, {
      label: proposal.suggestedLabel,
    })
  },
  async dismissSplit() {},
  async confirmUpdate() {},
  async dismissUpdate() {},
}
```

---

## 4. `session` — Session 层接入

`StelloAgentSessionConfig` 是**纯 I/O 数据加载**，按 ID 加载 Session 实例与其固化配置。

```typescript
session: {
  sessionLoader: async (sessionId) => {
    const session = await loadSession(sessionId, {
      storage: sessionStorage,
      llm: currentLlm,
    })
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    return {
      session,        // SessionCompatible 实例
      config: null,   // SerializableSessionConfig | null
    }
  },

  // 可选：自定义 send() 结果序列化（默认 JSON）
  serializeSendResult: (result) => JSON.stringify(result),

  // 可选：自定义 tool call 解析器（默认 sessionSendResultParser）
  toolCallParser: customParser,
}
```

所有 Session（含 root）由同一个 `sessionLoader` 按 id 加载。Root 与子 session 的差异只在拓扑 (`TopologyNode.parentId === null`)，loader 无需区分。

**两种 session 接入方式**：

| 方式 | 配置 | 适用场景 |
|------|------|---------|
| Session 适配 | `session.sessionLoader` | 使用 `@stello-ai/session` 包（推荐） |
| 直接提供 runtime | `runtime.resolver` | 自定义 session 实现 |

---

## 5. `orchestration` — 编排策略（可选）

### `consolidateEveryNTurns`

```typescript
orchestration: {
  consolidateEveryNTurns: 5,
}
```

每 5 轮自动 consolidate（fire-and-forget）。

### `splitGuard`

```typescript
import { SplitGuard } from '@stello-ai/core'

orchestration: {
  splitGuard: new SplitGuard(sessions, {
    minTurns: 3,
    cooldownTurns: 5,
  }),
}
```

### `hooks`

```typescript
orchestration: {
  hooks: {
    onRoundStart({ sessionId, input }) {},
    onRoundEnd({ sessionId, turn }) {},
    onSessionFork({ parentId, child }) {},
    onToolCall({ sessionId, toolCall }) {},
    onError({ source, error }) {},
  },
}
```

所有 hooks **fire-and-forget**：抛错时 emit error 事件，不中断对话。

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
  InMemorySharedMemoryStore,
  createSessionTool,
  activateSkillTool,
  memoryRecallTool,
  memoryRememberTool,
  memoryForgetTool,
} from '@stello-ai/core'
import {
  loadSession,
  InMemoryStorageAdapter,
  createOpenAICompatibleAdapter,
} from '@stello-ai/session'

// ─── 基础设施 ───
const fs = new NodeFileSystemAdapter('./data')
const sessions = new SessionTreeImpl(fs)
const sessionStorage = new InMemoryStorageAdapter()
const sharedMemory = new InMemorySharedMemoryStore()
const llm = createOpenAICompatibleAdapter({
  apiKey: process.env.OPENAI_API_KEY!,
  model: 'gpt-4o',
})

// ─── 自定义 Tools（含 opt-in 内置 tool） ───
const skills = new SkillRouterImpl()
skills.register({
  name: 'data-analysis',
  description: '数据分析模式：激活后按结构化流程分析数据',
  content: '你是数据分析专家...',
})

const toolRegistry = new ToolRegistryImpl([
  createSessionTool(),                  // 内置 fork tool（opt-in）
  activateSkillTool(skills),            // 内置 skill 激活 tool（opt-in）
  memoryRecallTool(),                   // 共享 memory 读取 tool（opt-in）
  memoryRememberTool(),                 // 共享 memory 写入 tool（opt-in）
  memoryForgetTool(),                   // 共享 memory 删除 tool（opt-in）
])
toolRegistry.register({
  name: 'search_knowledge',
  description: '搜索知识库',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
  },
  execute: async (args, _ctx) => ({
    success: true,
    data: await knowledgeBase.search(String(args.query)),
  }),
})

// ─── Fork Profiles ───
const profiles = new ForkProfileRegistryImpl()
profiles.register('researcher', {
  systemPrompt: '你是研究助手，善于深入分析。',
  systemPromptMode: 'prepend',
  context: 'inherit',
  skills: ['search', 'data-analysis'],
})

// ─── 创建 Agent ───
let agent: ReturnType<typeof createStelloAgent>
agent = createStelloAgent({
  sessions,
  storage: sessionStorage,            // 注入内容存储，启用 orchestrator-facing SDK
  sharedMemory,                       // 注入共享 memory，启用 4 个 SDK 方法 + 索引自动注入

  sessionDefaults: {
    llm,
    systemPrompt: '你是一个助手。',
    // consolidateFn / compressFn 由应用层闭包注入
  },

  session: {
    sessionLoader: async (sessionId) => {
      const session = await loadSession(sessionId, { storage: sessionStorage, llm })
      if (!session) throw new Error(`Session not found: ${sessionId}`)
      return { session, config: null }
    },
  },

  capabilities: {
    lifecycle: {
      bootstrap: async (sessionId) => ({
        context: { core: {}, memories: [], currentMemory: null, scope: null },
        session: await sessions.get(sessionId),
      }),
      afterTurn: async () => ({ coreUpdated: false, memoryUpdated: false, recordAppended: true }),
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

// ─── 创建 root session ───
const root = await agent.createSession({ label: 'Main' })

// ─── 开始对话 ───
await agent.enterSession(root.id)
const result = await agent.turn(root.id, '帮我分析一下市场趋势')
console.log(result.turn.finalContent)
```

---

## 7. 自行实现 reflection 循环

"全 memory → 反思 → 定向 insight" 的循环由应用层实现：

```typescript
async function reflect(agent: StelloAgent, llm: LLMAdapter): Promise<void> {
  const digests = await agent.listSessionDigests({ status: 'active' })
  const reflection = await llm.complete([
    { role: 'system', content: '你是 orchestrator，请综合各 session 的 memory，对需要纠偏/补充信息的 session 写出 insight。' },
    { role: 'user', content: JSON.stringify(digests) },
  ])

  // 解析 reflection 输出（自定义 schema），调用 putInsight 定向回写
  const { insights } = JSON.parse(reflection.content ?? '{}') as { insights: Record<string, string> }
  await Promise.all(
    Object.entries(insights).map(([sessionId, content]) =>
      agent.putInsight(sessionId, content),
    ),
  )
}
```

---

## 8. 运行时使用

Agent 创建后的运行时操作（createSession / turn / stream / fork / attach / detach / 数据 SDK 等）见 skill `stello-agent-usage`。
