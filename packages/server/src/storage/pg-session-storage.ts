import type pg from 'pg'
import type { SessionStorage, ListRecordsOptions } from '@stello-ai/session'
import type { SessionMeta } from '@stello-ai/session'
import type { Message } from '@stello-ai/session'

/** Pool 或事务内的 PoolClient */
type PgClient = pg.Pool | pg.PoolClient

/** 将 DB 行投影为 session 包的 SessionMeta（不含树字段） */
function rowToSessionMeta(row: Record<string, unknown>): SessionMeta {
  return {
    id: row['id'] as string,
    label: row['label'] as string,
    role: row['role'] as 'standard' | 'main',
    status: row['status'] as 'active' | 'archived',
    tags: (row['tags'] as string[]) ?? [],
    metadata: (row['metadata'] as Record<string, unknown>) ?? {},
    createdAt: (row['created_at'] as Date).toISOString(),
    updatedAt: (row['updated_at'] as Date).toISOString(),
  }
}

/** 将 DB 行投影为 Message */
function rowToMessage(row: Record<string, unknown>): Message {
  const msg: Message = {
    role: row['role'] as Message['role'],
    content: row['content'] as string,
  }
  if (row['tool_call_id']) msg.toolCallId = row['tool_call_id'] as string
  if (row['timestamp']) msg.timestamp = (row['timestamp'] as Date).toISOString()
  return msg
}

/**
 * PgSessionStorage — 基于 PostgreSQL 的 SessionStorage 实现
 * 所有查询通过 spaceId 隔离
 */
export class PgSessionStorage implements SessionStorage {
  constructor(
    protected readonly client: PgClient,
    protected readonly spaceId: string,
  ) {}

  /** 读取 Session 元数据 */
  async getSession(id: string): Promise<SessionMeta | null> {
    const { rows } = await this.client.query(
      'SELECT * FROM sessions WHERE id = $1 AND space_id = $2',
      [id, this.spaceId],
    )
    if (rows.length === 0) return null
    return rowToSessionMeta(rows[0]!)
  }

  /** 写入或更新 Session 元数据 */
  async putSession(session: SessionMeta): Promise<void> {
    await this.client.query(
      `INSERT INTO sessions (id, space_id, label, role, status, tags, metadata, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET
         label = EXCLUDED.label,
         role = EXCLUDED.role,
         status = EXCLUDED.status,
         tags = EXCLUDED.tags,
         metadata = EXCLUDED.metadata,
         updated_at = EXCLUDED.updated_at`,
      [
        session.id,
        this.spaceId,
        session.label,
        session.role,
        session.status,
        session.tags,
        JSON.stringify(session.metadata),
        session.createdAt,
        session.updatedAt,
      ],
    )
  }

  /** 追加一条对话记录 */
  async appendRecord(sessionId: string, record: Message): Promise<void> {
    await this.client.query(
      `INSERT INTO records (session_id, role, content, tool_call_id, "timestamp", metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        sessionId,
        record.role,
        record.content,
        record.toolCallId ?? null,
        record.timestamp ?? new Date().toISOString(),
        null,
      ],
    )
  }

  /** 读取对话记录列表 */
  async listRecords(sessionId: string, options?: ListRecordsOptions): Promise<Message[]> {
    let sql = 'SELECT * FROM records WHERE session_id = $1'
    const params: unknown[] = [sessionId]
    let paramIdx = 2

    if (options?.role) {
      sql += ` AND role = $${paramIdx}`
      params.push(options.role)
      paramIdx++
    }

    sql += ' ORDER BY id ASC'

    if (options?.limit !== undefined) {
      sql += ` LIMIT $${paramIdx}`
      params.push(options.limit)
      paramIdx++
    }

    if (options?.offset !== undefined) {
      sql += ` OFFSET $${paramIdx}`
      params.push(options.offset)
    }

    const { rows } = await this.client.query(sql, params)
    return rows.map(rowToMessage)
  }

  /** 裁剪旧 L3，保留最近 keepRecent 条 */
  async trimRecords(sessionId: string, keepRecent: number): Promise<void> {
    await this.client.query(
      `DELETE FROM records WHERE session_id = $1 AND id NOT IN (
        SELECT id FROM records WHERE session_id = $1 ORDER BY id DESC LIMIT $2
      )`,
      [sessionId, keepRecent],
    )
  }

  /** 读取 system prompt */
  async getSystemPrompt(sessionId: string): Promise<string | null> {
    return this.getSlot(sessionId, 'system_prompt')
  }

  /** 写入 system prompt */
  async putSystemPrompt(sessionId: string, content: string): Promise<void> {
    await this.putSlot(sessionId, 'system_prompt', content)
  }

  /** 读取 insight */
  async getInsight(sessionId: string): Promise<string | null> {
    return this.getSlot(sessionId, 'insight')
  }

  /** 写入 insight */
  async putInsight(sessionId: string, content: string): Promise<void> {
    await this.putSlot(sessionId, 'insight', content)
  }

  /** 清除 insight */
  async clearInsight(sessionId: string): Promise<void> {
    await this.client.query(
      `DELETE FROM session_data WHERE session_id = $1 AND key = 'insight'`,
      [sessionId],
    )
  }

  /** 读取 memory（L2 / synthesis） */
  async getMemory(sessionId: string): Promise<string | null> {
    return this.getSlot(sessionId, 'memory')
  }

  /** 写入 memory */
  async putMemory(sessionId: string, content: string): Promise<void> {
    await this.putSlot(sessionId, 'memory', content)
  }

  /** 在事务中执行操作 */
  async transaction<T>(fn: (tx: SessionStorage) => Promise<T>): Promise<T> {
    // 如果已经在事务中（client 是 PoolClient），直接执行
    if (!('connect' in this.client)) {
      return fn(this)
    }

    const pool = this.client as pg.Pool
    const txClient = await pool.connect()
    try {
      await txClient.query('BEGIN')
      const txStorage = new PgSessionStorage(txClient, this.spaceId)
      const result = await fn(txStorage)
      await txClient.query('COMMIT')
      return result
    } catch (err) {
      await txClient.query('ROLLBACK')
      throw err
    } finally {
      txClient.release()
    }
  }

  /** 读取 session_data 槽位 */
  protected async getSlot(sessionId: string, key: string): Promise<string | null> {
    const { rows } = await this.client.query(
      'SELECT content FROM session_data WHERE session_id = $1 AND key = $2',
      [sessionId, key],
    )
    if (rows.length === 0) return null
    return rows[0]!['content'] as string
  }

  /** 写入 session_data 槽位 */
  protected async putSlot(sessionId: string, key: string, content: string): Promise<void> {
    await this.client.query(
      `INSERT INTO session_data (session_id, key, content, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (session_id, key) DO UPDATE SET content = EXCLUDED.content, updated_at = now()`,
      [sessionId, key, content],
    )
  }
}
