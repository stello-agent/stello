import { describe, expect, it, vi } from 'vitest';
import type { SessionTree } from '../../types/session';
import type { MemoryEngine } from '../../types/memory';
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
      memory: {} as MemoryEngine,
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

    const createChild = vi.fn().mockResolvedValue({
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
        createChild,
        getConfig: vi.fn().mockResolvedValue(null),
        putConfig: vi.fn().mockResolvedValue(undefined),
      } as unknown as SessionTree,
      memory: {} as MemoryEngine,
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
    expect(createChild).toHaveBeenCalledWith(expect.objectContaining({
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

  it('会保留 mainSessionConfig 独立配置（不参与 fork 合成链）', () => {
    const integrateFn = vi.fn();
    const agent = createStelloAgent({
      ...baseConfig(),
      mainSessionConfig: {
        systemPrompt: 'main prompt',
        integrateFn,
      },
    });

    expect(agent.config.mainSessionConfig?.systemPrompt).toBe('main prompt');
    expect(agent.config.mainSessionConfig?.integrateFn).toBe(integrateFn);
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

  it('integrate 调用 mainSession.integrate', async () => {
    const integrateFn = vi.fn().mockResolvedValue({ synthesis: 's', insights: [] });
    const mainSession = { integrate: integrateFn };
    const agent = createStelloAgent({
      ...baseConfig(),
      session: {
        mainSessionLoader: vi.fn().mockResolvedValue({ session: mainSession, config: null }),
      },
    });
    await agent.integrate();
    expect(integrateFn).toHaveBeenCalledTimes(1);
  });

  it('integrate 未配置 mainSessionLoader 时抛错', async () => {
    const agent = createStelloAgent(baseConfig());
    await expect(agent.integrate()).rejects.toThrow('No mainSessionLoader configured');
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
      memory: {} as MemoryEngine,
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

  describe('createMainSession', () => {
    /** 构建带 createRoot/putConfig/getConfig 能力的 sessions mock */
    function sessionsMock() {
      const store = new Map<string, unknown>();
      const createRoot = vi.fn().mockImplementation(async (label?: string) => ({
        id: 'root',
        parentId: null,
        children: [],
        refs: [],
        depth: 0,
        index: 0,
        label: label ?? 'Root',
      }));
      const putConfig = vi.fn().mockImplementation(async (id: string, config: unknown) => {
        store.set(id, config);
      });
      const getConfig = vi.fn().mockImplementation(async (id: string) => store.get(id) ?? null);
      return { createRoot, putConfig, getConfig, store };
    }

    it('createMainSession 返回根拓扑节点（指定 label）', async () => {
      const sessions = sessionsMock();
      const agent = createStelloAgent(
        baseConfig({
          sessions: {
            createRoot: sessions.createRoot,
            putConfig: sessions.putConfig,
            getConfig: sessions.getConfig,
          },
        }),
      );

      const node = await agent.createMainSession({ label: 'Main' });

      expect(sessions.createRoot).toHaveBeenCalledWith('Main');
      expect(node.id).toBe('root');
      expect(node.parentId).toBeNull();
      expect(node.depth).toBe(0);
      expect(node.label).toBe('Main');
    });

    it('createMainSession 无 label 时走 createRoot 默认值', async () => {
      const sessions = sessionsMock();
      const agent = createStelloAgent(
        baseConfig({
          sessions: {
            createRoot: sessions.createRoot,
            putConfig: sessions.putConfig,
            getConfig: sessions.getConfig,
          },
        }),
      );

      const node = await agent.createMainSession();

      expect(sessions.createRoot).toHaveBeenCalledWith(undefined);
      expect(node.label).toBe('Root');
    });

    it('createMainSession 将 mainSessionConfig 的可序列化字段写入 putConfig', async () => {
      const sessions = sessionsMock();
      const agent = createStelloAgent({
        ...baseConfig({
          sessions: {
            createRoot: sessions.createRoot,
            putConfig: sessions.putConfig,
            getConfig: sessions.getConfig,
          },
        }),
        mainSessionConfig: {
          systemPrompt: 'P',
          skills: ['a'],
        },
      });

      await agent.createMainSession({ label: 'Main' });

      expect(sessions.putConfig).toHaveBeenCalledWith('root', {
        systemPrompt: 'P',
        skills: ['a'],
      });
      expect(await agent.sessions.getConfig('root')).toEqual({
        systemPrompt: 'P',
        skills: ['a'],
      });
    });

    it('createMainSession 剔除非可序列化字段（llm/integrateFn 等）', async () => {
      const sessions = sessionsMock();
      const dummyLlm = { complete: vi.fn() } as never;
      const dummyFn = vi.fn();
      const agent = createStelloAgent({
        ...baseConfig({
          sessions: {
            createRoot: sessions.createRoot,
            putConfig: sessions.putConfig,
            getConfig: sessions.getConfig,
          },
        }),
        mainSessionConfig: {
          systemPrompt: 'P',
          llm: dummyLlm,
          integrateFn: dummyFn,
        },
      });

      await agent.createMainSession({ label: 'Main' });

      expect(sessions.putConfig).toHaveBeenCalledWith('root', { systemPrompt: 'P' });
      const stored = sessions.store.get('root') as Record<string, unknown>;
      expect(stored).not.toHaveProperty('llm');
      expect(stored).not.toHaveProperty('integrateFn');
    });

    it('createMainSession 无 mainSessionConfig 时写入空对象', async () => {
      const sessions = sessionsMock();
      const agent = createStelloAgent(
        baseConfig({
          sessions: {
            createRoot: sessions.createRoot,
            putConfig: sessions.putConfig,
            getConfig: sessions.getConfig,
          },
        }),
      );

      await agent.createMainSession({ label: 'Main' });

      expect(sessions.putConfig).toHaveBeenCalledWith('root', {});
    });
  });
});
