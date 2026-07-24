import type { LLMAdapter, LLMChunk, LLMResult } from '../types/llm.js'
import type { Session } from '../types/session-api.js'
import type { CreateSessionOptions } from '../types/functions.js'
import { createSession } from '../create-session.js'
import { InMemoryStorageAdapter } from '../mocks/in-memory-storage.js'

/**
 * createMockLLM — 按顺序返回预定义响应的 LLM mock
 * 超出响应列表后抛出错误
 */
export function createMockLLM(responses: LLMResult[]): LLMAdapter {
  let index = 0
  const takeNext = (): LLMResult => {
    if (index >= responses.length) {
      throw new Error(`MockLLM: no more responses (called ${index + 1} times, only ${responses.length} provided)`)
    }
    return responses[index++]!
  }

  async function* streamResult(result: LLMResult): AsyncIterable<LLMChunk> {
    if (result.content) {
      yield { delta: result.content }
    }
    if (result.reasoningContent) {
      yield { delta: '', reasoningDelta: result.reasoningContent }
    }
    for (const [toolIndex, toolCall] of (result.toolCalls ?? []).entries()) {
      yield {
        delta: '',
        toolCallDeltas: [{
          index: toolIndex,
          id: toolCall.id,
          name: toolCall.name,
          input: JSON.stringify(toolCall.input),
        }],
      }
    }
    if (result.providerToolEvents?.length) {
      yield { delta: '', providerToolEvents: result.providerToolEvents }
    }
    if (result.usage) {
      yield { delta: '', usage: result.usage }
    }
  }

  return {
    maxContextTokens: 1_000_000,
    async complete(): Promise<LLMResult> {
      return takeNext()
    },
    async *stream(): AsyncIterable<LLMChunk> {
      yield* streamResult(takeNext())
    },
  }
}

/**
 * makeSession — 快速创建测试用 Session
 * 使用 InMemoryStorageAdapter，可传入覆盖选项
 */
export async function makeSession(
  opts?: Partial<Omit<CreateSessionOptions, 'storage'>> & { storage?: InMemoryStorageAdapter }
): Promise<{ session: Session; storage: InMemoryStorageAdapter }> {
  const storage = opts?.storage ?? new InMemoryStorageAdapter()
  const rest = opts ? { ...opts } : {}
  delete rest.storage
  const session = await createSession({
    storage,
    label: 'Test Session',
    ...rest,
  })
  return { session, storage }
}
