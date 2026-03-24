import { Hono } from 'hono'
import type { AuthEnv } from '../middleware/auth.js'
import type { SpaceManager } from '../../space/space-manager.js'
import type { AgentPool } from '../../space/agent-pool.js'

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
  spaceManager: SpaceManager,
  agentPool: AgentPool,
): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>()

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

  return app
}
