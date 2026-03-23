import type pg from 'pg'
import type { AgentPoolOptions } from './space/agent-pool.js'
import type { SpaceManager } from './space/space-manager.js'
import type { AgentPool } from './space/agent-pool.js'
import type { Hono } from 'hono'
import type { AuthEnv } from './http/middleware/auth.js'

/** Space 配置（创建 / 更新时使用） */
export interface SpaceConfig {
  label: string
  systemPrompt?: string
  consolidatePrompt?: string
  config?: Record<string, unknown>
}

/** Space 完整数据 */
export interface Space {
  id: string
  userId: string
  label: string
  systemPrompt: string | null
  consolidatePrompt: string | null
  config: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

/** createStelloServer 配置 */
export interface StelloServerOptions {
  pool: pg.Pool
  agentPoolOptions: AgentPoolOptions
  /** 跳过数据库迁移（测试或已迁移场景） */
  skipMigrate?: boolean
}

/** createStelloServer 返回值 */
export interface StelloServer {
  /** Hono app 实例（可用 app.request() 测试） */
  app: Hono<AuthEnv>
  /** 启动 HTTP + WS 服务 */
  listen(port?: number): Promise<{ port: number; close: () => Promise<void> }>
  /** Space 管理器 */
  spaceManager: SpaceManager
  /** Agent 池 */
  agentPool: AgentPool
  /** PG 连接池 */
  pool: pg.Pool
}
