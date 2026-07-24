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

function textResponseEvents(text = 'ok', inputTokens = 1, outputTokens = 1) {
  return asyncIterableFrom([
    {
      type: 'message_start',
      message: { usage: { input_tokens: inputTokens, output_tokens: 0 } },
    },
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text },
    },
    {
      type: 'message_delta',
      usage: { output_tokens: outputTokens },
    },
  ])
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
    messagesStream.mockReturnValue(textResponseEvents())
  })

  it('complete() 通过 stream 聚合，未配置时回落到内建默认值 4096', async () => {
    const adapter = createAnthropicAdapter({
      apiKey: 'k',
      model: 'm',
      maxContextTokens: 200_000,
    })
    const result = await adapter.complete([{ role: 'user', content: 'hi' }])

    expect(result).toEqual({
      content: 'ok',
      usage: { promptTokens: 1, completionTokens: 1 },
    })
    expect(messagesStream).toHaveBeenCalledWith(
      expect.objectContaining({ max_tokens: 4096 }),
      undefined,
    )
    expect(messagesCreate).not.toHaveBeenCalled()
  })

  it('options.maxOutputTokens 覆盖内建默认值', async () => {
    const adapter = createAnthropicAdapter({
      apiKey: 'k',
      model: 'm',
      maxContextTokens: 200_000,
      maxOutputTokens: 8192,
    })
    await adapter.complete([{ role: 'user', content: 'hi' }])
    expect(messagesStream).toHaveBeenCalledWith(
      expect.objectContaining({ max_tokens: 8192 }),
      undefined,
    )
  })

  it('超过 Anthropic SDK 非流式长请求阈值时仍通过 stream 传输并完整聚合', async () => {
    const adapter = createAnthropicAdapter({
      apiKey: 'k',
      model: 'm',
      maxContextTokens: 200_000,
      maxOutputTokens: 128_000,
    })

    await expect(adapter.complete([{ role: 'user', content: 'long answer' }])).resolves.toMatchObject({
      content: 'ok',
    })
    expect(messagesStream).toHaveBeenCalledWith(
      expect.objectContaining({ max_tokens: 128_000 }),
      undefined,
    )
    expect(messagesCreate).not.toHaveBeenCalled()
  })

  it('调用方 maxTokens 优先级最高，盖过 options.maxOutputTokens', async () => {
    const adapter = createAnthropicAdapter({
      apiKey: 'k',
      model: 'm',
      maxContextTokens: 200_000,
      maxOutputTokens: 8192,
    })
    await adapter.complete([{ role: 'user', content: 'hi' }], { maxTokens: 2048 })
    expect(messagesStream).toHaveBeenCalledWith(
      expect.objectContaining({ max_tokens: 2048 }),
      undefined,
    )
  })

  it('将 providerTools 原样透传给 Anthropic tools 数组', async () => {
    const adapter = createAnthropicAdapter({
      apiKey: 'k',
      model: 'm',
      maxContextTokens: 200_000,
      providerTools: [{
        id: 'anthropic_web_search',
        provider: 'anthropic',
        spec: { type: 'web_search_20250305', name: 'web_search', max_uses: 3 },
      }],
    })

    await adapter.complete([{ role: 'user', content: 'latest news' }], {
      tools: [{ name: 'client_tool', description: 'client', inputSchema: { type: 'object' } }],
    })

    expect(messagesStream).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: [
          { name: 'client_tool', description: 'client', input_schema: { type: 'object' } },
          { type: 'web_search_20250305', name: 'web_search', max_uses: 3 },
        ],
      }),
      undefined,
    )
  })

  it('Anthropic server-side tool blocks 不会变成客户端 toolCalls，并保留 providerToolEvents', async () => {
    messagesStream.mockReturnValueOnce(asyncIterableFrom([
      {
        type: 'message_start',
        message: { usage: { input_tokens: 10, output_tokens: 0 } },
      },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'server_tool_use', id: 'srv_1', name: 'web_search', input: { query: 'OpenAI news' } },
      },
      {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'web_search_tool_result', tool_use_id: 'srv_1', content: [{ type: 'web_search_result', title: 'Example', url: 'https://example.com' }] },
      },
      {
        type: 'content_block_delta',
        index: 2,
        delta: { type: 'text_delta', text: 'answer' },
      },
      {
        type: 'message_delta',
        usage: { output_tokens: 5 },
      },
    ]))

    const adapter = createAnthropicAdapter({
      apiKey: 'k',
      model: 'm',
      maxContextTokens: 200_000,
    })

    const result = await adapter.complete([{ role: 'user', content: 'latest news' }])

    expect(result.content).toBe('answer')
    expect(result.toolCalls).toBeUndefined()
    expect(result.providerToolEvents).toEqual([
      {
        id: 'srv_1',
        type: 'server_tool_use',
        name: 'web_search',
        input: { query: 'OpenAI news' },
        raw: { type: 'server_tool_use', id: 'srv_1', name: 'web_search', input: { query: 'OpenAI news' } },
      },
      {
        id: 'srv_1',
        type: 'web_search_tool_result',
        results: [{ type: 'web_search_result', title: 'Example', url: 'https://example.com' }],
        raw: { type: 'web_search_tool_result', tool_use_id: 'srv_1', content: [{ type: 'web_search_result', title: 'Example', url: 'https://example.com' }] },
      },
    ])
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5 })
    expect(messagesCreate).not.toHaveBeenCalled()
  })

  it('complete() 从 stream delta 聚合客户端 tool call，且无文本时 content 为 null', async () => {
    messagesStream.mockReturnValueOnce(asyncIterableFrom([
      {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_use', id: 'toolu_1', name: 'search', input: {} },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '{"q":"stello"}' },
      },
    ]))

    const adapter = createAnthropicAdapter({
      apiKey: 'k',
      model: 'm',
      maxContextTokens: 200_000,
    })

    const result = await adapter.complete([{ role: 'user', content: 'search' }])

    expect(result).toEqual({
      content: null,
      toolCalls: [{ id: 'toolu_1', name: 'search', input: { q: 'stello' } }],
    })
    expect(messagesCreate).not.toHaveBeenCalled()
  })

  it('complete() 将 temperature 和 signal 原样传给 stream 请求', async () => {
    const adapter = createAnthropicAdapter({
      apiKey: 'k',
      model: 'm',
      maxContextTokens: 200_000,
    })
    const controller = new AbortController()

    await adapter.complete([{ role: 'user', content: 'hi' }], {
      temperature: 0.25,
      signal: controller.signal,
    })

    expect(messagesStream).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: 0.25 }),
      { signal: controller.signal },
    )
    expect(messagesCreate).not.toHaveBeenCalled()
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
