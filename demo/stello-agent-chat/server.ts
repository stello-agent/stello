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
function createInMemoryMemoryEngine(sessions: SessionTreeImpl): MemoryEngine {
  const core: Record<string, unknown> = {
    name: schema.name.default,
    goal: schema.goal.default,
    topics: schema.topics.default,
  }
  const memories = new Map<string, string>()
  const scopes = new Map<string, string>()
  const indexes = new Map<string, string>()
  const recordStore = new Map<string, TurnRecord[]>()

  return {
    async readCore(path?: string) {
      if (!path) return { ...core }
      return core[path]
    },
    async writeCore(path: string, value: unknown) {
      core[path] = value
    },
    async readMemory(sessionId: string) {
      return memories.get(sessionId) ?? null
    },
    async writeMemory(sessionId: string, content: string) {
      memories.set(sessionId, content)
    },
    async readScope(sessionId: string) {
      return scopes.get(sessionId) ?? null
    },
    async writeScope(sessionId: string, content: string) {
      scopes.set(sessionId, content)
    },
    async readIndex(sessionId: string) {
      return indexes.get(sessionId) ?? null
    },
    async writeIndex(sessionId: string, content: string) {
      indexes.set(sessionId, content)
    },
    async appendRecord(sessionId: string, record: TurnRecord) {
      const list = recordStore.get(sessionId) ?? []
      list.push(record)
      recordStore.set(sessionId, list)
    },
    async readRecords(sessionId: string) {
      return recordStore.get(sessionId) ?? []
    },
    async assembleContext(sessionId: string) {
      const session = await sessions.get(sessionId)
      const currentMemory = memories.get(sessionId) ?? null
      const scope = scopes.get(sessionId) ?? null
      const parentMemories: string[] = []
      if (session?.parentId) {
        const parentMem = memories.get(session.parentId)
        if (parentMem) parentMemories.push(parentMem)
      }
      return { core: { ...core }, memories: parentMemories, currentMemory, scope }
    },
  }
}

async function bootstrap() {
  const fs = new NodeFileSystemAdapter(dataDir)
  const sessions = new SessionTreeImpl(fs)
  const llm = createOpenAICompatibleAdapter({
    apiKey: openaiApiKey!,
    baseURL: openaiBaseURL,
    model: openaiModel,
  })

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

  const memory = createInMemoryMemoryEngine(sessions)

  const root = await sessions.createRoot('Main Session')
  currentSessionId = root.id

  const mainSession = await createMainSession({
    storage: sessionStorage,
    llm,
    label: root.label,
    systemPrompt: '你是 Stello 的演示助手。回答简洁、直接，优先中文。当用户明确要求创建子 session / 子会话 / 新会话时，必须调用 stello_create_session 工具，不要只用文字描述。',
    tools: [...sessionTools],
  })
  sessionMap.set(root.id, { main: mainSession })

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
        llm,
        label: child.label,
        systemPrompt: `你当前专注于子话题：${child.scope ?? child.label}。回答时只围绕当前子话题。当用户明确要求创建新的子 session / 子会话时，必须调用 stello_create_session 工具。`,
        tools: [...sessionTools],
      })
      sessionMap.set(child.id, { session: childSession })
      return child
    },
  }

  const tools: EngineToolRuntime = {
    getToolDefinitions: () => [
      {
        name: 'stello_create_session',
        description: 'Create a child session under the current or root main session.',
        parameters: sessionTools[0].inputSchema,
      },
    ],
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
      consolidateFn: async (_currentMemory, messages) => {
        const tail = messages.slice(-6)
        return tail.map((m) => `${m.role}: ${m.content}`).join('\n')
      },
      integrateFn: async (children, currentSynthesis) => {
        const synthesisLines = [
          currentSynthesis ?? 'Current synthesis: none',
          ...children.map((child) => `- ${child.label}: ${child.l2}`),
        ]
        return {
          synthesis: synthesisLines.join('\n'),
          insights: [],
        }
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
  const dt = await startDevtools(app.agent, { port: devtoolsPort, open: true })

  console.log(`\nStello Agent Demo`)
  console.log(`  Model:    ${openaiModel}`)
  console.log(`  Base URL: ${openaiBaseURL}`)
  console.log(`  DevTools: http://${host}:${dt.port}\n`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
