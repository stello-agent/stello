import { describe, expect, it, vi } from 'vitest';
import type { SessionTree } from '../../types/session';
import type { MemoryEngine } from '../../types/memory';
import type { ConfirmProtocol, SkillRouter } from '../../types/lifecycle';
import { createStelloAgent } from '../stello-agent';

describe('StelloAgent', () => {
  const rootSession = {
    id: 'root',
    parentId: null,
    children: [],
    refs: [],
    label: 'Main',
    index: 0,
    scope: null,
    status: 'active' as const,
    depth: 0,
    turnCount: 0,
    metadata: {},
    tags: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    lastActiveAt: '2026-01-01T00:00:00Z',
  };

  it('可以根据配置完成初始化，并通过顶层对象运行 session turn', async () => {
    const runtimeSession = {
      id: 'root',
      meta: { id: 'root', turnCount: 0, status: 'active' as const },
      turnCount: 0,
      send: vi.fn().mockResolvedValue(JSON.stringify({ content: 'done', toolCalls: [] })),
      consolidate: vi.fn(),
    };

    const agent = createStelloAgent({
      sessions: {
        get: vi.fn().mockResolvedValue(rootSession),
        archive: vi.fn(),
      } as unknown as SessionTree,
      memory: {} as MemoryEngine,
      skills: {
        match: vi.fn().mockReturnValue(null),
        register: vi.fn(),
        getAll: vi.fn().mockReturnValue([]),
      } as unknown as SkillRouter,
      confirm: {} as ConfirmProtocol,
      lifecycle: {
        bootstrap: vi.fn().mockResolvedValue({
          context: { core: {}, memories: [], currentMemory: null, scope: null },
          session: rootSession,
        }),
        assemble: vi.fn().mockResolvedValue({
          core: {},
          memories: [],
          currentMemory: null,
          scope: null,
        }),
        afterTurn: vi.fn(),
        prepareChildSpawn: vi.fn(),
      },
      tools: {
        getToolDefinitions: vi.fn().mockReturnValue([]),
        executeTool: vi.fn(),
      },
      sessionRuntimeResolver: {
        resolve: vi.fn().mockResolvedValue(runtimeSession),
      },
    });

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

    const agent = createStelloAgent({
      sessions: {
        get: vi.fn().mockResolvedValue(rootSession),
        archive: vi.fn(),
      } as unknown as SessionTree,
      memory: {} as MemoryEngine,
      skills: {
        match: vi.fn().mockReturnValue(null),
        register: vi.fn(),
        getAll: vi.fn().mockReturnValue([]),
      } as unknown as SkillRouter,
      confirm: {} as ConfirmProtocol,
      lifecycle: {
        bootstrap: vi.fn().mockResolvedValue({
          context: { core: {}, memories: [], currentMemory: null, scope: null },
          session: rootSession,
        }),
        assemble: vi.fn().mockResolvedValue({
          core: {},
          memories: [],
          currentMemory: null,
          scope: null,
        }),
        afterTurn: vi.fn(),
        prepareChildSpawn: vi.fn(),
      },
      tools: {
        getToolDefinitions: vi.fn().mockReturnValue([]),
        executeTool: vi.fn(),
      },
      sessionRuntimeResolver: {
        resolve: vi.fn().mockResolvedValue(runtimeSession),
      },
    });

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
      parentId: 'root',
      depth: 1,
      label: 'UI',
      scope: 'ui',
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
      .mockResolvedValue({ id: 'child-2', parentId: 'root', label: 'UI 2' });

    const agent = createStelloAgent({
      sessions: {
        get: vi.fn().mockImplementation(async (id: string) => {
          if (id === 'root') return rootSession;
          if (id === 'child-1') return childSession;
          return null;
        }),
        getRoot: vi.fn().mockResolvedValue(rootSession),
        archive: vi.fn(),
      } as unknown as SessionTree,
      memory: {} as MemoryEngine,
      skills: {
        match: vi.fn().mockReturnValue(null),
        register: vi.fn(),
        getAll: vi.fn().mockReturnValue([]),
      } as unknown as SkillRouter,
      confirm: {} as ConfirmProtocol,
      lifecycle: {
        bootstrap: vi.fn().mockResolvedValue({
          context: { core: {}, memories: [], currentMemory: null, scope: null },
          session: rootSession,
        }),
        assemble: vi.fn().mockResolvedValue({
          core: {},
          memories: [],
          currentMemory: null,
          scope: null,
        }),
        afterTurn: vi.fn(),
        prepareChildSpawn,
      },
      tools: {
        getToolDefinitions: vi.fn().mockReturnValue([]),
        executeTool: vi.fn(),
      },
      sessionRuntimeResolver: {
        resolve: vi.fn().mockImplementation(async (id: string) => {
          if (id === 'root') return rootRuntime;
          if (id === 'child-1') return childRuntime;
          throw new Error(`unexpected session: ${id}`);
        }),
      },
      splitGuard: {
        checkCanSplit: vi.fn().mockResolvedValue({ canSplit: true }),
        recordSplit: vi.fn(),
      } as never,
    });

    const result = await agent.forkSession('child-1', { label: 'UI 2', scope: 'ui' });

    expect(prepareChildSpawn).toHaveBeenCalledWith({
      label: 'UI 2',
      scope: 'ui',
      parentId: 'root',
    });
    expect(result.parentId).toBe('root');
  });

  it('可以显式 attach/detach session engine，并复用同一运行时', async () => {
    const runtimeSession = {
      id: 'root',
      meta: { id: 'root', turnCount: 0, status: 'active' as const },
      turnCount: 0,
      send: vi.fn().mockResolvedValue(JSON.stringify({ content: 'done', toolCalls: [] })),
      consolidate: vi.fn(),
    };

    const agent = createStelloAgent({
      sessions: {
        get: vi.fn().mockResolvedValue(rootSession),
        archive: vi.fn(),
      } as unknown as SessionTree,
      memory: {} as MemoryEngine,
      skills: {
        match: vi.fn().mockReturnValue(null),
        register: vi.fn(),
        getAll: vi.fn().mockReturnValue([]),
      } as unknown as SkillRouter,
      confirm: {} as ConfirmProtocol,
      lifecycle: {
        bootstrap: vi.fn().mockResolvedValue({
          context: { core: {}, memories: [], currentMemory: null, scope: null },
          session: rootSession,
        }),
        assemble: vi.fn().mockResolvedValue({
          core: {},
          memories: [],
          currentMemory: null,
          scope: null,
        }),
        afterTurn: vi.fn(),
        prepareChildSpawn: vi.fn(),
      },
      tools: {
        getToolDefinitions: vi.fn().mockReturnValue([]),
        executeTool: vi.fn(),
      },
      sessionRuntimeResolver: {
        resolve: vi.fn().mockResolvedValue(runtimeSession),
      },
    });

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
    const runtimeSession = {
      id: 'root',
      meta: { id: 'root', turnCount: 0, status: 'active' as const },
      turnCount: 0,
      send: vi.fn().mockResolvedValue(JSON.stringify({ content: 'done', toolCalls: [] })),
      consolidate: vi.fn(),
    };

    const agent = createStelloAgent({
      sessions: {
        get: vi.fn().mockResolvedValue(rootSession),
        archive: vi.fn(),
      } as unknown as SessionTree,
      memory: {} as MemoryEngine,
      skills: {
        match: vi.fn().mockReturnValue(null),
        register: vi.fn(),
        getAll: vi.fn().mockReturnValue([]),
      } as unknown as SkillRouter,
      confirm: {} as ConfirmProtocol,
      lifecycle: {
        bootstrap: vi.fn().mockResolvedValue({
          context: { core: {}, memories: [], currentMemory: null, scope: null },
          session: rootSession,
        }),
        assemble: vi.fn().mockResolvedValue({
          core: {},
          memories: [],
          currentMemory: null,
          scope: null,
        }),
        afterTurn: vi.fn(),
        prepareChildSpawn: vi.fn(),
      },
      tools: {
        getToolDefinitions: vi.fn().mockReturnValue([]),
        executeTool: vi.fn(),
      },
      sessionRuntimeResolver: {
        resolve: vi.fn().mockResolvedValue(runtimeSession),
      },
      runtimeRecyclePolicy: {
        idleTtlMs: 1_000,
      },
    });

    await agent.attachSession('root', 'ws-1');
    await agent.detachSession('root', 'ws-1');

    expect(agent.hasActiveEngine('root')).toBe(true);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(agent.hasActiveEngine('root')).toBe(false);

    vi.useRealTimers();
  });

  it('支持新的分组式 StelloAgentConfig', async () => {
    const runtimeSession = {
      id: 'root',
      meta: { id: 'root', turnCount: 0, status: 'active' as const },
      turnCount: 0,
      send: vi.fn().mockResolvedValue(JSON.stringify({ content: 'done', toolCalls: [] })),
      consolidate: vi.fn(),
    };

    const agent = createStelloAgent({
      sessions: {
        get: vi.fn().mockResolvedValue(rootSession),
        archive: vi.fn(),
      } as unknown as SessionTree,
      memory: {} as MemoryEngine,
      capabilities: {
        lifecycle: {
          bootstrap: vi.fn().mockResolvedValue({
            context: { core: {}, memories: [], currentMemory: null, scope: null },
            session: rootSession,
          }),
          assemble: vi.fn().mockResolvedValue({
            core: {},
            memories: [],
            currentMemory: null,
            scope: null,
          }),
          afterTurn: vi.fn(),
          prepareChildSpawn: vi.fn(),
        },
        tools: {
          getToolDefinitions: vi.fn().mockReturnValue([]),
          executeTool: vi.fn(),
        },
        skills: {
          match: vi.fn().mockReturnValue(null),
          register: vi.fn(),
          getAll: vi.fn().mockReturnValue([]),
        } as unknown as SkillRouter,
        confirm: {} as ConfirmProtocol,
      },
      runtime: {
        resolver: {
          resolve: vi.fn().mockResolvedValue(runtimeSession),
        },
        recyclePolicy: {
          idleTtlMs: 1_000,
        },
      },
      orchestration: {
        strategy: undefined,
      },
    });

    await agent.attachSession('root', 'ws-1');
    expect(agent.hasActiveEngine('root')).toBe(true);
    expect(agent.getEngineRefCount('root')).toBe(1);
  });

  it('会保留 session 预留配置接入点', async () => {
    const runtimeSession = {
      id: 'root',
      meta: { id: 'root', turnCount: 0, status: 'active' as const },
      turnCount: 0,
      send: vi.fn().mockResolvedValue(JSON.stringify({ content: 'done', toolCalls: [] })),
      consolidate: vi.fn(),
    };

    const agent = createStelloAgent({
      sessions: {
        get: vi.fn().mockResolvedValue(rootSession),
        archive: vi.fn(),
      } as unknown as SessionTree,
      memory: {} as MemoryEngine,
      session: {
        options: {
          provider: 'session-team',
          mode: 'preview',
        },
      },
      capabilities: {
        lifecycle: {
          bootstrap: vi.fn().mockResolvedValue({
            context: { core: {}, memories: [], currentMemory: null, scope: null },
            session: rootSession,
          }),
          assemble: vi.fn().mockResolvedValue({
            core: {},
            memories: [],
            currentMemory: null,
            scope: null,
          }),
          afterTurn: vi.fn(),
          prepareChildSpawn: vi.fn(),
        },
        tools: {
          getToolDefinitions: vi.fn().mockReturnValue([]),
          executeTool: vi.fn(),
        },
        skills: {
          match: vi.fn().mockReturnValue(null),
          register: vi.fn(),
          getAll: vi.fn().mockReturnValue([]),
        } as unknown as SkillRouter,
        confirm: {} as ConfirmProtocol,
      },
      runtime: {
        resolver: {
          resolve: vi.fn().mockResolvedValue(runtimeSession),
        },
      },
    });

    expect(agent.config.session?.options).toEqual({
      provider: 'session-team',
      mode: 'preview',
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
          assemble: vi.fn().mockResolvedValue({
            core: {},
            memories: [],
            currentMemory: null,
            scope: null,
          }),
          afterTurn: vi.fn(),
          prepareChildSpawn: vi.fn(),
        },
        tools: {
          getToolDefinitions: vi.fn().mockReturnValue([]),
          executeTool: vi.fn().mockResolvedValue({ success: true, data: {} }),
        },
        skills: {
          match: vi.fn().mockReturnValue(null),
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
