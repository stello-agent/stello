import type { LLMAdapter } from '@stello-ai/session'
import type {
  SessionCompatibleConsolidateFn,
  SessionCompatibleCompressFn,
} from '../adapters/session-runtime.js'

/** 最小 LLM 调用接口，仅用于 consolidation/integration 内置默认实现 */
export type LLMCallFn = (
  messages: Array<{ role: string; content: string }>,
) => Promise<string>

/**
 * 将 LLMAdapter 桥接为 LLMCallFn。
 * LLMAdapter.complete 需要窄化的 role 联合,且返回 { content: string | null };
 * LLMCallFn 使用宽松的 { role: string } 且返回 Promise<string>。
 * 这个适配器集中处理两者之间的 role narrowing 和 null 合并。
 */
export function llmCallFnFromAdapter(adapter: LLMAdapter): LLMCallFn {
  return async (msgs) => {
    const result = await adapter.complete(
      msgs as Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }>,
    )
    return result.content ?? ''
  }
}

/** 默认 consolidation 提示词 */
export const DEFAULT_CONSOLIDATE_PROMPT = `你是对话摘要助手。请将对话提炼为一段 100-150 字的简洁摘要。
要求：
- 聚焦核心目标和关键成果，只保留已确认的结论
- 省略讨论过程、寒暄和未决事项
- 输出一段连贯文字，不用列表或 Markdown 标记
- 语言精炼客观，像一条工作备忘`

/**
 * 默认 fn 的可选参数。
 *
 * - `roleContext`：被处理会话的角色 system prompt。非空字符串时会作为
 *   独立的 `<role_context>...</role_context>` system 消息插入。
 * - `label`：被处理会话的 label。非空字符串时会作为 `[session: {label}]`
 *   前缀注入到 user prompt 头部，让摘要/压缩/整合的 LLM 明确知道处理的是哪个 session。
 */
export interface DefaultFnOptions {
  roleContext?: string
  label?: string
}

/** 若 roleContext 非空，返回一条 role_context system 消息；否则返回空数组 */
function roleContextMessages(
  options: DefaultFnOptions | undefined,
): Array<{ role: 'system'; content: string }> {
  const ctx = options?.roleContext
  if (!ctx) return []
  return [{ role: 'system', content: `<role_context>\n${ctx}\n</role_context>` }]
}

/** 若 label 非空，返回 `[session: {label}]\n\n` 前缀；否则返回空字符串 */
function labelPrefix(options: DefaultFnOptions | undefined): string {
  const label = options?.label
  if (!label) return ''
  return `[session: ${label}]\n\n`
}

/** 根据 prompt 创建默认 consolidateFn：prompt + L3 历史 → L2 */
export function createDefaultConsolidateFn(
  prompt: string,
  llm: LLMCallFn,
  options?: DefaultFnOptions,
): SessionCompatibleConsolidateFn {
  return async (currentMemory, messages) => {
    const parts: string[] = []
    if (currentMemory) {
      parts.push(`当前摘要:\n${currentMemory}`)
    }
    parts.push(
      `对话记录:\n${messages.map((m) => `${m.role}: ${m.content}`).join('\n')}`,
    )
    const userContent = labelPrefix(options) + parts.join('\n\n')
    const raw = await llm([
      { role: 'system', content: prompt },
      ...roleContextMessages(options),
      { role: 'user', content: userContent },
    ])
    /* 清除 <think> 标签，只保留正文 */
    return raw.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim()
  }
}

/** 默认 context 压缩提示词 */
export const DEFAULT_COMPRESS_PROMPT = `你是对话压缩助手。请将以下对话历史压缩为一段简洁的摘要，保留关键上下文信息。
要求：
- 保留对话的核心主题、已做出的决定和关键事实
- 省略重复信息和冗余细节
- 输出一段连贯文字
- 语言精炼，像一份上下文备忘录`

/** Fork 子会话上下文压缩的默认提示词:作为子会话开场的"交接备忘"风格摘要 */
export const DEFAULT_FORK_COMPRESS_PROMPT = `你是对话压缩助手。请将以下对话历史压缩为一段简洁的摘要，作为子会话开场的上下文背景。
要求：
- 保留对话的核心主题、关键事实、已确认的结论
- 突出对子会话延续可能有用的人物 / 设定 / 待办
- 省略寒暄、重复信息和已收尾的细节
- 输出一段连贯文字，不用列表或 Markdown 标记
- 语言精炼客观，像一份交接备忘`

/** 根据 prompt 创建默认 compressFn：历史消息 → 压缩摘要 */
export function createDefaultCompressFn(
  prompt: string,
  llm: LLMCallFn,
  options?: DefaultFnOptions,
): SessionCompatibleCompressFn {
  return async (messages) => {
    const content = messages.map((m) => `${m.role}: ${m.content}`).join('\n')
    const userContent = labelPrefix(options) + `对话记录:\n${content}`
    const raw = await llm([
      { role: 'system', content: prompt },
      ...roleContextMessages(options),
      { role: 'user', content: userContent },
    ])
    return raw.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim()
  }
}
