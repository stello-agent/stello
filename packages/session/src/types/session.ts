/** Session 元数据，描述一个对话节点的结构信息 */
export interface SessionMeta {
  readonly id: string
  parentId: string | null
  label: string
  /** 'standard' 为普通会话，'main' 为根主会话 */
  role: 'standard' | 'main'
  status: 'active' | 'archived'
  depth: number
  turnCount: number
  /** 上次 consolidation 时的 turnCount，用于判断是否需要重新 consolidate */
  consolidatedTurn: number
  tags: string[]
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

/** 可更新的 SessionMeta 字段子集 */
export interface SessionMetaUpdate {
  label?: string
  tags?: string[]
  metadata?: Record<string, unknown>
}

/** 列举 Session 时的过滤条件 */
export interface SessionFilter {
  parentId?: string | null
  status?: 'active' | 'archived'
  role?: 'standard' | 'main'
  tags?: string[]
}

/** fork 操作的选项 */
export interface ForkOptions {
  label: string
  /** fork 角色决定从父链继承多少上下文（一次性继承，之后独立） */
  forkRole?: 'full' | 'minimal' | 'none'
  tags?: string[]
  metadata?: Record<string, unknown>
}
