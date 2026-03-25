import { Hono } from 'hono'
import type pg from 'pg'
import type { AuthEnv } from '../middleware/auth.js'
import type { SpaceManager } from '../../space/space-manager.js'
import type { AgentPool } from '../../space/agent-pool.js'
import { PgSessionStorage } from '../../storage/pg-session-storage.js'

/** 验证 space 所有权，返回 spaceId 或抛 Response */
async function requireOwnership(
  c: { get(key: 'userId'): string; json(data: unknown, status: number): Response },
  spaceManager: SpaceManager,
  spaceId: string,
): Promise<Response | null> {
  const userId = c.get('userId')
  const space = await spaceManager.getSpace(spaceId)
  if (!space) return c.json({ error: 'Space not found' }, 404)
  if (space.userId !== userId) return c.json({ error: 'Forbidden' }, 403)
  return null
}

/** 创建 Session 相关路由（嵌套在 /spaces/:spaceId 下） */
export function createSessionRoutes(
  pool: pg.Pool,
  spaceManager: SpaceManager,
  agentPool: AgentPool,
): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>()

  // ─── 拓扑查询（通过 agent.sessions） ───

  /** 获取 space 下的 session 树（递归嵌套结构） */
  app.get('/:spaceId/sessions', async (c) => {
    const spaceId = c.req.param('spaceId')
    const err = await requireOwnership(c, spaceManager, spaceId)
    if (err) return err

    const agent = await agentPool.getAgent(spaceId)
    const sessionTree = await agent.sessions.getTree()
    return c.json(sessionTree)
  })

  /** 获取单个 session */
  app.get('/:spaceId/sessions/:id', async (c) => {
    const spaceId = c.req.param('spaceId')
    const err = await requireOwnership(c, spaceManager, spaceId)
    if (err) return err

    const agent = await agentPool.getAgent(spaceId)
    const session = await agent.sessions.get(c.req.param('id'))
    if (!session) return c.json({ error: 'Session not found' }, 404)
    return c.json(session)
  })

  // ─── 对话操作（通过 agent） ───

  /** 获取 session 的对话记录 */
  app.get('/:spaceId/sessions/:id/messages', async (c) => {
    const spaceId = c.req.param('spaceId')
    const err = await requireOwnership(c, spaceManager, spaceId)
    if (err) return err

    const agent = await agentPool.getAgent(spaceId)
    const records = await agent.memory.readRecords(c.req.param('id'))
    return c.json(records)
  })

  /** 非流式对话 */
  app.post('/:spaceId/sessions/:id/turn', async (c) => {
    const spaceId = c.req.param('spaceId')
    const err = await requireOwnership(c, spaceManager, spaceId)
    if (err) return err

    const body = await c.req.json<{ input: string }>()
    if (!body.input) return c.json({ error: 'input is required' }, 400)

    const agent = await agentPool.getAgent(spaceId)
    const result = await agent.turn(c.req.param('id'), body.input)
    return c.json(result)
  })

  /** fork session */
  app.post('/:spaceId/sessions/:id/fork', async (c) => {
    const spaceId = c.req.param('spaceId')
    const err = await requireOwnership(c, spaceManager, spaceId)
    if (err) return err

    const body = await c.req.json<{ label: string; scope?: string }>()
    if (!body.label) return c.json({ error: 'label is required' }, 400)

    const agent = await agentPool.getAgent(spaceId)
    const child = await agent.forkSession(c.req.param('id'), {
      label: body.label,
      scope: body.scope,
    })
    return c.json(child, 201)
  })

  /** 归档 session */
  app.post('/:spaceId/sessions/:id/archive', async (c) => {
    const spaceId = c.req.param('spaceId')
    const err = await requireOwnership(c, spaceManager, spaceId)
    if (err) return err

    const agent = await agentPool.getAgent(spaceId)
    const result = await agent.archiveSession(c.req.param('id'))
    return c.json(result)
  })

  // ─── Session 数据管理（通过 PgSessionStorage） ───

  /** 获取 session 的 system prompt */
  app.get('/:spaceId/sessions/:id/system-prompt', async (c) => {
    const spaceId = c.req.param('spaceId')
    const err = await requireOwnership(c, spaceManager, spaceId)
    if (err) return err

    const storage = new PgSessionStorage(pool, spaceId)
    const content = await storage.getSystemPrompt(c.req.param('id'))
    return c.json({ content })
  })

  /** 更新 session 的 system prompt */
  app.put('/:spaceId/sessions/:id/system-prompt', async (c) => {
    const spaceId = c.req.param('spaceId')
    const err = await requireOwnership(c, spaceManager, spaceId)
    if (err) return err

    const body = await c.req.json<{ content: string }>()
    if (body.content === undefined) return c.json({ error: 'content is required' }, 400)

    const storage = new PgSessionStorage(pool, spaceId)
    await storage.putSystemPrompt(c.req.param('id'), body.content)
    return c.json({ content: body.content })
  })

  /** 获取 session 的 memory（子 Session = L2，Main Session = synthesis） */
  app.get('/:spaceId/sessions/:id/memory', async (c) => {
    const spaceId = c.req.param('spaceId')
    const err = await requireOwnership(c, spaceManager, spaceId)
    if (err) return err

    const storage = new PgSessionStorage(pool, spaceId)
    const content = await storage.getMemory(c.req.param('id'))
    return c.json({ content })
  })

  /** 获取 session 的 insight */
  app.get('/:spaceId/sessions/:id/insight', async (c) => {
    const spaceId = c.req.param('spaceId')
    const err = await requireOwnership(c, spaceManager, spaceId)
    if (err) return err

    const storage = new PgSessionStorage(pool, spaceId)
    const content = await storage.getInsight(c.req.param('id'))
    return c.json({ content })
  })

  /** 获取 session 的 consolidate prompt（per-session 粒度） */
  app.get('/:spaceId/sessions/:id/consolidate-prompt', async (c) => {
    const spaceId = c.req.param('spaceId')
    const err = await requireOwnership(c, spaceManager, spaceId)
    if (err) return err

    const content = await getSessionData(pool, c.req.param('id'), 'consolidate_prompt')
    return c.json({ content })
  })

  /** 设置 session 的 consolidate prompt */
  app.put('/:spaceId/sessions/:id/consolidate-prompt', async (c) => {
    const spaceId = c.req.param('spaceId')
    const err = await requireOwnership(c, spaceManager, spaceId)
    if (err) return err

    const body = await c.req.json<{ content: string }>()
    if (body.content === undefined) return c.json({ error: 'content is required' }, 400)

    await putSessionData(pool, c.req.param('id'), 'consolidate_prompt', body.content)
    return c.json({ content: body.content })
  })

  /** 获取 session 的 integrate prompt（通常用于 main session） */
  app.get('/:spaceId/sessions/:id/integrate-prompt', async (c) => {
    const spaceId = c.req.param('spaceId')
    const err = await requireOwnership(c, spaceManager, spaceId)
    if (err) return err

    const content = await getSessionData(pool, c.req.param('id'), 'integrate_prompt')
    return c.json({ content })
  })

  /** 设置 session 的 integrate prompt */
  app.put('/:spaceId/sessions/:id/integrate-prompt', async (c) => {
    const spaceId = c.req.param('spaceId')
    const err = await requireOwnership(c, spaceManager, spaceId)
    if (err) return err

    const body = await c.req.json<{ content: string }>()
    if (body.content === undefined) return c.json({ error: 'content is required' }, 400)

    await putSessionData(pool, c.req.param('id'), 'integrate_prompt', body.content)
    return c.json({ content: body.content })
  })

  return app
}

/** 读取 session_data 的通用方法 */
async function getSessionData(pool: pg.Pool, sessionId: string, key: string): Promise<string | null> {
  const { rows } = await pool.query(
    `SELECT content FROM session_data WHERE session_id = $1 AND key = $2`,
    [sessionId, key],
  )
  return (rows[0]?.['content'] as string) ?? null
}

/** 写入 session_data 的通用方法 */
async function putSessionData(pool: pg.Pool, sessionId: string, key: string, content: string): Promise<void> {
  await pool.query(
    `INSERT INTO session_data (session_id, key, content, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (session_id, key) DO UPDATE SET content = EXCLUDED.content, updated_at = now()`,
    [sessionId, key, content],
  )
}
