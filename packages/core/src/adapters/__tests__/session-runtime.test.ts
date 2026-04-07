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
