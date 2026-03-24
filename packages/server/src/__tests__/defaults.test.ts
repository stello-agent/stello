import { describe, it, expect, vi } from 'vitest'
import {
  createDefaultConsolidateFn,
  createDefaultIntegrateFn,
  type LLMCallFn,
} from '../llm/defaults.js'

describe('createDefaultConsolidateFn', () => {
  it('将 prompt 作为 system message，L3 作为 user message', async () => {
    const llm = vi.fn<LLMCallFn>(async () => 'new L2 summary')
    const fn = createDefaultConsolidateFn('请提炼对话要点', llm)

    const result = await fn(null, [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ])

    expect(result).toBe('new L2 summary')
    expect(llm).toHaveBeenCalledOnce()

    const [messages] = llm.mock.calls[0]!
    expect(messages[0]).toEqual({ role: 'system', content: '请提炼对话要点' })
    expect(messages[1]!.role).toBe('user')
    expect(messages[1]!.content).toContain('user: hello')
    expect(messages[1]!.content).toContain('assistant: hi there')
  })

  it('包含当前 L2 作为上下文', async () => {
    const llm = vi.fn<LLMCallFn>(async () => 'updated L2')
    const fn = createDefaultConsolidateFn('summarize', llm)

    await fn('existing summary', [
      { role: 'user', content: 'new message' },
    ])

    const [messages] = llm.mock.calls[0]!
    expect(messages[1]!.content).toContain('当前摘要:\nexisting summary')
    expect(messages[1]!.content).toContain('对话记录:')
  })

  it('无当前 L2 时不包含摘要部分', async () => {
    const llm = vi.fn<LLMCallFn>(async () => 'new L2')
    const fn = createDefaultConsolidateFn('summarize', llm)

    await fn(null, [{ role: 'user', content: 'msg' }])

    const [messages] = llm.mock.calls[0]!
    expect(messages[1]!.content).not.toContain('当前摘要')
  })
})

describe('createDefaultIntegrateFn', () => {
  it('将 prompt 作为 system message，子 L2 作为 user message', async () => {
    const llm = vi.fn<LLMCallFn>(async () =>
      JSON.stringify({
        synthesis: 'global view',
        insights: [{ sessionId: 's1', content: 'focus more' }],
      }),
    )
    const fn = createDefaultIntegrateFn('请综合所有子 Session', llm)

    const result = await fn(
      [
        { sessionId: 's1', label: 'Session 1', l2: 'about topic A' },
        { sessionId: 's2', label: 'Session 2', l2: 'about topic B' },
      ],
      null,
    )

    expect(result.synthesis).toBe('global view')
    expect(result.insights).toEqual([{ sessionId: 's1', content: 'focus more' }])
    expect(llm).toHaveBeenCalledOnce()

    const [messages] = llm.mock.calls[0]!
    expect(messages[0]).toEqual({ role: 'system', content: '请综合所有子 Session' })
    expect(messages[1]!.content).toContain('Session 1: about topic A')
    expect(messages[1]!.content).toContain('Session 2: about topic B')
  })

  it('包含当前 synthesis 作为上下文', async () => {
    const llm = vi.fn<LLMCallFn>(async () =>
      JSON.stringify({ synthesis: 'updated', insights: [] }),
    )
    const fn = createDefaultIntegrateFn('synthesize', llm)

    await fn(
      [{ sessionId: 's1', label: 'S1', l2: 'data' }],
      'previous synthesis',
    )

    const [messages] = llm.mock.calls[0]!
    expect(messages[1]!.content).toContain('当前综合:\nprevious synthesis')
  })

  it('无当前 synthesis 时不包含综合部分', async () => {
    const llm = vi.fn<LLMCallFn>(async () =>
      JSON.stringify({ synthesis: 'new', insights: [] }),
    )
    const fn = createDefaultIntegrateFn('synthesize', llm)

    await fn([{ sessionId: 's1', label: 'S1', l2: 'data' }], null)

    const [messages] = llm.mock.calls[0]!
    expect(messages[1]!.content).not.toContain('当前综合')
  })
})
