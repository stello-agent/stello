import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAnthropicAdapter } from '../adapters/anthropic.js'
import type { LLMChunk } from '../types/llm.js'

const messagesStream = vi.fn()
const messagesCreate = vi.fn()

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { stream: messagesStream, create: messagesCreate }
  },
}))

function asyncIterableFrom<T>(items: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0
      return {
        async next() {
          if (i >= items.length) return { value: undefined as unknown as T, done: true }
          return { value: items[i++]!, done: false }
        },
      }
    },
  }
}

describe('createAnthropicAdapter stream()', () => {
  beforeEach(() => {
    messagesStream.mockReset()
    messagesCreate.mockReset()
  })

  it('从 content_block_start 中读取 tool_use 的 id 和 name 并通过 toolCallDeltas 下发', async () => {
    messagesStream.mockReturnValue(
      asyncIterableFrom([
        {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'tool_use',
            id: 'toolu_abc123',
            name: 'stello_create_session',
            input: {},
          },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '{"label":"小猫会话"' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: ',"prompt":"喵～"}' },
        },
      ]),
    )

    const adapter = createAnthropicAdapter({
      apiKey: 'test-key',
      baseURL: 'https://api.example.com',
      model: 'test-model',
      maxContextTokens: 200_000,
    })

    if (!adapter.stream) throw new Error('adapter.stream is required')

    const chunks: LLMChunk[] = []
    for await (const chunk of adapter.stream([{ role: 'user', content: 'hi' }])) {
      chunks.push(chunk)
    }

    const allDeltas = chunks.flatMap((c) => c.toolCallDeltas ?? [])

    // 必须至少有一条 delta 携带 name 和 id —— 当前 adapter 忽略 content_block_start，
    // 这条断言会让测试在修复前失败。
    const named = allDeltas.find((d) => d.name !== undefined)
    expect(named).toBeDefined()
    expect(named).toMatchObject({
      index: 0,
      id: 'toolu_abc123',
      name: 'stello_create_session',
    })

    // 输入 JSON 通过后续 delta 拼回完整字符串
    const inputJson = allDeltas
      .filter((d) => typeof d.input === 'string')
      .map((d) => d.input)
      .join('')
    expect(JSON.parse(inputJson)).toEqual({ label: '小猫会话', prompt: '喵～' })
  })

  it('content_block_start 在所有 input_json_delta 之前下发，确保下游累加器先拿到 name', async () => {
    messagesStream.mockReturnValue(
      asyncIterableFrom([
        {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'tool_use',
            id: 'toolu_xyz',
            name: 'stello_create_session',
            input: {},
          },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '{}' },
        },
      ]),
    )

    const adapter = createAnthropicAdapter({
      apiKey: 'test-key',
      model: 'test-model',
      maxContextTokens: 200_000,
    })
    if (!adapter.stream) throw new Error('adapter.stream is required')

    const deltaOrder: Array<{ kind: 'name' | 'input' }> = []
    for await (const chunk of adapter.stream([{ role: 'user', content: 'hi' }])) {
      for (const d of chunk.toolCallDeltas ?? []) {
        if (d.name !== undefined) deltaOrder.push({ kind: 'name' })
        if (d.input !== undefined) deltaOrder.push({ kind: 'input' })
      }
    }

    expect(deltaOrder[0]?.kind).toBe('name')
  })

  it('content_block_start 是非 tool_use 块时不下发 toolCallDeltas', async () => {
    messagesStream.mockReturnValue(
      asyncIterableFrom([
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'hello' },
        },
      ]),
    )

    const adapter = createAnthropicAdapter({
      apiKey: 'test-key',
      model: 'test-model',
      maxContextTokens: 200_000,
    })
    if (!adapter.stream) throw new Error('adapter.stream is required')

    const chunks: LLMChunk[] = []
    for await (const chunk of adapter.stream([{ role: 'user', content: 'hi' }])) {
      chunks.push(chunk)
    }

    expect(chunks.flatMap((c) => c.toolCallDeltas ?? [])).toEqual([])
    expect(chunks.map((c) => c.delta).join('')).toBe('hello')
  })
})

describe('createAnthropicAdapter complete() max_tokens', () => {
  beforeEach(() => {
    messagesStream.mockReset()
    messagesCreate.mockReset()
    messagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    })
  })

  it('未配置时回落到内建默认值 4096', async () => {
    const adapter = createAnthropicAdapter({
      apiKey: 'k',
      model: 'm',
      maxContextTokens: 200_000,
    })
    await adapter.complete([{ role: 'user', content: 'hi' }])
    expect(messagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ max_tokens: 4096 }),
      undefined,
    )
  })

  it('options.maxOutputTokens 覆盖内建默认值', async () => {
    const adapter = createAnthropicAdapter({
      apiKey: 'k',
      model: 'm',
      maxContextTokens: 200_000,
      maxOutputTokens: 8192,
    })
    await adapter.complete([{ role: 'user', content: 'hi' }])
    expect(messagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ max_tokens: 8192 }),
      undefined,
    )
  })

  it('调用方 maxTokens 优先级最高，盖过 options.maxOutputTokens', async () => {
    const adapter = createAnthropicAdapter({
      apiKey: 'k',
      model: 'm',
      maxContextTokens: 200_000,
      maxOutputTokens: 8192,
    })
    await adapter.complete([{ role: 'user', content: 'hi' }], { maxTokens: 2048 })
    expect(messagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ max_tokens: 2048 }),
      undefined,
    )
  })
})

describe('createAnthropicAdapter stream() max_tokens', () => {
  beforeEach(() => {
    messagesStream.mockReset()
    messagesCreate.mockReset()
    messagesStream.mockReturnValue(asyncIterableFrom([]))
  })

  it('options.maxOutputTokens 用于 stream() 请求', async () => {
    const adapter = createAnthropicAdapter({
      apiKey: 'k',
      model: 'm',
      maxContextTokens: 200_000,
      maxOutputTokens: 8192,
    })
    if (!adapter.stream) throw new Error('adapter.stream is required')
    for await (const _ of adapter.stream([{ role: 'user', content: 'hi' }])) {
      void _
    }
    expect(messagesStream).toHaveBeenCalledWith(
      expect.objectContaining({ max_tokens: 8192 }),
      undefined,
    )
  })
})
