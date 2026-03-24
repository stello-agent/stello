import type pg from 'pg'
import type { Space, SpaceConfig } from '../types.js'
import { PgSessionTree } from '../storage/pg-session-tree.js'

/**
 * SpaceManager — Space 生命周期管理
 * 创建 space 时自动创建 root session (role='main')
 */
export class SpaceManager {
  constructor(private readonly pool: pg.Pool) {}

  /** 创建 space（含 root session） */
  async createSpace(userId: string, config: SpaceConfig): Promise<Space> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')

      // 插入 space
      const { rows } = await client.query(
        `INSERT INTO spaces (user_id, label, system_prompt, consolidate_prompt, integrate_prompt, config)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          userId,
          config.label,
          config.systemPrompt ?? null,
          config.consolidatePrompt ?? null,
          config.integratePrompt ?? null,
          JSON.stringify(config.config ?? {}),
        ],
      )
      const spaceRow = rows[0]!
      const spaceId = spaceRow['id'] as string

      // 创建 root session
      const tree = new PgSessionTree(client, spaceId)
      const root = await tree.createRoot(config.label)

      // 如果有 system prompt，写入 root session 的 session_data
      if (config.systemPrompt) {
        await client.query(
          `INSERT INTO session_data (session_id, key, content) VALUES ($1, 'system_prompt', $2)`,
          [root.id, config.systemPrompt],
        )
      }

      await client.query('COMMIT')
      return this.rowToSpace(spaceRow)
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }

  /** 获取 space */
  async getSpace(spaceId: string): Promise<Space | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM spaces WHERE id = $1',
      [spaceId],
    )
    if (rows.length === 0) return null
    return this.rowToSpace(rows[0]!)
  }

  /** 更新 space 配置 */
  async updateSpace(spaceId: string, updates: Partial<SpaceConfig>): Promise<Space> {
    const sets: string[] = ['updated_at = now()']
    const params: unknown[] = []
    let idx = 1

    if (updates.label !== undefined) {
      sets.push(`label = $${idx}`)
      params.push(updates.label)
      idx++
    }
    if (updates.systemPrompt !== undefined) {
      sets.push(`system_prompt = $${idx}`)
      params.push(updates.systemPrompt)
      idx++
    }
    if (updates.consolidatePrompt !== undefined) {
      sets.push(`consolidate_prompt = $${idx}`)
      params.push(updates.consolidatePrompt)
      idx++
    }
    if (updates.integratePrompt !== undefined) {
      sets.push(`integrate_prompt = $${idx}`)
      params.push(updates.integratePrompt)
      idx++
    }
    if (updates.config !== undefined) {
      sets.push(`config = $${idx}`)
      params.push(JSON.stringify(updates.config))
      idx++
    }

    params.push(spaceId)
    const { rows } = await this.pool.query(
      `UPDATE spaces SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      params,
    )

    if (rows.length === 0) throw new Error(`Space 不存在: ${spaceId}`)

    // 如果更新了 system prompt，同步更新 root session 的 session_data
    if (updates.systemPrompt !== undefined) {
      const { rows: rootRows } = await this.pool.query(
        `SELECT id FROM sessions WHERE space_id = $1 AND parent_id IS NULL`,
        [spaceId],
      )
      if (rootRows.length > 0) {
        const rootId = rootRows[0]!['id'] as string
        await this.pool.query(
          `INSERT INTO session_data (session_id, key, content, updated_at)
           VALUES ($1, 'system_prompt', $2, now())
           ON CONFLICT (session_id, key) DO UPDATE SET content = EXCLUDED.content, updated_at = now()`,
          [rootId, updates.systemPrompt],
        )
      }
    }

    return this.rowToSpace(rows[0]!)
  }

  /** 列出用户的所有 space */
  async listSpaces(userId: string): Promise<Space[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM spaces WHERE user_id = $1 ORDER BY created_at ASC',
      [userId],
    )
    return rows.map(r => this.rowToSpace(r))
  }

  /** 删除 space（级联删除 sessions 等） */
  async deleteSpace(spaceId: string): Promise<void> {
    await this.pool.query('DELETE FROM spaces WHERE id = $1', [spaceId])
  }

  /** 将 DB 行转为 Space 对象 */
  private rowToSpace(row: Record<string, unknown>): Space {
    return {
      id: row['id'] as string,
      userId: row['user_id'] as string,
      label: row['label'] as string,
      systemPrompt: (row['system_prompt'] as string) ?? null,
      consolidatePrompt: (row['consolidate_prompt'] as string) ?? null,
      integratePrompt: (row['integrate_prompt'] as string) ?? null,
      config: (row['config'] as Record<string, unknown>) ?? {},
      createdAt: (row['created_at'] as Date).toISOString(),
      updatedAt: (row['updated_at'] as Date).toISOString(),
    }
  }
}
