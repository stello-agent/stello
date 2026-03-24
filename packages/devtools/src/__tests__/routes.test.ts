import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import { createRoutes } from '../server/routes.js'

/** 构建 mock agent（对齐真实 StelloAgent 接口） */
function createMockAgent() {
  return {
    sessions: {
      getRoot: vi.fn().mockResolvedValue({ id: 'root', label: 'Main', status: 'active', turnCount: 0, scope: null, tags: [], metadata: {}, createdAt: '', updatedAt: '', lastActiveAt: '' }),
      listAll: vi.fn().mockResolvedValue([
        { id: 'root', label: 'Main', status: 'active', turnCount: 0, scope: null, tags: [], metadata: {}, createdAt: '', updatedAt: '', lastActiveAt: '' },
        { id: 'sess-1', label: 'research', status: 'active', turnCount: 12, scope: null, tags: [], metadata: {}, createdAt: '', updatedAt: '', lastActiveAt: '' },
      ]),
      get: vi.fn().mockResolvedValue({ id: 'sess-1', label: 'research', status: 'active', turnCount: 12, scope: null, tags: [], metadata: {}, createdAt: '', updatedAt: '', lastActiveAt: '' }),
      getNode: vi.fn().mockResolvedValue({ id: 'sess-1', parentId: 'root', children: [], refs: [], depth: 1, index: 0, label: 'research' }),
      getTree: vi.fn().mockResolvedValue({ node: { id: 'root', parentId: null, children: ['sess-1'], refs: [], depth: 0, index: 0, label: 'Main' }, meta: { id: 'root', label: 'Main', status: 'active', turnCount: 0 }, children: [] }),
    },
    config: {
      memory: {
        readRecords: vi.fn().mockResolvedValue([]),
        readMemory: vi.fn().mockResolvedValue(null),
        readScope: vi.fn().mockResolvedValue(null),
      },
      orchestration: { strategy: { constructor: { name: 'MainSessionFlatStrategy' } } },
      capabilities: {
        tools: { getToolDefinitions: () => [{ name: 'search', description: 'Search papers', parameters: {} }] },
        skills: { getAll: () => [{ name: 'research', description: 'Research skill' }] },
      },
    },
    enterSession: vi.fn().mockResolvedValue({ context: {}, session: {} }),
    turn: vi.fn().mockResolvedValue({ turn: { finalContent: 'hello', toolRoundCount: 0, toolCallsExecuted: 0, rawResponse: 'hello' } }),
    leaveSession: vi.fn().mockResolvedValue({ sessionId: 'sess-1' }),
    forkSession: vi.fn().mockResolvedValue({ id: 'child-1', parentId: 'sess-1', label: 'fork', children: [], refs: [], depth: 2, index: 0 }),
    archiveSession: vi.fn().mockResolvedValue(undefined),
  }
}

describe('devtools REST routes', () => {
  it('GET /sessions 返回 session 列表', async () => {
    const agent = createMockAgent()
    const app = new Hono()
    app.route('/api', createRoutes(agent as never))

    const res = await app.request('/api/sessions')
    expect(res.status).toBe(200)
    const body = await res.json() as { sessions: unknown[] }
    expect(body.sessions).toHaveLength(2)
  })

  it('GET /sessions/tree 返回递归树', async () => {
    const agent = createMockAgent()
    const app = new Hono()
    app.route('/api', createRoutes(agent as never))

    const res = await app.request('/api/sessions/tree')
    expect(res.status).toBe(200)
    expect(agent.sessions.getTree).toHaveBeenCalled()
  })

  it('GET /sessions/:id 返回单个 session', async () => {
    const agent = createMockAgent()
    const app = new Hono()
    app.route('/api', createRoutes(agent as never))

    const res = await app.request('/api/sessions/sess-1')
    expect(res.status).toBe(200)
    const body = await res.json() as { id: string }
    expect(body.id).toBe('sess-1')
  })

  it('POST /sessions/:id/turn 调用 agent.turn', async () => {
    const agent = createMockAgent()
    const app = new Hono()
    app.route('/api', createRoutes(agent as never))

    const res = await app.request('/api/sessions/sess-1/turn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: 'hello' }),
    })
    expect(res.status).toBe(200)
    expect(agent.turn).toHaveBeenCalledWith('sess-1', 'hello')
  })

  it('POST /sessions/:id/fork 调用 agent.forkSession', async () => {
    const agent = createMockAgent()
    const app = new Hono()
    app.route('/api', createRoutes(agent as never))

    const res = await app.request('/api/sessions/sess-1/fork', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'new-fork' }),
    })
    expect(res.status).toBe(200)
    expect(agent.forkSession).toHaveBeenCalledWith('sess-1', { label: 'new-fork' })
  })

  it('GET /config 返回 agent 配置', async () => {
    const agent = createMockAgent()
    const app = new Hono()
    app.route('/api', createRoutes(agent as never))

    const res = await app.request('/api/config')
    expect(res.status).toBe(200)
    const body = await res.json() as { orchestration: { strategy: string }; capabilities: { tools: unknown[]; skills: unknown[] } }
    expect(body.orchestration.strategy).toBe('MainSessionFlatStrategy')
    expect(body.capabilities.tools).toHaveLength(1)
    expect(body.capabilities.skills).toHaveLength(1)
  })

  it('GET /sessions/:id/detail 返回详细数据', async () => {
    const agent = createMockAgent()
    const app = new Hono()
    app.route('/api', createRoutes(agent as never))

    const res = await app.request('/api/sessions/sess-1/detail')
    expect(res.status).toBe(200)
    const body = await res.json() as { meta: { id: string }; records: unknown[]; l2: null; scope: null }
    expect(body.meta.id).toBe('sess-1')
    expect(body.records).toEqual([])
  })
})
