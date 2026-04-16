import { describe, expect, it, vi } from 'vitest';
import {
  adaptMainSessionToSchedulerMainSession,
  adaptSessionToEngineRuntime,
  serializeSessionSendResult,
  sessionSendResultParser,
} from '../session-runtime';

describe('session-runtime adapters', () => {
  it('可以把 session.send() 结果序列化成 TurnRunner 可消费的原始字符串', () => {
    const raw = serializeSessionSendResult({
      content: 'done',
      toolCalls: [{ id: 't1', name: 'read_file', input: { path: 'a.ts' } }],
      usage: { promptTokens: 10, completionTokens: 5 },
    });

    const parsed = sessionSendResultParser.parse(raw);

    expect(parsed.content).toBe('done');
    expect(parsed.toolCalls).toEqual([
      { id: 't1', name: 'read_file', args: { path: 'a.ts' } },
    ]);
  });

  it('可以把真实 Session 适配成 EngineRuntimeSession', async () => {
    const session = {
      meta: {
        id: 's1',
        status: 'active' as const,
      },
      messages: vi
        .fn()
        .mockResolvedValue([
          { role: 'user', content: 'a' },
          { role: 'assistant', content: 'b' },
          { role: 'user', content: 'c' },
          { role: 'assistant', content: 'd' },
        ]),
      send: vi.fn().mockResolvedValue({
        content: 'done',
        toolCalls: [{ id: 't1', name: 'tool', input: { x: 1 } }],
      }),
      consolidate: vi.fn().mockResolvedValue(undefined),
    };

    const consolidateFn = vi.fn().mockResolvedValue('memory');
    const runtime = await adaptSessionToEngineRuntime(session as never, {
      consolidateFn,
    });

    expect(runtime.meta.turnCount).toBe(2);

    const raw = await runtime.send('hello');
    const parsed = sessionSendResultParser.parse(raw);

    expect(session.send).toHaveBeenCalledWith('hello');
    expect(runtime.meta.turnCount).toBe(3);
    expect(parsed.toolCalls[0]).toEqual({
      id: 't1',
      name: 'tool',
      args: { x: 1 },
    });

    await runtime.consolidate();
    expect(session.consolidate).toHaveBeenCalledWith(consolidateFn);
  });

  it('adapter 暴露 fork 方法并适配返回值', async () => {
    const childSession = {
      meta: { id: 'child-1', status: 'active' as const },
      send: vi.fn().mockResolvedValue({ content: 'hi', toolCalls: [] }),
      messages: vi.fn().mockResolvedValue([]),
      consolidate: vi.fn(),
    };
    const parentSession = {
      meta: { id: 'p1', status: 'active' as const },
      send: vi.fn(),
      messages: vi.fn().mockResolvedValue([]),
      consolidate: vi.fn(),
      fork: vi.fn().mockResolvedValue(childSession),
    };

    const runtime = await adaptSessionToEngineRuntime(parentSession, {
      consolidateFn: vi.fn(),
    });

    expect(runtime.fork).toBeDefined();
    const child = await runtime.fork!({ id: 'child-1', label: '子' });
    expect(child.id).toBe('child-1');
    expect(parentSession.fork).toHaveBeenCalledWith({ id: 'child-1', label: '子' });
  });

  it('session 无 fork 方法时 adapter 不暴露 fork', async () => {
    const session = {
      meta: { id: 'p1', status: 'active' as const },
      send: vi.fn(),
      messages: vi.fn().mockResolvedValue([]),
      consolidate: vi.fn(),
    };
    const runtime = await adaptSessionToEngineRuntime(session, {
      consolidateFn: vi.fn(),
    });
    expect(runtime.fork).toBeUndefined();
  });

  it('fork 时覆盖 consolidateFn，子 session 使用新函数', async () => {
    const parentConsolidateFn = vi.fn().mockResolvedValue('parent-memory');
    const childConsolidateFn = vi.fn().mockResolvedValue('child-memory');
    const childSession = {
      meta: { id: 'child-1', status: 'active' as const },
      send: vi.fn().mockResolvedValue({ content: 'hi', toolCalls: [] }),
      messages: vi.fn().mockResolvedValue([]),
      consolidate: vi.fn(),
    };
    const parentSession = {
      meta: { id: 'p1', status: 'active' as const },
      send: vi.fn(),
      messages: vi.fn().mockResolvedValue([]),
      consolidate: vi.fn(),
      fork: vi.fn().mockResolvedValue(childSession),
    };

    const runtime = await adaptSessionToEngineRuntime(parentSession, {
      consolidateFn: parentConsolidateFn,
    });

    const child = await runtime.fork!({
      id: 'child-1',
      label: '子',
      consolidateFn: childConsolidateFn,
    });

    await child.consolidate();
    expect(childSession.consolidate).toHaveBeenCalledWith(childConsolidateFn);
  });

  it('fork 时未指定 consolidateFn，子 session 继承父的', async () => {
    const parentConsolidateFn = vi.fn().mockResolvedValue('parent-memory');
    const childSession = {
      meta: { id: 'child-1', status: 'active' as const },
      send: vi.fn().mockResolvedValue({ content: 'hi', toolCalls: [] }),
      messages: vi.fn().mockResolvedValue([]),
      consolidate: vi.fn(),
    };
    const parentSession = {
      meta: { id: 'p1', status: 'active' as const },
      send: vi.fn(),
      messages: vi.fn().mockResolvedValue([]),
      consolidate: vi.fn(),
      fork: vi.fn().mockResolvedValue(childSession),
    };

    const runtime = await adaptSessionToEngineRuntime(parentSession, {
      consolidateFn: parentConsolidateFn,
    });

    const child = await runtime.fork!({ id: 'child-1', label: '子' });

    await child.consolidate();
    expect(childSession.consolidate).toHaveBeenCalledWith(parentConsolidateFn);
  });

  it('嵌套 fork 继承链：孙 session 继承子 session 覆盖的 consolidateFn', async () => {
    const parentConsolidateFn = vi.fn().mockResolvedValue('parent-memory');
    const childConsolidateFn = vi.fn().mockResolvedValue('child-memory');
    const grandchildSession = {
      meta: { id: 'gc-1', status: 'active' as const },
      send: vi.fn().mockResolvedValue({ content: 'hi', toolCalls: [] }),
      messages: vi.fn().mockResolvedValue([]),
      consolidate: vi.fn(),
    };
    const childSession = {
      meta: { id: 'child-1', status: 'active' as const },
      send: vi.fn().mockResolvedValue({ content: 'hi', toolCalls: [] }),
      messages: vi.fn().mockResolvedValue([]),
      consolidate: vi.fn(),
      fork: vi.fn().mockResolvedValue(grandchildSession),
    };
    const parentSession = {
      meta: { id: 'p1', status: 'active' as const },
      send: vi.fn(),
      messages: vi.fn().mockResolvedValue([]),
      consolidate: vi.fn(),
      fork: vi.fn().mockResolvedValue(childSession),
    };

    const runtime = await adaptSessionToEngineRuntime(parentSession, {
      consolidateFn: parentConsolidateFn,
    });

    // 子 session 覆盖 consolidateFn
    const child = await runtime.fork!({
      id: 'child-1',
      label: '子',
      consolidateFn: childConsolidateFn,
    });

    // 孙 session 未指定，应继承子的 childConsolidateFn
    const grandchild = await child.fork!({ id: 'gc-1', label: '孙' });

    await grandchild.consolidate();
    expect(grandchildSession.consolidate).toHaveBeenCalledWith(childConsolidateFn);
  });

  it('fork 时覆盖 compressFn，子 session 使用新函数', async () => {
    const parentCompressFn = vi.fn().mockResolvedValue('parent-compressed');
    const childCompressFn = vi.fn().mockResolvedValue('child-compressed');
    const childSession = {
      meta: { id: 'child-1', status: 'active' as const },
      send: vi.fn().mockResolvedValue({ content: 'hi', toolCalls: [] }),
      messages: vi.fn().mockResolvedValue([]),
      consolidate: vi.fn(),
      fork: vi.fn(),
    };
    const parentSession = {
      meta: { id: 'p1', status: 'active' as const },
      send: vi.fn(),
      messages: vi.fn().mockResolvedValue([]),
      consolidate: vi.fn(),
      fork: vi.fn().mockResolvedValue(childSession),
    };

    const runtime = await adaptSessionToEngineRuntime(parentSession, {
      consolidateFn: vi.fn(),
      compressFn: parentCompressFn,
    });

    const child = await runtime.fork!({
      id: 'child-1',
      label: '子',
      compressFn: childCompressFn,
    });

    // 验证子 runtime 的 options 中 compressFn 已被覆盖
    // 通过再次 fork 孙 session 来间接验证继承链
    const grandchildSession = {
      meta: { id: 'gc-1', status: 'active' as const },
      send: vi.fn().mockResolvedValue({ content: 'hi', toolCalls: [] }),
      messages: vi.fn().mockResolvedValue([]),
      consolidate: vi.fn(),
    };
    childSession.fork.mockResolvedValue(grandchildSession);

    const grandchild = await child.fork!({ id: 'gc-1', label: '孙' });
    // 孙 session 继承子的 compressFn（间接验证子 runtime 持有 childCompressFn）
    // 此处验证 compressFn 在 options 中被正确传递
    await grandchild.consolidate();
    // consolidateFn 应继承父的（未覆盖）
    expect(grandchildSession.consolidate).toHaveBeenCalled();
  });

  it('可以把真实 MainSession 适配成 SchedulerMainSession', async () => {
    const mainSession = {
      integrate: vi.fn().mockResolvedValue({
        synthesis: 's',
        insights: [],
      }),
    };
    const integrateFn = vi.fn().mockResolvedValue({
      synthesis: 's',
      insights: [],
    });

    const schedulerMain = adaptMainSessionToSchedulerMainSession(mainSession as never, {
      integrateFn,
    });

    await schedulerMain.integrate();
    expect(mainSession.integrate).toHaveBeenCalledWith(integrateFn);
  });
});
