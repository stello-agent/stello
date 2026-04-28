import { describe, it, expect } from 'vitest'
import { makeSession } from './helpers.js'
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
