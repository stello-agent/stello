import { randomUUID } from 'node:crypto'
import type pg from 'pg'
import type { SessionTree, SessionMeta, CreateSessionOptions } from '@stello-ai/core'

/** Pool 或事务内的 PoolClient */
type PgClient = pg.Pool | pg.PoolClient

/** 当前时间 ISO 字符串 */
function now(): string {
  return new Date().toISOString()
}

/** 从 DB 行重建 core SessionMeta（含 children 和 refs） */
function rowToCoreSessionMeta(
  row: Record<string, unknown>,
  children: string[],
  refs: string[],
): SessionMeta {
  return {
    id: row['id'] as string,
    parentId: (row['parent_id'] as string) ?? null,
    children,
    refs,
    label: row['label'] as string,
    index: row['index'] as number,
    scope: (row['scope'] as string) ?? null,
    status: row['status'] as 'active' | 'archived',
    depth: row['depth'] as number,
    turnCount: row['turn_count'] as number,
    metadata: (row['metadata'] as Record<string, unknown>) ?? {},
    tags: (row['tags'] as string[]) ?? [],
    createdAt: (row['created_at'] as Date).toISOString(),
    updatedAt: (row['updated_at'] as Date).toISOString(),
    lastActiveAt: (row['last_active_at'] as Date).toISOString(),
  }
}

/**
 * PgSessionTree — 基于 PostgreSQL 的 SessionTree 实现
 * children 通过子查询派生，refs 通过 JOIN session_refs
 */
export class PgSessionTree implements SessionTree {
  constructor(
    private readonly client: PgClient,
    private readonly spaceId: string,
  ) {}

  /** 创建根 Session（不在接口中，创建 space 时调用） */
  async createRoot(label = 'Root'): Promise<SessionMeta> {
    const id = randomUUID()
    const ts = now()
    await this.client.query(
      `INSERT INTO sessions (id, space_id, parent_id, label, role, status, depth, "index", turn_count, tags, metadata, created_at, updated_at, last_active_at)
       VALUES ($1, $2, NULL, $3, 'main', 'active', 0, 0, 0, '{}', '{}', $4, $4, $4)`,
      [id, this.spaceId, label, ts],
    )
    return {
      id,
      parentId: null,
      children: [],
      refs: [],
      label,
      index: 0,
      scope: null,
      status: 'active',
      depth: 0,
      turnCount: 0,
      metadata: {},
      tags: [],
      createdAt: ts,
      updatedAt: ts,
      lastActiveAt: ts,
    }
  }

  /** 创建子 Session */
  async createChild(options: CreateSessionOptions): Promise<SessionMeta> {
    const parent = await this.requireSession(options.parentId)
    const id = randomUUID()
    const ts = now()

    // 计算在兄弟中的排序
    const { rows: countRows } = await this.client.query(
      'SELECT COUNT(*)::int AS cnt FROM sessions WHERE parent_id = $1 AND space_id = $2',
      [parent.id, this.spaceId],
    )
    const idx = (countRows[0]!['cnt'] as number) ?? 0

    const depth = parent.depth + 1
    await this.client.query(
      `INSERT INTO sessions (id, space_id, parent_id, label, role, status, scope, depth, "index", turn_count, tags, metadata, created_at, updated_at, last_active_at)
       VALUES ($1, $2, $3, $4, 'standard', 'active', $5, $6, $7, 0, $8, $9, $10, $10, $10)`,
      [
        id, this.spaceId, parent.id, options.label,
        options.scope ?? null, depth, idx,
        options.tags ?? [], JSON.stringify(options.metadata ?? {}),
        ts,
      ],
    )

    return {
      id,
      parentId: parent.id,
      children: [],
      refs: [],
      label: options.label,
      index: idx,
      scope: options.scope ?? null,
      status: 'active',
      depth,
      turnCount: 0,
      metadata: options.metadata ?? {},
      tags: options.tags ?? [],
      createdAt: ts,
      updatedAt: ts,
      lastActiveAt: ts,
    }
  }

  /** 获取单个 Session（含派生的 children 和 refs） */
  async get(id: string): Promise<SessionMeta | null> {
    const { rows } = await this.client.query(
      'SELECT * FROM sessions WHERE id = $1 AND space_id = $2',
      [id, this.spaceId],
    )
    if (rows.length === 0) return null
    const row = rows[0]!

    const children = await this.getChildIds(id)
    const refs = await this.getRefIds(id)

    return rowToCoreSessionMeta(row, children, refs)
  }

  /** 获取根 Session */
  async getRoot(): Promise<SessionMeta> {
    const { rows } = await this.client.query(
      'SELECT * FROM sessions WHERE parent_id IS NULL AND space_id = $1',
      [this.spaceId],
    )
    if (rows.length === 0) throw new Error('根 Session 不存在')
    const row = rows[0]!
    const children = await this.getChildIds(row['id'] as string)
    const refs = await this.getRefIds(row['id'] as string)
    return rowToCoreSessionMeta(row, children, refs)
  }

  /** 列出所有 Session */
  async listAll(): Promise<SessionMeta[]> {
    const { rows } = await this.client.query(
      'SELECT * FROM sessions WHERE space_id = $1 ORDER BY created_at ASC',
      [this.spaceId],
    )
    const result: SessionMeta[] = []
    for (const row of rows) {
      const id = row['id'] as string
      const children = await this.getChildIds(id)
      const refs = await this.getRefIds(id)
      result.push(rowToCoreSessionMeta(row, children, refs))
    }
    return result
  }

  /** 归档 Session */
  async archive(id: string): Promise<void> {
    await this.requireSession(id)
    await this.client.query(
      `UPDATE sessions SET status = 'archived', updated_at = $1
       WHERE id = $2 AND space_id = $3`,
      [now(), id, this.spaceId],
    )
  }

  /** 创建跨分支引用 */
  async addRef(fromId: string, toId: string): Promise<void> {
    if (fromId === toId) throw new Error('不能引用自己')
    await this.requireSession(fromId)
    await this.requireSession(toId)

    // 校验：不能引用直系祖先
    const ancestors = await this.getAncestors(fromId)
    if (ancestors.some(a => a.id === toId)) {
      throw new Error('不能引用直系祖先')
    }

    // 校验：不能引用直系后代
    const descendants = await this.getAllDescendantIds(fromId)
    if (descendants.has(toId)) {
      throw new Error('不能引用直系后代')
    }

    // 幂等插入
    await this.client.query(
      'INSERT INTO session_refs (from_id, to_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [fromId, toId],
    )
  }

  /** 更新 Session 元数据 */
  async updateMeta(
    id: string,
    updates: Partial<Pick<SessionMeta, 'label' | 'scope' | 'tags' | 'metadata' | 'turnCount'>>,
  ): Promise<SessionMeta> {
    const meta = await this.requireSession(id)

    const sets: string[] = ['updated_at = $1']
    const params: unknown[] = [now()]
    let idx = 2

    if (updates.label !== undefined) {
      sets.push(`label = $${idx}`)
      params.push(updates.label)
      idx++
    }
    if (updates.scope !== undefined) {
      sets.push(`scope = $${idx}`)
      params.push(updates.scope)
      idx++
    }
    if (updates.tags !== undefined) {
      sets.push(`tags = $${idx}`)
      params.push(updates.tags)
      idx++
    }
    if (updates.metadata !== undefined) {
      sets.push(`metadata = $${idx}`)
      params.push(JSON.stringify(updates.metadata))
      idx++
    }
    if (updates.turnCount !== undefined) {
      sets.push(`turn_count = $${idx}`)
      params.push(updates.turnCount)
      idx++
    }

    params.push(id, this.spaceId)
    await this.client.query(
      `UPDATE sessions SET ${sets.join(', ')} WHERE id = $${idx} AND space_id = $${idx + 1}`,
      params,
    )

    // 重新读取
    const updated = await this.requireSession(id)
    return updated
  }

  /** 获取所有祖先（从父到根） */
  async getAncestors(id: string): Promise<SessionMeta[]> {
    const { rows } = await this.client.query(
      `WITH RECURSIVE ancestors AS (
         SELECT * FROM sessions WHERE id = $1 AND space_id = $2
         UNION ALL
         SELECT s.* FROM sessions s JOIN ancestors a ON s.id = a.parent_id
       )
       SELECT * FROM ancestors WHERE id != $1 ORDER BY depth ASC`,
      [id, this.spaceId],
    )

    const result: SessionMeta[] = []
    for (const row of rows) {
      const rid = row['id'] as string
      const children = await this.getChildIds(rid)
      const refs = await this.getRefIds(rid)
      result.push(rowToCoreSessionMeta(row, children, refs))
    }
    return result
  }

  /** 获取同级兄弟节点 */
  async getSiblings(id: string): Promise<SessionMeta[]> {
    const meta = await this.requireSession(id)
    if (meta.parentId === null) return []

    const { rows } = await this.client.query(
      `SELECT * FROM sessions WHERE parent_id = $1 AND space_id = $2 AND id != $3
       ORDER BY "index" ASC`,
      [meta.parentId, this.spaceId, id],
    )

    const result: SessionMeta[] = []
    for (const row of rows) {
      const rid = row['id'] as string
      const children = await this.getChildIds(rid)
      const refs = await this.getRefIds(rid)
      result.push(rowToCoreSessionMeta(row, children, refs))
    }
    return result
  }

  /** 读取 Session，不存在则抛错 */
  private async requireSession(id: string): Promise<SessionMeta> {
    const session = await this.get(id)
    if (!session) throw new Error(`Session 不存在: ${id}`)
    return session
  }

  /** 获取子 Session ID 列表 */
  private async getChildIds(id: string): Promise<string[]> {
    const { rows } = await this.client.query(
      'SELECT id FROM sessions WHERE parent_id = $1 AND space_id = $2 ORDER BY "index" ASC',
      [id, this.spaceId],
    )
    return rows.map(r => r['id'] as string)
  }

  /** 获取引用 ID 列表 */
  private async getRefIds(id: string): Promise<string[]> {
    const { rows } = await this.client.query(
      'SELECT to_id FROM session_refs WHERE from_id = $1',
      [id],
    )
    return rows.map(r => r['to_id'] as string)
  }

  /** 递归获取所有后代 ID */
  private async getAllDescendantIds(id: string): Promise<Set<string>> {
    const { rows } = await this.client.query(
      `WITH RECURSIVE descendants AS (
         SELECT id FROM sessions WHERE parent_id = $1 AND space_id = $2
         UNION ALL
         SELECT s.id FROM sessions s JOIN descendants d ON s.parent_id = d.id
       )
       SELECT id FROM descendants`,
      [id, this.spaceId],
    )
    return new Set(rows.map(r => r['id'] as string))
  }
}
