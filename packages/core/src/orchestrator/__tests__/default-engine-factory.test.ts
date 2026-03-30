import { describe, expect, it, vi } from 'vitest';
import type { SessionTree } from '../../types/session';
import type { MemoryEngine } from '../../types/memory';
import type { ConfirmProtocol, SkillRouter } from '../../types/lifecycle';
import { DefaultEngineFactory } from '../default-engine-factory';
import type { Scheduler } from '../../engine/scheduler';

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
    lifecycle: {
      bootstrap: vi.fn().mockResolvedValue({
        context: { core: {}, memories: [], currentMemory: null, scope: null },
        session: { id: 's1' },
      }),
      afterTurn: vi.fn(),
      prepareChildSpawn: vi.fn(),
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
    expect(runtimeSession.send).toHaveBeenCalledWith('hello');
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

  it('有 scheduler 时，onRoundEnd hook 会 fire-and-forget 触发 scheduler.afterTurn', async () => {
    const runtimeSession = makeSession();
    const scheduler = {
      afterTurn: vi.fn().mockResolvedValue({
        consolidated: false,
        integrated: false,
        errors: [],
      }),
    } as unknown as Scheduler;

    const factory = new DefaultEngineFactory({
      ...baseOptions(),
      sessionRuntimeResolver: {
        resolve: vi.fn().mockResolvedValue(runtimeSession),
      },
      scheduler,
    });

    const engine = await factory.create('s1');
    await engine.turn('hello');

    // fire-and-forget，等一个 tick 让 promise 执行
    await Promise.resolve();
    expect(scheduler.afterTurn).toHaveBeenCalledTimes(1);
  });

  it('有 scheduler 时，onSessionLeave hook 会 fire-and-forget 触发 scheduler.onSessionLeave', async () => {
    const runtimeSession = makeSession();
    const scheduler = {
      onSessionLeave: vi.fn().mockResolvedValue({
        consolidated: true,
        integrated: false,
        errors: [],
      }),
    } as unknown as Scheduler;

    const factory = new DefaultEngineFactory({
      ...baseOptions(),
      sessionRuntimeResolver: {
        resolve: vi.fn().mockResolvedValue(runtimeSession),
      },
      scheduler,
    });

    const engine = await factory.create('s1');
    await engine.leaveSession();

    await Promise.resolve();
    expect(scheduler.onSessionLeave).toHaveBeenCalledTimes(1);
  });

  it('有 scheduler 时，onSessionArchive hook 会 fire-and-forget 触发 scheduler.onSessionArchive', async () => {
    const runtimeSession = makeSession();
    const scheduler = {
      onSessionArchive: vi.fn().mockResolvedValue({
        consolidated: false,
        integrated: false,
        errors: [],
      }),
    } as unknown as Scheduler;

    const factory = new DefaultEngineFactory({
      ...baseOptions(),
      sessionRuntimeResolver: {
        resolve: vi.fn().mockResolvedValue(runtimeSession),
      },
      scheduler,
    });

    const engine = await factory.create('s1');
    await engine.archiveSession();

    await Promise.resolve();
    expect(scheduler.onSessionArchive).toHaveBeenCalledTimes(1);
  });

  it('用户 hooks 和 scheduler hooks 合并后都能触发', async () => {
    const runtimeSession = makeSession();
    const userOnRoundEnd = vi.fn();
    const scheduler = {
      afterTurn: vi.fn().mockResolvedValue({
        consolidated: false,
        integrated: false,
        errors: [],
      }),
    } as unknown as Scheduler;

    const factory = new DefaultEngineFactory({
      ...baseOptions(),
      sessionRuntimeResolver: {
        resolve: vi.fn().mockResolvedValue(runtimeSession),
      },
      scheduler,
      hooks: { onRoundEnd: userOnRoundEnd },
    });

    const engine = await factory.create('s1');
    await engine.turn('hello');

    await Promise.resolve();
    expect(userOnRoundEnd).toHaveBeenCalledTimes(1);
    expect(scheduler.afterTurn).toHaveBeenCalledTimes(1);
  });
});
