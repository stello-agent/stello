import type { MiddlewareHandler } from 'hono'
import type pg from 'pg'

/** Hono 环境变量类型——认证中间件注入 userId */
export type AuthEnv = {
  Variables: {
    userId: string
  }
}

/** X-API-Key → userId 认证中间件 */
export function apiKeyAuth(pool: pg.Pool): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const apiKey = c.req.header('X-API-Key')
    if (!apiKey) {
      return c.json({ error: 'Missing API key' }, 401)
    }

    const { rows } = await pool.query(
      'SELECT id FROM users WHERE api_key = $1',
      [apiKey],
    )
    if (rows.length === 0) {
      return c.json({ error: 'Invalid API key' }, 401)
    }

    c.set('userId', rows[0]!['id'] as string)
    await next()
  }
}
