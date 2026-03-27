import type { SessionMeta, SessionFilter } from './session.js'
import type { Message } from './llm.js'
import type { ChildL2Summary } from './functions.js'

/** 列举消息记录时的选项 */
export interface ListRecordsOptions {
  limit?: number
  offset?: number
  /** 只返回指定 role 的消息 */
  role?: Message['role']
}

/**
 * SessionStorage — 单个 Session 的数据操作接口
 * 普通 Session 注入此接口，只能操作自身数据，不感知其他 Session
 */
export interface SessionStorage {
  /** 读取 Session 元数据，不存在返回 null */
  getSession(id: string): Promise<SessionMeta | null>
  /** 写入或更新 Session 元数据 */
  putSession(session: SessionMeta): Promise<void>

  /** 追加一条对话记录（L3） */
  appendRecord(sessionId: string, record: Message): Promise<void>
  /** 读取对话记录列表（L3） */
  listRecords(sessionId: string, options?: ListRecordsOptions): Promise<Message[]>
  /** 裁剪旧 L3 记录，仅保留最近 keepRecent 条 */
  trimRecords(sessionId: string, keepRecent: number): Promise<void>

  /** 读取 Session 的 system prompt，不存在返回 null */
  getSystemPrompt(sessionId: string): Promise<string | null>
  /** 写入 Session 的 system prompt */
  putSystemPrompt(sessionId: string, content: string): Promise<void>

  /** 读取 Session 的 insight（Main Session 推送的洞察），不存在返回 null */
  getInsight(sessionId: string): Promise<string | null>
  /** 写入 Session 的 insight */
  putInsight(sessionId: string, content: string): Promise<void>
  /** 清除 Session 的 insight（send 消费后调用） */
  clearInsight(sessionId: string): Promise<void>

  /** 读取 Session 的记忆摘要（子 Session = L2，Main Session = synthesis） */
  getMemory(sessionId: string): Promise<string | null>
  /** 写入 Session 的记忆摘要 */
  putMemory(sessionId: string, content: string): Promise<void>

  /** 在事务中执行操作（内存实现可直接执行 fn） */
  transaction<T>(fn: (tx: SessionStorage) => Promise<T>): Promise<T>
}

/** 拓扑树节点（轻量，仅供前端渲染用） */
export interface TopologyNode {
  /** 节点 ID，等于 sessionId */
  id: string
  /** 树中的父节点 ID（null 表示根节点，即 Main Session） */
  parentId: string | null
  /** 冗余存储的标签，避免渲染树时加载完整 SessionMeta */
  label: string
}

/**
 * MainStorage — Main Session 的存储接口，继承 SessionStorage
 * 额外提供：批量 L2 收集、拓扑树操作、Session 列举、全局键值
 */
export interface MainStorage extends SessionStorage {
  /** 批量获取所有子 Session 的 L2（integration 专用，扁平收集，不走树） */
  getAllSessionL2s(): Promise<ChildL2Summary[]>

  /** 列举 Session，可按条件过滤 */
  listSessions(filter?: SessionFilter): Promise<SessionMeta[]>

  /** 添加拓扑树节点 */
  putNode(node: TopologyNode): Promise<void>
  /** 获取某节点的直接子节点（前端懒加载用） */
  getChildren(parentId: string): Promise<TopologyNode[]>
  /** 删除拓扑树节点 */
  removeNode(nodeId: string): Promise<void>

  /** 读取全局键值，不存在返回 null */
  getGlobal(key: string): Promise<unknown>
  /** 写入全局键值 */
  putGlobal(key: string, value: unknown): Promise<void>
}
