import type { LLMAdapter, LLMResult, Message } from '../types/llm.js'
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
  return {
    async complete(_messages: Message[]): Promise<LLMResult> {
      if (index >= responses.length) {
        throw new Error(`MockLLM: no more responses (called ${index + 1} times, only ${responses.length} provided)`)
      }
      return responses[index++]!
    },
  }
}

/**
 * makeSession — 快速创建测试用 Session
 * 使用 InMemoryStorageAdapter，可传入覆盖选项
 */
export async function makeSession(
  opts?: Partial<Omit<CreateSessionOptions, 'storage'>>
): Promise<{ session: Session; storage: InMemoryStorageAdapter }> {
  const storage = new InMemoryStorageAdapter()
  const session = await createSession({
    storage,
    label: 'Test Session',
    ...opts,
  })
  return { session, storage }
}
