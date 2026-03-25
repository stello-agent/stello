import 'dotenv/config'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  NodeFileSystemAdapter,
  SessionTreeImpl,
  SkillRouterImpl,
  createStelloAgent,
  type ConfirmProtocol,
  type CoreSchema,
  type EngineLifecycleAdapter,
  type EngineToolRuntime,
  type MemoryEngine,
  type SessionMeta,
  type SessionTree,
  type StelloAgentConfig,
  type TurnRecord,
  createDefaultConsolidateFn,
  createDefaultIntegrateFn,
  DEFAULT_CONSOLIDATE_PROMPT,
  DEFAULT_INTEGRATE_PROMPT,
  type LLMCallFn,
} from '../../packages/core/src/index'
import { startDevtools } from '../../packages/devtools/src/index'
import {
  createOpenAICompatibleAdapter,
} from '../../packages/session/src/adapters/openai-compatible.ts'
import { createMainSession } from '../../packages/session/src/create-main-session.ts'
import { createSession } from '../../packages/session/src/create-session.ts'
import { InMemoryStorageAdapter } from '../../packages/session/src/mocks/in-memory-storage.ts'
import type { MainSession } from '../../packages/session/src/types/main-session-api.ts'
import type { Session } from '../../packages/session/src/types/session-api.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataDir = './tmp/stello-agent-chat'
const host = process.env.DEMO_HOST ?? '127.0.0.1'

const openaiApiKey = process.env.OPENAI_API_KEY
const openaiBaseURL = process.env.OPENAI_BASE_URL ?? 'https://api.minimaxi.com/v1'
const openaiModel = process.env.OPENAI_MODEL ?? 'MiniMax-M1'

if (!openaiApiKey) {
  console.error('Missing OPENAI_API_KEY')
  console.error('Example:')
  console.error('  export OPENAI_BASE_URL=https://api.minimaxi.com/v1')
  console.error('  export OPENAI_API_KEY=your_key')
  console.error('  export OPENAI_MODEL=MiniMax-M1')
  process.exit(1)
}

const schema: CoreSchema = {
  name: { type: 'string', default: '', bubbleable: true },
  goal: { type: 'string', default: '', bubbleable: true },
  topics: { type: 'array', default: [], bubbleable: true },
}

type WrappedSession = {
  session: Session
  main?: never
}

type WrappedMainSession = {
  main: MainSession
  session?: never
}

function wrapSession(coreSessionId: string, session: Session) {
  return {
    get meta() {
      return {
        id: coreSessionId,
        status: session.meta.status,
      } as const
    },
    async send(content: string) {
      return session.send(content)
    },
    stream(content: string) {
      return session.stream(content)
    },
    async messages() {
      return session.messages()
    },
    async consolidate(fn: (currentMemory: string | null, messages: Array<{ role: string; content: string; timestamp?: string }>) => Promise<string>) {
      await session.consolidate(fn)
    },
  }
}

/** 简易内存 MemoryEngine，仅用于 demo */
/** 文件持久化 MemoryEngine */
function createFileMemoryEngine(fs: NodeFileSystemAdapter, sessions: SessionTreeImpl): MemoryEngine {
  const corePath = 'memory/core.json'
  const memPath = (id: string) => `memory/sessions/${id}/memory.json`
  const scopePath = (id: string) => `memory/sessions/${id}/scope.json`
  const indexPath = (id: string) => `memory/sessions/${id}/index.json`
  const recordsPath = (id: string) => `memory/sessions/${id}/records.json`

  return {
    async readCore(path?: string) {
      const data = (await fs.readJSON<Record<string, unknown>>(corePath)) ?? {
        name: schema.name.default,
        goal: schema.goal.default,
        topics: schema.topics.default,
      }
      if (!path) return data
      return data?.[path]
    },
    async writeCore(path: string, value: unknown) {
      const data = await this.readCore() as Record<string, unknown>
      data[path] = value
      await fs.writeJSON(corePath, data)
    },
    async readMemory(sessionId: string) {
      return fs.readJSON<string>(memPath(sessionId)).catch(() => null)
    },
    async writeMemory(sessionId: string, content: string) {
      await fs.writeJSON(memPath(sessionId), content)
    },
    async readScope(sessionId: string) {
      return fs.readJSON<string>(scopePath(sessionId)).catch(() => null)
    },
    async writeScope(sessionId: string, content: string) {
      await fs.writeJSON(scopePath(sessionId), content)
    },
    async readIndex(sessionId: string) {
      return fs.readJSON<string>(indexPath(sessionId)).catch(() => null)
    },
    async writeIndex(sessionId: string, content: string) {
      await fs.writeJSON(indexPath(sessionId), content)
    },
    async appendRecord(sessionId: string, record: TurnRecord) {
      const list = (await fs.readJSON<TurnRecord[]>(recordsPath(sessionId))) ?? []
      list.push(record)
      await fs.writeJSON(recordsPath(sessionId), list)
    },
    async readRecords(sessionId: string) {
      return (await fs.readJSON<TurnRecord[]>(recordsPath(sessionId))) ?? []
    },
    async assembleContext(sessionId: string) {
      const core = await this.readCore() as Record<string, unknown>
      const session = await sessions.get(sessionId)
      const currentMemory = await this.readMemory(sessionId)
      const scope = await this.readScope(sessionId)
      const parentMemories: string[] = []
      if (session?.parentId) {
        const parentMem = await this.readMemory(session.parentId)
        if (parentMem) parentMemories.push(parentMem)
      }
      return { core, memories: parentMemories, currentMemory, scope }
    },
  }
}

async function bootstrap() {
  const fs = new NodeFileSystemAdapter(dataDir)
  const sessions = new SessionTreeImpl(fs)
  let currentLlm = createOpenAICompatibleAdapter({
    apiKey: openaiApiKey!,
    baseURL: openaiBaseURL,
    model: openaiModel,
  })
  let currentLlmConfig = { model: openaiModel, baseURL: openaiBaseURL, apiKey: openaiApiKey!, temperature: 0.7, maxTokens: 1024 }

  /* LLM 调用函数——从 currentLlm 实时读取，用 currentLlmConfig 的 temperature/maxTokens */
  const llmCall: LLMCallFn = async (messages) => {
    const result = await currentLlm.complete(
      messages.map((m) => ({ role: m.role as 'user' | 'assistant' | 'system', content: m.content })),
      { temperature: currentLlmConfig.temperature, maxTokens: currentLlmConfig.maxTokens },
    )
    return result.content
  }

  let currentConsolidatePrompt = DEFAULT_CONSOLIDATE_PROMPT
  let currentIntegratePrompt = DEFAULT_INTEGRATE_PROMPT
  const disabledTools = new Set<string>()
  const disabledSkills = new Set<string>()

  const sessionStorage = new InMemoryStorageAdapter()
  const sessionMap = new Map<string, WrappedSession | WrappedMainSession>()
  let currentSessionId: string | null = null
  let currentToolSessionId: string | null = null

  const sessionTools = [
    {
      name: 'stello_create_session',
      description: 'Create a child session when the user asks to branch into a new topic or sub-task.',
      inputSchema: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'Display name of the child session' },
          scope: { type: 'string', description: 'Optional topic scope of the child session' },
        },
        required: ['label'],
      },
    },
  ] as const

  const memory = createFileMemoryEngine(fs, sessions)

  /* 复用已有 root session 或创建新的 */
  let root: SessionMeta
  try {
    root = await sessions.getRoot()
  } catch {
    root = await sessions.createRoot('Main Session')
  }
  currentSessionId = root.id

  const mainSession = await createMainSession({
    storage: sessionStorage,
    llm: currentLlm,
    label: root.label,
    systemPrompt: '你是 Stello 的演示助手。回答简洁、直接，优先中文。当用户明确要求创建子 session / 子会话 / 新会话时，必须调用 stello_create_session 工具，不要只用文字描述。',
    tools: [...sessionTools],
  })
  sessionMap.set(root.id, { main: mainSession })

  /* 恢复已有的子 session 运行时实例 */
  const allSessions = await sessions.listAll()
  for (const meta of allSessions) {
    if (meta.id === root.id) continue
    if (sessionMap.has(meta.id)) continue
    const childSession = await createSession({
      storage: sessionStorage,
      llm: currentLlm,
      label: meta.label,
      systemPrompt: `你当前专注于子话题：${meta.scope ?? meta.label}。回答时只围绕当前子话题。当用户明确要求创建新的子 session / 子会话时，必须调用 stello_create_session 工具。`,
      tools: [...sessionTools],
    })
    sessionMap.set(meta.id, { session: childSession })
  }
  if (allSessions.length > 1) {
    console.log(`Restored ${allSessions.length - 1} child session(s) from disk`)
  }

  const lifecycle: EngineLifecycleAdapter = {
    bootstrap: async (sessionId) => ({
      context: await memory.assembleContext(sessionId),
      session: await requireCoreSession(sessions, sessionId),
    }),
    assemble: (sessionId) => memory.assembleContext(sessionId),
    afterTurn: async (sessionId, userMsg, assistantMsg) => {
      await memory.appendRecord(sessionId, userMsg)
      await memory.appendRecord(sessionId, assistantMsg)
      const current = await requireCoreSession(sessions, sessionId)
      await sessions.updateMeta(sessionId, { turnCount: current.turnCount + 1 })
      return {
        coreUpdated: false,
        memoryUpdated: false,
        recordAppended: true,
      }
    },
    prepareChildSpawn: async (options) => {
      const child = await sessions.createChild(options)
      const childSession = await createSession({
        storage: sessionStorage,
        llm: currentLlm,
        label: child.label,
        systemPrompt: `你当前专注于子话题：${child.scope ?? child.label}。回答时只围绕当前子话题。当用户明确要求创建新的子 session / 子会话时，必须调用 stello_create_session 工具。`,
        tools: [...sessionTools],
      })
      sessionMap.set(child.id, { session: childSession })
      return child
    },
  }

  const allToolDefs = [
    {
      name: 'stello_create_session',
      description: 'Create a child session under the current or root main session.',
      parameters: sessionTools[0].inputSchema as Record<string, unknown>,
    },
  ]

  const tools: EngineToolRuntime = {
    getToolDefinitions: () => allToolDefs.filter((t) => !disabledTools.has(t.name)),
    async executeTool(name, args) {
      if (name !== 'stello_create_session') {
        return { success: false, error: `Unknown tool: ${name}` }
      }
      if (!currentToolSessionId) {
        return { success: false, error: 'No active tool session context' }
      }

      const source = await requireCoreSession(sessions, currentToolSessionId)
      const effectiveParentId = source.parentId === null
        ? source.id
        : (await sessions.getRoot()).id

      const label = String(args.label ?? 'New Child Session')
      const scope = args.scope ? String(args.scope) : undefined
      const child = await lifecycle.prepareChildSpawn({
        parentId: effectiveParentId,
        label,
        scope,
      })

      return {
        success: true,
        data: {
          sessionId: child.id,
          label: child.label,
          scope: child.scope,
          parentId: child.parentId,
        },
      }
    },
  }

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

  const config: StelloAgentConfig = {
    sessions: sessions as SessionTree,
    memory,
    session: {
      sessionResolver: async (sessionId) => {
        const entry = sessionMap.get(sessionId)
        if (!entry) {
          throw new Error(`Unknown session: ${sessionId}`)
        }
        if ('main' in entry && entry.main) {
          return wrapSession(sessionId, entry.main)
        }
        return wrapSession(sessionId, entry.session)
      },
      mainSessionResolver: async () => mainSession,
      /* LLM 驱动的 consolidation 和 integration——prompt 通过 mutable ref 支持热更新 */
      consolidateFn: (currentMemory, messages) => {
        const fn = createDefaultConsolidateFn(currentConsolidatePrompt, llmCall)
        return fn(currentMemory, messages)
      },
      integrateFn: (children, currentSynthesis) => {
        const fn = createDefaultIntegrateFn(currentIntegratePrompt, llmCall)
        return fn(children, currentSynthesis)
      },
    },
    capabilities: {
      lifecycle,
      tools,
      skills: new SkillRouterImpl(),
      confirm,
    },
    runtime: {
      recyclePolicy: {
        idleTtlMs: 30_000,
      },
    },
    orchestration: {
      hooks: {
        onRoundStart({ sessionId }) {
          currentToolSessionId = sessionId
        },
        onRoundEnd({ sessionId, input, turn }) {
          currentToolSessionId = null
          /* 持久化对话记录到 MemoryEngine */
          const userRecord = { role: 'user' as const, content: input, timestamp: new Date().toISOString() }
          const assistantRecord = { role: 'assistant' as const, content: turn.finalContent ?? turn.rawResponse, timestamp: new Date().toISOString() }
          lifecycle.afterTurn(sessionId, userRecord, assistantRecord).catch(() => {})
        },
      },
    },
  }

  const agent = createStelloAgent(config)

  return {
    agent,
    sessions,
    sessionMap,
    getCurrentSessionId: () => currentSessionId,
    setCurrentSessionId: (sessionId: string) => {
      currentSessionId = sessionId
    },
    /** Session 访问能力 */
    sessionAccess: {
      async getSystemPrompt(sessionId: string) {
        const entry = sessionMap.get(sessionId)
        if (!entry) return null
        const s = 'main' in entry && entry.main ? entry.main : entry.session
        return s.systemPrompt()
      },
      async setSystemPrompt(sessionId: string, content: string) {
        const entry = sessionMap.get(sessionId)
        if (!entry) return
        const s = 'main' in entry && entry.main ? entry.main : entry.session
        await s.setSystemPrompt(content)
      },
      async getScope(sessionId: string) {
        return memory.readScope(sessionId)
      },
      async setScope(sessionId: string, content: string) {
        await memory.writeScope(sessionId, content)
      },
      async injectRecord(sessionId: string, record: { role: string; content: string }) {
        await memory.appendRecord(sessionId, { role: record.role as 'user' | 'assistant', content: record.content, timestamp: new Date().toISOString() })
      },
    },
    /** Consolidation/Integration 提示词 getter/setter */
    prompts: {
      getPrompts: () => ({ consolidate: currentConsolidatePrompt, integrate: currentIntegratePrompt }),
      setPrompts: (p: { consolidate?: string; integrate?: string }) => {
        if (p.consolidate) currentConsolidatePrompt = p.consolidate
        if (p.integrate) currentIntegratePrompt = p.integrate
        console.log('[Prompts] Updated consolidation/integration prompts')
      },
    },
    /** LLM 配置 getter/setter，供 DevTools 热切换 */
    llm: {
      getConfig: () => ({ ...currentLlmConfig }),
      setConfig: (config: { model: string; baseURL: string; apiKey?: string; temperature?: number; maxTokens?: number }) => {
        const newLlm = createOpenAICompatibleAdapter({
          apiKey: config.apiKey ?? currentLlmConfig.apiKey,
          baseURL: config.baseURL,
          model: config.model,
        })
        currentLlmConfig = {
          model: config.model,
          baseURL: config.baseURL,
          apiKey: config.apiKey ?? currentLlmConfig.apiKey,
          temperature: config.temperature ?? currentLlmConfig.temperature,
          maxTokens: config.maxTokens ?? currentLlmConfig.maxTokens,
        }
        currentLlm = newLlm
        /* 遍历所有 session 替换 LLM adapter */
        for (const entry of sessionMap.values()) {
          const s = 'main' in entry && entry.main ? entry.main : entry.session
          s.setLLM(newLlm)
        }
        console.log(`[LLM] Switched to ${config.model} @ ${config.baseURL}`)
      },
    },
    /** Tools 动态开关 */
    tools: {
      getTools: () => allToolDefs.map((t) => ({ ...t, enabled: !disabledTools.has(t.name) })),
      setEnabled: (name: string, enabled: boolean) => {
        if (enabled) disabledTools.delete(name)
        else disabledTools.add(name)
        console.log(`[Tools] ${name} ${enabled ? 'enabled' : 'disabled'}`)
      },
    },
    /** Skills 动态开关 */
    skills: {
      getSkills: () => {
        const allSkills = config.capabilities.skills.getAll()
        return allSkills.map((s) => ({ name: s.name, description: s.description, enabled: !disabledSkills.has(s.name) }))
      },
      setEnabled: (name: string, enabled: boolean) => {
        if (enabled) disabledSkills.delete(name)
        else disabledSkills.add(name)
        console.log(`[Skills] ${name} ${enabled ? 'enabled' : 'disabled'}`)
      },
    },
    /** 手动触发 integration */
    integration: {
      async trigger() {
        const integrateFn = config.session!.integrateFn!
        const allL2s: Array<{ sessionId: string; label: string; l2: string }> = []
        for (const [id, entry] of sessionMap) {
          if ('main' in entry && entry.main) continue
          const l2 = await memory.readMemory(id).catch(() => null)
          if (l2) {
            const meta = await sessions.get(id)
            allL2s.push({ sessionId: id, label: meta?.label ?? id, l2 })
          }
        }
        const currentSynthesis = await memory.readMemory(root.id).catch(() => null)
        const result = await integrateFn(allL2s, currentSynthesis)
        await memory.writeMemory(root.id, result.synthesis)
        for (const { sessionId, content } of result.insights) {
          await memory.writeScope(sessionId, content)
        }
        return { synthesis: result.synthesis, insightCount: result.insights.length }
      },
    },
  }
}

async function requireCoreSession(sessions: SessionTreeImpl, sessionId: string): Promise<SessionMeta> {
  const session = await sessions.get(sessionId)
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`)
  }
  return session
}

async function main() {
  const app = await bootstrap()

  if (process.env.DEMO_DRY_RUN === '1') {
    console.log('StelloAgent chat demo bootstrap succeeded.')
    console.log(`Root/current session: ${app.getCurrentSessionId()}`)
    return
  }

  /* 启动 DevTools 调试面板（唯一的 UI 入口） */
  const devtoolsPort = Number(process.env.DEVTOOLS_PORT ?? 4800)
  const dt = await startDevtools(app.agent, {
    port: devtoolsPort,
    open: true,
    llm: app.llm,
    prompts: app.prompts,
    sessionAccess: app.sessionAccess,
    tools: app.tools,
    skills: app.skills,
    integration: app.integration,
  })

  console.log(`\nStello Agent Demo`)
  console.log(`  Model:    ${openaiModel}`)
  console.log(`  Base URL: ${openaiBaseURL}`)
  console.log(`  DevTools: http://${host}:${dt.port}\n`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
