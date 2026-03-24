import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, dirname, extname, normalize } from 'node:path'
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
const distDir = resolve(__dirname, 'dist')
const dataDir = './tmp/stello-agent-chat'
const port = Number(process.env.DEMO_PORT ?? 3477)
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
        onRoundEnd() {
          currentToolSessionId = null
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

function json(res: import('node:http').ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

async function readJsonBody(req: import('node:http').IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

async function requireCoreSession(sessions: SessionTreeImpl, sessionId: string): Promise<SessionMeta> {
  const session = await sessions.get(sessionId)
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`)
  }
  return session
}

function toViewSession(meta: SessionMeta) {
  return {
    id: meta.id,
    label: meta.label,
    parentId: meta.parentId,
    scope: meta.scope,
    depth: meta.depth,
    status: meta.status,
    turnCount: meta.turnCount,
    children: meta.children,
  }
}

async function main() {
  const app = await bootstrap()

  if (process.env.DEMO_DRY_RUN === '1') {
    console.log('StelloAgent chat demo bootstrap succeeded.')
    console.log(`Root/current session: ${app.getCurrentSessionId()}`)
    return
  }

  /* 启动 DevTools 调试面板 */
  if (process.env.DEVTOOLS !== '0') {
    const devtoolsPort = Number(process.env.DEVTOOLS_PORT ?? 4800)
    startDevtools(app.agent, { port: devtoolsPort, open: false }).then((dt) => {
      console.log(`Stello DevTools running at http://${host}:${dt.port}`)
    }).catch((err) => {
      console.warn('DevTools failed to start:', err instanceof Error ? err.message : err)
    })
  }

  const server = createServer(async (req, res) => {
    try {
      if (!req.url) {
        json(res, 400, { error: 'Missing URL' })
        return
      }

      const url = new URL(req.url, `http://${req.headers.host ?? `${host}:${port}`}`)
      const pathname = url.pathname

      if (req.method === 'GET' && pathname === '/api/state') {
        const sessions = (await app.sessions.listAll()).map(toViewSession)
        json(res, 200, {
          currentSessionId: app.getCurrentSessionId(),
          sessions,
        })
        return
      }

      if (req.method === 'GET' && pathname.startsWith('/api/sessions/') && pathname.endsWith('/messages')) {
        const sessionId = pathname.split('/')[3]
        const entry = app.sessionMap.get(sessionId)
        if (!entry) {
          json(res, 404, { error: 'Session not found' })
          return
        }
        const runtime = 'main' in entry && entry.main ? entry.main : entry.session
        const messages = await runtime.messages()
        json(res, 200, { sessionId, messages })
        return
      }

      if (req.method === 'POST' && pathname.startsWith('/api/sessions/') && pathname.endsWith('/enter')) {
        const sessionId = pathname.split('/')[3]
        const bootstrapResult = await app.agent.enterSession(sessionId)
        app.setCurrentSessionId(sessionId)
        json(res, 200, bootstrapResult)
        return
      }

      if (req.method === 'POST' && pathname.startsWith('/api/sessions/') && pathname.endsWith('/turn')) {
        const sessionId = pathname.split('/')[3]
        const body = await readJsonBody(req)
        const input = String(body.input ?? '')
        const result = await app.agent.turn(sessionId, input)
        const entry = app.sessionMap.get(sessionId)
        if (!entry) {
          json(res, 404, { error: 'Session not found' })
          return
        }
        const messages = await ('main' in entry && entry.main ? entry.main.messages() : entry.session.messages())
        json(res, 200, {
          result,
          messages,
        })
        return
      }

      if (req.method === 'POST' && pathname.startsWith('/api/sessions/') && pathname.endsWith('/stream')) {
        const sessionId = pathname.split('/')[3]
        const body = await readJsonBody(req)
        const input = String(body.input ?? '')
        const stream = await app.agent.stream(sessionId, input)

        res.statusCode = 200
        res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
        res.setHeader('Cache-Control', 'no-cache')
        res.setHeader('Transfer-Encoding', 'chunked')

        for await (const chunk of stream) {
          res.write(`${JSON.stringify({ type: 'delta', delta: chunk })}\n`)
        }

        const result = await stream.result
        const entry = app.sessionMap.get(sessionId)
        if (!entry) {
          res.write(`${JSON.stringify({ type: 'error', error: 'Session not found after stream' })}\n`)
          res.end()
          return
        }
        const messages = await ('main' in entry && entry.main ? entry.main.messages() : entry.session.messages())
        res.write(`${JSON.stringify({ type: 'done', result, messages })}\n`)
        res.end()
        return
      }

      if (req.method === 'POST' && pathname.startsWith('/api/sessions/') && pathname.endsWith('/fork')) {
        const sessionId = pathname.split('/')[3]
        const body = await readJsonBody(req)
        const label = String(body.label ?? 'New Session')
        const scope = body.scope ? String(body.scope) : undefined
        const child = await app.agent.forkSession(sessionId, { label, scope })
        json(res, 200, { child })
        return
      }

      if (req.method === 'GET') {
        const requestedPath = pathname === '/' ? '/index.html' : pathname
        const safePath = normalize(requestedPath).replace(/^(\.\.[/\\])+/, '')
        const filePath = resolve(distDir, `.${safePath}`)
        const fallbackHtml = resolve(distDir, 'index.html')

        try {
          const payload = await readFile(filePath)
          res.statusCode = 200
          res.setHeader('Content-Type', contentTypeFor(filePath))
          res.end(payload)
          return
        } catch {
          if (!extname(pathname)) {
            const html = await readFile(fallbackHtml)
            res.statusCode = 200
            res.setHeader('Content-Type', 'text/html; charset=utf-8')
            res.end(html)
            return
          }
        }
      }

      json(res, 404, { error: 'Not found' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      json(res, 500, { error: message })
    }
  })

  server.listen(port, host, () => {
    console.log(`StelloAgent chat demo running at http://${host}:${port}`)
    console.log(`Model: ${openaiModel}`)
    console.log(`Base URL: ${openaiBaseURL}`)
  })
}

function contentTypeFor(filePath: string) {
  switch (extname(filePath)) {
    case '.html':
      return 'text/html; charset=utf-8'
    case '.css':
      return 'text/css; charset=utf-8'
    case '.js':
      return 'application/javascript; charset=utf-8'
    case '.json':
      return 'application/json; charset=utf-8'
    case '.svg':
      return 'image/svg+xml'
    default:
      return 'application/octet-stream'
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
