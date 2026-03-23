import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type pg from 'pg'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

/** 执行所有迁移文件（按文件名排序） */
export async function migrate(pool: pg.Pool): Promise<void> {
  const migrationsDir = join(__dirname, 'migrations')
  const files = readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort()

  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf-8')
    await pool.query(sql)
  }
}
