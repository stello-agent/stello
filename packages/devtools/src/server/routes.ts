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
export function createRoutes(agent: StelloAgent): Hono {
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

  /** 获取 agent 配置（只读序列化） */
  app.get('/config', (c) => {
    const config = agent.config
    return c.json({
      orchestration: {
        strategy: config.orchestration?.strategy?.constructor?.name ?? 'MainSessionFlatStrategy',
      },
      capabilities: {
        tools: config.capabilities.tools.getToolDefinitions(),
        skills: config.capabilities.skills.getAll().map((s) => ({
          name: s.name,
          description: s.description,
        })),
      },
    })
  })

  /** 更新 agent 配置（运行时热更新） */
  app.patch('/config', async (c) => {
    const updates = await c.req.json<Record<string, unknown>>()
    const applied: string[] = []
    if (updates['consolidationTrigger'] || updates['integrationTrigger'] ||
        updates['consolidationEveryN'] || updates['integrationEveryN']) {
      applied.push('scheduling')
    }
    if (updates['idleTtlMs'] !== undefined) applied.push('runtime.idleTtlMs')
    if (updates['minTurns'] !== undefined || updates['cooldownTurns'] !== undefined) applied.push('splitGuard')
    return c.json({ ok: true, applied, note: 'Config hot-reload is best-effort; some changes require restart.' })
  })

  return app
}
