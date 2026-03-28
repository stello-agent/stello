import { describe, it, expect, vi } from 'vitest'
import { createMainSession } from '../create-main-session.js'
import { createSession } from '../create-session.js'
import { InMemoryStorageAdapter } from '../mocks/in-memory-storage.js'
import { SessionArchivedError } from '../types/session-api.js'
import type { IntegrateFn } from '../types/functions.js'
import type { LLMAdapter, LLMResult, Message } from '../types/llm.js'

/** 创建 mock LLMAdapter */
function makeMockLLM(response: Partial<LLMResult> = {}): LLMAdapter {
  return {
    maxContextTokens: 1_000_000,
    complete: vi.fn(async () => ({
      content: response.content ?? 'mock response',
      toolCalls: response.toolCalls,
      usage: response.usage ?? { promptTokens: 10, completionTokens: 5 },
    })),
  }
}

/** 快速创建测试用 MainSession */
async function makeMainSession(options?: { llm?: LLMAdapter }) {
  const storage = new InMemoryStorageAdapter()
  const main = await createMainSession({ storage, label: 'Test Main', llm: options?.llm })
  return { main, storage }
}

/** 创建 MainSession + 带 L2 的子 Session */
async function makeWithChildren() {
  const storage = new InMemoryStorageAdapter()
  const main = await createMainSession({ storage })

  const child1 = await createSession({
    storage, label: '选校',
  })
  const child2 = await createSession({
    storage, label: '文书',
  })

  // 写入 L2
  await storage.putMemory(child1.meta.id, '已确定 top5 CS 项目')
  await storage.putMemory(child2.meta.id, 'PS 初稿已完成')

  return { main, storage, child1, child2 }
}

describe('MainSession meta', () => {
  it('创建后 role 为 main', async () => {
    const { main } = await makeMainSession()
    expect(main.meta.role).toBe('main')
    expect(main.meta.status).toBe('active')
  })

  it('updateMeta 更新 label', async () => {
    const { main } = await makeMainSession()
    await main.updateMeta({ label: 'Updated' })
    expect(main.meta.label).toBe('Updated')
  })

  it('archive 后 status 变为 archived', async () => {
    const { main } = await makeMainSession()
    await main.archive()
    expect(main.meta.status).toBe('archived')
  })

  it('archived 后 updateMeta 抛错', async () => {
    const { main } = await makeMainSession()
    await main.archive()
    await expect(main.updateMeta({ label: 'X' })).rejects.toThrow(SessionArchivedError)
  })
})

describe('MainSession synthesis()', () => {
  it('初始 synthesis 为 null', async () => {
    const { main } = await makeMainSession()
    expect(await main.synthesis()).toBeNull()
  })

  it('integrate 后 synthesis 可读', async () => {
    const { main } = await makeWithChildren()

    const fn: IntegrateFn = async (children) => ({
      synthesis: `共 ${children.length} 个子任务`,
      insights: [],
    })
    await main.integrate(fn)

    expect(await main.synthesis()).toBe('共 2 个子任务')
  })
})

describe('MainSession integrate()', () => {
  it('IntegrateFn 接收所有子 Session 的 L2', async () => {
    const { main } = await makeWithChildren()

    const fn = vi.fn<IntegrateFn>(async () => ({
      synthesis: 'ok',
      insights: [],
    }))
    await main.integrate(fn)

    expect(fn).toHaveBeenCalledTimes(1)
    const children = fn.mock.calls[0]![0]
    expect(children).toHaveLength(2)
    expect(children.map((c) => c.label).sort()).toEqual(['文书', '选校'])
    expect(children.find((c) => c.label === '选校')?.l2).toBe('已确定 top5 CS 项目')
  })

  it('IntegrateFn 接收当前 synthesis', async () => {
    const { main } = await makeWithChildren()

    // 先做一次 integrate
    await main.integrate(async () => ({
      synthesis: 'first synthesis',
      insights: [],
    }))

    // 第二次应收到 first synthesis
    const fn = vi.fn<IntegrateFn>(async (_children, current) => ({
      synthesis: `updated from: ${current}`,
      insights: [],
    }))
    await main.integrate(fn)

    expect(fn.mock.calls[0]![1]).toBe('first synthesis')
    expect(await main.synthesis()).toBe('updated from: first synthesis')
  })

  it('insights 推送到子 Session', async () => {
    const { main, storage, child1, child2 } = await makeWithChildren()

    await main.integrate(async () => ({
      synthesis: 'overview',
      insights: [
        { sessionId: child1.meta.id, content: '加快进度' },
        { sessionId: child2.meta.id, content: 'DDL 临近' },
      ],
    }))

    // 验证 insights 已写入子 Session
    const insight1 = await storage.getInsight(child1.meta.id)
    const insight2 = await storage.getInsight(child2.meta.id)
    expect(insight1).toBeTruthy()
    expect(insight2).toBeTruthy()
  })

  it('忽略返回给不存在 sessionId 的 insights', async () => {
    const { main, storage, child1 } = await makeWithChildren()

    const result = await main.integrate(async () => ({
      synthesis: 'overview',
      insights: [
        { sessionId: child1.meta.id, content: '保留这条' },
        { sessionId: 'fake-session-id', content: '丢弃这条' },
      ],
    }))

    expect(result.insights).toEqual([
      { sessionId: child1.meta.id, content: '保留这条' },
    ])
    expect(await storage.getInsight(child1.meta.id)).toBe('保留这条')
    expect(await storage.getInsight('fake-session-id')).toBeNull()
  })

  it('无子 Session 时 IntegrateFn 接收空数组', async () => {
    const { main } = await makeMainSession()

    const fn = vi.fn<IntegrateFn>(async () => ({
      synthesis: 'empty',
      insights: [],
    }))
    await main.integrate(fn)

    expect(fn.mock.calls[0]![0]).toEqual([])
  })

  it('archived 后 integrate 抛错', async () => {
    const { main } = await makeMainSession()
    await main.archive()
    await expect(main.integrate(async () => ({
      synthesis: '', insights: [],
    }))).rejects.toThrow(SessionArchivedError)
  })
})

describe('MainSession systemPrompt()', () => {
  it('初始返回 null（未设置时）', async () => {
    const { main } = await makeMainSession()
    expect(await main.systemPrompt()).toBeNull()
  })

  it('createMainSession 传入 systemPrompt 后可读', async () => {
    const storage = new InMemoryStorageAdapter()
    const main = await createMainSession({ storage, systemPrompt: 'Main prompt' })
    expect(await main.systemPrompt()).toBe('Main prompt')
  })

  it('setSystemPrompt + systemPrompt 往返正确', async () => {
    const { main } = await makeMainSession()
    await main.setSystemPrompt('New prompt')
    expect(await main.systemPrompt()).toBe('New prompt')
  })

  it('archived 后 setSystemPrompt 抛错', async () => {
    const { main } = await makeMainSession()
    await main.archive()
    await expect(main.setSystemPrompt('x')).rejects.toThrow(SessionArchivedError)
  })
})

describe('MainSession send()', () => {
  it('调用 LLM 并返回 SendResult', async () => {
    const llm = makeMockLLM({ content: 'hello back' })
    const { main } = await makeMainSession({ llm })

    const result = await main.send('hello')

    expect(result.content).toBe('hello back')
    expect(result.usage).toBeDefined()
    expect(llm.complete).toHaveBeenCalledTimes(1)
  })

  it('返回 toolCalls 时会把 assistant toolCalls 写入 L3', async () => {
    const llm = makeMockLLM({
      content: '',
      toolCalls: [{ id: 'tc_1', name: 'search', input: { q: 'test' } }],
    })
    const { main } = await makeMainSession({ llm })

    await main.send('搜索 test')

    const messages = await main.messages()
    expect(messages).toHaveLength(2)
    expect(messages[1]!.role).toBe('assistant')
    expect(messages[1]!.toolCalls).toEqual([{ id: 'tc_1', name: 'search', input: { q: 'test' } }])
  })

  it('toolResults continuation 会回放 assistant toolCalls 和 tool 消息', async () => {
    const llm = {
      maxContextTokens: 1_000_000,
      complete: vi
        .fn()
        .mockResolvedValueOnce({
          content: '',
          toolCalls: [{ id: 'tc_1', name: 'search', input: { q: 'test' } }],
        })
        .mockResolvedValueOnce({
          content: '最终答案',
          usage: { promptTokens: 10, completionTokens: 5 },
        }),
    } satisfies LLMAdapter
    const { main } = await makeMainSession({ llm })

    await main.send('搜索 test')
    await main.send(JSON.stringify({
      toolResults: [{
        toolCallId: 'tc_1',
        toolName: 'search',
        args: { q: 'test' },
        success: true,
        data: { hits: 2 },
        error: null,
      }],
    }))

    const secondCall = (llm.complete as ReturnType<typeof vi.fn>).mock.calls[1]![0] as Array<Message>
    expect(secondCall[0]).toMatchObject({ role: 'user', content: '搜索 test' })
    expect(secondCall[1]).toMatchObject({
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'tc_1', name: 'search', input: { q: 'test' } }],
    })
    expect(secondCall[2]).toMatchObject({ role: 'tool', toolCallId: 'tc_1' })

    const persisted = await main.messages()
    expect(persisted.map((message) => message.role)).toEqual(['user', 'assistant', 'tool', 'assistant'])
  })

  it('自动存 L3（user + assistant）', async () => {
    const llm = makeMockLLM()
    const { main } = await makeMainSession({ llm })

    await main.send('hello')

    const messages = await main.messages()
    expect(messages).toHaveLength(2)
    expect(messages[0]!.role).toBe('user')
    expect(messages[0]!.content).toBe('hello')
    expect(messages[1]!.role).toBe('assistant')
    expect(messages[1]!.content).toBe('mock response')
  })

  it('上下文使用 synthesis 而非 insights', async () => {
    const llm = makeMockLLM()
    const storage = new InMemoryStorageAdapter()
    const main = await createMainSession({
      storage, llm, systemPrompt: 'You are helpful',
    })

    // 写入 synthesis
    await storage.putMemory(main.meta.id, 'synthesis content')
    // 写入 insight（不应出现在上下文中）
    await storage.putInsight(main.meta.id, 'insight content')

    await main.send('hello')

    const calledMessages = (llm.complete as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    const systemMessages = calledMessages.filter((m: { role: string }) => m.role === 'system')
    expect(systemMessages).toHaveLength(2)
    expect(systemMessages[0].content).toBe('You are helpful')
    expect(systemMessages[1].content).toBe('synthesis content')
    // insights 不应出现
    expect(calledMessages.every((m: { content: string }) => m.content !== 'insight content')).toBe(true)
  })

  it('无 LLM 时抛错', async () => {
    const { main } = await makeMainSession()
    await expect(main.send('hello')).rejects.toThrow('LLMAdapter is required for send()')
  })

  it('archived 时抛 SessionArchivedError', async () => {
    const llm = makeMockLLM()
    const { main } = await makeMainSession({ llm })
    await main.archive()
    await expect(main.send('hello')).rejects.toThrow(SessionArchivedError)
  })

  it('stream() 流式输出', async () => {
    const llm: LLMAdapter = {
      maxContextTokens: 1_000_000,
      complete: vi.fn(async () => ({ content: 'hello stream' })),
      async *stream() {
        yield { delta: 'hello ' }
        yield { delta: 'stream' }
      },
    }
    const { main } = await makeMainSession({ llm })

    const stream = main.stream('hello')
    const chunks: string[] = []
    for await (const chunk of stream) {
      chunks.push(chunk)
    }
    const result = await stream.result

    expect(chunks).toEqual(['hello ', 'stream'])
    expect(result.content).toBe('hello stream')

    const messages = await main.messages()
    expect(messages).toHaveLength(2)
    expect(messages[1]!.content).toBe('hello stream')
  })
})
