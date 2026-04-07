import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest'
import type pg from 'pg'
import { AgentPool, type AgentPoolOptions } from '../space/agent-pool.js'
import { SpaceManager } from '../space/space-manager.js'
import { createTestPool, setupDatabase, cleanDatabase, createTestUser } from './helpers.js'

let pool: pg.Pool
let userId: string
let spaceManager: SpaceManager

/** 创建最小可用的 AgentPoolOptions（mock capabilities） */
function createPoolOptions(overrides?: Partial<AgentPoolOptions>): AgentPoolOptions {
  return {
    buildConfig: (ctx) => ({
      capabilities: {
        lifecycle: {
          bootstrap: async () => ({
            context: { core: {}, memories: [], currentMemory: null, scope: null },
            session: {
              id: '', label: '', scope: null, status: 'active' as const,
              turnCount: 0, metadata: {}, tags: [], createdAt: '', updatedAt: '', lastActiveAt: '',
            },
          }),
          afterTurn: async () => ({ coreUpdated: false, memoryUpdated: false, recordAppended: false }),
        },
        tools: {
          getToolDefinitions: () => [],
          executeTool: async () => ({ success: false, error: 'not implemented' }),
        },
        skills: {
          register: () => {},
          get: () => undefined,
          getAll: () => [],
        },
        confirm: {
          confirmSplit: async () => {
            throw new Error('not implemented')
          },
          dismissSplit: async () => {},
          confirmUpdate: async () => {},
          dismissUpdate: async () => {},
        },
      },
      session: {
        sessionResolver: async (sessionId) => {
          const { loadSession } = await import('@stello-ai/session')
          const session = await loadSession(sessionId, { storage: ctx.sessionStorage })
          if (!session) throw new Error(`Session not found: ${sessionId}`)
          return session
        },
        consolidateFn: async (currentMemory) => {
          return currentMemory ?? 'consolidated'
        },
      },
    }),
    idleTtlMs: 1000,
    ...overrides,
  }
}

beforeAll(async () => {
  pool = createTestPool()
  await setupDatabase(pool)
})

beforeEach(async () => {
  await cleanDatabase(pool)
  userId = await createTestUser(pool)
  spaceManager = new SpaceManager(pool)
})

afterAll(async () => {
  await pool.end()
})

describe('AgentPool', () => {
  let agentPool: AgentPool

  afterEach(() => {
    agentPool?.dispose()
  })

  it('懒创建 agent', async () => {
    const space = await spaceManager.createSpace(userId, { label: 'Test' })
    agentPool = new AgentPool(pool, createPoolOptions())

    expect(agentPool.size).toBe(0)
    const agent = await agentPool.getAgent(space.id)
    expect(agent).toBeDefined()
    expect(agentPool.size).toBe(1)
  })

  it('缓存命中，不重复创建', async () => {
    const space = await spaceManager.createSpace(userId, { label: 'Test' })
    agentPool = new AgentPool(pool, createPoolOptions())

    const agent1 = await agentPool.getAgent(space.id)
    const agent2 = await agentPool.getAgent(space.id)
    expect(agent1).toBe(agent2)
    expect(agentPool.size).toBe(1)
  })

  it('不同 space 创建不同 agent', async () => {
    const space1 = await spaceManager.createSpace(userId, { label: 'Space 1' })
    const space2 = await spaceManager.createSpace(userId, { label: 'Space 2' })
    agentPool = new AgentPool(pool, createPoolOptions())

    const agent1 = await agentPool.getAgent(space1.id)
    const agent2 = await agentPool.getAgent(space2.id)
    expect(agent1).not.toBe(agent2)
    expect(agentPool.size).toBe(2)
  })

  it('evict 清除缓存', async () => {
    const space = await spaceManager.createSpace(userId, { label: 'Test' })
    agentPool = new AgentPool(pool, createPoolOptions())

    await agentPool.getAgent(space.id)
    expect(agentPool.size).toBe(1)

    agentPool.evict(space.id)
    expect(agentPool.size).toBe(0)
  })

  it('dispose 清理所有', async () => {
    const space = await spaceManager.createSpace(userId, { label: 'Test' })
    agentPool = new AgentPool(pool, createPoolOptions())

    await agentPool.getAgent(space.id)
    agentPool.dispose()
    expect(agentPool.size).toBe(0)
  })

  it('Space 不存在时抛错', async () => {
    agentPool = new AgentPool(pool, createPoolOptions())
    await expect(agentPool.getAgent('00000000-0000-0000-0000-000000000000'))
      .rejects.toThrow('Space 不存在')
  })

  it('buildConfig 收到 space 对象', async () => {
    const space = await spaceManager.createSpace(userId, {
      label: 'WithPrompts',
      consolidatePrompt: 'Summarize.',
      integratePrompt: 'Synthesize.',
    })

    let receivedSpace: unknown = null
    agentPool = new AgentPool(pool, {
      ...createPoolOptions(),
      buildConfig: (ctx) => {
        receivedSpace = ctx.space
        return createPoolOptions().buildConfig(ctx)
      },
    })

    await agentPool.getAgent(space.id)
    expect(receivedSpace).not.toBeNull()
    expect((receivedSpace as { consolidatePrompt: string }).consolidatePrompt).toBe('Summarize.')
    expect((receivedSpace as { integratePrompt: string }).integratePrompt).toBe('Synthesize.')
  })

  it('有 llm + prompt 但无显式 fn 时自动注入默认', async () => {
    const space = await spaceManager.createSpace(userId, {
      label: 'AutoDefault',
      consolidatePrompt: 'Summarize the conversation.',
    })

    // buildConfig 不提供 consolidateFn
    agentPool = new AgentPool(pool, {
      buildConfig: (ctx) => {
        const base = createPoolOptions().buildConfig(ctx)
        return {
          ...base,
          session: {
            ...base.session,
            consolidateFn: undefined,
          },
        }
      },
      llm: async () => 'llm response',
      idleTtlMs: 1000,
    })

    // 不抛错即代表 agent 正常创建（含内置默认 consolidateFn）
    const agent = await agentPool.getAgent(space.id)
    expect(agent).toBeDefined()
  })

  it('buildConfig 显式 fn 优先于内置默认', async () => {
    const space = await spaceManager.createSpace(userId, {
      label: 'ExplicitOverride',
      consolidatePrompt: 'Summarize.',
    })

    const customFn = async () => 'custom result'
    let sessionConfigSeen = false

    agentPool = new AgentPool(pool, {
      buildConfig: (ctx) => {
        const base = createPoolOptions().buildConfig(ctx)
        sessionConfigSeen = true
        return {
          ...base,
          session: {
            ...base.session,
            consolidateFn: customFn,
          },
        }
      },
      llm: async () => 'should not be used',
      idleTtlMs: 1000,
    })

    const agent = await agentPool.getAgent(space.id)
    expect(agent).toBeDefined()
    expect(sessionConfigSeen).toBe(true)
  })
})
