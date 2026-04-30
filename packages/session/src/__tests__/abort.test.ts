import { describe, it, expect } from 'vitest'
import { makeSession } from './helpers.js'
import { loadSession } from '../create-session.js'
import { InMemoryStorageAdapter } from '../mocks/in-memory-storage.js'
import type { LLMAdapter, LLMChunk, LLMCompleteOptions, LLMResult, Message } from '../types/llm.js'

/** 让 fetch-style adapter 监听 signal 的最小 LLMAdapter */
function createSignalAwareLLM(behavior: {
  /** complete() 等多久 resolve（毫秒），默认 50ms */
  delayMs?: number
  result?: LLMResult
  chunks?: LLMChunk[]
  /** chunk 之间的间隔（毫秒），默认 20ms */
  streamGapMs?: number
} = {}): LLMAdapter & { calls: { signal?: AbortSignal }[] } {
  const calls: { signal?: AbortSignal }[] = []
  const result = behavior.result ?? { content: 'ok' }
  const chunks = behavior.chunks ?? [{ delta: 'partial' }]
  const delayMs = behavior.delayMs ?? 50
  const streamGapMs = behavior.streamGapMs ?? 20

  return {
    calls,
    maxContextTokens: 1_000_000,
    async complete(_messages: Message[], options?: LLMCompleteOptions): Promise<LLMResult> {
      calls.push({ signal: options?.signal })
      await new Promise<void>((resolve, reject) => {
        if (options?.signal?.aborted) {
          reject(new DOMException('aborted', 'AbortError'))
          return
        }
        const timer = setTimeout(() => {
          options?.signal?.removeEventListener('abort', onAbort)
          resolve()
        }, delayMs)
        const onAbort = () => {
          clearTimeout(timer)
          reject(new DOMException('aborted', 'AbortError'))
        }
        options?.signal?.addEventListener('abort', onAbort, { once: true })
      })
      return result
    },
    async *stream(_messages: Message[], options?: LLMCompleteOptions): AsyncIterable<LLMChunk> {
      calls.push({ signal: options?.signal })
      for (const chunk of chunks) {
        if (options?.signal?.aborted) {
          throw new DOMException('aborted', 'AbortError')
        }
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            options?.signal?.removeEventListener('abort', onAbort)
            resolve()
          }, streamGapMs)
          const onAbort = () => {
            clearTimeout(timer)
            reject(new DOMException('aborted', 'AbortError'))
          }
          options?.signal?.addEventListener('abort', onAbort, { once: true })
        })
        yield chunk
      }
    },
  }
}

describe('Session.send() AbortSignal', () => {
  it('signal abort 触发后 send() reject 为 AbortError，且不写入 L3', async () => {
    const llm = createSignalAwareLLM({ delayMs: 100 })
    const { session } = await makeSession({ llm })

    const controller = new AbortController()
    const promise = session.send('hello', { signal: controller.signal })
    setTimeout(() => controller.abort(), 10)

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })

    const messages = await session.messages()
    expect(messages).toEqual([])
  })

  it('已 abort 的 signal 立即抛出，不调用 LLM', async () => {
    const llm = createSignalAwareLLM()
    const { session } = await makeSession({ llm })
    const controller = new AbortController()
    controller.abort()

    await expect(session.send('hello', { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(llm.calls).toHaveLength(0)
  })

  it('signal 被透传到 LLMAdapter.complete', async () => {
    const llm = createSignalAwareLLM()
    const { session } = await makeSession({ llm })

    const controller = new AbortController()
    await session.send('hello', { signal: controller.signal })

    expect(llm.calls[0]!.signal).toBe(controller.signal)
  })
})

describe('Session.stream() AbortSignal', () => {
  it('流式中段 abort 后迭代器停止，result reject 为 AbortError，L3 不写', async () => {
    const llm = createSignalAwareLLM({
      chunks: [{ delta: 'a' }, { delta: 'b' }, { delta: 'c' }],
      streamGapMs: 30,
    })
    const { session } = await makeSession({ llm })

    const controller = new AbortController()
    const stream = session.stream('hello', { signal: controller.signal })

    const collected: string[] = []
    const iteratorPromise = (async () => {
      for await (const chunk of stream) {
        collected.push(chunk)
        if (collected.length === 1) {
          controller.abort()
        }
      }
    })()

    await expect(stream.result).rejects.toMatchObject({ name: 'AbortError' })
    // 等待 iterator 完成（abort 后会停止）
    await iteratorPromise.catch(() => {})

    const messages = await session.messages()
    expect(messages).toEqual([])
  })

  it('stream() 已 abort 的 signal 立即让 result reject', async () => {
    const llm = createSignalAwareLLM()
    const { session } = await makeSession({ llm })
    const controller = new AbortController()
    controller.abort()

    const stream = session.stream('hello', { signal: controller.signal })
    await expect(stream.result).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('signal 被透传到 LLMAdapter.stream', async () => {
    const llm = createSignalAwareLLM({
      chunks: [{ delta: 'x' }],
    })
    const { session } = await makeSession({ llm })

    const controller = new AbortController()
    const stream = session.stream('hello', { signal: controller.signal })
    const drained: string[] = []
    for await (const chunk of stream) {
      drained.push(chunk)
    }
    await stream.result

    expect(drained.length).toBeGreaterThan(0)
    expect(llm.calls[0]!.signal).toBe(controller.signal)
  })
})

/**
 * 当 tool 执行被 abort 中断后，storage 中会残留 assistant(toolCalls) 但缺对应 tool 结果。
 * 下一次 send/stream 加载历史送给 LLM 时，必须把这种孤儿组过滤掉，
 * 否则 OpenAI-compat adapter 会因协议不一致返回 400（assistant 有 tool_calls 缺响应）。
 */
describe('orphaned tool_calls sanitization (abort recovery)', () => {
  /** 直接往 storage 注入一个携带 orphan 历史的 session */
  async function seedSession(
    storage: InMemoryStorageAdapter,
    sessionId: string,
    records: Message[],
  ): Promise<void> {
    const now = new Date().toISOString()
    await storage.putSession({
      id: sessionId,
      label: 'Test',
      role: 'standard',
      status: 'active',
      tags: [],
      metadata: {},
      createdAt: now,
      updatedAt: now,
    })
    for (const rec of records) {
      await storage.appendRecord(sessionId, rec)
    }
  }

  /** 抓取 LLM 收到的 prompt messages 的 mock adapter */
  function createCapturingLLM(reply: LLMResult = { content: 'ok' }): LLMAdapter & { calls: Message[][] } {
    const calls: Message[][] = []
    const adapter: LLMAdapter = {
      maxContextTokens: 1_000_000,
      async complete(messages) {
        calls.push(messages)
        return reply
      },
    }
    return Object.assign(adapter, { calls })
  }

  it('tail orphan：abort 留下 assistant(toolCalls) 后下一轮 send 不应把孤儿带进 prompt', async () => {
    const storage = new InMemoryStorageAdapter()
    const sessionId = 'tail-orphan'
    await seedSession(storage, sessionId, [
      { role: 'user', content: 'do X' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'tc-tail', name: 'foo', input: {} }],
      },
    ])

    const llm = createCapturingLLM()
    const session = await loadSession(sessionId, { storage, llm })
    expect(session).not.toBeNull()
    await session!.send('follow-up')

    const hasOrphan = llm.calls[0]!.some(
      (m) => m.role === 'assistant' && m.toolCalls?.some((tc) => tc.id === 'tc-tail'),
    )
    expect(hasOrphan).toBe(false)
    // 跟进的 user 消息应当是最末一条
    expect(llm.calls[0]![llm.calls[0]!.length - 1]).toMatchObject({ role: 'user', content: 'follow-up' })
  })

  it('middle orphan：被夹在干净消息中间的 orphan 也必须过滤（仅裁尾不够）', async () => {
    const storage = new InMemoryStorageAdapter()
    const sessionId = 'middle-orphan'
    await seedSession(storage, sessionId, [
      { role: 'user', content: 'first' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'tc-orphan', name: 'foo', input: {} }],
      },
      { role: 'user', content: 'second' },
      { role: 'assistant', content: 'clean response' },
    ])

    const llm = createCapturingLLM()
    const session = await loadSession(sessionId, { storage, llm })
    expect(session).not.toBeNull()
    await session!.send('third')

    const hasOrphan = llm.calls[0]!.some(
      (m) => m.role === 'assistant' && m.toolCalls?.some((tc) => tc.id === 'tc-orphan'),
    )
    expect(hasOrphan).toBe(false)
    // 干净的 assistant 应保留
    const hasClean = llm.calls[0]!.some((m) => m.role === 'assistant' && m.content === 'clean response')
    expect(hasClean).toBe(true)
  })

  it('完整 tool call 组应原样保留（不能误伤）', async () => {
    const storage = new InMemoryStorageAdapter()
    const sessionId = 'complete-group'
    await seedSession(storage, sessionId, [
      { role: 'user', content: 'do Y' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'tc-ok', name: 'bar', input: {} }],
      },
      { role: 'tool', content: 'result', toolCallId: 'tc-ok' },
      { role: 'assistant', content: 'final' },
    ])

    const llm = createCapturingLLM()
    const session = await loadSession(sessionId, { storage, llm })
    expect(session).not.toBeNull()
    await session!.send('next')

    const hasAssistantWithCall = llm.calls[0]!.some(
      (m) => m.role === 'assistant' && m.toolCalls?.some((tc) => tc.id === 'tc-ok'),
    )
    const hasToolResult = llm.calls[0]!.some((m) => m.role === 'tool' && m.toolCallId === 'tc-ok')
    expect(hasAssistantWithCall).toBe(true)
    expect(hasToolResult).toBe(true)
  })
})
