---
name: stello-agent-creation
description: StelloAgent 创建配置教程。完整说明 createStelloAgent 的每个配置项，包含 tools、skills、forkProfiles、scheduler、session 接入等。
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
    sessionResolver: async (id) => loadedSession,
    consolidateFn: myConsolidateFn,
  },
})
```

---

## 配置结构总览

```typescript
interface StelloAgentConfig {
  sessions: SessionTree             // 拓扑树（必填）
  memory: MemoryEngine              // 记忆引擎（必填）
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

## 1. `capabilities` — 能力注入

### 1.1 `tools` — 用户自定义工具

用 `ToolRegistryImpl` 注册自定义 tool，每个 tool 是一个 `ToolRegistryEntry`：

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

toolRegistry.register({
  name: 'search_docs',
  description: '搜索知识库',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '搜索关键词' },
    },
    required: ['query'],
  },
  execute: async (args) => {
    const results = await vectorStore.search(String(args.query))
    return { success: true, data: results }
  },
})
```

**要点**：
- `parameters` 是 JSON Schema 格式，LLM 据此生成参数
- `execute` 返回 `{ success: true, data: ... }` 或 `{ success: false, error: '...' }`
- tool 执行失败时 Engine 自动将 error 作为 tool result 返回给 LLM，不中断对话
- **不需要注册 `stello_create_session` 和 `activate_skill`**——框架自动注入

### 1.2 `skills` — Skill 注册表

Skill 是两级渐进式加载的 prompt 片段：LLM 始终看到 name + description，主动调用 `activate_skill` 后注入完整 content。

```typescript
import { SkillRouterImpl, loadSkillsFromDirectory } from '@stello-ai/core'

const skillRouter = new SkillRouterImpl()

// 方式一：代码注册
skillRouter.register({
  name: 'code-review',
  description: '代码审查专家，激活后按标准流程审查代码质量',
  content: `你现在是代码审查专家。请按以下流程审查：
1. 检查代码风格一致性
2. 检查潜在 bug 和边界条件
3. 检查性能问题
4. 给出改进建议`,
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
- Skill 目录格式：每个子目录包含 `SKILL.md`，用 YAML frontmatter 定义 name 和 description

### 1.3 `profiles` — Fork Profile 注册表（可选）

ForkProfile 是预定义的 fork 配置模板。LLM 调用 `stello_create_session` 时可通过 `profile` 参数引用。

```typescript
import { ForkProfileRegistryImpl } from '@stello-ai/core'

const forkProfiles = new ForkProfileRegistryImpl()

// 基础 profile：固定角色
forkProfiles.register('poet', {
  systemPrompt: '你是一位诗人。所有回复必须用诗歌形式。',
  systemPromptMode: 'preset',      // 忽略 LLM 提供的 systemPrompt
})

// 高级 profile：prepend 合成 + 限制 skills + 自定义 consolidation
forkProfiles.register('researcher', {
  systemPrompt: '你是研究助手，善于深入分析。',
  systemPromptMode: 'prepend',     // profile prompt 在前，LLM prompt 在后
  context: 'inherit',              // 继承父会话的对话历史
  skills: ['search', 'summarize'], // 只允许这两个 skill
  consolidateFn: researchConsolidateFn,  // 研究类 session 专属的 L3→L2 策略
})

// 模板函数 profile：动态生成 systemPrompt
forkProfiles.register('region-expert', {
  systemPrompt: (vars) => `你是${vars.region}地区的留学专家。`,
  systemPromptMode: 'preset',
  llm: cheaperLlmAdapter,          // 使用更便宜的模型
  tools: customToolList,           // 覆盖工具列表
})
```

**`systemPromptMode` 三种模式**：
- `'preset'`：只用 profile 的 systemPrompt，忽略 LLM 提供的
- `'prepend'`（默认）：profile prompt 在前 + LLM prompt 在后
- `'append'`：LLM prompt 在前 + profile prompt 在后

**行为**：
- 有 profiles 时，`stello_create_session` 的参数定义自动包含 `profile` 枚举和 `vars` 对象
- 无 profiles 时，`stello_create_session` 只有 label / systemPrompt / prompt / context 参数
- `skills` 白名单写入子 session 的 metadata，Factory 创建子 Engine 时自动过滤
- `consolidateFn` / `compressFn` 在 fork 时注入子 session，不指定则继承父 session 的

### 1.4 `lifecycle` — 生命周期适配器

```typescript
const lifecycle: EngineLifecycleAdapter = {
  // 进入 session 时组装上下文
  bootstrap: async (sessionId) => ({
    context: await memory.assembleContext(sessionId),
    session: await sessions.get(sessionId),
  }),

  // 每轮对话后持久化记录
  afterTurn: async (sessionId, userMsg, assistantMsg) => {
    await memory.appendRecord(sessionId, userMsg)
    await memory.appendRecord(sessionId, assistantMsg)
    return { coreUpdated: false, memoryUpdated: false, recordAppended: true }
  },
}
```

### 1.5 `confirm` — 确认协议

```typescript
const confirm: ConfirmProtocol = {
  async confirmSplit(proposal) {
    // LLM 建议拆分时的处理
    return agent.forkSession(proposal.parentId, {
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

## 2. `session` — Session 层接入

这是 `@stello-ai/session` 包接入 core 的适配层。提供 resolver + 提炼函数，StelloAgent 自动完成适配。

```typescript
session: {
  // 按 ID 加载真实 Session（必填）
  sessionResolver: async (sessionId) => {
    const session = await loadSession(sessionId, {
      storage: sessionStorage,
      llm: currentLlm,
      tools: sessionTools,  // session 层需要的 tool schema
    })
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    return session
  },

  // 加载 MainSession（可选，需要 integration 时提供）
  mainSessionResolver: async () => mainSession,

  // L3 → L2 提炼函数（必填，作为根 session 的默认值，fork 时可覆盖）
  consolidateFn: async (currentMemory, messages) => {
    return llm.summarize(messages)  // 返回 L2 字符串
  },

  // 所有 L2 → synthesis + insights（可选，与 mainSessionResolver 配对）
  integrateFn: async (children, currentSynthesis) => {
    return {
      synthesis: '综合认知...',
      insights: children.map(c => ({
        sessionId: c.sessionId,
        content: `针对 ${c.label} 的建议...`,
      })),
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
| Session 适配 | `session.sessionResolver` + `session.consolidateFn` | 使用 `@stello-ai/session` 包 |
| 直接提供 runtime | `runtime.resolver` | 自定义 session 实现 |

方式一是推荐路径。StelloAgent 内部自动调用 `adaptSessionToEngineRuntime()` 完成适配。

---

## 3. `orchestration` — 编排策略（可选）

### 3.1 `scheduler` — 调度器

控制 consolidation 和 integration 的自动触发时机。

```typescript
import { Scheduler } from '@stello-ai/core'

const scheduler = new Scheduler({
  consolidation: {
    trigger: 'everyNTurns',  // 每 N 轮自动 consolidate
    everyNTurns: 3,
  },
  integration: {
    trigger: 'afterConsolidate',  // consolidate 后自动 integrate
  },
})
```

**可用触发时机**：

| 触发 | consolidation | integration |
|------|:---:|:---:|
| `'manual'` | ✓ | ✓ |
| `'everyNTurns'` | ✓ | ✓ |
| `'onSwitch'` | ✓ | ✓ |
| `'onArchive'` | ✓ | ✓ |
| `'onLeave'` | ✓ | ✓ |
| `'afterConsolidate'` | - | ✓ |

不配置 scheduler 时，consolidation 和 integration 只能手动触发。

### 3.2 `strategy` — 编排策略

控制 fork 时的拓扑父节点选择。

```typescript
import { MainSessionFlatStrategy, HierarchicalOkrStrategy } from '@stello-ai/core'

// 默认：所有 fork 挂到根节点
orchestration: {
  strategy: new MainSessionFlatStrategy(),
}

// 或：保持层级结构
orchestration: {
  strategy: new HierarchicalOkrStrategy(),
}
```

### 3.3 `splitGuard` — 拆分保护

防止过早或过于频繁的 fork。

```typescript
import { SplitGuard } from '@stello-ai/core'

orchestration: {
  splitGuard: new SplitGuard(sessions, {
    minTurns: 3,       // 至少对话 3 轮才允许 fork
    cooldownTurns: 5,  // 上次 fork 后至少再对话 5 轮
  }),
}
```

### 3.4 `hooks` — Engine 事件钩子

```typescript
orchestration: {
  hooks: {
    onRoundStart({ sessionId, input }) {
      console.log(`[${sessionId}] 用户: ${input}`)
    },
    onRoundEnd({ sessionId, turn }) {
      console.log(`[${sessionId}] 助手: ${turn.finalContent}`)
    },
    onSessionFork({ parentId, child }) {
      console.log(`Fork: ${parentId} → ${child.id}`)
    },
    onToolCall({ sessionId, toolCall }) {
      console.log(`Tool: ${toolCall.name}`)
    },
    onError({ source, error }) {
      console.error(`[${source}]`, error)
    },
  },
}
```

hooks 也支持按 sessionId 动态生成：

```typescript
orchestration: {
  hooks: (sessionId) => ({
    onRoundEnd({ turn }) {
      analytics.track(sessionId, turn)
    },
  }),
}
```

所有 hooks 都是 **fire-and-forget**：抛错时 emit error 事件，不中断对话。

---

## 4. 内置 Tool 的自动注册机制

用户**不需要**手动注册以下内置 tool，Engine 构造时自动处理：

| 内置 Tool | 注入条件 | 功能 |
|-----------|---------|------|
| `stello_create_session` | 始终注入 | LLM 发起 fork 创建子会话 |
| `activate_skill` | `skills.getAll().length > 0` | LLM 按需加载 skill prompt |

**内部机制**：Engine 构造时通过 `createBuiltinToolEntries()` 生成 `ToolRegistryEntry` 实例（闭包捕获 Engine 上下文），与用户 `tools` 一起包装为 `CompositeToolRuntime`。内置 tool 优先级高于用户同名 tool。

---

## 5. 完整配置示例

```typescript
import {
  createStelloAgent,
  ToolRegistryImpl,
  SkillRouterImpl,
  ForkProfileRegistryImpl,
  Scheduler,
  SplitGuard,
  SessionTreeImpl,
  NodeFileSystemAdapter,
  FileSystemMemoryEngine,
  createDefaultConsolidateFn,
  createDefaultIntegrateFn,
  createOpenAICompatibleAdapter,
  InMemoryStorageAdapter,
  loadSession,
  createMainSession,
  type StelloAgentConfig,
} from '@stello-ai/core'

// ─── 基础设施 ───
const fs = new NodeFileSystemAdapter('./data')
const sessions = new SessionTreeImpl(fs)
const memory = new FileSystemMemoryEngine(fs, sessions)
const sessionStorage = new InMemoryStorageAdapter()

const llm = createOpenAICompatibleAdapter({
  apiKey: process.env.OPENAI_API_KEY!,
  model: 'gpt-4o',
  maxContextTokens: 128000,
})

// ─── 自定义 Tools ───
const toolRegistry = new ToolRegistryImpl()
toolRegistry.register({
  name: 'search_knowledge',
  description: '搜索知识库',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
  },
  execute: async (args) => {
    const results = await knowledgeBase.search(String(args.query))
    return { success: true, data: results }
  },
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
profiles.register('deep-dive', {
  systemPrompt: '你是深度研究助手，擅长对特定主题进行详尽分析。',
  systemPromptMode: 'prepend',
  context: 'inherit',
  consolidateFn: createDefaultConsolidateFn('请提炼研究要点和关键发现', llmCall),
})

// ─── LLM 调用函数（供 consolidate/integrate 使用）───
const llmCall = async (messages: Array<{ role: string; content: string }>) => {
  const result = await llm.complete(
    messages.map(m => ({ role: m.role as 'user' | 'system', content: m.content }))
  )
  return result.content ?? ''
}

// ─── 创建 Agent ───
const agent = createStelloAgent({
  sessions,
  memory,

  session: {
    sessionResolver: async (sessionId) => {
      return await loadSession(sessionId, { storage: sessionStorage, llm })
    },
    mainSessionResolver: async () => mainSession,
    consolidateFn: createDefaultConsolidateFn('请将对话压缩为要点摘要', llmCall), // 默认值，fork 时可覆盖
    integrateFn: createDefaultIntegrateFn('请综合所有子会话的信息', llmCall),
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
    scheduler: new Scheduler({
      consolidation: { trigger: 'everyNTurns', everyNTurns: 5 },
      integration: { trigger: 'afterConsolidate' },
    }),
    splitGuard: new SplitGuard(sessions, { minTurns: 3, cooldownTurns: 5 }),
    hooks: {
      onSessionFork({ parentId, child }) {
        console.log(`Fork: ${parentId} → ${child.id} (${child.label})`)
      },
    },
  },
})

// ─── 使用 ───
await agent.enterSession(rootSessionId)
const result = await agent.turn(rootSessionId, '帮我分析一下市场趋势')
console.log(result.turn.finalContent)
```

---

## 6. StelloAgent 公开方法

| 方法 | 说明 |
|------|------|
| `enterSession(id)` | 进入 session，触发 bootstrap |
| `turn(id, input, options?)` | 运行一轮对话（含 tool call 循环） |
| `stream(id, input, options?)` | 流式运行一轮对话 |
| `leaveSession(id)` | 离开 session，触发调度 |
| `forkSession(id, options)` | 编程式 fork（公开 API，等价于 LLM 调用 stello_create_session） |
| `archiveSession(id)` | 归档 session |
| `attachSession(id, holderId)` | 附着 runtime（WS 连接建立时） |
| `detachSession(id, holderId)` | 释放 runtime（WS 断开时） |
| `updateConfig(patch)` | 热更新运行时配置 |
