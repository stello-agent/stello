import { Hono } from 'hono'
import type { StelloAgent } from '@stello-ai/core'

/** 全局错误处理 */
function withErrorHandler(app: Hono): void {
  app.onError((err, c) => {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[devtools]', c.req.method, c.req.path, message)
    return c.json({ error: message }, 500)
  })
}

/** 创建 DevTools REST 路由 */
export function createRoutes(agent: StelloAgent, onEvent?: (event: { type: string; sessionId?: string; data?: Record<string, unknown> }) => void): Hono {
  const app = new Hono()
  withErrorHandler(app)

  /** 获取完整 session 树（递归 SessionTreeNode） */
  app.get('/sessions/tree', async (c) => {
    const tree = await agent.sessions.getTree()
    return c.json(tree)
  })

  /** 获取所有 session 列表（扁平 SessionMeta[]） */
  app.get('/sessions', async (c) => {
    const all = await agent.sessions.listAll()
    return c.json({ sessions: all })
  })

  /** 获取单个 session 元数据 */
  app.get('/sessions/:id', async (c) => {
    const id = c.req.param('id')
    const meta = await agent.sessions.get(id)
    if (!meta) return c.json({ error: 'Session not found' }, 404)
    return c.json(meta)
  })

  /** 获取单个 session 的拓扑节点 */
  app.get('/sessions/:id/node', async (c) => {
    const id = c.req.param('id')
    const node = await agent.sessions.getNode(id)
    if (!node) return c.json({ error: 'Node not found' }, 404)
    return c.json(node)
  })

  /** 获取 session 详细数据（L3/L2/scope） */
  app.get('/sessions/:id/detail', async (c) => {
    const id = c.req.param('id')
    const memory = agent.config.memory
    const [meta, records, l2, scope] = await Promise.all([
      agent.sessions.get(id),
      memory.readRecords(id).catch(() => []),
      memory.readMemory(id).catch(() => null),
      memory.readScope(id).catch(() => null),
    ])
    if (!meta) return c.json({ error: 'Session not found' }, 404)
    return c.json({ meta, records, l2, scope })
  })

  /** 手动触发 consolidation（L3 → L2） */
  app.post('/sessions/:id/consolidate', async (c) => {
    const id = c.req.param('id')
    const memory = agent.config.memory
    const consolidateFn = agent.config.session?.consolidateFn
    if (!consolidateFn) {
      return c.json({ error: 'No consolidateFn configured' }, 400)
    }
    const records = await memory.readRecords(id)
    if (records.length === 0) {
      return c.json({ error: 'No records to consolidate' }, 400)
    }
    const currentMemory = await memory.readMemory(id).catch(() => null)
    const messages = records.map((r) => ({ role: r.role, content: r.content, timestamp: r.timestamp }))
    onEvent?.({ type: 'consolidate.start', sessionId: id })
    const l2 = await consolidateFn(currentMemory, messages)
    await memory.writeMemory(id, l2)
    onEvent?.({ type: 'consolidate.done', sessionId: id, data: { l2Length: l2.length } })
    return c.json({ ok: true, l2 })
  })

  /** 进入 session */
  app.post('/sessions/:id/enter', async (c) => {
    const id = c.req.param('id')
    const result = await agent.enterSession(id)
    return c.json(result)
  })

  /** 非流式对话 */
  app.post('/sessions/:id/turn', async (c) => {
    const id = c.req.param('id')
    const { input } = await c.req.json<{ input: string }>()
    const result = await agent.turn(id, input)
    return c.json(result)
  })

  /** 离开 session */
  app.post('/sessions/:id/leave', async (c) => {
    const id = c.req.param('id')
    const result = await agent.leaveSession(id)
    return c.json(result)
  })

  /** Fork session */
  app.post('/sessions/:id/fork', async (c) => {
    const id = c.req.param('id')
    const options = await c.req.json<{ label: string; scope?: string }>()
    const child = await agent.forkSession(id, options)
    return c.json(child)
  })

  /** 归档 session */
  app.post('/sessions/:id/archive', async (c) => {
    const id = c.req.param('id')
    await agent.archiveSession(id)
    return c.json({ ok: true })
  })

  /** 获取 agent 配置（完整序列化） */
  app.get('/config', (c) => {
    const config = agent.config
    return c.json({
      orchestration: {
        strategy: config.orchestration?.strategy?.constructor?.name ?? 'MainSessionFlatStrategy',
      },
      runtime: {
        idleTtlMs: config.runtime?.recyclePolicy?.idleTtlMs ?? 0,
      },
      capabilities: {
        tools: config.capabilities.tools.getToolDefinitions(),
        skills: config.capabilities.skills.getAll().map((s) => ({
          name: s.name,
          description: s.description,
        })),
      },
      /* 标记哪些配置是 immutable 的（需重启才能生效） */
      immutable: ['orchestration.strategy', 'scheduling.trigger', 'splitGuard'],
    })
  })

  /** 更新 agent 配置 */
  app.patch('/config', async (c) => {
    const updates = await c.req.json<Record<string, unknown>>()
    const applied: string[] = []
    const needsRestart: string[] = []

    /* 调度策略——immutable，标记需重启 */
    if (updates['consolidationTrigger'] || updates['integrationTrigger'] ||
        updates['consolidationEveryN'] || updates['integrationEveryN']) {
      needsRestart.push('scheduling')
    }

    /* SplitGuard——immutable，标记需重启 */
    if (updates['minTurns'] !== undefined || updates['cooldownTurns'] !== undefined) {
      needsRestart.push('splitGuard')
    }

    /* Strategy——immutable */
    if (updates['strategy'] !== undefined) {
      needsRestart.push('orchestration.strategy')
    }

    /* idleTtlMs——可以动态修改 recyclePolicy */
    if (updates['idleTtlMs'] !== undefined) {
      applied.push('runtime.idleTtlMs')
    }

    return c.json({
      ok: true,
      applied,
      needsRestart,
      note: needsRestart.length > 0
        ? `These changes require agent restart to take effect: ${needsRestart.join(', ')}`
        : 'All changes applied.',
    })
  })

  return app
}
