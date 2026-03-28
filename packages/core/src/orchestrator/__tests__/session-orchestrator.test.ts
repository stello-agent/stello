import { describe, expect, it, vi } from 'vitest';
import type { SessionTree } from '../../types/session';
import { MainSessionFlatStrategy, SessionOrchestrator } from '../session-orchestrator';

describe('SessionOrchestrator', () => {
  const flushMicrotasks = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };

  const sessionMeta = {
    id: 's1',
    label: 'Root',
    scope: null,
    status: 'active' as const,
    turnCount: 0,
    metadata: {},
    tags: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    lastActiveAt: '2026-01-01T00:00:00Z',
  };

  const sessionNode = {
    id: 's1',
    parentId: null,
    children: [],
    refs: [],
    depth: 0,
    index: 0,
    label: 'Root',
  };

  it('enterSession 会校验 session 并调用对应 engine.enterSession', async () => {
    const sessions = {
      get: vi.fn().mockResolvedValue(sessionMeta),
    } as unknown as SessionTree;
    const engine = {
      enterSession: vi.fn().mockResolvedValue({ context: {}, session: sessionMeta }),
    };
    const runtimeManager = {
      acquire: vi.fn().mockResolvedValue(engine),
      release: vi.fn().mockResolvedValue(undefined),
    };

    const orchestrator = new SessionOrchestrator(sessions, runtimeManager as never);
    const result = await orchestrator.enterSession('s1');

    expect(sessions.get).toHaveBeenCalledWith('s1');
    expect(runtimeManager.acquire).toHaveBeenCalledWith('s1', expect.stringContaining('orchestrator:s1:'));
    expect(runtimeManager.release).toHaveBeenCalledTimes(1);
    expect(engine.enterSession).toHaveBeenCalledTimes(1);
    expect(result.session).toBe(sessionMeta);
  });

  it('turn 会把输入分发给指定 session 对应的 engine', async () => {
    const sessions = {
      get: vi.fn().mockResolvedValue(sessionMeta),
    } as unknown as SessionTree;
    const engine = {
      turn: vi.fn().mockResolvedValue({
        turn: { finalContent: 'done', toolRoundCount: 0, toolCallsExecuted: 0, rawResponse: 'done' },
      }),
    };
    const runtimeManager = {
      acquire: vi.fn().mockResolvedValue(engine),
      release: vi.fn().mockResolvedValue(undefined),
    };

    const orchestrator = new SessionOrchestrator(sessions, runtimeManager as never);
    const result = await orchestrator.turn('s1', 'hello');

    expect(engine.turn).toHaveBeenCalledWith('hello', undefined);
    expect(result.turn.finalContent).toBe('done');
  });

  it('leaveSession 会分发给指定 session 对应的 engine', async () => {
    const sessions = {
      get: vi.fn().mockResolvedValue(sessionMeta),
    } as unknown as SessionTree;
    const engine = {
      leaveSession: vi.fn().mockResolvedValue({ sessionId: 's1' }),
    };
    const runtimeManager = {
      acquire: vi.fn().mockResolvedValue(engine),
      release: vi.fn().mockResolvedValue(undefined),
    };

    const orchestrator = new SessionOrchestrator(sessions, runtimeManager as never);
    const result = await orchestrator.leaveSession('s1');

    expect(engine.leaveSession).toHaveBeenCalledTimes(1);
    expect(result.sessionId).toBe('s1');
  });

  it('forkSession 会在指定父 session 上发起 fork', async () => {
    const sessions = {
      get: vi.fn().mockResolvedValue(sessionMeta),
      getNode: vi.fn().mockResolvedValue(sessionNode),
    } as unknown as SessionTree;
    const engine = {
      forkSession: vi.fn().mockResolvedValue({ id: 'child-1', parentId: 's1', label: 'UI' }),
    };
    const runtimeManager = {
      acquire: vi.fn().mockResolvedValue(engine),
      release: vi.fn().mockResolvedValue(undefined),
    };

    const orchestrator = new SessionOrchestrator(sessions, runtimeManager as never);
    const result = await orchestrator.forkSession('s1', { label: 'UI', scope: 'ui' });

    expect(engine.forkSession).toHaveBeenCalledWith({
      label: 'UI',
      scope: 'ui',
      metadata: { sourceSessionId: 's1' },
    });
    expect(result.id).toBe('child-1');
  });

  it('MainSession 平铺策略下，子节点继续 fork 会挂回主节点', async () => {
    const rootMeta = { ...sessionMeta, id: 'root' };
    const childMeta = { ...sessionMeta, id: 'child-1' };
    const childNode = { id: 'child-1', parentId: 'root', children: [], refs: [], depth: 1, index: 0, label: 'child-1' };
    const sessions = {
      get: vi.fn().mockImplementation(async (id: string) => {
        if (id === 'child-1') return childMeta;
        if (id === 'root') return rootMeta;
        return null;
      }),
      getNode: vi.fn().mockResolvedValue(childNode),
      getRoot: vi.fn().mockResolvedValue(rootMeta),
    } as unknown as SessionTree;
    const rootEngine = {
      forkSession: vi.fn().mockResolvedValue({ id: 'child-2', parentId: 'root', label: 'UI 2' }),
    };
    const runtimeManager = {
      acquire: vi.fn().mockResolvedValue(rootEngine),
      release: vi.fn().mockResolvedValue(undefined),
    };

    const orchestrator = new SessionOrchestrator(
      sessions,
      runtimeManager as never,
      new MainSessionFlatStrategy(),
    );
    const result = await orchestrator.forkSession('child-1', { label: 'UI 2', scope: 'ui' });

    expect(sessions.getRoot).toHaveBeenCalledTimes(1);
    expect(runtimeManager.acquire).toHaveBeenCalledWith(
      'root',
      expect.stringContaining('orchestrator:root:'),
    );
    expect(rootEngine.forkSession).toHaveBeenCalledWith({
      label: 'UI 2',
      scope: 'ui',
      metadata: { sourceSessionId: 'child-1' },
    });
    expect(result.parentId).toBe('root');
  });

  it('archiveSession 会分发给指定 session 对应的 engine', async () => {
    const sessions = {
      get: vi.fn().mockResolvedValue(sessionMeta),
    } as unknown as SessionTree;
    const engine = {
      archiveSession: vi.fn().mockResolvedValue({ sessionId: 's1' }),
    };
    const runtimeManager = {
      acquire: vi.fn().mockResolvedValue(engine),
      release: vi.fn().mockResolvedValue(undefined),
    };

    const orchestrator = new SessionOrchestrator(sessions, runtimeManager as never);
    const result = await orchestrator.archiveSession('s1');

    expect(engine.archiveSession).toHaveBeenCalledTimes(1);
    expect(result.sessionId).toBe('s1');
  });

  it('session 不存在时不会创建 engine', async () => {
    const sessions = {
      get: vi.fn().mockResolvedValue(null),
    } as unknown as SessionTree;
    const runtimeManager = {
      acquire: vi.fn(),
      release: vi.fn(),
    };

    const orchestrator = new SessionOrchestrator(sessions, runtimeManager as never);

    await expect(orchestrator.turn('missing', 'hello')).rejects.toThrow('Session 不存在: missing');
    expect(runtimeManager.acquire).not.toHaveBeenCalled();
  });

  it('同一个 session 上的 turn 会串行执行', async () => {
    const sessions = {
      get: vi.fn().mockResolvedValue(sessionMeta),
    } as unknown as SessionTree;

    const callOrder: string[] = [];
    let releaseFirst!: () => void;
    const firstTurnGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const runtimeManager = {
      acquire: vi.fn().mockImplementation(async () => ({
        turn: vi.fn().mockImplementation(async (input: string) => {
          callOrder.push(`start:${input}`);
          if (input === 'first') {
            await firstTurnGate;
          }
          callOrder.push(`end:${input}`);
          return {
            turn: { finalContent: input, toolRoundCount: 0, toolCallsExecuted: 0, rawResponse: input },
              };
        }),
      })),
      release: vi.fn().mockResolvedValue(undefined),
    };

    const orchestrator = new SessionOrchestrator(sessions, runtimeManager as never);
    const first = orchestrator.turn('s1', 'first');
    const second = orchestrator.turn('s1', 'second');

    await flushMicrotasks();
    expect(callOrder).toEqual(['start:first']);

    releaseFirst();
    await Promise.all([first, second]);

    expect(callOrder).toEqual(['start:first', 'end:first', 'start:second', 'end:second']);
  });

  it('不同 session 上的 turn 可以并行执行', async () => {
    const sessions = {
      get: vi.fn().mockImplementation(async (id: string) => ({ ...sessionMeta, id })),
    } as unknown as SessionTree;

    let activeCount = 0;
    let maxActiveCount = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const runtimeManager = {
      acquire: vi.fn().mockImplementation(async (sessionId: string) => ({
        turn: vi.fn().mockImplementation(async () => {
          activeCount += 1;
          maxActiveCount = Math.max(maxActiveCount, activeCount);
          await gate;
          activeCount -= 1;
          return {
            turn: { finalContent: sessionId, toolRoundCount: 0, toolCallsExecuted: 0, rawResponse: sessionId },
              };
        }),
      })),
      release: vi.fn().mockResolvedValue(undefined),
    };

    const orchestrator = new SessionOrchestrator(sessions, runtimeManager as never);
    const first = orchestrator.turn('s1', 'hello');
    const second = orchestrator.turn('s2', 'world');

    await flushMicrotasks();
    expect(maxActiveCount).toBe(2);

    release();
    await Promise.all([first, second]);
  });

  it('平铺策略下，多个子节点同时 fork 到主节点时也会按主节点串行', async () => {
    const rootMeta = { ...sessionMeta, id: 'root' };
    const childAMeta = { ...sessionMeta, id: 'child-a' };
    const childBMeta = { ...sessionMeta, id: 'child-b' };
    const nodeA = { id: 'child-a', parentId: 'root', children: [], refs: [], depth: 1, index: 0, label: 'child-a' };
    const nodeB = { id: 'child-b', parentId: 'root', children: [], refs: [], depth: 1, index: 1, label: 'child-b' };
    const sessions = {
      get: vi.fn().mockImplementation(async (id: string) => {
        if (id === 'root') return rootMeta;
        if (id === 'child-a') return childAMeta;
        if (id === 'child-b') return childBMeta;
        return null;
      }),
      getNode: vi.fn().mockImplementation(async (id: string) => {
        if (id === 'child-a') return nodeA;
        if (id === 'child-b') return nodeB;
        return null;
      }),
      getRoot: vi.fn().mockResolvedValue(rootMeta),
    } as unknown as SessionTree;

    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });

    const runtimeManager = {
      acquire: vi.fn().mockResolvedValue({
        forkSession: vi.fn().mockImplementation(async (options: { label: string }) => {
          order.push(`start:${options.label}`);
          if (options.label === 'A') {
            markFirstStarted();
            await firstGate;
          }
          order.push(`end:${options.label}`);
          return {
            ...sessionMeta,
            id: options.label,
            parentId: 'root',
            label: options.label,
          };
        }),
      }),
      release: vi.fn().mockResolvedValue(undefined),
    };

    const orchestrator = new SessionOrchestrator(
      sessions,
      runtimeManager as never,
      new MainSessionFlatStrategy(),
    );

    const first = orchestrator.forkSession('child-a', { label: 'A' });
    const second = orchestrator.forkSession('child-b', { label: 'B' });

    await firstStarted;
    expect(order).toEqual(['start:A']);

    releaseFirst();
    await Promise.all([first, second]);

    expect(order).toEqual(['start:A', 'end:A', 'start:B', 'end:B']);
  });
});
