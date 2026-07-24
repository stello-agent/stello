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

function completionStream(chunks: unknown[]): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      yield* chunks
    },
  }
}

function textResponseStream(text = 'ok', promptTokens = 12, completionTokens = 3) {
  return completionStream([
    { choices: [{ delta: { content: text } }] },
    { choices: [], usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens } },
  ])
}

describe('createOpenAICompatibleAdapter', () => {
  beforeEach(() => {
    createCompletion.mockReset()
    createCompletion.mockResolvedValue(textResponseStream())
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
    expect(createCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          { role: 'system', content: 'system prompt\n\nsynthesis' },
          { role: 'user', content: 'hello' },
        ],
        max_tokens: 4096,
        stream: true,
        stream_options: { include_usage: true },
      }),
      undefined,
    )
  })

  it('显式传入 maxTokens 时优先使用调用方配置', async () => {
    const adapter = createOpenAICompatibleAdapter({
      apiKey: 'test-key',
      baseURL: 'https://api.example.com/v1',
      model: 'test-model',
      maxContextTokens: 128_000,
    })

    await adapter.complete([{ role: 'user', content: 'hello' }], { maxTokens: 2048 })

    expect(createCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        max_tokens: 2048,
        stream: true,
      }),
      undefined,
    )
  })

  it('options.maxOutputTokens 覆盖内建默认值', async () => {
    const adapter = createOpenAICompatibleAdapter({
      apiKey: 'test-key',
      baseURL: 'https://api.example.com/v1',
      model: 'test-model',
      maxContextTokens: 128_000,
      maxOutputTokens: 8192,
    })

    await adapter.complete([{ role: 'user', content: 'hello' }])

    expect(createCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ max_tokens: 8192, stream: true }),
      undefined,
    )
  })

  it('调用方 maxTokens 优先级最高，盖过 options.maxOutputTokens', async () => {
    const adapter = createOpenAICompatibleAdapter({
      apiKey: 'test-key',
      baseURL: 'https://api.example.com/v1',
      model: 'test-model',
      maxContextTokens: 128_000,
      maxOutputTokens: 8192,
    })

    await adapter.complete([{ role: 'user', content: 'hello' }], { maxTokens: 2048 })

    expect(createCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ max_tokens: 2048, stream: true }),
      undefined,
    )
  })

  it('complete() 提取响应中的 reasoning_content', async () => {
    createCompletion.mockResolvedValueOnce(completionStream([
      { choices: [{ delta: { content: 'answer', reasoning_content: 'thinking...' } }] },
      { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } },
    ]))

    const adapter = createOpenAICompatibleAdapter({
      apiKey: 'test-key',
      baseURL: 'https://api.example.com/v1',
      model: 'test-model',
      maxContextTokens: 128_000,
    })

    const result = await adapter.complete([{ role: 'user', content: 'hello' }])
    expect(result.reasoningContent).toBe('thinking...')
    expect(result.content).toBe('answer')
  })

  it('assistant 消息的 reasoningContent 回传为 reasoning_content', async () => {
    const adapter = createOpenAICompatibleAdapter({
      apiKey: 'test-key',
      baseURL: 'https://api.example.com/v1',
      model: 'test-model',
      maxContextTokens: 128_000,
    })

    const messages: Message[] = [
      { role: 'user', content: 'hello' },
      {
        role: 'assistant',
        content: 'let me think',
        reasoningContent: 'step 1: ...',
        toolCalls: [{ id: 'tc_1', name: 'foo', input: {} }],
      },
      { role: 'tool', content: 'result', toolCallId: 'tc_1' },
    ]

    await adapter.complete(messages)

    const sentMessages = createCompletion.mock.calls[0]![0].messages
    expect(sentMessages[1]).toMatchObject({
      role: 'assistant',
      content: 'let me think',
      reasoning_content: 'step 1: ...',
      tool_calls: [{ id: 'tc_1', type: 'function', function: { name: 'foo', arguments: '{}' } }],
    })
  })

  it('非推理模型响应不含 reasoningContent', async () => {
    const adapter = createOpenAICompatibleAdapter({
      apiKey: 'test-key',
      baseURL: 'https://api.example.com/v1',
      model: 'test-model',
      maxContextTokens: 128_000,
    })

    const result = await adapter.complete([{ role: 'user', content: 'hello' }])
    expect(result.reasoningContent).toBeUndefined()
  })

  it('StepFun 3.7 将 image/video parts 转成 Chat Completions 多模态 content', async () => {
    const adapter = createOpenAICompatibleAdapter({
      apiKey: 'test-key',
      baseURL: 'https://api.stepfun.com/v1',
      model: 'step-3.7-flash',
      maxContextTokens: 128_000,
    })

    await adapter.complete([{ role: 'user', content: '看一下', parts: [
      { kind: 'image', source: { type: 'url', url: 'https://example.com/a.png' }, detail: 'high' },
      { kind: 'video', source: { type: 'url', url: 'https://example.com/a.mp4' } },
    ] }])

    const sentMessages = createCompletion.mock.calls[0]![0].messages
    expect(sentMessages[0]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: '看一下' },
        { type: 'image_url', image_url: { url: 'https://example.com/a.png', detail: 'high' } },
        { type: 'video_url', video_url: { url: 'https://example.com/a.mp4' } },
      ],
    })
  })

  it('将 providerTools 原样透传给 OpenAI-compatible tools 数组', async () => {
    const adapter = createOpenAICompatibleAdapter({
      apiKey: 'test-key',
      baseURL: 'https://api.stepfun.com/v1',
      model: 'step-3.7-flash',
      maxContextTokens: 128_000,
    })

    await adapter.complete([{ role: 'user', content: '今天有什么新闻？' }], {
      tools: [{ name: 'client_search', description: 'client search', inputSchema: { type: 'object' } }],
      providerTools: [{
        id: 'stepfun_web_search',
        provider: 'openai-compatible',
        spec: {
          type: 'web_search',
          function: { description: '搜索互联网实时信息' },
        },
      }],
    })

    expect(createCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        tool_choice: 'auto',
        tools: [
          {
            type: 'function',
            function: {
              name: 'client_search',
              description: 'client search',
              parameters: { type: 'object' },
            },
          },
          {
            type: 'web_search',
            function: { description: '搜索互联网实时信息' },
          },
        ],
      }),
      undefined,
    )
  })

  it('StepFun web_search tool_calls 不会变成客户端 toolCalls，并保留 providerToolEvents', async () => {
    createCompletion.mockResolvedValueOnce(completionStream([
      {
        choices: [{
          delta: {
            content: '上海中心大厦',
            tool_calls: [{
              index: 0,
              id: 'call_search_1',
              type: 'web_search',
              function: {
                name: 'step_websearch',
                arguments: '{"keyword":"上海最高的楼"}',
                results: [{ index: 0, url: 'https://example.com', title: '上海最高的楼' }],
              },
            }],
          },
        }],
      },
      { choices: [], usage: { prompt_tokens: 10, completion_tokens: 4 } },
    ]))

    const adapter = createOpenAICompatibleAdapter({
      apiKey: 'test-key',
      baseURL: 'https://api.stepfun.com/v1',
      model: 'step-3.7-flash',
      maxContextTokens: 128_000,
    })

    const result = await adapter.complete([{ role: 'user', content: '上海最高的楼？' }], {
      providerTools: [{
        id: 'stepfun_web_search',
        provider: 'openai-compatible',
        spec: { type: 'web_search', function: { description: '搜索互联网实时信息' } },
      }],
    })

    expect(result.toolCalls).toBeUndefined()
    expect(result.providerToolEvents).toEqual([{
      id: 'call_search_1',
      type: 'web_search',
      name: 'step_websearch',
      input: { keyword: '上海最高的楼' },
      results: [{ index: 0, url: 'https://example.com', title: '上海最高的楼' }],
      raw: {
        index: 0,
        id: 'call_search_1',
        type: 'web_search',
        function: {
          name: 'step_websearch',
          arguments: '{"keyword":"上海最高的楼"}',
          results: [{ index: 0, url: 'https://example.com', title: '上海最高的楼' }],
        },
      },
    }])
  })

  it('complete() 从 stream delta 聚合客户端 tool call，且无文本时 content 为 null', async () => {
    createCompletion.mockResolvedValueOnce(completionStream([
      {
        choices: [{
          delta: {
            tool_calls: [{
              index: 1,
              id: 'call_1',
              type: 'function',
              function: { name: 'search', arguments: '{"q":' },
            }],
          },
        }],
      },
      {
        choices: [{
          delta: {
            tool_calls: [{
              index: 1,
              function: { arguments: '"stello"}' },
            }],
          },
        }],
      },
    ]))

    const adapter = createOpenAICompatibleAdapter({
      apiKey: 'test-key',
      baseURL: 'https://api.example.com/v1',
      model: 'test-model',
      maxContextTokens: 128_000,
    })

    const result = await adapter.complete([{ role: 'user', content: 'search' }])

    expect(result).toEqual({
      content: null,
      toolCalls: [{ id: 'call_1', name: 'search', input: { q: 'stello' } }],
    })
    expect(createCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ stream: true }),
      undefined,
    )
  })

  it('stream() 忽略 provider tool delta 的客户端执行通道，并下发 providerToolEvents', async () => {
    createCompletion.mockResolvedValueOnce((async function* () {
      yield {
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id: 'call_search_1',
              type: 'web_search',
              function: {
                name: 'step_websearch',
                arguments: '{"keyword":"上海最高的楼"}',
                results: [{ index: 0, url: 'https://example.com', title: '上海最高的楼' }],
              },
            }],
          },
        }],
      }
      yield { choices: [{ delta: { content: '上海中心大厦' } }] }
    })())

    const adapter = createOpenAICompatibleAdapter({
      apiKey: 'test-key',
      baseURL: 'https://api.stepfun.com/v1',
      model: 'step-3.7-flash',
      maxContextTokens: 128_000,
    })

    if (!adapter.stream) throw new Error('adapter.stream is required')

    const chunks = []
    for await (const chunk of adapter.stream([{ role: 'user', content: '上海最高的楼？' }], {
      providerTools: [{
        id: 'stepfun_web_search',
        provider: 'openai-compatible',
        spec: { type: 'web_search', function: { description: '搜索互联网实时信息' } },
      }],
    })) {
      chunks.push(chunk)
    }

    expect(chunks.flatMap((chunk) => chunk.toolCallDeltas ?? [])).toEqual([])
    expect(chunks.flatMap((chunk) => chunk.providerToolEvents ?? [])).toEqual([{
      id: 'call_search_1',
      type: 'web_search',
      name: 'step_websearch',
      input: { keyword: '上海最高的楼' },
      results: [{ index: 0, url: 'https://example.com', title: '上海最高的楼' }],
      raw: {
        index: 0,
        id: 'call_search_1',
        type: 'web_search',
        function: {
          name: 'step_websearch',
          arguments: '{"keyword":"上海最高的楼"}',
          results: [{ index: 0, url: 'https://example.com', title: '上海最高的楼' }],
        },
      },
    }])
    expect(chunks.map((chunk) => chunk.delta).join('')).toBe('上海中心大厦')
  })

  it('stream() 请求 provider usage 并透传 usage-only chunk', async () => {
    createCompletion.mockResolvedValueOnce((async function* () {
      yield { choices: [{ delta: { content: 'ok' } }] }
      yield { choices: [], usage: { prompt_tokens: 10, completion_tokens: 2 } }
    })())

    const adapter = createOpenAICompatibleAdapter({
      apiKey: 'test-key',
      baseURL: 'https://api.example.com/v1',
      model: 'test-model',
      maxContextTokens: 128_000,
    })

    if (!adapter.stream) throw new Error('adapter.stream is required')

    const chunks = []
    for await (const chunk of adapter.stream([{ role: 'user', content: 'hello' }])) {
      chunks.push(chunk)
    }

    expect(createCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        stream: true,
        stream_options: { include_usage: true },
      }),
      undefined,
    )
    expect(chunks).toEqual([
      { delta: 'ok' },
      { delta: '', usage: { promptTokens: 10, completionTokens: 2 } },
    ])
  })

  it('StepFun 3.7 多模态能力不绑定固定 baseURL', async () => {
    const adapter = createOpenAICompatibleAdapter({
      apiKey: 'test-key',
      baseURL: 'https://api.stepfun.com/step_plan/v1',
      model: 'step-3.7-flash',
      maxContextTokens: 128_000,
    })

    await adapter.complete([{ role: 'user', content: '描述图片', parts: [
      { kind: 'image', source: { type: 'url', url: 'https://example.com/a.png' } },
    ] }])

    expect(createCompletion.mock.calls[0]![0].messages[0].content).toEqual([
      { type: 'text', text: '描述图片' },
      { type: 'image_url', image_url: { url: 'https://example.com/a.png' } },
    ])
  })
  it('StepFun 3.7 支持 data URL 与 stepfile provider_file', async () => {
    const adapter = createOpenAICompatibleAdapter({
      apiKey: 'test-key',
      baseURL: 'https://api.stepfun.com/step_plan/v1',
      model: 'step-3.7-flash',
      maxContextTokens: 128_000,
    })

    await adapter.complete([{ role: 'user', content: '比较', parts: [
      { kind: 'image', source: { type: 'data', mediaType: 'image/png', data: 'abc123' } },
      { kind: 'video', source: { type: 'provider_file', provider: 'stepfun', fileId: 'file_123' } },
    ] }])

    expect(createCompletion.mock.calls[0]![0].messages[0].content).toEqual([
      { type: 'text', text: '比较' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,abc123' } },
      { type: 'video_url', video_url: { url: 'stepfile://file_123' } },
    ])
  })

  it('StepFun 3.7 将已解析 file part 转成文本块并保留原始用户问题', async () => {
    const adapter = createOpenAICompatibleAdapter({
      apiKey: 'test-key',
      baseURL: 'https://api.stepfun.com/step_plan/v1',
      model: 'step-3.7-flash',
      maxContextTokens: 128_000,
    })

    await adapter.complete([{ role: 'user', content: '总结重点', parts: [
      {
        kind: 'file',
        source: { type: 'kitkit_file', fileId: 'mmf_1', objectKey: 'multimodal/doc.pdf', backend: 's3' },
        filename: 'report.pdf',
        mediaType: 'application/pdf',
        extraction: { provider: 'stepfun', fileId: 'file-C0DD', status: 'success', content: '第一章：项目概况' },
      },
    ] }])

    const sentMessages = createCompletion.mock.calls[0]![0].messages
    expect(sentMessages[0].content).toEqual([
      { type: 'text', text: '总结重点' },
      {
        type: 'text',
        text: [
          '用户上传了文档：report.pdf',
          '<document filename="report.pdf" media_type="application/pdf">',
          '第一章：项目概况',
          '</document>',
        ].join('\n'),
      },
    ])
  })

  it('非 StepFun 3.7 模型收到 parts 时明确报错', async () => {
    const adapter = createOpenAICompatibleAdapter({
      apiKey: 'test-key',
      baseURL: 'https://api.example.com/v1',
      model: 'other-model',
      maxContextTokens: 128_000,
    })

    await expect(adapter.complete([{ role: 'user', content: '看图', parts: [
      { kind: 'image', source: { type: 'url', url: 'https://example.com/a.png' } },
    ] }])).rejects.toThrow('Multimodal content parts are only supported for StepFun step-3.7-flash')
    expect(createCompletion).not.toHaveBeenCalled()
  })

  it('signal 透传到 SDK request options', async () => {
    const adapter = createOpenAICompatibleAdapter({
      apiKey: 'test-key',
      baseURL: 'https://api.example.com/v1',
      model: 'test-model',
      maxContextTokens: 128_000,
    })

    const controller = new AbortController()
    await adapter.complete([{ role: 'user', content: 'hello' }], { signal: controller.signal })

    expect(createCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ stream: true }),
      { signal: controller.signal },
    )
  })
})
