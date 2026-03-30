import { describe, expect, it, vi } from 'vitest';
import type { SessionTree } from '../../types/session';
import type { MemoryEngine } from '../../types/memory';
import type { ConfirmProtocol, SkillRouter } from '../../types/lifecycle';
import { Scheduler } from '../../engine/scheduler';
import { createStelloAgent, type StelloAgentConfig } from '../stello-agent';

describe('StelloAgent', () => {
  const rootSession = {
    id: 'root',
    label: 'Main',
    scope: null,
    status: 'active' as const,
    turnCount: 0,
    metadata: {},
    tags: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    lastActiveAt: '2026-01-01T00:00:00Z',
  };

  /** 构建基础 config，减少测试中的重复 */
  function baseConfig(overrides?: {
    sessions?: Partial<SessionTree>;
    runtimeSession?: Record<string, unknown>;
    recyclePolicy?: { idleTtlMs: number };
    orchestration?: StelloAgentConfig['orchestration'];
  }): StelloAgentConfig {
    const runtimeSession = overrides?.runtimeSession ?? {
      id: 'root',
      meta: { id: 'root', turnCount: 0, status: 'active' as const },
      turnCount: 0,
      send: vi.fn().mockResolvedValue(JSON.stringify({ content: 'done', toolCalls: [] })),
      consolidate: vi.fn(),
    };
    return {
      sessions: {
        get: vi.fn().mockResolvedValue(rootSession),
        archive: vi.fn(),
        ...overrides?.sessions,
      } as unknown as SessionTree,
      memory: {} as MemoryEngine,
      capabilities: {
        lifecycle: {
          bootstrap: vi.fn().mockResolvedValue({
            context: { core: {}, memories: [], currentMemory: null, scope: null },
            session: rootSession,
          }),
          afterTurn: vi.fn(),
          prepareChildSpawn: vi.fn(),
        },
        tools: {
          getToolDefinitions: vi.fn().mockReturnValue([]),
          executeTool: vi.fn(),
        },
        skills: {
          get: vi.fn().mockReturnValue(undefined),
          register: vi.fn(),
          getAll: vi.fn().mockReturnValue([]),
        } as unknown as SkillRouter,
        confirm: {} as ConfirmProtocol,
      },
      runtime: {
        resolver: {
          resolve: vi.fn().mockResolvedValue(runtimeSession),
        },
        recyclePolicy: overrides?.recyclePolicy,
      },
      orchestration: overrides?.orchestration,
    };
  }

  it('可以根据配置完成初始化，并通过顶层对象运行 session turn', async () => {
    const runtimeSession = {
      id: 'root',
      meta: { id: 'root', turnCount: 0, status: 'active' as const },
      turnCount: 0,
      send: vi.fn().mockResolvedValue(JSON.stringify({ content: 'done', toolCalls: [] })),
      consolidate: vi.fn(),
    };

    const agent = createStelloAgent(baseConfig({ runtimeSession }));
    const result = await agent.turn('root', 'hello');

    expect(agent.sessions).toBeDefined();
    expect(runtimeSession.send).toHaveBeenCalledWith('hello');
    expect(result.turn.finalContent).toContain('"content":"done"');
  });

  it('可以通过顶层对象流式获取响应', async () => {
    const runtimeSession = {
      id: 'root',
      meta: { id: 'root', turnCount: 0, status: 'active' as const },
      turnCount: 0,
      send: vi.fn().mockResolvedValue(JSON.stringify({ content: 'done', toolCalls: [] })),
      stream: vi.fn().mockReturnValue({
        result: Promise.resolve(JSON.stringify({ content: 'done', toolCalls: [] })),
        async *[Symbol.asyncIterator]() {
          yield 'do'
          yield 'ne'
        },
      }),
      consolidate: vi.fn(),
    };

    const agent = createStelloAgent(baseConfig({ runtimeSession }));

    const stream = await agent.stream('root', 'hello')
    const chunks: string[] = []
    for await (const chunk of stream) {
      chunks.push(chunk)
    }
    const result = await stream.result

    expect(chunks).toEqual(['do', 'ne'])
    expect(result.turn.finalContent).toContain('"content":"done"')
  });

  it('默认使用 MainSessionFlatStrategy，并通过顶层对象发起 fork', async () => {
    const childSession = {
      ...rootSession,
      id: 'child-1',
      label: 'UI',
      scope: 'ui',
    };
    const childNode = {
      id: 'child-1',
      parentId: 'root',
      children: [],
      refs: [],
      depth: 1,
      index: 0,
      label: 'UI',
    };

    const rootRuntime = {
      id: 'root',
      meta: { id: 'root', turnCount: 1, status: 'active' as const },
      turnCount: 1,
      send: vi.fn(),
      consolidate: vi.fn(),
    };

    const childRuntime = {
      id: 'child-1',
      meta: { id: 'child-1', turnCount: 1, status: 'active' as const },
      turnCount: 1,
      send: vi.fn(),
      consolidate: vi.fn(),
    };

    const prepareChildSpawn = vi
      .fn()
      .mockResolvedValue({ id: 'child-2', parentId: 'root', children: [], refs: [], depth: 1, index: 1, label: 'UI 2' });

    const agent = createStelloAgent({
      sessions: {
        get: vi.fn().mockImplementation(async (id: string) => {
          if (id === 'root') return rootSession;
          if (id === 'child-1') return childSession;
          return null;
        }),
        getNode: vi.fn().mockResolvedValue(childNode),
        getRoot: vi.fn().mockResolvedValue(rootSession),
        archive: vi.fn(),
      } as unknown as SessionTree,
      memory: {} as MemoryEngine,
      capabilities: {
        lifecycle: {
          bootstrap: vi.fn(),
          afterTurn: vi.fn(),
          prepareChildSpawn,
        },
        tools: {
          getToolDefinitions: vi.fn().mockReturnValue([]),
          executeTool: vi.fn(),
        },
        skills: {
          get: vi.fn().mockReturnValue(undefined),
          register: vi.fn(),
          getAll: vi.fn().mockReturnValue([]),
        } as unknown as SkillRouter,
        confirm: {} as ConfirmProtocol,
      },
      runtime: {
        resolver: {
          resolve: vi.fn().mockImplementation(async (id: string) => {
            if (id === 'root') return rootRuntime;
            if (id === 'child-1') return childRuntime;
            throw new Error(`unexpected session: ${id}`);
          }),
        },
      },
      orchestration: {
        splitGuard: {
          checkCanSplit: vi.fn().mockResolvedValue({ canSplit: true }),
          recordSplit: vi.fn(),
        } as never,
      },
    });

    const result = await agent.forkSession('child-1', { label: 'UI 2', scope: 'ui' });

    expect(prepareChildSpawn).toHaveBeenCalledWith({
      label: 'UI 2',
      scope: 'ui',
      metadata: { sourceSessionId: 'child-1' },
      parentId: 'root',
    });
    expect(result.parentId).toBe('root');
  });

  it('可以显式 attach/detach session engine，并复用同一运行时', async () => {
    const agent = createStelloAgent(baseConfig());

    await agent.attachSession('root', 'ws-1');
    expect(agent.hasActiveEngine('root')).toBe(true);
    expect(agent.getEngineRefCount('root')).toBe(1);

    await agent.turn('root', 'hello');
    expect(agent.hasActiveEngine('root')).toBe(true);
    expect(agent.getEngineRefCount('root')).toBe(1);

    await agent.detachSession('root', 'ws-1');
    expect(agent.hasActiveEngine('root')).toBe(false);
    expect(agent.getEngineRefCount('root')).toBe(0);
  });

  it('支持通过配置启用 idleTtlMs 延迟回收', async () => {
    vi.useFakeTimers();

    const agent = createStelloAgent(baseConfig({
      recyclePolicy: { idleTtlMs: 1_000 },
    }));

    await agent.attachSession('root', 'ws-1');
    await agent.detachSession('root', 'ws-1');

    expect(agent.hasActiveEngine('root')).toBe(true);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(agent.hasActiveEngine('root')).toBe(false);

    vi.useRealTimers();
  });

  it('会保留 session 预留配置接入点', async () => {
    const agent = createStelloAgent({
      ...baseConfig(),
      session: {
        options: {
          provider: 'session-team',
          mode: 'preview',
        },
      },
    });

    expect(agent.config.session?.options).toEqual({
      provider: 'session-team',
      mode: 'preview',
    });
  });

  it('updateConfig 可热更新 scheduler 和 runtime 配置', async () => {
    vi.useFakeTimers();

    const scheduler = new Scheduler({
      consolidation: { trigger: 'manual' },
    });

    const agent = createStelloAgent(baseConfig({
      recyclePolicy: { idleTtlMs: 0 },
      orchestration: { scheduler },
    }));

    // 热更新 scheduler
    agent.updateConfig({
      scheduling: { consolidation: { trigger: 'everyNTurns', everyNTurns: 2 } },
    });
    expect(scheduler.getConfig().consolidation?.trigger).toBe('everyNTurns');

    // 热更新 runtime
    agent.updateConfig({ runtime: { idleTtlMs: 1_000 } });
    await agent.attachSession('root', 'ws-1');
    await agent.detachSession('root', 'ws-1');
    // 应该延迟回收而非立即
    expect(agent.hasActiveEngine('root')).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(agent.hasActiveEngine('root')).toBe(false);

    vi.useRealTimers();
  });

  it('updateConfig 无对应组件时静默跳过', () => {
    const agent = createStelloAgent(baseConfig());
    // 没有 scheduler 和 splitGuard，不应抛错
    agent.updateConfig({
      scheduling: { consolidation: { trigger: 'onSwitch' } },
      splitGuard: { minTurns: 1 },
    });
  });

  it('支持通过 session.sessionResolver + consolidateFn 正式接入 Session 配置', async () => {
    const session = {
      meta: {
        id: 'root',
        status: 'active' as const,
      },
      messages: vi.fn().mockResolvedValue([]),
      send: vi.fn().mockImplementation(async (input: string) => {
        if (input.includes('"toolResults"')) {
          return {
            content: 'done',
            toolCalls: [],
          };
        }
        return {
          content: null,
          toolCalls: [{ id: 't1', name: 'read_file', input: { path: 'a.ts' } }],
        };
      }),
      consolidate: vi.fn().mockResolvedValue(undefined),
    };

    const agent = createStelloAgent({
      sessions: {
        get: vi.fn().mockResolvedValue(rootSession),
        archive: vi.fn(),
      } as unknown as SessionTree,
      memory: {} as MemoryEngine,
      session: {
        sessionResolver: vi.fn().mockResolvedValue(session),
        consolidateFn: vi.fn().mockResolvedValue('memory'),
      },
      capabilities: {
        lifecycle: {
          bootstrap: vi.fn().mockResolvedValue({
            context: { core: {}, memories: [], currentMemory: null, scope: null },
            session: rootSession,
          }),
          afterTurn: vi.fn(),
          prepareChildSpawn: vi.fn(),
        },
        tools: {
          getToolDefinitions: vi.fn().mockReturnValue([]),
          executeTool: vi.fn().mockResolvedValue({ success: true, data: {} }),
        },
        skills: {
          get: vi.fn().mockReturnValue(undefined),
          register: vi.fn(),
          getAll: vi.fn().mockReturnValue([]),
        } as unknown as SkillRouter,
        confirm: {} as ConfirmProtocol,
      },
    });

    const result = await agent.turn('root', 'hello');

    expect(session.send).toHaveBeenCalledWith('hello');
    expect(result.turn.rawResponse).toContain('"content":"done"');
    expect(result.turn.toolCallsExecuted).toBe(1);
  });
});
