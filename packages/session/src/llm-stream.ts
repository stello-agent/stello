import type { LLMChunk, LLMResult, LLMUsage, ProviderToolEvent } from './types/llm.js'

/** 每个 LLM chunk 的可选观察回调；按流顺序串行等待。 */
export type LLMChunkHandler = (chunk: LLMChunk) => void | Promise<void>

interface AccumulatedToolCall {
  id?: string
  name?: string
  input: string
}

/**
 * 消费完整 LLM stream，并聚合为 provider 中性的 LLMResult。
 *
 * - 没有任何非空文本 delta 时，content 为 null。
 * - tool call 按 provider index 排序，参数 delta 按到达顺序拼接。
 * - usage 使用流中最后一份快照，不对累计快照重复求和。
 * - provider tool events 按到达顺序完整保留。
 */
export async function collectLLMStream(stream: AsyncIterable<LLMChunk>, onChunk?: LLMChunkHandler): Promise<LLMResult> {
  let content = ''
  let hasContent = false
  let reasoningContent = ''
  let usage: LLMUsage | undefined
  const toolCallsByIndex = new Map<number, AccumulatedToolCall>()
  const providerToolEvents: ProviderToolEvent[] = []

  for await (const chunk of stream) {
    if (chunk.delta) {
      content += chunk.delta
      hasContent = true
    }
    if (chunk.reasoningDelta) {
      reasoningContent += chunk.reasoningDelta
    }
    for (const delta of chunk.toolCallDeltas ?? []) {
      const current = toolCallsByIndex.get(delta.index) ?? { input: '' }
      if (delta.id !== undefined) current.id = delta.id
      if (delta.name !== undefined) current.name = delta.name
      if (delta.input !== undefined) current.input += delta.input
      toolCallsByIndex.set(delta.index, current)
    }
    if (chunk.providerToolEvents) {
      providerToolEvents.push(...chunk.providerToolEvents)
    }
    if (chunk.usage) {
      usage = { ...chunk.usage }
    }

    await onChunk?.(chunk)
  }

  const toolCalls = Array.from(toolCallsByIndex.entries())
    .sort(([left], [right]) => left - right)
    .map(([index, call]) => ({
      id: call.id ?? `tool_${index}`,
      name: call.name ?? 'unknown_tool',
      input: call.input ? (JSON.parse(call.input) as Record<string, unknown>) : {},
    }))

  return {
    content: hasContent ? content : null,
    ...(reasoningContent ? { reasoningContent } : {}),
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
    ...(providerToolEvents.length > 0 ? { providerToolEvents } : {}),
    ...(usage ? { usage } : {}),
  }
}
