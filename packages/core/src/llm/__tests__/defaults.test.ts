import { describe, expect, it, vi } from 'vitest'
import { createDefaultIntegrateFn, DEFAULT_INTEGRATE_PROMPT, type LLMCallFn } from '../defaults.js'

describe('createDefaultIntegrateFn', () => {
  it('在传给 LLM 的子 Session 摘要中包含真实 sessionId', async () => {
    const llm = vi.fn<LLMCallFn>(async () => JSON.stringify({
      synthesis: '综合结果',
      insights: [{ sessionId: 'sess-1', content: '继续推进' }],
    }))
    const fn = createDefaultIntegrateFn(DEFAULT_INTEGRATE_PROMPT, llm)

    await fn([
      { sessionId: 'sess-1', label: '选校', l2: '已完成第一轮筛选' },
      { sessionId: 'sess-2', label: '文书', l2: 'PS 初稿待修改' },
    ], null)

    expect(llm).toHaveBeenCalledTimes(1)
    const [messages] = llm.mock.calls[0]!
    expect(messages[1]?.content).toContain('[sessionId=sess-1] 选校: 已完成第一轮筛选')
    expect(messages[1]?.content).toContain('[sessionId=sess-2] 文书: PS 初稿待修改')
  })
})
