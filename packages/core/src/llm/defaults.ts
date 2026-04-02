import type {
  SessionCompatibleConsolidateFn,
  SessionCompatibleIntegrateFn,
  SessionCompatibleCompressFn,
} from '../adapters/session-runtime.js'

/** 最小 LLM 调用接口，仅用于 consolidation/integration 内置默认实现 */
export type LLMCallFn = (
  messages: Array<{ role: string; content: string }>,
) => Promise<string>

/** 默认 consolidation 提示词 */
export const DEFAULT_CONSOLIDATE_PROMPT = `你是对话摘要助手。请将对话提炼为一段 100-150 字的简洁摘要。
要求：
- 聚焦核心目标和关键成果，只保留已确认的结论
- 省略讨论过程、寒暄和未决事项
- 输出一段连贯文字，不用列表或 Markdown 标记
- 语言精炼客观，像一条工作备忘`

/** 默认 integration 提示词 */
export const DEFAULT_INTEGRATE_PROMPT = `你是一个跨会话综合分析助手。请根据所有子会话的摘要，生成综合分析和给各子会话的建议。

输出 JSON 格式：
{
  "synthesis": "综合分析文本",
  "insights": [
    {"sessionId": "子会话ID", "content": "给该子会话的建议"}
  ]
}

要求：
- synthesis 综合所有子会话的核心发现
- insights 给每个子会话提供跨会话视角的建议
- insights.sessionId 必须使用输入里提供的 sessionId 原样返回，不要使用 label，也不要编造值
- 用中文输出`

/** 根据 prompt 创建默认 consolidateFn：prompt + L3 历史 → L2 */
export function createDefaultConsolidateFn(
  prompt: string,
  llm: LLMCallFn,
): SessionCompatibleConsolidateFn {
  return async (currentMemory, messages) => {
    const parts: string[] = []
    if (currentMemory) {
      parts.push(`当前摘要:\n${currentMemory}`)
    }
    parts.push(
      `对话记录:\n${messages.map((m) => `${m.role}: ${m.content}`).join('\n')}`,
    )
    const raw = await llm([
      { role: 'system', content: prompt },
      { role: 'user', content: parts.join('\n\n') },
    ])
    /* 清除 <think> 标签，只保留正文 */
    return raw.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim()
  }
}

/** 根据 prompt 创建默认 integrateFn：prompt + 所有子 L2 + 当前 synthesis → synthesis + insights */
export function createDefaultIntegrateFn(
  prompt: string,
  llm: LLMCallFn,
): SessionCompatibleIntegrateFn {
  return async (children, currentSynthesis) => {
    const parts: string[] = []
    if (currentSynthesis) {
      parts.push(`当前综合:\n${currentSynthesis}`)
    }
    parts.push(
      `子 Session 摘要:\n${children.map((c) => `- [sessionId=${c.sessionId}] ${c.label}: ${c.l2}`).join('\n')}`,
    )
    const raw = await llm([
      { role: 'system', content: prompt },
      { role: 'user', content: parts.join('\n\n') },
    ])
    /* 容错：清除 <think> 标签，提取 JSON 块 */
    const cleaned = raw.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim()
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return { synthesis: cleaned, insights: [] }
    }
    try {
      return JSON.parse(jsonMatch[0]) as {
        synthesis: string
        insights: Array<{ sessionId: string; content: string }>
      }
    } catch {
      return { synthesis: cleaned, insights: [] }
    }
  }
}

/** 默认 context 压缩提示词 */
export const DEFAULT_COMPRESS_PROMPT = `你是对话压缩助手。请将以下对话历史压缩为一段简洁的摘要，保留关键上下文信息。
要求：
- 保留对话的核心主题、已做出的决定和关键事实
- 省略重复信息和冗余细节
- 输出一段连贯文字
- 语言精炼，像一份上下文备忘录`

/** 根据 prompt 创建默认 compressFn：历史消息 → 压缩摘要 */
export function createDefaultCompressFn(
  prompt: string,
  llm: LLMCallFn,
): SessionCompatibleCompressFn {
  return async (messages) => {
    const content = messages.map((m) => `${m.role}: ${m.content}`).join('\n')
    const raw = await llm([
      { role: 'system', content: prompt },
      { role: 'user', content: `对话记录:\n${content}` },
    ])
    return raw.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim()
  }
}
