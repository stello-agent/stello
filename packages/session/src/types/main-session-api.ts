import type { SessionMeta, SessionMetaUpdate } from './session.js'
import type { Message, LLMAdapter } from './llm.js'
import type { SendResult, StreamResult, IntegrateFn, IntegrateResult } from './functions.js'
import type { MessageQueryOptions } from './session-api.js'

/**
 * MainSession — 全局意识层对话单元
 *
 * 与 Session 的核心区别：
 * - 上下文使用 synthesis（integration 产出），而非 insights
 * - 没有 L2，没有 consolidate — 取而代之的是 integrate()
 * - 不接收 insights，而是通过 integrate 主动推送给子 Session
 * - 不 fork — 子 Session 由编排层通过 createSession() 创建
 */
export interface MainSession {
  /** 同步读取元数据（role 始终为 'main'） */
  readonly meta: Readonly<SessionMeta>

  /** 发送消息：组装上下文（system prompt + synthesis + L3 + msg）→ 调 LLM → 存 L3 */
  send(content: string): Promise<SendResult>

  /** 流式发送：同 send 但逐 chunk 输出 */
  stream(content: string): StreamResult

  /** 读取 L3 对话记录 */
  messages(options?: MessageQueryOptions): Promise<Message[]>

  /** 读取 system prompt */
  systemPrompt(): Promise<string | null>

  /** 更新 system prompt（持久化到 storage） */
  setSystemPrompt(content: string): Promise<void>

  /** 读取 synthesis — integration cycle 的产出 */
  synthesis(): Promise<string | null>

  /** 执行 integration cycle：收集子 L2 → IntegrateFn → 保存 synthesis + 推送 insights */
  integrate(fn: IntegrateFn): Promise<IntegrateResult>

  /** 裁剪旧 L3，保留最近 keepRecent 条。通常在 integrate() 后调用 */
  trimRecords(keepRecent: number): Promise<void>

  /** 更新元数据 */
  updateMeta(updates: SessionMetaUpdate): Promise<void>

  /** 归档 */
  archive(): Promise<void>

  /** 动态替换 LLM adapter（热更新，立即对后续 send/stream 生效） */
  setLLM(adapter: LLMAdapter): void
}
