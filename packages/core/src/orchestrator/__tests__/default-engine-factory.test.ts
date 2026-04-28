import { describe, expect, it, vi } from 'vitest';
import type { SessionTree } from '../../types/session';
import type { MemoryEngine } from '../../types/memory';
import type { ConfirmProtocol, SkillRouter } from '../../types/lifecycle';
import { DefaultEngineFactory } from '../default-engine-factory';

describe('DefaultEngineFactory', () => {
  const baseOptions = () => ({
    sessions: {
      archive: vi.fn(),
      getNode: vi.fn(),
      getTree: vi.fn(),
      updateMeta: vi.fn().mockResolvedValue(undefined),
    } as unknown as SessionTree,
    memory: {} as MemoryEngine,
    skills: {
      get: vi.fn().mockReturnValue(undefined),
      register: vi.fn(),
      getAll: vi.fn().mockReturnValue([]),
    } as unknown as SkillRouter,
    confirm: {} as ConfirmProtocol,
    agent: {} as never,
    lifecycle: {
      bootstrap: vi.fn().mockResolvedValue({
        context: { core: {}, memories: [], currentMemory: null, scope: null },
        session: { id: 's1' },
      }),
      afterTurn: vi.fn(),
    },
    tools: {
      getToolDefinitions: vi.fn().mockReturnValue([]),
      executeTool: vi.fn(),
    },
  });

  const makeSession = (id = 's1') => ({
    id,
    meta: { id, turnCount: 0, status: 'active' as const },
    turnCount: 0,
    send: vi.fn().mockResolvedValue(JSON.stringify({ content: 'done', toolCalls: [] })),
    consolidate: vi.fn(),
    setTools: vi.fn(),
  });

  it('会把 sessionId 解析成 runtime session，并返回对应 engine', async () => {
    const runtimeSession = makeSession();

    const factory = new DefaultEngineFactory({
      ...baseOptions(),
      sessionRuntimeResolver: {
        resolve: vi.fn().mockResolvedValue(runtimeSession),
      },
    });

    const engine = await factory.create('s1');
    const result = await engine.turn('hello');

    expect(engine.sessionId).toBe('s1');
    expect(runtimeSession.send).toHaveBeenCalledWith('hello', { signal: undefined });
    expect(result.turn.rawResponse).toContain('"content":"done"');
  });

  it('支持按 sessionId 提供不同 hooks', async () => {
    const runtimeSession = makeSession('s-special');
    const onSessionEnter = vi.fn();

    const factory = new DefaultEngineFactory({
      ...baseOptions(),
      sessionRuntimeResolver: {
        resolve: vi.fn().mockResolvedValue(runtimeSession),
      },
      hooks: (sessionId) => ({
        onSessionEnter: sessionId === 's-special' ? onSessionEnter : vi.fn(),
      }),
    });

    const engine = await factory.create('s-special');
    await engine.enterSession();

    expect(onSessionEnter).toHaveBeenCalledWith({ sessionId: 's-special' });
  });

  // Skill filter / activate_skill auto-injection tests removed in Task 12:
  // the engine no longer auto-injects activate_skill from a global SkillRouter;
  // skill tools are now provided explicitly via createStelloAgent.tools (or the
  // builtin-tools factory). Tests that relied on auto-injection were obsolete.

  const makeSessionWithTurnCount = (id = 's1', initialTurnCount = 0) => ({
    id,
    meta: { id, turnCount: initialTurnCount, status: 'active' as const },
    turnCount: initialTurnCount,
    send: vi.fn().mockResolvedValue(JSON.stringify({ content: 'done', toolCalls: [] })),
    consolidate: vi.fn().mockResolvedValue(undefined),
    setTools: vi.fn(),
  });

  it('consolidateEveryNTurns 到达阈值时自动触发 consolidate', async () => {
    // turnCount 从 1 开始，+1 后为 2，2 % 2 === 0，应触发
    const runtimeSession = makeSessionWithTurnCount('s1', 1);
    const opts = baseOptions();

    const factory = new DefaultEngineFactory({
      ...opts,
      sessionRuntimeResolver: {
        resolve: vi.fn().mockResolvedValue(runtimeSession),
      },
      consolidateEveryNTurns: 2,
    });

    const engine = await factory.create('s1');
    await engine.turn('hello');
    // fire-and-forget，等 microtasks 完成
    await Promise.resolve();

    expect(runtimeSession.consolidate).toHaveBeenCalled();
  });

  it('未达阈值时不触发 consolidate', async () => {
    // turnCount 从 0 开始，+1 后为 1，1 % 2 !== 0，不触发
    const runtimeSession = makeSessionWithTurnCount('s1', 0);
    const opts = baseOptions();

    const factory = new DefaultEngineFactory({
      ...opts,
      sessionRuntimeResolver: {
        resolve: vi.fn().mockResolvedValue(runtimeSession),
      },
      consolidateEveryNTurns: 2,
    });

    const engine = await factory.create('s1');
    await engine.turn('hello');
    await Promise.resolve();

    expect(runtimeSession.consolidate).not.toHaveBeenCalled();
  });

  it('未配置 consolidateEveryNTurns 时无自动 consolidation', async () => {
    const runtimeSession = makeSessionWithTurnCount('s1', 1);
    const opts = baseOptions();

    const factory = new DefaultEngineFactory({
      ...opts,
      sessionRuntimeResolver: {
        resolve: vi.fn().mockResolvedValue(runtimeSession),
      },
      // 没有 consolidateEveryNTurns
    });

    const engine = await factory.create('s1');
    await engine.turn('hello');
    await Promise.resolve();

    expect(runtimeSession.consolidate).not.toHaveBeenCalled();
  });

  it('用户 hooks 和自动 consolidation hook 合并后都能触发', async () => {
    // turnCount 从 1 开始，+1 后为 2，2 % 2 === 0，应触发
    const runtimeSession = makeSessionWithTurnCount('s1', 1);
    const opts = baseOptions();
    const userOnRoundEnd = vi.fn();

    const factory = new DefaultEngineFactory({
      ...opts,
      sessionRuntimeResolver: {
        resolve: vi.fn().mockResolvedValue(runtimeSession),
      },
      consolidateEveryNTurns: 2,
      hooks: {
        onRoundEnd: userOnRoundEnd,
      },
    });

    const engine = await factory.create('s1');
    await engine.turn('hello');
    await Promise.resolve();

    expect(userOnRoundEnd).toHaveBeenCalled();
    expect(runtimeSession.consolidate).toHaveBeenCalled();
  });
});
