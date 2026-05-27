import { describe, expect, it, vi } from 'vitest'
import type { LLMAdapter } from '@stello-ai/session'
import {
  createDefaultCompressFn,
  createDefaultConsolidateFn,
  DEFAULT_COMPRESS_PROMPT,
  DEFAULT_CONSOLIDATE_PROMPT,
  llmCallFnFromAdapter,
  type LLMCallFn,
} from '../defaults.js'

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

describe('label option in DefaultFnOptions', () => {
  it('prepends [session: {label}] to compress user prompt when label set', async () => {
    let captured: any[] = [];
    const llm = async (msgs: any[]) => { captured = msgs; return 'summary'; };
    const fn = createDefaultCompressFn('PROMPT', llm, { label: 'Alpha' });
    await fn([{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }]);
    const userMsg = captured.find(m => m.role === 'user');
    expect(userMsg.content.startsWith('[session: Alpha]\n\n')).toBe(true);
    expect(userMsg.content).toContain('对话记录:');
  });

  it('omits prefix when label undefined', async () => {
    let captured: any[] = [];
    const llm = async (msgs: any[]) => { captured = msgs; return 'summary'; };
    const fn = createDefaultCompressFn('PROMPT', llm);
    await fn([{ role: 'user', content: 'hi' }]);
    const userMsg = captured.find(m => m.role === 'user');
    expect(userMsg.content.startsWith('[session:')).toBe(false);
  });

  it('prepends [session: {label}] to consolidate user prompt before "当前摘要"', async () => {
    let captured: any[] = [];
    const llm = async (msgs: any[]) => { captured = msgs; return 'new memory'; };
    const fn = createDefaultConsolidateFn('PROMPT', llm, { label: 'Beta' });
    await fn('old memory', [{ role: 'user', content: 'x' }]);
    const userMsg = captured.find(m => m.role === 'user');
    expect(userMsg.content.startsWith('[session: Beta]\n\n当前摘要:')).toBe(true);
  });

  it('omits prefix in consolidate when label undefined', async () => {
    let captured: any[] = [];
    const llm = async (msgs: any[]) => { captured = msgs; return 'new'; };
    const fn = createDefaultConsolidateFn('PROMPT', llm);
    await fn(null, [{ role: 'user', content: 'x' }]);
    const userMsg = captured.find(m => m.role === 'user');
    expect(userMsg.content.startsWith('[session:')).toBe(false);
  });

  it('coexists with roleContext (both injected)', async () => {
    let captured: any[] = [];
    const llm = async (msgs: any[]) => { captured = msgs; return 's'; };
    const fn = createDefaultCompressFn('PROMPT', llm, { label: 'L', roleContext: 'RC' });
    await fn([{ role: 'user', content: 'x' }]);
    const systemContents = captured.filter(m => m.role === 'system').map(m => m.content);
    expect(systemContents.some(c => c.includes('<role_context>\nRC\n</role_context>'))).toBe(true);
    const userMsg = captured.find(m => m.role === 'user');
    expect(userMsg.content.startsWith('[session: L]')).toBe(true);
  });
});

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
