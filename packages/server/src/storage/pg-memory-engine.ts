import type pg from 'pg'
import type { MemoryEngine, TurnRecord, AssembledContext } from '@stello-ai/core'

/** Pool 或事务内的 PoolClient */
type PgClient = pg.Pool | pg.PoolClient

/**
 * PgMemoryEngine — 基于 PostgreSQL 的 MemoryEngine 实现
 * 使用 session_data、core_data、records 表存储记忆数据
 */
export class PgMemoryEngine implements MemoryEngine {
  constructor(
    private readonly client: PgClient,
    private readonly spaceId: string,
  ) {}

  /** 读取 L1 核心档案 */
  async readCore(path?: string): Promise<unknown> {
    if (path) {
      const { rows } = await this.client.query(
        'SELECT value FROM core_data WHERE space_id = $1 AND path = $2',
        [this.spaceId, path],
      )
      if (rows.length === 0) return null
      return rows[0]!['value']
    }
    // 无 path 时返回整个 core 对象
    const { rows } = await this.client.query(
      'SELECT path, value FROM core_data WHERE space_id = $1',
      [this.spaceId],
    )
    const result: Record<string, unknown> = {}
    for (const row of rows) {
      result[row['path'] as string] = row['value']
    }
    return result
  }

  /** 写入 L1 核心档案的某个字段 */
  async writeCore(path: string, value: unknown): Promise<void> {
    await this.client.query(
      `INSERT INTO core_data (space_id, path, value)
       VALUES ($1, $2, $3)
       ON CONFLICT (space_id, path) DO UPDATE SET value = EXCLUDED.value`,
      [this.spaceId, path, JSON.stringify(value)],
    )
  }

  /** 读取某 Session 的 memory.md */
  async readMemory(sessionId: string): Promise<string | null> {
    return this.getSlot(sessionId, 'memory')
  }

  /** 写入某 Session 的 memory.md */
  async writeMemory(sessionId: string, content: string): Promise<void> {
    await this.putSlot(sessionId, 'memory', content)
  }

  /** 读取某 Session 的 scope.md */
  async readScope(sessionId: string): Promise<string | null> {
    return this.getSlot(sessionId, 'scope')
  }

  /** 写入某 Session 的 scope.md */
  async writeScope(sessionId: string, content: string): Promise<void> {
    await this.putSlot(sessionId, 'scope', content)
  }

  /** 读取某 Session 的 index.md */
  async readIndex(sessionId: string): Promise<string | null> {
    return this.getSlot(sessionId, 'index')
  }

  /** 写入某 Session 的 index.md */
  async writeIndex(sessionId: string, content: string): Promise<void> {
    await this.putSlot(sessionId, 'index', content)
  }

  /** 追加一条 L3 对话记录 */
  async appendRecord(sessionId: string, record: TurnRecord): Promise<void> {
    await this.client.query(
      `INSERT INTO records (session_id, role, content, "timestamp", metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        sessionId,
        record.role,
        record.content,
        record.timestamp,
        record.metadata ? JSON.stringify(record.metadata) : null,
      ],
    )
  }

  /** 读取某 Session 的所有 L3 对话记录 */
  async readRecords(sessionId: string): Promise<TurnRecord[]> {
    const { rows } = await this.client.query(
      'SELECT role, content, "timestamp", metadata FROM records WHERE session_id = $1 ORDER BY id ASC',
      [sessionId],
    )
    return rows.map(r => ({
      role: r['role'] as TurnRecord['role'],
      content: r['content'] as string,
      timestamp: (r['timestamp'] as Date).toISOString(),
      metadata: r['metadata'] as Record<string, unknown> | undefined,
    }))
  }

  /** 按继承策略组装上下文 */
  async assembleContext(sessionId: string): Promise<AssembledContext> {
    // 读取 L1
    const core = (await this.readCore()) as Record<string, unknown> ?? {}

    // 收集父链 memory（从直接父到根）
    const memories: string[] = []
    const { rows: ancestorRows } = await this.client.query(
      `WITH RECURSIVE ancestors AS (
         SELECT id, parent_id FROM sessions WHERE id = $1 AND space_id = $2
         UNION ALL
         SELECT s.id, s.parent_id FROM sessions s JOIN ancestors a ON s.id = a.parent_id
       )
       SELECT a.id FROM ancestors a WHERE a.id != $1 ORDER BY (
         SELECT depth FROM sessions WHERE id = a.id
       ) DESC`,
      [sessionId, this.spaceId],
    )
    for (const row of ancestorRows) {
      const mem = await this.getSlot(row['id'] as string, 'memory')
      if (mem) memories.push(mem)
    }

    // 当前 Session 的 memory
    const currentMemory = await this.getSlot(sessionId, 'memory')

    // 当前 Session 的 scope
    const scope = await this.getSlot(sessionId, 'scope')

    return { core, memories, currentMemory, scope }
  }

  /** 读取 session_data 槽位 */
  private async getSlot(sessionId: string, key: string): Promise<string | null> {
    const { rows } = await this.client.query(
      'SELECT content FROM session_data WHERE session_id = $1 AND key = $2',
      [sessionId, key],
    )
    if (rows.length === 0) return null
    return rows[0]!['content'] as string
  }

  /** 写入 session_data 槽位 */
  private async putSlot(sessionId: string, key: string, content: string): Promise<void> {
    await this.client.query(
      `INSERT INTO session_data (session_id, key, content, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (session_id, key) DO UPDATE SET content = EXCLUDED.content, updated_at = now()`,
      [sessionId, key, content],
    )
  }
}
