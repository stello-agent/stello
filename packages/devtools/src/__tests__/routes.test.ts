import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import { createRoutes } from '../server/routes.js'

/** 构建 mock agent（对齐真实 StelloAgent 接口） */
function createMockAgent() {
  const config = {
    memory: {
      readRecords: vi.fn().mockResolvedValue([]),
      readMemory: vi.fn().mockResolvedValue(null),
      readScope: vi.fn().mockResolvedValue(null),
    },
    runtime: {
      recyclePolicy: {
        idleTtlMs: 0,
      },
    },
    orchestration: { strategy: { constructor: { name: 'MainSessionFlatStrategy' } } },
    capabilities: {
      tools: { getToolDefinitions: () => [{ name: 'search', description: 'Search papers', parameters: {} }] },
      skills: { getAll: () => [{ name: 'research', description: 'Research skill' }] },
    },
  }

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
    config,
    enterSession: vi.fn().mockResolvedValue({ context: {}, session: {} }),
    turn: vi.fn().mockResolvedValue({ turn: { finalContent: 'hello', toolRoundCount: 0, toolCallsExecuted: 0, rawResponse: 'hello' } }),
    leaveSession: vi.fn().mockResolvedValue({ sessionId: 'sess-1' }),
    forkSession: vi.fn().mockResolvedValue({ id: 'child-1', parentId: 'sess-1', label: 'fork', children: [], refs: [], depth: 2, index: 0 }),
    archiveSession: vi.fn().mockResolvedValue(undefined),
    updateConfig: vi.fn((patch: { runtime?: { idleTtlMs?: number } }) => {
      if (patch.runtime?.idleTtlMs !== undefined) {
        config.runtime.recyclePolicy.idleTtlMs = patch.runtime.idleTtlMs
      }
    }),
  }
}

describe('devtools REST routes', () => {
  it('GET /sessions 返回 session 列表', async () => {
    const agent = createMockAgent()
    const app = new Hono()
    app.route('/api', createRoutes(agent as never))

    const res = await app.request('/api/sessions')
    expect(res.status).toBe(200)
    const body = await res.json() as { sessions: Array<{ id: string }> }
    expect(body.sessions).toHaveLength(2)
    expect(body.sessions[0]?.id).toBe('root')
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
    expect(agent.turn).toHaveBeenCalledWith(
      'sess-1',
      'hello',
      expect.objectContaining({
        onToolCall: expect.any(Function),
        onToolResult: expect.any(Function),
      }),
    )
  })

  it('POST /sessions/:id/turn 返回非流式 tool call 明细', async () => {
    const agent = createMockAgent()
    agent.turn = vi.fn().mockImplementation(async (_sessionId: string, _input: string, options?: {
      onToolCall?: (toolCall: { id?: string; name: string; args: Record<string, unknown> }) => void
      onToolResult?: (result: { toolCallId: string | null; toolName: string; success: boolean; data: unknown; error: string | null }) => void
    }) => {
      options?.onToolCall?.({ id: 'call_1', name: 'search', args: { query: 'cs master us' } })
      options?.onToolResult?.({ toolCallId: 'call_1', toolName: 'search', success: true, data: { hits: 3 }, error: null })
      return { turn: { finalContent: 'done', toolRoundCount: 1, toolCallsExecuted: 1, rawResponse: 'done' } }
    })
    const app = new Hono()
    app.route('/api', createRoutes(agent as never))

    const res = await app.request('/api/sessions/sess-1/turn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: 'hello' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as {
      turn: {
        toolCalls?: Array<{ id: string; name: string; args: Record<string, unknown>; success?: boolean; data?: unknown }>
      }
    }
    expect(body.turn.toolCalls).toEqual([
      {
        id: 'call_1',
        name: 'search',
        args: { query: 'cs master us' },
        success: true,
        data: { hits: 3 },
        error: null,
        duration: expect.any(Number),
      },
    ])
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

  it('PATCH /config 调用 agent.updateConfig 并返回更新后的配置', async () => {
    const agent = createMockAgent()
    const app = new Hono()
    app.route('/api', createRoutes(agent as never))

    const res = await app.request('/api/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runtime: { idleTtlMs: 5000 } }),
    })
    expect(res.status).toBe(200)
    expect(agent.updateConfig).toHaveBeenCalledWith({ runtime: { idleTtlMs: 5000 } })
    const body = await res.json() as { ok: boolean; config: { orchestration: { strategy: string } } }
    expect(body.ok).toBe(true)
    expect(body.config.orchestration.strategy).toBe('MainSessionFlatStrategy')
  })

  it('PATCH /config 校验非法输入返回 400', async () => {
    const agent = createMockAgent()
    const app = new Hono()
    app.route('/api', createRoutes(agent as never))

    const res = await app.request('/api/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runtime: { idleTtlMs: -1 } }),
    })
    expect(res.status).toBe(400)
    expect(agent.updateConfig).not.toHaveBeenCalled()
  })

  it('PATCH /config 校验非法 trigger 值', async () => {
    const agent = createMockAgent()
    const app = new Hono()
    app.route('/api', createRoutes(agent as never))

    const res = await app.request('/api/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scheduling: { consolidation: { trigger: 'invalid' } } }),
    })
    expect(res.status).toBe(400)
  })

  it('GET /sessions/:id/detail 返回详细数据', async () => {
    const agent = createMockAgent()
    agent.config.memory.readRecords.mockResolvedValue([
      {
        role: 'assistant',
        content: '我先调研几个项目。',
        timestamp: '2026-03-28T12:00:02.000Z',
        metadata: {
          toolCalls: [{ id: 'tool_1', name: 'search_programs', input: { region: 'US', major: 'CS' } }],
        },
      },
    ])
    const app = new Hono()
    app.route('/api', createRoutes(agent as never))

    const res = await app.request('/api/sessions/sess-1/detail')
    expect(res.status).toBe(200)
    const body = await res.json() as {
      meta: { id: string }
      records: Array<{ metadata?: { toolCalls?: Array<{ id: string; name: string; input: Record<string, unknown> }> } }>
      l2: null
      scope: null
    }
    expect(body.meta.id).toBe('sess-1')
    expect(body.records[0]?.metadata?.toolCalls).toEqual([
      { id: 'tool_1', name: 'search_programs', input: { region: 'US', major: 'CS' } },
    ])
  })

  it('GET /sessions/:id/detail 优先返回 sessionAccess 的实时 scope', async () => {
    const agent = createMockAgent()
    const sessionAccess = {
      getSystemPrompt: vi.fn().mockResolvedValue(null),
      setSystemPrompt: vi.fn().mockResolvedValue(undefined),
      getScope: vi.fn().mockResolvedValue('live insight'),
    }
    const app = new Hono()
    app.route('/api', createRoutes(agent as never, undefined, undefined, undefined, undefined, sessionAccess))

    const res = await app.request('/api/sessions/sess-1/detail')
    expect(res.status).toBe(200)
    const body = await res.json() as { scope: string | null }
    expect(body.scope).toBe('live insight')
    expect(sessionAccess.getScope).toHaveBeenCalledWith('sess-1')
  })

  it('PATCH /prompts 会通过 stateStore 持久化当前 DevTools 状态', async () => {
    const agent = createMockAgent()
    const prompts = {
      current: { consolidate: 'old consolidate', integrate: 'old integrate' },
      getPrompts() {
        return this.current
      },
      setPrompts(next: { consolidate?: string; integrate?: string }) {
        this.current = {
          consolidate: next.consolidate ?? this.current.consolidate,
          integrate: next.integrate ?? this.current.integrate,
        }
      },
    }
    const llm = {
      getConfig: () => ({ model: 'gpt-4o', baseURL: 'https://api.example.com/v1', temperature: 0.7, maxTokens: 1024 }),
      setConfig: vi.fn(),
    }
    const tools = {
      getTools: () => [{ name: 'search', description: 'Search papers', enabled: true }],
      setEnabled: vi.fn(),
    }
    const skills = {
      getSkills: () => [{ name: 'research', description: 'Research skill', enabled: true }],
      setEnabled: vi.fn(),
    }
    const stateStore = {
      load: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockResolvedValue(undefined),
    }
    const app = new Hono()
    app.route('/api', createRoutes(agent as never, undefined, undefined, llm, prompts, undefined, tools, skills, undefined, undefined, stateStore))

    const res = await app.request('/api/prompts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ consolidate: 'new consolidate' }),
    })
    expect(res.status).toBe(200)
    expect(stateStore.save).toHaveBeenCalledWith(expect.objectContaining({
      prompts: expect.objectContaining({ consolidate: 'new consolidate', integrate: 'old integrate' }),
      disabledTools: [],
      disabledSkills: [],
    }))
  })

  it('PATCH /config 会通过 stateStore 持久化热更新配置', async () => {
    const agent = createMockAgent()
    const stateStore = {
      load: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockResolvedValue(undefined),
    }
    const app = new Hono()
    app.route('/api', createRoutes(agent as never, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, stateStore))

    const res = await app.request('/api/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runtime: { idleTtlMs: 5000 } }),
    })
    expect(res.status).toBe(200)
    expect(stateStore.save).toHaveBeenCalledWith(expect.objectContaining({
      hotConfig: expect.objectContaining({
        runtime: { idleTtlMs: 5000 },
      }),
    }))
  })

  it('POST /reset 会清空 stateStore 并调用 reset provider', async () => {
    const agent = createMockAgent()
    const reset = { reset: vi.fn().mockResolvedValue(undefined) }
    const stateStore = {
      load: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockResolvedValue(undefined),
      reset: vi.fn().mockResolvedValue(undefined),
    }
    const app = new Hono()
    app.route('/api', createRoutes(agent as never, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, reset, stateStore))

    const res = await app.request('/api/reset', { method: 'POST' })
    expect(res.status).toBe(200)
    expect(stateStore.reset).toHaveBeenCalledTimes(1)
    expect(reset.reset).toHaveBeenCalledTimes(1)
  })
})
