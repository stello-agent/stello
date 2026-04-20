import { describe, it, expect, vi } from 'vitest'
import { applyCompressContext, ForkConfigError } from '../fork-compress'
import type { LLMCallFn } from '../../llm/defaults'

const makeMessages = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `msg${i}`,
  }))

describe('applyCompressContext', () => {
  it('非 compress 上下文直接透传', async () => {
    const result = await applyCompressContext({
      context: 'inherit',
      systemPrompt: 'role',
      compressFn: undefined,
      llmCallFn: undefined,
      sourceMessages: async () => makeMessages(2),
    })
    expect(result).toEqual({ systemPrompt: 'role', forwardedContext: 'inherit' })
  })

  it('compress + compressFn 可用：追加 <parent_context> 段,forwardedContext=none', async () => {
    const compressFn = vi.fn(async () => '摘要内容')
    const result = await applyCompressContext({
      context: 'compress',
      systemPrompt: 'role',
      compressFn,
      llmCallFn: undefined,
      sourceMessages: async () => makeMessages(4),
    })
    expect(compressFn).toHaveBeenCalledOnce()
    expect(result.systemPrompt).toBe('role\n\n<parent_context>\n摘要内容\n</parent_context>')
    expect(result.forwardedContext).toBe('none')
  })

  it('compress + 父消息为空：跳过压缩,不追加,forwardedContext=none', async () => {
    const compressFn = vi.fn()
    const result = await applyCompressContext({
      context: 'compress',
      systemPrompt: 'role',
      compressFn,
      llmCallFn: undefined,
      sourceMessages: async () => [],
    })
    expect(compressFn).not.toHaveBeenCalled()
    expect(result.systemPrompt).toBe('role')
    expect(result.forwardedContext).toBe('none')
  })

  it('compress + systemPrompt 为 undefined：以空字符串起头追加', async () => {
    const result = await applyCompressContext({
      context: 'compress',
      systemPrompt: undefined,
      compressFn: async () => 'X',
      llmCallFn: undefined,
      sourceMessages: async () => makeMessages(2),
    })
    expect(result.systemPrompt).toBe('\n\n<parent_context>\nX\n</parent_context>')
    expect(result.forwardedContext).toBe('none')
  })

  it('compress + 无 compressFn 但有 llmCallFn：fallback 用 DEFAULT_COMPRESS_PROMPT 构建', async () => {
    const llmCallFn = vi.fn<LLMCallFn>(async () => 'fallback-summary')
    const result = await applyCompressContext({
      context: 'compress',
      systemPrompt: 'r',
      compressFn: undefined,
      llmCallFn,
      sourceMessages: async () => makeMessages(2),
    })
    expect(llmCallFn).toHaveBeenCalledOnce()
    expect(result.systemPrompt).toBe('r\n\n<parent_context>\nfallback-summary\n</parent_context>')
    expect(result.forwardedContext).toBe('none')
  })

  it('compress + 无 compressFn 也无 llmCallFn：抛 ForkConfigError', async () => {
    await expect(
      applyCompressContext({
        context: 'compress',
        systemPrompt: 'r',
        compressFn: undefined,
        llmCallFn: undefined,
        sourceMessages: async () => makeMessages(2),
      }),
    ).rejects.toBeInstanceOf(ForkConfigError)
  })

  it('compress + compressFn 抛异常：向上传播', async () => {
    const boom = new Error('LLM down')
    await expect(
      applyCompressContext({
        context: 'compress',
        systemPrompt: 'r',
        compressFn: async () => {
          throw boom
        },
        llmCallFn: undefined,
        sourceMessages: async () => makeMessages(2),
      }),
    ).rejects.toBe(boom)
  })
})
