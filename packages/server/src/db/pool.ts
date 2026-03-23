import pg from 'pg'

/** 数据库连接池配置 */
export interface PoolOptions {
  /** PostgreSQL 连接字符串 */
  connectionString: string
  /** 最大连接数（默认 20） */
  max?: number
  /** 空闲连接超时毫秒（默认 30000） */
  idleTimeoutMillis?: number
}

/** 创建 pg.Pool 实例 */
export function createPool(options: PoolOptions): pg.Pool {
  return new pg.Pool({
    connectionString: options.connectionString,
    max: options.max ?? 20,
    idleTimeoutMillis: options.idleTimeoutMillis ?? 30_000,
  })
}
