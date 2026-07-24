import { describe, expect, it, vi } from 'vitest'
import { collectLLMStream } from '../llm-stream.js'
import type { LLMChunk } from '../types/llm.js'

function streamFrom(chunks: LLMChunk[]): AsyncIterable<LLMChunk> {
  return {
    async *[Symbol.asyncIterator]() {
      yield* chunks
    },
  }
}

describe('collectLLMStream', () => {
  it('聚合文本、推理内容，并使用最后一份 usage 快照', async () => {
    const chunks: LLMChunk[] = [
      {
        delta: '你',
        reasoningDelta: '先想',
        usage: { promptTokens: 12, completionTokens: 0 },
      },
      { delta: '好', reasoningDelta: '清楚' },
      { delta: '', usage: { promptTokens: 12, completionTokens: 2 } },
    ]
    const observed: LLMChunk[] = []
    let activeHandlers = 0
    let maxActiveHandlers = 0
    const onChunk = vi.fn(async (chunk: LLMChunk) => {
      activeHandlers += 1
      maxActiveHandlers = Math.max(maxActiveHandlers, activeHandlers)
      await Promise.resolve()
      observed.push(chunk)
      activeHandlers -= 1
    })

    const result = await collectLLMStream(streamFrom(chunks), onChunk)

    expect(result).toEqual({
      content: '你好',
      reasoningContent: '先想清楚',
      usage: { promptTokens: 12, completionTokens: 2 },
    })
    expect(observed).toEqual(chunks)
    expect(onChunk).toHaveBeenCalledTimes(3)
    expect(maxActiveHandlers).toBe(1)
  })

  it('没有非空文本 delta 时 content 为 null', async () => {
    const result = await collectLLMStream(streamFrom([{ delta: '', usage: { promptTokens: 3, completionTokens: 1 } }]))

    expect(result).toEqual({
      content: null,
      usage: { promptTokens: 3, completionTokens: 1 },
    })
  })

  it('按 tool index 排序并分别拼接交错的参数 delta', async () => {
    const result = await collectLLMStream(
      streamFrom([
        {
          delta: '',
          toolCallDeltas: [{ index: 2, id: 'tool_2', name: 'second', input: '{"value":' }],
        },
        {
          delta: '',
          toolCallDeltas: [{ index: 0, id: 'tool_0', name: 'first', input: '{"value":' }],
        },
        {
          delta: '',
          toolCallDeltas: [
            { index: 2, input: '2}' },
            { index: 0, input: '0}' },
          ],
        },
      ]),
    )

    expect(result.content).toBeNull()
    expect(result.toolCalls).toEqual([
      { id: 'tool_0', name: 'first', input: { value: 0 } },
      { id: 'tool_2', name: 'second', input: { value: 2 } },
    ])
  })

  it('按到达顺序保留 provider tool events', async () => {
    const first = { id: 'p1', type: 'server_tool_use', raw: { step: 1 } }
    const second = { id: 'p1', type: 'server_tool_result', raw: { step: 2 } }

    const result = await collectLLMStream(
      streamFrom([
        { delta: '', providerToolEvents: [first] },
        { delta: 'done', providerToolEvents: [second] },
      ]),
    )

    expect(result.providerToolEvents).toEqual([first, second])
  })

  it('工具参数 JSON 不完整时拒绝结果', async () => {
    await expect(
      collectLLMStream(
        streamFrom([
          {
            delta: '',
            toolCallDeltas: [{ index: 0, id: 'broken', name: 'tool', input: '{"x":' }],
          },
        ]),
      ),
    ).rejects.toBeInstanceOf(SyntaxError)
  })
})
