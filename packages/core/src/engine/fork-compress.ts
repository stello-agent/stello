import type {
  SessionCompatibleForkOptions,
  SessionCompatibleCompressFn,
} from '../adapters/session-runtime'
import {
  createDefaultCompressFn,
  DEFAULT_COMPRESS_PROMPT,
  type LLMCallFn,
} from '../llm/defaults'

/** Fork 配置错误：当 compress 上下文缺少可用 compressFn 或 llm 时抛出 */
export class ForkConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ForkConfigError'
  }
}

export interface ApplyCompressContextArgs {
  /** fork 请求的 context 选项：'none' | 'inherit' | 'compress' | ForkContextFn */
  context: SessionCompatibleForkOptions['context']
  /** compose 链拼好的 systemPrompt（未追加 parent_context） */
  systemPrompt: string | undefined
  /** 显式传入的 compressFn（优先级高于 llmCallFn fallback） */
  compressFn: SessionCompatibleCompressFn | undefined
  /** 已经从 LLMAdapter 包装好的 LLMCallFn；用于 fallback 构造默认 compressFn */
  llmCallFn: LLMCallFn | undefined
  /** 读取父 session 消息的惰性函数，仅在需要压缩时调用 */
  sourceMessages: () => Promise<
    Array<{ role: string; content: string; timestamp?: string }>
  >
}

export interface ApplyCompressContextResult {
  /** 可能被追加了 <parent_context> 段的 systemPrompt */
  systemPrompt: string | undefined
  /**
   * 要向下游 fork 调用转发的 context 值。
   * 当原始 context==='compress' 时，此处固定返回 'none'（压缩已在本层完成，
   * 不应再让底层 session 重复处理）。
   */
  forwardedContext: SessionCompatibleForkOptions['context']
}

/**
 * 纯函数：根据 fork 请求的 context 策略，决定是否在 systemPrompt 中注入
 * 父 session 压缩摘要，并返回转发给底层 fork 的 context 值。
 *
 * - 非 'compress'：直接透传。
 * - 'compress' + 父消息为空：跳过压缩，forwardedContext='none'。
 * - 'compress' + 有消息：调用 compressFn（或 fallback 从 llmCallFn 构造）得到摘要，
 *   追加 `\n\n<parent_context>\n{summary}\n</parent_context>` 到 systemPrompt。
 * - 'compress' 但既无 compressFn 又无 llmCallFn：抛 ForkConfigError。
 */
export async function applyCompressContext(
  args: ApplyCompressContextArgs,
): Promise<ApplyCompressContextResult> {
  const { context, systemPrompt, compressFn, llmCallFn, sourceMessages } = args

  if (context !== 'compress') {
    return { systemPrompt, forwardedContext: context }
  }

  const resolvedCompressFn: SessionCompatibleCompressFn | undefined =
    compressFn ??
    (llmCallFn
      ? createDefaultCompressFn(DEFAULT_COMPRESS_PROMPT, llmCallFn)
      : undefined)

  if (!resolvedCompressFn) {
    throw new ForkConfigError(
      'compress context requires compressFn or llm in compose chain',
    )
  }

  const messages = await sourceMessages()
  if (messages.length === 0) {
    return { systemPrompt, forwardedContext: 'none' }
  }

  const summary = await resolvedCompressFn(messages)
  const base = systemPrompt ?? ''
  return {
    systemPrompt: `${base}\n\n<parent_context>\n${summary}\n</parent_context>`,
    forwardedContext: 'none',
  }
}
