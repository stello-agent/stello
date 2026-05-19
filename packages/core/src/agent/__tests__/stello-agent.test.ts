import { describe, expect, it, vi } from 'vitest';
import type { SessionStorage } from '@stello-ai/session';
import type { SessionTree } from '../../types/session';
import type { ConfirmProtocol, SkillRouter } from '../../types/lifecycle';
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
      setTools: vi.fn(),
    };
    return {
      sessions: {
        get: vi.fn().mockResolvedValue(rootSession),
        archive: vi.fn(),
        ...overrides?.sessions,
      } as unknown as SessionTree,
      capabilities: {
        lifecycle: {
          bootstrap: vi.fn().mockResolvedValue({
            context: { core: {}, memories: [], currentMemory: null, scope: null },
            session: rootSession,
          }),
          afterTurn: vi.fn(),

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
      setTools: vi.fn(),
    };

    const agent = createStelloAgent(baseConfig({ runtimeSession }));
    const result = await agent.turn('root', 'hello');

    expect(agent.sessions).toBeDefined();
    expect(runtimeSession.send).toHaveBeenCalledWith('hello', { signal: undefined });
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
      setTools: vi.fn(),
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

  it('agent.stream(input, { signal }) 透传到 runtime session 并在 abort 时让 result reject', async () => {
    const controller = new AbortController()
    const runtimeSession = {
      id: 'root',
      meta: { id: 'root', turnCount: 0, status: 'active' as const },
      turnCount: 0,
      send: vi.fn(),
      stream: vi.fn((_input: string, opts?: { signal?: AbortSignal }) => {
        let rejectResult: (err: unknown) => void = () => {}
        const result = new Promise<string>((_resolve, reject) => { rejectResult = reject })
        result.catch(() => {})
        return {
          result,
          async *[Symbol.asyncIterator]() {
            try {
              for (const chunk of ['a', 'b', 'c']) {
                if (opts?.signal?.aborted) {
                  const err = new DOMException('aborted', 'AbortError')
                  rejectResult(err)
                  throw err
                }
                await new Promise((r) => setTimeout(r, 5))
                yield chunk
              }
            } catch (err) {
              rejectResult(err)
              throw err
            }
          },
        }
      }),
      consolidate: vi.fn(),
      setTools: vi.fn(),
    }

    const agent = createStelloAgent(baseConfig({ runtimeSession }))
    const stream = await agent.stream('root', 'hello', { signal: controller.signal })

    const collected: string[] = []
    const iter = (async () => {
      try {
        for await (const chunk of stream) {
          collected.push(chunk)
          if (collected.length === 1) controller.abort()
        }
      } catch {
        // expected: iterator re-throws AbortError
      }
    })()

    await expect(stream.result).rejects.toMatchObject({ name: 'AbortError' })
    await iter

    expect(runtimeSession.stream).toHaveBeenCalledWith('hello', { signal: controller.signal })
  })

  it('默认树形拓扑：子节点 fork 出的新节点挂在自己下面', async () => {
    const childSession = {
      ...rootSession,
      id: 'child-1',
      label: 'UI',
      scope: 'ui',
    };

    const sessionFork = vi.fn().mockResolvedValue({
      id: 'child-2', meta: { id: 'child-2', turnCount: 0, status: 'active' },
      turnCount: 0, send: vi.fn(), consolidate: vi.fn(), setTools: vi.fn(),
    });

    const childRuntime = {
      id: 'child-1',
      meta: { id: 'child-1', turnCount: 1, status: 'active' as const },
      turnCount: 1,
      send: vi.fn(),
      consolidate: vi.fn(),
      setTools: vi.fn(),
      fork: sessionFork,
    };

    const createSession = vi.fn().mockResolvedValue({
      id: 'child-2', parentId: 'child-1', children: [], refs: [], depth: 2, index: 0, label: 'UI 2',
    });

    const agent = createStelloAgent({
      sessions: {
        get: vi.fn().mockImplementation(async (id: string) => {
          if (id === 'root') return rootSession;
          if (id === 'child-1') return childSession;
          return null;
        }),
        archive: vi.fn(),
        createSession,
        getConfig: vi.fn().mockResolvedValue(null),
        putConfig: vi.fn().mockResolvedValue(undefined),
      } as unknown as SessionTree,
      capabilities: {
        lifecycle: {
          bootstrap: vi.fn(),
          afterTurn: vi.fn(),
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

    const result = await agent.forkSession('child-1', { label: 'UI 2' });

    // engine 用 `options.topologyParentId ?? this.session.id` 默认挂到 source（child-1）下
    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
      label: 'UI 2',
      parentId: 'child-1',
    }));
    expect(sessionFork).toHaveBeenCalledWith(expect.objectContaining({
      id: 'child-2',
      label: 'UI 2',
    }));
    expect(result.parentId).toBe('child-1');
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

  it('会保留 sessionDefaults 作为 fork 合成链的最低优先级默认值', () => {
    const compressFn = vi.fn();
    const agent = createStelloAgent({
      ...baseConfig(),
      sessionDefaults: {
        systemPrompt: 'default system prompt',
        compressFn,
        skills: ['read_file'],
      },
    });

    expect(agent.config.sessionDefaults?.systemPrompt).toBe('default system prompt');
    expect(agent.config.sessionDefaults?.compressFn).toBe(compressFn);
    expect(agent.config.sessionDefaults?.skills).toEqual(['read_file']);
  });

  it('updateConfig 可热更新 runtime 配置', async () => {
    vi.useFakeTimers();

    const agent = createStelloAgent(baseConfig({
      recyclePolicy: { idleTtlMs: 0 },
    }));

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
    // 没有 splitGuard，不应抛错
    agent.updateConfig({
      splitGuard: { minTurns: 1 },
    });
  });

  it('consolidateSession 调用指定 session 的 consolidate', async () => {
    const runtimeSession = {
      id: 'root',
      meta: { id: 'root', turnCount: 0, status: 'active' as const },
      turnCount: 0,
      send: vi.fn().mockResolvedValue(JSON.stringify({ content: 'done', toolCalls: [] })),
      consolidate: vi.fn().mockResolvedValue(undefined),
      setTools: vi.fn(),
    };
    const agent = createStelloAgent(baseConfig({ runtimeSession }));
    await agent.consolidateSession('root');
    expect(runtimeSession.consolidate).toHaveBeenCalledTimes(1);
  });

  it('支持通过 session.sessionLoader 正式接入 Session 配置', async () => {
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
      setTools: vi.fn(),
    };

    const agent = createStelloAgent({
      sessions: {
        get: vi.fn().mockResolvedValue(rootSession),
        archive: vi.fn(),
      } as unknown as SessionTree,
      session: {
        sessionLoader: vi.fn().mockResolvedValue({ session, config: null }),
      },
      capabilities: {
        lifecycle: {
          bootstrap: vi.fn().mockResolvedValue({
            context: { core: {}, memories: [], currentMemory: null, scope: null },
            session: rootSession,
          }),
          afterTurn: vi.fn(),

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

    expect(session.send).toHaveBeenCalledWith('hello', { signal: undefined });
    expect(result.turn.rawResponse).toContain('"content":"done"');
    expect(result.turn.toolCallsExecuted).toBe(1);
  });

  describe('createSession', () => {
    it('createSession 无 parentId 时建 root', async () => {
      const createSession = vi.fn().mockResolvedValue({
        id: 'root-id',
        parentId: null,
        children: [],
        refs: [],
        depth: 0,
        index: 0,
        label: 'My Root',
      });
      const agent = createStelloAgent(
        baseConfig({ sessions: { createSession } as unknown as SessionTree }),
      );
      const node = await agent.createSession({ label: 'My Root' });
      expect(createSession).toHaveBeenCalledWith({ label: 'My Root' });
      expect(node.parentId).toBeNull();
    });

    it('createSession 带 parentId 时挂在父下', async () => {
      const createSession = vi.fn().mockResolvedValue({
        id: 'child-id',
        parentId: 'root-id',
        children: [],
        refs: [],
        depth: 1,
        index: 0,
        label: 'Child',
      });
      const agent = createStelloAgent(
        baseConfig({ sessions: { createSession } as unknown as SessionTree }),
      );
      const node = await agent.createSession({ parentId: 'root-id', label: 'Child' });
      expect(createSession).toHaveBeenCalledWith({ parentId: 'root-id', label: 'Child' });
      expect(node.parentId).toBe('root-id');
    });

    it('createSession 不传参数时调用 sessions.createSession({})', async () => {
      const createSession = vi.fn().mockResolvedValue({
        id: 'r',
        parentId: null,
        children: [],
        refs: [],
        depth: 0,
        index: 0,
        label: 'Root',
      });
      const agent = createStelloAgent(
        baseConfig({ sessions: { createSession } as unknown as SessionTree }),
      );
      await agent.createSession();
      expect(createSession).toHaveBeenCalledWith({});
    });
  });

  describe('orchestrator-facing topology SDK', () => {
    it('listSessions 代理 sessions.listAll', async () => {
      const listAll = vi.fn().mockResolvedValue([
        { id: 'a', label: 'A', status: 'active', turnCount: 0, createdAt: '', updatedAt: '', lastActiveAt: '' },
        { id: 'b', label: 'B', status: 'archived', turnCount: 0, createdAt: '', updatedAt: '', lastActiveAt: '' },
      ]);
      const agent = createStelloAgent(
        baseConfig({ sessions: { listAll } as unknown as SessionTree }),
      );
      expect(await agent.listSessions()).toHaveLength(2);
      const activeOnly = await agent.listSessions({ status: 'active' });
      expect(activeOnly).toHaveLength(1);
      expect(activeOnly[0]?.id).toBe('a');
    });

    it('listRoots 代理 sessions.listRoots', async () => {
      const listRoots = vi.fn().mockResolvedValue([
        { id: 'r1', parentId: null, children: [], refs: [], depth: 0, index: 0, label: 'R1' },
      ]);
      const agent = createStelloAgent(
        baseConfig({ sessions: { listRoots } as unknown as SessionTree }),
      );
      const roots = await agent.listRoots();
      expect(roots).toHaveLength(1);
      expect(roots[0]?.parentId).toBeNull();
    });

    it('getTopology 代理 sessions.getTree 并返回森林', async () => {
      const getTree = vi.fn().mockResolvedValue([
        { id: 'r1', label: 'R1', status: 'active', turnCount: 0, children: [] },
        { id: 'r2', label: 'R2', status: 'active', turnCount: 0, children: [] },
      ]);
      const agent = createStelloAgent(
        baseConfig({ sessions: { getTree } as unknown as SessionTree }),
      );
      const forest = await agent.getTopology();
      expect(forest).toHaveLength(2);
      expect(forest.map((n) => n.id).sort()).toEqual(['r1', 'r2']);
    });

    it('getTopologyNode 代理 sessions.getNode', async () => {
      const getNode = vi.fn().mockResolvedValue({
        id: 'x', parentId: null, children: [], refs: [], depth: 0, index: 0, label: 'X',
      });
      const agent = createStelloAgent(
        baseConfig({ sessions: { getNode } as unknown as SessionTree }),
      );
      const node = await agent.getTopologyNode('x');
      expect(node?.id).toBe('x');
    });
  });

  describe('orchestrator-facing data-IO SDK', () => {
    function storageMock() {
      return {
        getMemory: vi.fn().mockResolvedValue('mem-x'),
        putMemory: vi.fn().mockResolvedValue(undefined),
        getInsight: vi.fn().mockResolvedValue('ins-x'),
        putInsight: vi.fn().mockResolvedValue(undefined),
        clearInsight: vi.fn().mockResolvedValue(undefined),
        listRecords: vi.fn().mockResolvedValue([{ role: 'user', content: 'hi' }]),
      } as unknown as SessionStorage;
    }

    it('未注入 storage 时数据 IO 抛错', async () => {
      const agent = createStelloAgent(baseConfig());
      await expect(agent.getSessionMetadata('x')).rejects.toThrow(
        'StelloAgent.getSessionMetadata 需要 StelloAgentConfig.storage',
      );
    });

    it('getSessionMetadata 聚合 memory + insight', async () => {
      const storage = storageMock();
      const agent = createStelloAgent({ ...baseConfig(), storage });
      expect(await agent.getSessionMetadata('s1')).toEqual({ memory: 'mem-x', insight: 'ins-x' });
    });

    it('listSessionDigests 走 sessions.listAll 并对每个 Session 取 memory/insight', async () => {
      const storage = storageMock();
      const listAll = vi.fn().mockResolvedValue([
        { id: 'a', label: 'A', status: 'active', turnCount: 0, createdAt: '', updatedAt: '', lastActiveAt: '' },
        { id: 'b', label: 'B', status: 'archived', turnCount: 0, createdAt: '', updatedAt: '', lastActiveAt: '' },
      ]);
      const agent = createStelloAgent({
        ...baseConfig({ sessions: { listAll } as unknown as SessionTree }),
        storage,
      });
      const digests = await agent.listSessionDigests({ status: 'active' });
      expect(digests).toEqual([
        { id: 'a', label: 'A', status: 'active', memory: 'mem-x', insight: 'ins-x' },
      ]);
    });

    it('listMessages 代理 storage.listRecords', async () => {
      const storage = storageMock();
      const agent = createStelloAgent({ ...baseConfig(), storage });
      expect(await agent.listMessages('s1', { limit: 10 })).toEqual([
        { role: 'user', content: 'hi' },
      ]);
      expect(storage.listRecords).toHaveBeenCalledWith('s1', { limit: 10 });
    });

    it('putMemory / putInsight / clearInsight 代理 storage', async () => {
      const storage = storageMock();
      const agent = createStelloAgent({ ...baseConfig(), storage });
      await agent.putMemory('s1', 'M');
      await agent.putInsight('s1', 'I');
      await agent.clearInsight('s1');
      expect(storage.putMemory).toHaveBeenCalledWith('s1', 'M');
      expect(storage.putInsight).toHaveBeenCalledWith('s1', 'I');
      expect(storage.clearInsight).toHaveBeenCalledWith('s1');
    });
  });
});
