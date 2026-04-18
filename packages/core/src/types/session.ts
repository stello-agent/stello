// ─── Session 系统类型定义 ───

import type { SerializableSessionConfig } from './session-config';

/** Session 状态 */
export type SessionStatus = 'active' | 'archived';

/**
 * Session 元数据
 *
 * Session 是 Stello 的原子单元——一个独立的对话空间。
 * 不包含树结构信息，Session 不感知自己在拓扑中的位置。
 * 清理后只保留核心标识/状态/时间戳，scope/tags/metadata 已迁出。
 */
export interface SessionMeta {
  /** 唯一标识 */
  readonly id: string;
  /** 显示名称 */
  label: string;
  /** 当前状态 */
  status: SessionStatus;
  /** 对话轮次数 */
  turnCount: number;
  /** 创建时间（ISO 8601） */
  createdAt: string;
  /** 最后更新时间（ISO 8601） */
  updatedAt: string;
  /** 最后活跃时间（ISO 8601） */
  lastActiveAt: string;
}

/**
 * 拓扑节点
 *
 * 树结构信息，独立于 Session 维护。id 与 SessionMeta.id 对应。
 */
export interface TopologyNode {
  /** Session ID */
  readonly id: string;
  /** 父节点 ID，null 表示根 */
  parentId: string | null;
  /** 子节点 ID 列表 */
  children: string[];
  /** 跨分支引用 ID 列表 */
  refs: string[];
  /** 层级深度（根 = 0） */
  depth: number;
  /** 在兄弟节点中的排序序号 */
  index: number;
  /** 显示名称（冗余存放，渲染用） */
  label: string;
  /** fork 时的上下文来源 session ID（当 topologyParentId 被覆盖时可能 ≠ parentId） */
  sourceSessionId?: string;
}

/**
 * 递归树节点（API 返回用）
 *
 * 前端可直接用于渲染星空图。
 */
export interface SessionTreeNode {
  /** Session ID */
  id: string;
  /** 显示名称 */
  label: string;
  /** 展示层的 fork 来源 Session ID */
  sourceSessionId?: string;
  /** 当前状态 */
  status: SessionStatus;
  /** 对话轮次数 */
  turnCount: number;
  /** 子节点 */
  children: SessionTreeNode[];
}

/**
 * 创建子 Session 的参数（纯拓扑信息）
 */
export interface CreateSessionOptions {
  /** 父 Session ID */
  parentId: string;
  /** 显示名称 */
  label: string;
  /** fork 时的上下文来源 session（不传默认语义 = parentId） */
  sourceSessionId?: string;
}

/**
 * Session 树操作接口
 *
 * 管理对话的空间结构：创建、查询、归档、引用。
 * 不支持删除，只支持归档（归档不连带子 Session）。
 */
export interface SessionTree {
  /** 创建子 Session，返回拓扑节点 */
  createChild(options: CreateSessionOptions): Promise<TopologyNode>;
  /** 获取单个 Session 元数据 */
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
    updates: Partial<Pick<SessionMeta, 'label' | 'turnCount'>>,
  ): Promise<SessionMeta>;
  /** 获取单个拓扑节点 */
  getNode(id: string): Promise<TopologyNode | null>;
  /** 获取完整递归树 */
  getTree(): Promise<SessionTreeNode>;
  /** 获取所有祖先节点（从父到根） */
  getAncestors(id: string): Promise<TopologyNode[]>;
  /** 获取同级兄弟节点 */
  getSiblings(id: string): Promise<TopologyNode[]>;
  /**
   * 读取 Session 的固化配置（可序列化子集）
   *
   * 普通 Session 与 Main Session 共用同一存储槽。未写入或文件不存在时返回 null。
   * 仅包含可序列化字段（systemPrompt/skills），函数/适配器等运行时引用由
   * 应用层通过 sessionDefaults 重新合成。
   */
  getConfig(id: string): Promise<SerializableSessionConfig | null>;
  /**
   * 写入 Session 的固化配置（可序列化子集）
   *
   * 覆盖已有配置。调用方只传可序列化字段；若传入完整 SessionConfig 框架不会拒绝，
   * 但非可序列化字段在反序列化时将被丢弃。
   */
  putConfig(id: string, config: SerializableSessionConfig): Promise<void>;
}
