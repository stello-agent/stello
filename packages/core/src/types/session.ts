// ─── Session 系统类型定义 ───

/** Session 状态 */
export type SessionStatus = 'active' | 'archived';

/**
 * Session 元数据
 *
 * Session 是 Stello 的原子单元——一个独立的对话空间。
 * 树关系通过 parentId / children 维护，存储在 meta.json 中。
 */
export interface SessionMeta {
  /** 唯一标识 */
  readonly id: string;
  /** 父 Session ID，null 表示根节点 */
  parentId: string | null;
  /** 子 Session ID 列表 */
  children: string[];
  /** 跨分支引用的 Session ID 列表 */
  refs: string[];
  /** 显示名称 */
  label: string;
  /** 在兄弟节点中的排序序号 */
  index: number;
  /** 作用域标签，影响记忆系统的召回范围 */
  scope: string | null;
  /** 当前状态 */
  status: SessionStatus;
  /** 层级深度（根 = 0） */
  depth: number;
  /** 对话轮次数 */
  turnCount: number;
  /** 开发者自定义元数据 */
  metadata: Record<string, unknown>;
  /** 自由标签 */
  tags: string[];
  /** 创建时间（ISO 8601） */
  createdAt: string;
  /** 最后更新时间（ISO 8601） */
  updatedAt: string;
  /** 最后活跃时间（ISO 8601） */
  lastActiveAt: string;
}

/**
 * 创建子 Session 的参数
 */
export interface CreateSessionOptions {
  /** 父 Session ID */
  parentId: string;
  /** 显示名称 */
  label: string;
  /** 作用域标签 */
  scope?: string;
  /** 自定义元数据 */
  metadata?: Record<string, unknown>;
  /** 标签 */
  tags?: string[];
}

/**
 * Session 树操作接口
 *
 * 管理对话的空间结构：创建、查询、归档、引用。
 * 不支持删除，只支持归档（归档不连带子 Session）。
 */
export interface SessionTree {
  /** 创建子 Session */
  createChild(options: CreateSessionOptions): Promise<SessionMeta>;
  /** 获取单个 Session */
  get(id: string): Promise<SessionMeta | null>;
  /** 获取根 Session */
  getRoot(): Promise<SessionMeta>;
  /** 列出所有 Session */
  listAll(): Promise<SessionMeta[]>;
  /** 归档 Session（不连带子节点） */
  archive(id: string): Promise<void>;
  /** 创建跨分支引用（不能引用自己或直系祖先/后代） */
  addRef(fromId: string, toId: string): Promise<void>;
  /** 更新 Session 元数据 */
  updateMeta(
    id: string,
    updates: Partial<Pick<SessionMeta, 'label' | 'scope' | 'tags' | 'metadata'>>,
  ): Promise<SessionMeta>;
  /** 获取所有祖先（从父到根） */
  getAncestors(id: string): Promise<SessionMeta[]>;
  /** 获取同级兄弟节点 */
  getSiblings(id: string): Promise<SessionMeta[]>;
}
