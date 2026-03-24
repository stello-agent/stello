import type {
  SessionCompatibleConsolidateFn,
  SessionCompatibleIntegrateFn,
} from '@stello-ai/core'

/** 最小 LLM 调用接口，仅用于 consolidation/integration 内置默认实现 */
export type LLMCallFn = (
  messages: Array<{ role: string; content: string }>,
) => Promise<string>

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
    return llm([
      { role: 'system', content: prompt },
      { role: 'user', content: parts.join('\n\n') },
    ])
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
    const result = await llm([
      { role: 'system', content: prompt },
      { role: 'user', content: parts.join('\n\n') },
    ])
    return JSON.parse(result) as {
      synthesis: string
      insights: Array<{ sessionId: string; content: string }>
    }
  }
}
