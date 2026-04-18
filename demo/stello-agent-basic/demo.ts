import {
  NodeFileSystemAdapter,
  SessionTreeImpl,
  SkillRouterImpl,
  createStelloAgent,
  type ConfirmProtocol,
  type EngineLifecycleAdapter,
  type EngineToolRuntime,
  type MemoryEngine,
  type SessionTree,
  type StelloAgentConfig,
  type TurnRecord,
} from '../../packages/core/src/index'

const schema = {
  name: { type: 'string', default: '', bubbleable: true },
  goal: { type: 'string', default: '', bubbleable: true },
  topics: { type: 'array', default: [], bubbleable: true },
} as const

function section(title: string): void {
  console.log(`\n=== ${title} ===`)
}

function print(label: string, value: unknown): void {
  console.log(`\n${label}:`)
  console.log(JSON.stringify(value, null, 2))
}

/**
 * 这里用一个非常轻量的 session 兼容对象模拟 @stello-ai/session。
 * 真正接入时，把这里替换成真实 Session 实例即可。
 */
function createMockSession(id: string, consolidateFn?: (currentMemory: string | null, messages: Array<{ role: string; content: string; timestamp?: string }>) => Promise<string>) {
  const records: Array<{ role: string; content: string; timestamp?: string }> = []
  let memory: string | null = null

  return {
    meta: {
      id,
      status: 'active' as const,
    },
    async send(content: string) {
      records.push({ role: 'user', content })

      if (content.includes('"toolResults"')) {
        const result = {
          content: `session(${id}) received tool result`,
          toolCalls: [],
        }
        records.push({ role: 'assistant', content: result.content })
        return result
      }

      const result = {
        content: null,
        toolCalls: [{ id: 'tool-1', name: 'stello_read_core', input: {} }],
      }
      records.push({ role: 'assistant', content: '' })
      return result
    },
    async messages() {
      return records
    },
    async consolidate() {
      if (!consolidateFn) throw new Error('No consolidateFn configured')
      memory = await consolidateFn(memory, records)
    },
  }
}

/** 简易内存 MemoryEngine，仅用于 demo */
function createInMemoryMemoryEngine(): MemoryEngine {
  const core: Record<string, unknown> = {
    name: schema.name.default,
    goal: schema.goal.default,
    topics: schema.topics.default,
  }
  const memories = new Map<string, string>()
  const scopes = new Map<string, string>()
  const indexes = new Map<string, string>()
  const records = new Map<string, TurnRecord[]>()

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
      const list = records.get(sessionId) ?? []
      list.push(record)
      records.set(sessionId, list)
    },
    async readRecords(sessionId: string) {
      return records.get(sessionId) ?? []
    },
    async assembleContext() {
      return {
        core: { ...core },
        memories: [],
        currentMemory: null,
        scope: null,
      }
    },
  }
}

async function main(): Promise<void> {
  section('Prepare Core Dependencies')

  const fs = new NodeFileSystemAdapter('./tmp/stello-agent-basic')
  const sessions = new SessionTreeImpl(fs) as unknown as SessionTree
  const memory = createInMemoryMemoryEngine()

  const root = await (sessions as SessionTreeImpl).createRoot('Main Session')
  print('root session', root)

  section('Prepare Agent Config')

  const demoConsolidateFn = async (_currentMemory: string | null, messages: Array<{ role: string; content: string; timestamp?: string }>) => {
    return `summary(${messages.length})`
  }
  const mockSessions = new Map<string, ReturnType<typeof createMockSession>>()
  mockSessions.set(root.id, createMockSession(root.id, demoConsolidateFn))

  const lifecycle: EngineLifecycleAdapter = {
    bootstrap: async () => ({
      context: await memory.assembleContext(''),
      session: await (sessions as SessionTreeImpl).get(root.id),
    }),
    assemble: async () => await memory.assembleContext(''),
    afterTurn: async () => ({
      coreUpdated: false,
      memoryUpdated: false,
      recordAppended: true,
    }),
    prepareChildSpawn: async (options) => {
      const child = await (sessions as SessionTreeImpl).createChild(options)
      mockSessions.set(child.id, createMockSession(child.id, demoConsolidateFn))
      return child
    },
  }

  const tools: EngineToolRuntime = {
    getToolDefinitions: () => [
      {
        name: 'stello_read_core',
        description: 'Read current core state',
        parameters: { type: 'object', properties: {} },
      },
    ],
    async executeTool() {
      return {
        success: true,
        data: await memory.readCore(),
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
    sessions,
    memory,
    session: {
      sessionLoader: async (sessionId) => {
        const session = mockSessions.get(sessionId)
        if (!session) {
          throw new Error(`Unknown session: ${sessionId}`)
        }
        return { session, config: null }
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
  }

  print('config shape', {
    hasSessions: Boolean(config.sessions),
    hasMemory: Boolean(config.memory),
    hasSessionLoader: Boolean(config.session?.sessionLoader),
    hasLifecycle: Boolean(config.capabilities.lifecycle),
    hasTools: Boolean(config.capabilities.tools),
    recyclePolicy: config.runtime?.recyclePolicy ?? null,
  })

  section('Create Agent')

  const agent = createStelloAgent(config)
  print('agent public surface', {
    methods: [
      'enterSession',
      'turn',
      'leaveSession',
      'forkSession',
      'archiveSession',
      'attachSession',
      'detachSession',
    ],
  })

  section('Interact With Root Session')

  const bootstrap = await agent.enterSession(root.id)
  print('bootstrap', bootstrap)

  const turn = await agent.turn(root.id, 'Continue with the task')
  print('turn', turn)

  section('Fork Child Session')

  const child = await agent.forkSession(root.id, {
    label: 'UI Exploration',
  })
  print('child', child)

  section('Attach / Detach Runtime')

  await agent.attachSession(root.id, 'demo-connection')
  print('runtime status after attach', {
    active: agent.hasActiveEngine(root.id),
    refCount: agent.getEngineRefCount(root.id),
  })

  await agent.detachSession(root.id, 'demo-connection')
  print('runtime status after detach', {
    active: agent.hasActiveEngine(root.id),
    refCount: agent.getEngineRefCount(root.id),
  })

  console.log('\nDemo finished.')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
