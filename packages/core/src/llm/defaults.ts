import type {
  SessionCompatibleConsolidateFn,
  SessionCompatibleIntegrateFn,
} from '../adapters/session-runtime.js'

/** 最小 LLM 调用接口，仅用于 consolidation/integration 内置默认实现 */
export type LLMCallFn = (
  messages: Array<{ role: string; content: string }>,
) => Promise<string>

/** 默认 consolidation 提示词 */
export const DEFAULT_CONSOLIDATE_PROMPT = `你是一个对话摘要助手。请根据以下对话记录，提炼出关键信息和要点，生成简洁的摘要。
要求：
- 保留关键事实、决策和结论
- 忽略寒暄和重复内容
- 用中文输出
- 控制在 200 字以内`

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
      `子 Session 摘要:\n${children.map((c) => `- ${c.label}: ${c.l2}`).join('\n')}`,
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
