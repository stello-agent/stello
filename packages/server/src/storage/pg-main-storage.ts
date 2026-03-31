import type pg from 'pg'
import type { MainStorage, TopologyNode } from '@stello-ai/session'
import type { SessionMeta, SessionFilter } from '@stello-ai/session'
import type { ChildL2Summary, EventEnvelope } from '@stello-ai/session'
import { PgSessionStorage } from './pg-session-storage.js'

/**
 * PgMainStorage — 基于 PostgreSQL 的 MainStorage 实现
 * 继承 PgSessionStorage，额外提供批量 L2 收集、拓扑树、Session 列举、全局键值
 */
export class PgMainStorage extends PgSessionStorage implements MainStorage {
  constructor(client: pg.Pool | pg.PoolClient, spaceId: string) {
    super(client, spaceId)
  }

  /** 批量获取所有子 Session 的 L2（integration 专用） */
  async getAllSessionL2s(): Promise<ChildL2Summary[]> {
    const { rows } = await this.client.query(
      `SELECT
         s.id AS "sessionId",
         s.label,
         COALESCE(ev.content, sd.content) AS l2,
         COALESCE(ev.id, 0) AS sequence,
         ev.event_timestamp AS "timestamp"
       FROM sessions s
       LEFT JOIN LATERAL (
         SELECT id, content, event_timestamp
         FROM session_events
         WHERE space_id = $1 AND stream = 'memory' AND session_id = s.id
         ORDER BY id DESC
         LIMIT 1
       ) ev ON TRUE
       LEFT JOIN session_data sd ON s.id = sd.session_id AND sd.key = 'memory'
       WHERE s.space_id = $1 AND s.role = 'standard' AND s.status = 'active'
         AND (ev.id IS NOT NULL OR sd.content IS NOT NULL)`,
      [this.spaceId],
    )
    return rows.map(r => ({
      sessionId: r['sessionId'] as string,
      label: r['label'] as string,
      l2: r['l2'] as string,
      sequence: Number(r['sequence']),
      timestamp: r['timestamp'] ? (r['timestamp'] as Date).toISOString() : '',
    }))
  }

  /** 读取指定序号之后的 memory 事件。 */
  async listMemoryEvents(afterSequence = 0, limit?: number): Promise<EventEnvelope[]> {
    const params: Array<string | number> = [this.spaceId, afterSequence]
    let sql = `SELECT id, session_id AS "sessionId", content, event_timestamp AS "timestamp"
       FROM session_events
       WHERE space_id = $1 AND stream = 'memory' AND id > $2
       ORDER BY id ASC`

    if (limit !== undefined) {
      sql += ' LIMIT $3'
      params.push(limit)
    }

    const { rows } = await this.client.query(sql, params)
    return rows.map((row) => ({
      sessionId: row['sessionId'] as string,
      sequence: Number(row['id']),
      content: row['content'] as string,
      timestamp: (row['timestamp'] as Date).toISOString(),
    }))
  }

  /** 读取 MainSession 的 integration cursor。 */
  async getIntegrationCursor(sessionId: string): Promise<number> {
    const { rows } = await this.client.query(
      'SELECT value FROM core_data WHERE space_id = $1 AND path = $2',
      [this.spaceId, `integration_cursor:${sessionId}`],
    )
    if (rows.length === 0) return 0
    return Number(rows[0]!['value'])
  }

  /** 更新 MainSession 的 integration cursor。 */
  async setIntegrationCursor(sessionId: string, sequence: number): Promise<void> {
    await this.client.query(
      `INSERT INTO core_data (space_id, path, value)
       VALUES ($1, $2, $3)
       ON CONFLICT (space_id, path) DO UPDATE SET value = EXCLUDED.value`,
      [this.spaceId, `integration_cursor:${sessionId}`, JSON.stringify(sequence)],
    )
  }

  /** 列举 Session，可按条件过滤 */
  async listSessions(filter?: SessionFilter): Promise<SessionMeta[]> {
    let sql = 'SELECT * FROM sessions WHERE space_id = $1'
    const params: unknown[] = [this.spaceId]
    let idx = 2

    if (filter?.status) {
      sql += ` AND status = $${idx}`
      params.push(filter.status)
      idx++
    }
    if (filter?.role) {
      sql += ` AND role = $${idx}`
      params.push(filter.role)
      idx++
    }
    if (filter?.tags && filter.tags.length > 0) {
      sql += ` AND tags @> $${idx}`
      params.push(filter.tags)
      idx++
    }

    sql += ' ORDER BY created_at ASC'

    const { rows } = await this.client.query(sql, params)
    return rows.map(r => ({
      id: r['id'] as string,
      label: r['label'] as string,
      role: r['role'] as 'standard' | 'main',
      status: r['status'] as 'active' | 'archived',
      tags: (r['tags'] as string[]) ?? [],
      metadata: (r['metadata'] as Record<string, unknown>) ?? {},
      createdAt: (r['created_at'] as Date).toISOString(),
      updatedAt: (r['updated_at'] as Date).toISOString(),
    }))
  }

  /** 添加拓扑树节点（从 sessions 表派生，实际是 upsert session 的 parent_id + label） */
  async putNode(node: TopologyNode): Promise<void> {
    // TopologyNode 是 sessions 表的投影，putNode 仅更新 parent_id 和 label
    await this.client.query(
      `UPDATE sessions SET parent_id = $1, label = $2, updated_at = now()
       WHERE id = $3 AND space_id = $4`,
      [node.parentId, node.label, node.id, this.spaceId],
    )
  }

  /** 获取某节点的直接子节点 */
  async getChildren(parentId: string): Promise<TopologyNode[]> {
    const { rows } = await this.client.query(
      `SELECT id, parent_id AS "parentId", label FROM sessions
       WHERE parent_id = $1 AND space_id = $2
       ORDER BY "index" ASC`,
      [parentId, this.spaceId],
    )
    return rows.map(r => ({
      id: r['id'] as string,
      parentId: r['parentId'] as string | null,
      label: r['label'] as string,
    }))
  }

  /** 删除拓扑树节点（将 parent_id 设为 null，不删除 session） */
  async removeNode(nodeId: string): Promise<void> {
    await this.client.query(
      `UPDATE sessions SET parent_id = NULL, updated_at = now()
       WHERE id = $1 AND space_id = $2`,
      [nodeId, this.spaceId],
    )
  }

  /** 读取全局键值 */
  async getGlobal(key: string): Promise<unknown> {
    const { rows } = await this.client.query(
      'SELECT value FROM core_data WHERE space_id = $1 AND path = $2',
      [this.spaceId, key],
    )
    if (rows.length === 0) return null
    return rows[0]!['value']
  }

  /** 写入全局键值 */
  async putGlobal(key: string, value: unknown): Promise<void> {
    await this.client.query(
      `INSERT INTO core_data (space_id, path, value)
       VALUES ($1, $2, $3)
       ON CONFLICT (space_id, path) DO UPDATE SET value = EXCLUDED.value`,
      [this.spaceId, key, JSON.stringify(value)],
    )
  }
}
