import { describe, it, expect, vi } from 'vitest'
import { makeSession, createMockLLM } from './helpers.js'
import { SessionArchivedError } from '../types/session-api.js'
import type { LLMResult, Message } from '../types/llm.js'

describe('send() 契约', () => {
  const simpleResponse: LLMResult = {
    content: '你好！',
    usage: { promptTokens: 10, completionTokens: 5 },
  }

  it('send() 调用 LLMAdapter.complete 并返回 SendResult', async () => {
    const llm = createMockLLM([simpleResponse])
    const { session } = await makeSession({ llm })

    const result = await session.send('hello')

    expect(result.content).toBe('你好！')
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5 })
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
    // 劫持 complete 以捕获消息
    const originalComplete = llm.complete.bind(llm)
    llm.complete = async (msgs) => {
      capturedMessages.push([...msgs])
      return originalComplete(msgs)
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
    expect(firstCall[1]).toEqual({ role: 'system', content: '用户偏好简洁回答' })

    // 第二次 send — insight 已消费，不再出现
    await session.send('问题2')

    const secondCall = capturedMessages[1] as Array<{ role: string; content: string }>
    expect(secondCall[0]).toEqual({ role: 'system', content: '你是助手' })
    // L3 历史：user + assistant from first round
    expect(secondCall[1]!.role).toBe('user')
    expect(secondCall[1]!.content).toBe('问题1')
    expect(secondCall[2]!.role).toBe('assistant')
    // 当前用户消息
    expect(secondCall[3]!.role).toBe('user')
    expect(secondCall[3]!.content).toBe('问题2')
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
    const originalComplete = llm.complete.bind(llm)
    llm.complete = async (msgs, options) => {
      capturedMessages.push(msgs.map((msg) => ({ ...msg })))
      return originalComplete(msgs, options)
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
    expect(secondCall[0]).toMatchObject({ role: 'user', content: '搜索 test' })
    expect(secondCall[1]).toMatchObject({
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'tc_1', name: 'search', input: { q: 'test' } }],
    })
    expect(secondCall[2]).toMatchObject({
      role: 'tool',
      toolCallId: 'tc_1',
    })

    const persisted = await session.messages()
    expect(persisted.map((message) => message.role)).toEqual(['user', 'assistant', 'tool', 'assistant'])
  })

  it('send() 会把 tools 定义传给 LLMAdapter.complete', async () => {
    const llm = {
      maxContextTokens: 1_000_000,
      complete: vi.fn(async () => ({ content: null, toolCalls: [] })),
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

    expect(llm.complete).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        tools: [
          expect.objectContaining({
            name: 'stello_create_session',
          }),
        ],
      }),
    )
  })

  it('send() 无 LLM 时抛错', async () => {
    const { session } = await makeSession()
    await expect(session.send('hello')).rejects.toThrow('LLMAdapter is required for send()')
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
})
