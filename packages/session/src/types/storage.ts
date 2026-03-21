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
 * StorageAdapter — 业务语义键接口，屏蔽底层存储细节
 * 每个方法对应上下文组装或记忆系统中的一个专用槽位
 */
export interface StorageAdapter {
  /** 读取 Session 元数据，不存在返回 null */
  getSession(id: string): Promise<SessionMeta | null>
  /** 写入或更新 Session 元数据 */
  putSession(session: SessionMeta): Promise<void>
  /** 列举 Session，可按条件过滤 */
  listSessions(filter?: SessionFilter): Promise<SessionMeta[]>

  /** 追加一条对话记录（L3） */
  appendRecord(sessionId: string, record: Message): Promise<void>
  /** 读取对话记录列表（L3） */
  listRecords(sessionId: string, options?: ListRecordsOptions): Promise<Message[]>

  /** 读取 Session 的 system prompt，不存在返回 null */
  getSystemPrompt(sessionId: string): Promise<string | null>
  /** 写入 Session 的 system prompt */
  putSystemPrompt(sessionId: string, content: string): Promise<void>

  /** 读取 Session 的 insight（Main Session 推送的洞察），不存在返回 null */
  getInsight(sessionId: string): Promise<string | null>
  /** 写入 Session 的 insight */
  putInsight(sessionId: string, content: string): Promise<void>

  /** 读取 Session 的记忆摘要（子 Session = L2，Main Session = synthesis） */
  getMemory(sessionId: string): Promise<string | null>
  /** 写入 Session 的记忆摘要 */
  putMemory(sessionId: string, content: string): Promise<void>

  /** 读取全局键值，不存在返回 null */
  getGlobal(key: string): Promise<unknown>
  /** 写入全局键值 */
  putGlobal(key: string, value: unknown): Promise<void>

  /** 在事务中执行操作（内存实现可直接执行 fn） */
  transaction<T>(fn: (tx: StorageAdapter) => Promise<T>): Promise<T>
}
