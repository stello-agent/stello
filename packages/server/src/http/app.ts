import { Hono } from 'hono'
import type pg from 'pg'
import { apiKeyAuth, type AuthEnv } from './middleware/auth.js'
import { createSpaceRoutes } from './routes/spaces.js'
import { createSessionRoutes } from './routes/sessions.js'
import type { SpaceManager } from '../space/space-manager.js'
import type { AgentPool } from '../space/agent-pool.js'

/** 创建 Hono app 并挂载所有路由 */
export function createApp(
  pool: pg.Pool,
  spaceManager: SpaceManager,
  agentPool: AgentPool,
): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>()

  // 全局认证中间件
  app.use('*', apiKeyAuth(pool))

  // Space CRUD
  app.route('/spaces', createSpaceRoutes(pool, spaceManager, agentPool))

  // Session 路由（嵌套在 /spaces 下）
  app.route('/spaces', createSessionRoutes(pool, spaceManager, agentPool))

  // 全局错误处理
  app.onError((err, c) => {
    console.error('[StelloServer]', err)
    return c.json({ error: err.message ?? 'Internal Server Error' }, 500)
  })

  return app
}
