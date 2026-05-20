import type { SessionMeta, SessionFilter } from './session.js'
import type { Message } from './llm.js'

/** 列举消息记录时的选项 */
export interface ListRecordsOptions {
  limit?: number
  offset?: number
  /** 只返回指定 role 的消息 */
  role?: Message['role']
}

/**
 * SessionStorage — Session 数据操作接口
 *
 * 所有 Session（含 root）共用同一个接口。
 * 拓扑节点 CRUD 由 core SessionTree 持有，不在此接口职责内。
 */
export interface SessionStorage {
  /** 读取 Session 元数据，不存在返回 null */
  getSession(id: string): Promise<SessionMeta | null>
  /** 写入或更新 Session 元数据 */
  putSession(session: SessionMeta): Promise<void>
  /** 列举 Session（按状态过滤） */
  listSessions(filter?: SessionFilter): Promise<SessionMeta[]>

  /** 追加一条对话记录（L3） */
  appendRecord(sessionId: string, record: Message): Promise<void>
  /** 读取对话记录列表（L3） */
  listRecords(sessionId: string, options?: ListRecordsOptions): Promise<Message[]>
  /** 裁剪旧 L3 记录，仅保留最近 keepRecent 条 */
  trimRecords(sessionId: string, keepRecent: number): Promise<void>

  /** 读取 Session 的 system prompt */
  getSystemPrompt(sessionId: string): Promise<string | null>
  /** 写入 Session 的 system prompt */
  putSystemPrompt(sessionId: string, content: string): Promise<void>

  /** 读取 Session 的 insight，一次性，send 消费后调用 clearInsight */
  getInsight(sessionId: string): Promise<string | null>
  /** 写入 Session 的 insight */
  putInsight(sessionId: string, content: string): Promise<void>
  /** 清除 Session 的 insight */
  clearInsight(sessionId: string): Promise<void>

  /** 读取 Session 的持久 memory（原 L2 / 原 synthesis 统一槽位） */
  getMemory(sessionId: string): Promise<string | null>
  /** 写入 Session 的 memory */
  putMemory(sessionId: string, content: string): Promise<void>

  /**
   * (可选)读取 session 的已持久化压缩缓存。
   * 未实现该方法的 storage 后端,压缩缓存仅保留在内存(进程重启即丢)。
   * 无快照时返回 null。
   */
  getCompressionCache?(sessionId: string): Promise<CompressionCacheSnapshot | null>

  /**
   * (可选)持久化压缩缓存快照。
   * 每次压缩成功后被调用。失败应记录日志但不得阻塞当前 LLM 轮次。
   */
  putCompressionCache?(sessionId: string, snapshot: CompressionCacheSnapshot): Promise<void>

  /** 事务（内存实现可直接执行 fn） */
  transaction<T>(fn: (tx: SessionStorage) => Promise<T>): Promise<T>
}

/**
 * 压缩缓存快照,可通过 SessionStorage 持久化。
 * 形态与 context-utils.ts 中的 CompressionCache 保持一致。
 */
export interface CompressionCacheSnapshot {
  /** 最新的压缩摘要文本 */
  summary: string
  /** 该摘要覆盖的历史消息起始条数 */
  compressedCount: number
}
