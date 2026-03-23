import type { Server as HttpServer } from 'node:http'
import { createApp } from './http/app.js'
import { SpaceManager } from './space/space-manager.js'
import { AgentPool } from './space/agent-pool.js'
import { migrate } from './db/migrate.js'
import { createWsGateway } from './ws/gateway.js'
import type { StelloServerOptions, StelloServer } from './types.js'

/** 创建 Stello Server 实例 */
export async function createStelloServer(options: StelloServerOptions): Promise<StelloServer> {
  const { pool, agentPoolOptions, skipMigrate } = options

  // 可选：执行数据库迁移
  if (!skipMigrate) {
    await migrate(pool)
  }

  const spaceManager = new SpaceManager(pool)
  const agentPool = new AgentPool(pool, agentPoolOptions)

  const app = createApp(pool, spaceManager, agentPool)

  return {
    app,
    spaceManager,
    agentPool,
    pool,
    async listen(port = 0) {
      const { serve } = await import('@hono/node-server')
      return new Promise((resolve) => {
        const server = serve({ fetch: app.fetch, port }, (info) => {
          // 附着 WS Gateway（@hono/node-server 默认返回 http.Server）
          createWsGateway(server as unknown as HttpServer, pool, spaceManager, agentPool)

          resolve({
            port: info.port,
            async close() {
              agentPool.dispose()
              server.close()
            },
          })
        })
      })
    },
  }
}
