import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** 生成测试用 UUID */
export function uuid(): string {
  return randomUUID()
}

/** 测试用 PG 连接字符串 */
const TEST_DATABASE_URL = process.env['TEST_DATABASE_URL']
  ?? 'postgresql://stello:stello@localhost:5432/stello_test'

/** 创建测试用连接池 */
export function createTestPool(): pg.Pool {
  return new pg.Pool({ connectionString: TEST_DATABASE_URL })
}

/** 执行迁移 + 清空数据（每个测试文件调用一次） */
export async function setupDatabase(pool: pg.Pool): Promise<void> {
  const migrationsDir = join(__dirname, '..', 'db', 'migrations')
  const files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf-8')
    await pool.query(sql)
  }
}

/** 清空所有表数据（每个测试用例前调用） */
export async function cleanDatabase(pool: pg.Pool): Promise<void> {
  await pool.query(`
    TRUNCATE users, spaces, sessions, records, session_data, session_refs, core_data CASCADE
  `)
}

/** 创建测试用 user，返回 userId */
export async function createTestUser(pool: pg.Pool, name = 'test-user'): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO users (api_key, name) VALUES ($1, $2) RETURNING id`,
    [`test-key-${Date.now()}-${Math.random()}`, name],
  )
  return rows[0]!['id'] as string
}

/** 创建测试用 user，返回 { userId, apiKey } */
export async function createTestUserWithKey(pool: pg.Pool, name = 'test-user'): Promise<{ userId: string; apiKey: string }> {
  const apiKey = `test-key-${uuid()}`
  const { rows } = await pool.query(
    `INSERT INTO users (api_key, name) VALUES ($1, $2) RETURNING id`,
    [apiKey, name],
  )
  return { userId: rows[0]!['id'] as string, apiKey }
}

/** 创建测试用 space，返回 spaceId */
export async function createTestSpace(pool: pg.Pool, userId: string, label = 'test-space'): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO spaces (user_id, label) VALUES ($1, $2) RETURNING id`,
    [userId, label],
  )
  return rows[0]!['id'] as string
}
