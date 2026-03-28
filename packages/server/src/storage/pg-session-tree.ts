import { randomUUID } from 'node:crypto'
import type pg from 'pg'
import type { SessionTree, SessionMeta, TopologyNode, SessionTreeNode, CreateSessionOptions } from '@stello-ai/core'

/** Pool 或事务内的 PoolClient */
type PgClient = pg.Pool | pg.PoolClient

/** 当前时间 ISO 字符串 */
function now(): string {
  return new Date().toISOString()
}

/** 从 DB 行投影为 SessionMeta（不含树字段） */
function rowToSessionMeta(row: Record<string, unknown>): SessionMeta {
  return {
    id: row['id'] as string,
    label: row['label'] as string,
    scope: (row['scope'] as string) ?? null,
    status: row['status'] as 'active' | 'archived',
    turnCount: row['turn_count'] as number,
    metadata: (row['metadata'] as Record<string, unknown>) ?? {},
    tags: (row['tags'] as string[]) ?? [],
    createdAt: (row['created_at'] as Date).toISOString(),
    updatedAt: (row['updated_at'] as Date).toISOString(),
    lastActiveAt: (row['last_active_at'] as Date).toISOString(),
  }
}

/** 从 DB 行 + 派生数据投影为 TopologyNode */
function rowToTopologyNode(
  row: Record<string, unknown>,
  children: string[],
  refs: string[],
): TopologyNode {
  return {
    id: row['id'] as string,
    parentId: (row['parent_id'] as string) ?? null,
    children,
    refs,
    depth: row['depth'] as number,
    index: row['index'] as number,
    label: row['label'] as string,
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
  async createRoot(label = 'Root'): Promise<TopologyNode> {
    const id = randomUUID()
    const ts = now()
    await this.client.query(
      `INSERT INTO sessions (id, space_id, parent_id, label, role, status, depth, "index", turn_count, tags, metadata, created_at, updated_at, last_active_at)
       VALUES ($1, $2, NULL, $3, 'main', 'active', 0, 0, 0, '{}', '{}', $4, $4, $4)`,
      [id, this.spaceId, label, ts],
    )
    return { id, parentId: null, children: [], refs: [], depth: 0, index: 0, label }
  }

  /** 创建子 Session */
  async createChild(options: CreateSessionOptions): Promise<TopologyNode> {
    await this.requireRow(options.parentId)
    const parentRow = await this.getRow(options.parentId)
    if (!parentRow) throw new Error(`Session 不存在: ${options.parentId}`)

    const id = randomUUID()
    const ts = now()

    // 计算在兄弟中的排序
    const { rows: countRows } = await this.client.query(
      'SELECT COUNT(*)::int AS cnt FROM sessions WHERE parent_id = $1 AND space_id = $2',
      [options.parentId, this.spaceId],
    )
    const idx = (countRows[0]!['cnt'] as number) ?? 0
    const depth = (parentRow['depth'] as number) + 1

    await this.client.query(
      `INSERT INTO sessions (id, space_id, parent_id, label, role, status, scope, depth, "index", turn_count, tags, metadata, created_at, updated_at, last_active_at)
       VALUES ($1, $2, $3, $4, 'standard', 'active', $5, $6, $7, 0, $8, $9, $10, $10, $10)`,
      [
        id, this.spaceId, options.parentId, options.label,
        options.scope ?? null, depth, idx,
        options.tags ?? [], JSON.stringify(options.metadata ?? {}),
        ts,
      ],
    )

    return {
      id,
      parentId: options.parentId,
      children: [],
      refs: [],
      depth,
      index: idx,
      label: options.label,
    }
  }

  /** 获取单个 Session 元数据 */
  async get(id: string): Promise<SessionMeta | null> {
    const row = await this.getRow(id)
    if (!row) return null
    return rowToSessionMeta(row)
  }

  /** 获取根 Session */
  async getRoot(): Promise<SessionMeta> {
    const { rows } = await this.client.query(
      'SELECT * FROM sessions WHERE parent_id IS NULL AND space_id = $1',
      [this.spaceId],
    )
    if (rows.length === 0) throw new Error('根 Session 不存在')
    return rowToSessionMeta(rows[0]!)
  }

  /** 列出所有 Session */
  async listAll(): Promise<SessionMeta[]> {
    const { rows } = await this.client.query(
      'SELECT * FROM sessions WHERE space_id = $1 ORDER BY created_at ASC',
      [this.spaceId],
    )
    return rows.map(row => rowToSessionMeta(row))
  }

  /** 归档 Session */
  async archive(id: string): Promise<void> {
    await this.requireRow(id)
    await this.client.query(
      `UPDATE sessions SET status = 'archived', updated_at = $1
       WHERE id = $2 AND space_id = $3`,
      [now(), id, this.spaceId],
    )
  }

  /** 创建跨分支引用 */
  async addRef(fromId: string, toId: string): Promise<void> {
    if (fromId === toId) throw new Error('不能引用自己')
    await this.requireRow(fromId)
    await this.requireRow(toId)

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
    await this.requireRow(id)

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
    const row = await this.getRow(id)
    if (!row) throw new Error(`Session 不存在: ${id}`)
    return rowToSessionMeta(row)
  }

  /** 获取单个拓扑节点 */
  async getNode(id: string): Promise<TopologyNode | null> {
    const row = await this.getRow(id)
    if (!row) return null
    const children = await this.getChildIds(id)
    const refs = await this.getRefIds(id)
    return rowToTopologyNode(row, children, refs)
  }

  /** 获取完整递归树 */
  async getTree(): Promise<SessionTreeNode> {
    const { rows } = await this.client.query(
      'SELECT id, parent_id, label, status, turn_count, metadata FROM sessions WHERE space_id = $1 ORDER BY depth ASC, "index" ASC',
      [this.spaceId],
    )

    const nodeMap = new Map<string, SessionTreeNode>()
    let root: SessionTreeNode | null = null

    for (const row of rows) {
      const node: SessionTreeNode = {
        id: row['id'] as string,
        label: row['label'] as string,
        sourceSessionId: typeof (row['metadata'] as Record<string, unknown> | null)?.['sourceSessionId'] === 'string'
          ? (row['metadata'] as Record<string, unknown>)['sourceSessionId'] as string
          : undefined,
        status: row['status'] as 'active' | 'archived',
        turnCount: (row['turn_count'] as number) ?? 0,
        children: [],
      }
      nodeMap.set(node.id, node)

      const parentId = row['parent_id'] as string | null
      if (parentId === null) {
        root = node
      } else {
        const parent = nodeMap.get(parentId)
        if (parent) parent.children.push(node)
      }
    }

    if (!root) throw new Error('根 Session 不存在')
    return root
  }

  /** 获取所有祖先节点（从父到根） */
  async getAncestors(id: string): Promise<TopologyNode[]> {
    const { rows } = await this.client.query(
      `WITH RECURSIVE ancestors AS (
         SELECT * FROM sessions WHERE id = $1 AND space_id = $2
         UNION ALL
         SELECT s.* FROM sessions s JOIN ancestors a ON s.id = a.parent_id
       )
       SELECT * FROM ancestors WHERE id != $1 ORDER BY depth ASC`,
      [id, this.spaceId],
    )

    const result: TopologyNode[] = []
    for (const row of rows) {
      const rid = row['id'] as string
      const children = await this.getChildIds(rid)
      const refs = await this.getRefIds(rid)
      result.push(rowToTopologyNode(row, children, refs))
    }
    return result
  }

  /** 获取同级兄弟节点 */
  async getSiblings(id: string): Promise<TopologyNode[]> {
    const row = await this.getRow(id)
    if (!row) throw new Error(`Session 不存在: ${id}`)
    const parentId = row['parent_id'] as string | null
    if (parentId === null) return []

    const { rows } = await this.client.query(
      `SELECT * FROM sessions WHERE parent_id = $1 AND space_id = $2 AND id != $3
       ORDER BY "index" ASC`,
      [parentId, this.spaceId, id],
    )

    const result: TopologyNode[] = []
    for (const r of rows) {
      const rid = r['id'] as string
      const children = await this.getChildIds(rid)
      const refs = await this.getRefIds(rid)
      result.push(rowToTopologyNode(r, children, refs))
    }
    return result
  }

  /** 读取原始 DB 行 */
  private async getRow(id: string): Promise<Record<string, unknown> | null> {
    const { rows } = await this.client.query(
      'SELECT * FROM sessions WHERE id = $1 AND space_id = $2',
      [id, this.spaceId],
    )
    return rows.length > 0 ? rows[0]! : null
  }

  /** 读取原始 DB 行，不存在则抛错 */
  private async requireRow(id: string): Promise<Record<string, unknown>> {
    const row = await this.getRow(id)
    if (!row) throw new Error(`Session 不存在: ${id}`)
    return row
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
