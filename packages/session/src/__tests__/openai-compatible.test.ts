import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createOpenAICompatibleAdapter } from '../adapters/openai-compatible.js'
import type { Message } from '../types/llm.js'

const createCompletion = vi.fn()

vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        create: createCompletion,
      },
    }
  },
}))

describe('createOpenAICompatibleAdapter', () => {
  beforeEach(() => {
    createCompletion.mockReset()
    createCompletion.mockResolvedValue({
      choices: [{ message: { content: 'ok', tool_calls: [] } }],
      usage: { prompt_tokens: 12, completion_tokens: 3 },
    })
  })

  it('合并连续的 system 消息后再发请求', async () => {
    const adapter = createOpenAICompatibleAdapter({
      apiKey: 'test-key',
      baseURL: 'https://api.example.com/v1',
      model: 'test-model',
      maxContextTokens: 128_000,
    })

    const messages: Message[] = [
      { role: 'system', content: 'system prompt' },
      { role: 'system', content: 'synthesis' },
      { role: 'user', content: 'hello' },
    ]

    await adapter.complete(messages)

    expect(createCompletion).toHaveBeenCalledTimes(1)
    expect(createCompletion).toHaveBeenCalledWith(expect.objectContaining({
      messages: [
        { role: 'system', content: 'system prompt\n\nsynthesis' },
        { role: 'user', content: 'hello' },
      ],
      stream: false,
    }))
  })
})
