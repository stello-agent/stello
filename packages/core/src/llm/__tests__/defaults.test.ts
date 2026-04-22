import { describe, expect, it, vi } from 'vitest'
import type { LLMAdapter } from '@stello-ai/session'
import {
  createDefaultCompressFn,
  createDefaultConsolidateFn,
  createDefaultIntegrateFn,
  DEFAULT_COMPRESS_PROMPT,
  DEFAULT_CONSOLIDATE_PROMPT,
  DEFAULT_INTEGRATE_PROMPT,
  llmCallFnFromAdapter,
  type LLMCallFn,
} from '../defaults.js'

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

  it('无 roleContext 时不额外注入 system 消息（向后兼容）', async () => {
    const llm = vi.fn<LLMCallFn>(async () => JSON.stringify({ synthesis: '', insights: [] }))
    const fn = createDefaultIntegrateFn(DEFAULT_INTEGRATE_PROMPT, llm)
    await fn([{ sessionId: 's1', label: 'x', l2: 'y' }], null)
    const [messages] = llm.mock.calls[0]!
    expect(messages).toHaveLength(2)
    expect(messages[0]?.role).toBe('system')
    expect(messages[1]?.role).toBe('user')
  })

  it('传入 roleContext 时在任务 prompt 后插入 <role_context> system 消息', async () => {
    const llm = vi.fn<LLMCallFn>(async () => JSON.stringify({ synthesis: '', insights: [] }))
    const fn = createDefaultIntegrateFn(DEFAULT_INTEGRATE_PROMPT, llm, {
      roleContext: '你是 MainSession 的协调者',
    })
    await fn([{ sessionId: 's1', label: 'x', l2: 'y' }], null)
    const [messages] = llm.mock.calls[0]!
    expect(messages).toHaveLength(3)
    expect(messages[0]?.role).toBe('system')
    expect(messages[0]?.content).toBe(DEFAULT_INTEGRATE_PROMPT)
    expect(messages[1]?.role).toBe('system')
    expect(messages[1]?.content).toBe('<role_context>\n你是 MainSession 的协调者\n</role_context>')
    expect(messages[2]?.role).toBe('user')
  })

  it('roleContext 为空字符串时视为未传（不注入）', async () => {
    const llm = vi.fn<LLMCallFn>(async () => JSON.stringify({ synthesis: '', insights: [] }))
    const fn = createDefaultIntegrateFn(DEFAULT_INTEGRATE_PROMPT, llm, { roleContext: '' })
    await fn([{ sessionId: 's1', label: 'x', l2: 'y' }], null)
    const [messages] = llm.mock.calls[0]!
    expect(messages).toHaveLength(2)
  })
})

describe('createDefaultConsolidateFn', () => {
  it('无 roleContext 时消息结构为 [system:prompt, user:content]', async () => {
    const llm = vi.fn<LLMCallFn>(async () => '摘要结果')
    const fn = createDefaultConsolidateFn(DEFAULT_CONSOLIDATE_PROMPT, llm)
    await fn(null, [{ role: 'user', content: 'hi' }])
    const [messages] = llm.mock.calls[0]!
    expect(messages).toHaveLength(2)
    expect(messages[0]?.role).toBe('system')
    expect(messages[0]?.content).toBe(DEFAULT_CONSOLIDATE_PROMPT)
    expect(messages[1]?.role).toBe('user')
  })

  it('传入 roleContext 时插入 <role_context> system 消息', async () => {
    const llm = vi.fn<LLMCallFn>(async () => '摘要结果')
    const fn = createDefaultConsolidateFn(DEFAULT_CONSOLIDATE_PROMPT, llm, {
      roleContext: '你是留学顾问',
    })
    await fn(null, [{ role: 'user', content: 'hi' }])
    const [messages] = llm.mock.calls[0]!
    expect(messages).toHaveLength(3)
    expect(messages[1]?.role).toBe('system')
    expect(messages[1]?.content).toBe('<role_context>\n你是留学顾问\n</role_context>')
  })

  it('roleContext 为空字符串时视为未传', async () => {
    const llm = vi.fn<LLMCallFn>(async () => 'x')
    const fn = createDefaultConsolidateFn(DEFAULT_CONSOLIDATE_PROMPT, llm, { roleContext: '' })
    await fn(null, [{ role: 'user', content: 'hi' }])
    const [messages] = llm.mock.calls[0]!
    expect(messages).toHaveLength(2)
  })
})

describe('createDefaultCompressFn', () => {
  it('无 roleContext 时消息结构为 [system:prompt, user:content]', async () => {
    const llm = vi.fn<LLMCallFn>(async () => '压缩摘要')
    const fn = createDefaultCompressFn(DEFAULT_COMPRESS_PROMPT, llm)
    await fn([{ role: 'user', content: 'hi' }])
    const [messages] = llm.mock.calls[0]!
    expect(messages).toHaveLength(2)
    expect(messages[0]?.content).toBe(DEFAULT_COMPRESS_PROMPT)
  })

  it('传入 roleContext 时插入 <role_context> system 消息', async () => {
    const llm = vi.fn<LLMCallFn>(async () => '压缩摘要')
    const fn = createDefaultCompressFn(DEFAULT_COMPRESS_PROMPT, llm, {
      roleContext: '你是北美区域专家',
    })
    await fn([{ role: 'user', content: 'hi' }])
    const [messages] = llm.mock.calls[0]!
    expect(messages).toHaveLength(3)
    expect(messages[1]?.content).toBe('<role_context>\n你是北美区域专家\n</role_context>')
  })

  it('roleContext 为空字符串时视为未传', async () => {
    const llm = vi.fn<LLMCallFn>(async () => 'x')
    const fn = createDefaultCompressFn(DEFAULT_COMPRESS_PROMPT, llm, { roleContext: '' })
    await fn([{ role: 'user', content: 'hi' }])
    const [messages] = llm.mock.calls[0]!
    expect(messages).toHaveLength(2)
  })
})

describe('llmCallFnFromAdapter', () => {
  it('forwards messages to adapter.complete and returns content', async () => {
    const adapter = {
      complete: vi.fn(async () => ({ content: 'hello' })),
    } as unknown as LLMAdapter
    const fn = llmCallFnFromAdapter(adapter)
    const result = await fn([{ role: 'user', content: 'hi' }])
    expect(result).toBe('hello')
    expect(adapter.complete).toHaveBeenCalledWith([{ role: 'user', content: 'hi' }])
  })

  it('coerces null content to empty string', async () => {
    const adapter = {
      complete: vi.fn(async () => ({ content: null })),
    } as unknown as LLMAdapter
    const fn = llmCallFnFromAdapter(adapter)
    expect(await fn([{ role: 'user', content: 'x' }])).toBe('')
  })
})
