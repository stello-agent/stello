import type { SessionMeta, SessionMetaUpdate, ForkOptions } from './session.js'
import type { Message, LLMAdapter } from './llm.js'
import type { ConsolidateFn, SendResult, StreamResult } from './functions.js'


/** 消息查询选项 */
export interface MessageQueryOptions {
  limit?: number
  offset?: number
  role?: Message['role']
}

/** Session 错误：操作归档中的 Session */
export class SessionArchivedError extends Error {
  constructor(sessionId: string) {
    super(`Session "${sessionId}" is archived and cannot be modified`)
    this.name = 'SessionArchivedError'
  }
}

/** send()/stream() 未实现错误（v0.2 stub） */
export class NotImplementedError extends Error {
  constructor(method: string) {
    super(`${method} is not yet implemented`)
    this.name = 'NotImplementedError'
  }
}

/**
 * Session — 有记忆的对话单元
 * 接收消息 → 组装上下文 → 单次 LLM 调用 → 存 L3 → 返回响应
 */
export interface Session {
  /** 同步读取 Session 元数据（内存缓存，始终最新） */
  readonly meta: Readonly<SessionMeta>

  /** 发送一条消息：组装上下文 → 调 LLM → 存 L3（用户消息 + LLM 响应）→ 返回结果 */
  send(content: string): Promise<SendResult>

  /** 流式发送：同 send() 但逐 chunk 输出，流结束后自动存 L3 */
  stream(content: string): StreamResult

  /** 读取 L3 对话记录 */
  messages(options?: MessageQueryOptions): Promise<Message[]>

  /** 读取 system prompt */
  systemPrompt(): Promise<string | null>

  /** 更新 system prompt（持久化到 storage） */
  setSystemPrompt(content: string): Promise<void>

  /** 读取 insights（Main Session 通过 integration cycle 推送的） */
  insight(): Promise<string | null>

  /** 写入 insights（由 integration cycle 调用，子 Session 不应自行调用） */
  setInsight(content: string): Promise<void>

  /** 读取 L2（技能描述），初始为 null */
  memory(): Promise<string | null>

  /** L3 → L2 提炼，由上层在合适时机触发 */
  consolidate(fn: ConsolidateFn): Promise<void>

  /** 裁剪旧 L3，保留最近 keepRecent 条。通常在 consolidate() 后调用 */
  trimRecords(keepRecent: number): Promise<void>

  /** 派生子 Session，根据 forkRole 一次性继承父链上下文，之后独立 */
  fork(options: ForkOptions): Promise<Session>

  /** 更新 Session 元数据 */
  updateMeta(updates: SessionMetaUpdate): Promise<void>

  /** 归档当前 Session */
  archive(): Promise<void>

  /** 动态替换 LLM adapter（热更新，立即对后续 send/stream 生效） */
  setLLM(adapter: LLMAdapter): void

}
