import { Hono } from 'hono'
import type pg from 'pg'
import type { AuthEnv } from '../middleware/auth.js'
import type { SpaceManager } from '../../space/space-manager.js'
import type { AgentPool } from '../../space/agent-pool.js'

/** 创建 Space CRUD 路由 */
export function createSpaceRoutes(
  pool: pg.Pool,
  spaceManager: SpaceManager,
  agentPool: AgentPool,
): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>()

  /** 创建 space */
  app.post('/', async (c) => {
    const userId = c.get('userId')
    const body = await c.req.json<{ label: string; systemPrompt?: string; consolidatePrompt?: string; integratePrompt?: string }>()

    if (!body.label) {
      return c.json({ error: 'label is required' }, 400)
    }

    const space = await spaceManager.createSpace(userId, {
      label: body.label,
      systemPrompt: body.systemPrompt,
      consolidatePrompt: body.consolidatePrompt,
      integratePrompt: body.integratePrompt,
    })
    return c.json(space, 201)
  })

  /** 列出用户的所有 spaces */
  app.get('/', async (c) => {
    const userId = c.get('userId')
    const spaces = await spaceManager.listSpaces(userId)
    return c.json(spaces)
  })

  /** 获取单个 space */
  app.get('/:spaceId', async (c) => {
    const userId = c.get('userId')
    const spaceId = c.req.param('spaceId')

    const space = await spaceManager.getSpace(spaceId)
    if (!space) return c.json({ error: 'Space not found' }, 404)
    if (space.userId !== userId) return c.json({ error: 'Forbidden' }, 403)

    return c.json(space)
  })

  /** 更新 space 配置 */
  app.patch('/:spaceId', async (c) => {
    const userId = c.get('userId')
    const spaceId = c.req.param('spaceId')

    const space = await spaceManager.getSpace(spaceId)
    if (!space) return c.json({ error: 'Space not found' }, 404)
    if (space.userId !== userId) return c.json({ error: 'Forbidden' }, 403)

    const body = await c.req.json<{ label?: string; systemPrompt?: string; consolidatePrompt?: string; integratePrompt?: string }>()
    const updated = await spaceManager.updateSpace(spaceId, body)
    return c.json(updated)
  })

  /** 删除 space */
  app.delete('/:spaceId', async (c) => {
    const userId = c.get('userId')
    const spaceId = c.req.param('spaceId')

    const space = await spaceManager.getSpace(spaceId)
    if (!space) return c.json({ error: 'Space not found' }, 404)
    if (space.userId !== userId) return c.json({ error: 'Forbidden' }, 403)

    await spaceManager.deleteSpace(spaceId)
    agentPool.evict(spaceId)
    return c.body(null, 204)
  })

  return app
}
