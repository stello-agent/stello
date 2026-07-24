import { describe, it, expect, vi } from 'vitest'
import { makeSession, createMockLLM } from './helpers.js'
import { SessionArchivedError } from '../types/session-api.js'
import type { LLMAdapter, LLMChunk, LLMCompleteOptions, LLMResult, Message } from '../types/llm.js'

function chunks(items: LLMChunk[]): AsyncIterable<LLMChunk> {
  return (async function* () {
    yield* items
  })()
}

describe('send() 契约', () => {
  const simpleResponse: LLMResult = {
    content: '你好！',
    usage: { promptTokens: 10, completionTokens: 5 },
  }

  it('send() 只调用 LLMAdapter.stream 并聚合返回 SendResult', async () => {
    const complete = vi.fn(async () => ({ content: 'wrong transport' }))
    const stream = vi.fn(() => chunks([
      { delta: '你' },
      { delta: '好！' },
      { delta: '', usage: { promptTokens: 10, completionTokens: 5 } },
    ]))
    const llm: LLMAdapter = { maxContextTokens: 1_000_000, complete, stream }
    const { session } = await makeSession({ llm })

    const result = await session.send('hello')

    expect(result.content).toBe('你好！')
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5 })
    expect(stream).toHaveBeenCalledOnce()
    expect(complete).not.toHaveBeenCalled()
  })

  it('send() 自动存 L3（用户消息 + LLM 响应）', async () => {
    const llm = createMockLLM([simpleResponse])
    const { session } = await makeSession({ llm })

    await session.send('hello')

    const messages = await session.messages()
    expect(messages).toHaveLength(2)
    expect(messages[0]!.role).toBe('user')
    expect(messages[0]!.content).toBe('hello')
    expect(messages[1]!.role).toBe('assistant')
    expect(messages[1]!.content).toBe('你好！')
  })

  it('send() 上下文组装包含 system prompt + insights + L3 历史', async () => {
    const capturedMessages: unknown[] = []
    const llm = createMockLLM([simpleResponse, { content: '第二次回复' }])
    // 劫持 stream 以捕获消息
    const originalStream = llm.stream.bind(llm)
    llm.stream = async function* (msgs, options) {
      capturedMessages.push([...msgs])
      yield* originalStream(msgs, options)
    }

    const { session } = await makeSession({
      llm,
      systemPrompt: '你是助手',
    })
    await session.setInsight('用户偏好简洁回答')

    // 第一次 send — insight 出现在上下文中，之后被消费
    await session.send('问题1')

    const firstCall = capturedMessages[0] as Array<{ role: string; content: string }>
    expect(firstCall[0]).toEqual({ role: 'system', content: '你是助手' })
    // session_identity 注入（label 由 makeSession 默认给出 'Test Session'）
    expect(firstCall[1]!.content).toContain('<session_identity>')
    expect(firstCall[2]).toEqual({ role: 'system', content: '用户偏好简洁回答' })

    // 第二次 send — insight 已消费，不再出现
    await session.send('问题2')

    const secondCall = capturedMessages[1] as Array<{ role: string; content: string }>
    expect(secondCall[0]).toEqual({ role: 'system', content: '你是助手' })
    expect(secondCall[1]!.content).toContain('<session_identity>')
    // L3 历史：user + assistant from first round
    expect(secondCall[2]!.role).toBe('user')
    expect(secondCall[2]!.content).toBe('问题1')
    expect(secondCall[3]!.role).toBe('assistant')
    // 当前用户消息
    expect(secondCall[4]!.role).toBe('user')
    expect(secondCall[4]!.content).toBe('问题2')
  })

  it('send() 支持当前 turn 多模态 parts，持久化但不在后续历史中重复回放', async () => {
    const capturedMessages: Message[][] = []
    const llm = createMockLLM([{ content: '看到了' }, { content: '继续' }])
    const originalStream = llm.stream.bind(llm)
    llm.stream = async function* (msgs, options) {
      capturedMessages.push(msgs.map((msg) => ({ ...msg, parts: msg.parts ? [...msg.parts] : undefined })))
      yield* originalStream(msgs, options)
    }
    const { session } = await makeSession({ llm })
    const parts: Message['parts'] = [
      { kind: 'image', source: { type: 'url', url: 'https://example.com/a.png' }, detail: 'high' },
    ]

    await session.send({ text: '描述这张图', parts })

    const firstUserMessage = capturedMessages[0]!.find((message) => message.role === 'user')!
    expect(firstUserMessage.content).toBe('描述这张图')
    expect(firstUserMessage.parts).toEqual(parts)

    const persistedAfterFirstTurn = await session.messages()
    expect(persistedAfterFirstTurn[0]).toMatchObject({ role: 'user', content: '描述这张图', parts })

    await session.send('继续分析')

    const secondCall = capturedMessages[1]!
    const historicalUser = secondCall.find((message) => message.role === 'user' && message.content === '描述这张图')!
    const currentUser = secondCall.find((message) => message.role === 'user' && message.content === '继续分析')!
    expect(historicalUser.parts).toBeUndefined()
    expect(currentUser.parts).toBeUndefined()
  })

  it('send() 返回 toolCalls 时透传', async () => {
    const responseWithTools: LLMResult = {
      content: null,
      toolCalls: [{ id: 'tc_1', name: 'search', input: { q: 'test' } }],
    }
    const llm = createMockLLM([responseWithTools])
    const { session } = await makeSession({ llm })

    const result = await session.send('搜索 test')

    expect(result.content).toBeNull()
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls![0]!.name).toBe('search')
  })

  it('send() 返回 toolCalls 时会把 assistant toolCalls 写入 L3', async () => {
    const responseWithTools: LLMResult = {
      content: '',
      toolCalls: [{ id: 'tc_1', name: 'search', input: { q: 'test' } }],
    }
    const llm = createMockLLM([responseWithTools])
    const { session } = await makeSession({ llm })

    await session.send('搜索 test')

    const messages = await session.messages()
    expect(messages).toHaveLength(2)
    expect(messages[1]!.role).toBe('assistant')
    expect(messages[1]!.toolCalls).toEqual([{ id: 'tc_1', name: 'search', input: { q: 'test' } }])
  })

  it('toolResults continuation 会回放 assistant toolCalls 和 tool 消息', async () => {
    const capturedMessages: Message[][] = []
    const llm = createMockLLM([
      {
        content: '',
        toolCalls: [{ id: 'tc_1', name: 'search', input: { q: 'test' } }],
      },
      {
        content: '最终答案',
      },
    ])
    const originalStream = llm.stream.bind(llm)
    llm.stream = async function* (msgs, options) {
      capturedMessages.push(msgs.map((msg) => ({ ...msg })))
      yield* originalStream(msgs, options)
    }

    const { session } = await makeSession({ llm })
    await session.send('搜索 test')
    await session.send(JSON.stringify({
      toolResults: [{
        toolCallId: 'tc_1',
        toolName: 'search',
        args: { q: 'test' },
        success: true,
        data: { hits: 3 },
        error: null,
      }],
    }))

    const secondCall = capturedMessages[1]!
    // replay context 在 label 非空时注入 <session_identity>，之后才是 L3 回放
    expect(secondCall[0]).toMatchObject({ role: 'system' })
    expect(secondCall[0]!.content).toContain('<session_identity>')
    expect(secondCall[1]).toMatchObject({ role: 'user', content: '搜索 test' })
    expect(secondCall[2]).toMatchObject({
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'tc_1', name: 'search', input: { q: 'test' } }],
    })
    expect(secondCall[3]).toMatchObject({
      role: 'tool',
      toolCallId: 'tc_1',
    })

    const persisted = await session.messages()
    expect(persisted.map((message) => message.role)).toEqual(['user', 'assistant', 'tool', 'assistant'])
  })

  it('send() 会把 tools 定义传给 LLMAdapter.stream', async () => {
    const llm = {
      maxContextTokens: 1_000_000,
      complete: vi.fn(async () => ({ content: null, toolCalls: [] })),
      stream: vi.fn(() => chunks([{ delta: '' }])),
    }
    const { session } = await makeSession({
      llm,
      tools: [
        {
          name: 'stello_create_session',
          description: 'create child session',
          inputSchema: {
            type: 'object',
            properties: {
              label: { type: 'string' },
            },
            required: ['label'],
          },
        },
      ],
    })

    await session.send('创建一个子 session')

    expect(llm.stream).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        tools: [
          expect.objectContaining({
            name: 'stello_create_session',
          }),
        ],
      }),
    )
    expect(llm.complete).not.toHaveBeenCalled()
  })

  it('send() 无 LLM 时抛错', async () => {
    const { session } = await makeSession()
    await expect(session.send('hello')).rejects.toThrow('LLMAdapter is required for send()')
  })

  it('complete-only adapter 在 send/stream 入口 fail-fast，不调用 complete', async () => {
    const complete = vi.fn(async () => ({ content: 'must not run' }))
    const llm = {
      maxContextTokens: 1_000_000,
      complete,
    } as unknown as LLMAdapter
    const { session } = await makeSession({ llm })

    await expect(session.send('send')).rejects.toThrow('LLMAdapter.stream is required for send()')
    expect(() => session.stream('stream')).toThrow('LLMAdapter.stream is required for stream()')
    expect(complete).not.toHaveBeenCalled()
    expect(await session.messages()).toEqual([])
  })

  it('archived session 上调用 send() 抛 SessionArchivedError', async () => {
    const { session } = await makeSession()
    await session.archive()
    await expect(session.send('hello')).rejects.toThrow(SessionArchivedError)
  })

  it('setLLM() 替换 adapter 后 send() 使用新 adapter', async () => {
    const oldLlm = createMockLLM([{ content: 'old response' }])
    const { session } = await makeSession({ llm: oldLlm })

    const newLlm = createMockLLM([{ content: 'new response' }])
    session.setLLM(newLlm)

    const result = await session.send('hello')
    expect(result.content).toBe('new response')
  })

  it('stream() 支持逐 chunk 输出，并在结束后保存 L3', async () => {
    const { session } = await makeSession({
      llm: {
        maxContextTokens: 1_000_000,
        async complete() {
          return { content: '你好，世界' }
        },
        async *stream() {
          yield { delta: '你好，' }
          yield { delta: '世界' }
        },
      },
    })

    const stream = session.stream('hello')
    const chunks: string[] = []
    for await (const chunk of stream) {
      chunks.push(chunk)
    }
    const result = await stream.result

    expect(chunks).toEqual(['你好，', '世界'])
    expect(result.content).toBe('你好，世界')

    const messages = await session.messages()
    expect(messages).toHaveLength(2)
    expect(messages[1]!.content).toBe('你好，世界')
  })

  it('stream() 在 adapter 完成前就把首个 chunk 交给 iterator', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let sourceCompleted = false
    const { session } = await makeSession({
      llm: {
        maxContextTokens: 1_000_000,
        async complete() {
          return { content: 'unused' }
        },
        async *stream() {
          yield { delta: 'first' }
          await gate
          sourceCompleted = true
          yield { delta: 'second' }
        },
      },
    })

    const stream = session.stream('hello')
    const iterator = stream[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toEqual({ value: 'first', done: false })
    expect(sourceCompleted).toBe(false)

    release()
    await expect(iterator.next()).resolves.toEqual({ value: 'second', done: false })
    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true })
    await expect(stream.result).resolves.toMatchObject({ content: 'firstsecond' })
  })

  it('stream() 汇总 adapter chunk usage 并透传到最终结果', async () => {
    const { session } = await makeSession({
      llm: {
        maxContextTokens: 1_000_000,
        async complete() {
          return { content: 'unused' }
        },
        async *stream() {
          yield { delta: '你', usage: { promptTokens: 11, completionTokens: 0 } }
          yield { delta: '好' }
          yield { delta: '', usage: { promptTokens: 11, completionTokens: 2 } }
        },
      },
    })

    const stream = session.stream('hello')
    const chunks: string[] = []
    for await (const chunk of stream) {
      chunks.push(chunk)
    }
    const result = await stream.result

    expect(chunks).toEqual(['你', '好'])
    expect(result.content).toBe('你好')
    expect(result.usage).toEqual({ promptTokens: 11, completionTokens: 2 })
  })

  it('stream() 中途失败时 iterator 与 result 抛同一错误，且 L3 原子不写入', async () => {
    const failure = new Error('stream exploded')
    const { session } = await makeSession({
      llm: {
        maxContextTokens: 1_000_000,
        async complete() {
          return { content: 'unused' }
        },
        async *stream() {
          yield { delta: 'partial' }
          throw failure
        },
      },
    })

    const stream = session.stream('hello')
    const resultError = stream.result.catch((error: unknown) => error)
    const received: string[] = []
    let iteratorError: unknown
    try {
      for await (const chunk of stream) received.push(chunk)
    } catch (error) {
      iteratorError = error
    }

    expect(received).toEqual(['partial'])
    expect(iteratorError).toBe(failure)
    expect(await resultError).toBe(failure)
    expect(await session.messages()).toEqual([])
  })
})

describe('Session.setTools (per-session tool list mutation)', () => {
  it('setTools replaces the tools auto-injected on next send', async () => {
    const llmStream = vi
      .fn<(messages: Message[], options?: LLMCompleteOptions) => AsyncIterable<LLMChunk>>()
      .mockImplementation(() => chunks([{ delta: 'ok' }]))
    const llm = { complete: vi.fn(async () => ({ content: 'unused' })), stream: llmStream, maxContextTokens: 1_000_000 }
    const { session } = await makeSession({
      llm,
      tools: [{ name: 'old', description: 'd', inputSchema: {} }],
    })

    expect(session.tools).toEqual([{ name: 'old', description: 'd', inputSchema: {} }])

    session.setTools([{ name: 'new', description: 'd2', inputSchema: {} }])
    expect(session.tools).toEqual([{ name: 'new', description: 'd2', inputSchema: {} }])

    await session.send('hi')
    const passedTools = llmStream.mock.calls[0]![1]?.tools
    expect(passedTools).toEqual([{ name: 'new', description: 'd2', inputSchema: {} }])
  })

  it('setTools(undefined) clears tools', async () => {
    const llmStream = vi
      .fn<(messages: Message[], options?: LLMCompleteOptions) => AsyncIterable<LLMChunk>>()
      .mockImplementation(() => chunks([{ delta: 'ok' }]))
    const llm = { complete: vi.fn(async () => ({ content: 'unused' })), stream: llmStream, maxContextTokens: 1_000_000 }
    const { session } = await makeSession({
      llm,
      tools: [{ name: 'x', description: 'd', inputSchema: {} }],
    })
    session.setTools(undefined)
    await session.send('hi')
    expect(llmStream.mock.calls[0]![1]?.tools).toBeUndefined()
  })
})
