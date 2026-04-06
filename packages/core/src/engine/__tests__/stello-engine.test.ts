import { describe, expect, it, vi } from 'vitest';
import type { SessionTree } from '../../types/session';
import type { MemoryEngine } from '../../types/memory';
import type { ConfirmProtocol, SkillRouter } from '../../types/lifecycle';
import { StelloEngineImpl } from '../stello-engine';
import { TurnRunner, type ToolCallParser } from '../turn-runner';
import { ForkProfileRegistryImpl } from '../fork-profile';

describe('StelloEngineImpl', () => {
  const jsonParser: ToolCallParser = {
    parse(raw) {
      return JSON.parse(raw) as {
        content: string | null;
        toolCalls: Array<{ id?: string; name: string; args: Record<string, unknown> }>;
      };
    },
  };

  const sessions = {
    archive: vi.fn().mockResolvedValue(undefined),
    getNode: vi.fn(),
    getTree: vi.fn(),
  } as unknown as SessionTree;

  const memory = {} as MemoryEngine;
  const skills = {
    get: vi.fn().mockReturnValue(undefined),
    register: vi.fn(),
    getAll: vi.fn().mockReturnValue([]),
  } as unknown as SkillRouter;
  const confirm = {} as ConfirmProtocol;

  it('turn 会串联 turnRunner 并触发 hooks', async () => {
    const session = {
      id: 's1',
      meta: { id: 's1', turnCount: 0, status: 'active' as const },
      turnCount: 0,
      send: vi.fn(),
      consolidate: vi.fn(),
    };
    const turnRunner = {
      run: vi.fn().mockResolvedValue({
        finalContent: 'done',
        toolRoundCount: 1,
        toolCallsExecuted: 2,
        rawResponse: 'done',
      }),
    } as unknown as TurnRunner;

    const onRoundStart = vi.fn();
    const onRoundEnd = vi.fn();
    const onMessageReceived = vi.fn();
    const onAssistantReply = vi.fn();
    const onToolCall = vi.fn();
    const onToolResult = vi.fn();

    const engine = new StelloEngineImpl({
      session,
      sessions,
      memory,
      skills,
      confirm,
      lifecycle: {
        bootstrap: vi.fn(),
        afterTurn: vi.fn(),
        prepareChildSpawn: vi.fn(),
      },
      tools: {
        getToolDefinitions: vi.fn().mockReturnValue([]),
        executeTool: vi.fn(),
      },
      turnRunner,
      hooks: {
        onMessageReceived,
        onAssistantReply,
        onToolCall,
        onToolResult,
        onRoundStart,
        onRoundEnd,
      },
    });

    const result = await engine.turn('hello');

    expect(turnRunner.run).toHaveBeenCalledTimes(1);
    expect(onMessageReceived).toHaveBeenCalledWith({ sessionId: 's1', input: 'hello' });
    expect(onRoundStart).toHaveBeenCalledWith({ sessionId: 's1', input: 'hello' });
    expect(onAssistantReply).toHaveBeenCalledWith({
      sessionId: 's1',
      input: 'hello',
      content: 'done',
      rawResponse: 'done',
    });
    expect(onRoundEnd).toHaveBeenCalledWith({
      sessionId: 's1',
      input: 'hello',
      turn: result.turn,
    });
    expect(onToolCall).not.toHaveBeenCalled();
    expect(onToolResult).not.toHaveBeenCalled();
    expect(result.turn.finalContent).toBe('done');
  });

  it('turn 内部 tool loop 会触发 onToolCall 和 onToolResult hook', async () => {
    const session = {
      id: 's1',
      meta: { id: 's1', turnCount: 0, status: 'active' as const },
      turnCount: 0,
      send: vi
        .fn()
        .mockResolvedValueOnce(
          JSON.stringify({
            content: null,
            toolCalls: [{ id: '1', name: 'read', args: { path: 'core.name' } }],
          }),
        )
        .mockResolvedValueOnce(JSON.stringify({ content: 'done', toolCalls: [] })),
      consolidate: vi.fn(),
    };
    const onToolCall = vi.fn();
    const onToolResult = vi.fn();

    const engine = new StelloEngineImpl({
      session,
      sessions,
      memory,
      skills,
      confirm,
      lifecycle: {
        bootstrap: vi.fn(),
        afterTurn: vi.fn(),
        prepareChildSpawn: vi.fn(),
      },
      tools: {
        getToolDefinitions: vi.fn().mockReturnValue([]),
        executeTool: vi.fn().mockResolvedValue({ success: true, data: { value: 'Stello' } }),
      },
      turnRunner: new TurnRunner(jsonParser),
      hooks: {
        onToolCall,
        onToolResult,
      },
    });

    await engine.turn('hello');

    expect(onToolCall).toHaveBeenCalledWith({
      sessionId: 's1',
      toolCall: {
        id: '1',
        name: 'read',
        args: { path: 'core.name' },
      },
    });
    expect(onToolResult).toHaveBeenCalledWith({
      sessionId: 's1',
      result: {
        toolCallId: '1',
        toolName: 'read',
        args: { path: 'core.name' },
        success: true,
        data: { value: 'Stello' },
        error: null,
      },
    });
  });

  it('hook 抛错时会触发 onError 和 error 事件', async () => {
    const onError = vi.fn();
    const errorListener = vi.fn();

    const engine = new StelloEngineImpl({
      session: {
        id: 's1',
        meta: { id: 's1', turnCount: 0, status: 'active' as const },
        turnCount: 0,
        send: vi.fn().mockResolvedValue(JSON.stringify({ content: 'done', toolCalls: [] })),
        consolidate: vi.fn(),
      },
      sessions,
      memory,
      skills,
      confirm,
      lifecycle: {
        bootstrap: vi.fn(),
        afterTurn: vi.fn(),
        prepareChildSpawn: vi.fn(),
      },
      tools: {
        getToolDefinitions: vi.fn().mockReturnValue([]),
        executeTool: vi.fn(),
      },
      hooks: {
        onMessageReceived: vi.fn().mockRejectedValue(new Error('hook failed')),
        onError,
      },
    });
    engine.on('error', errorListener);

    await engine.turn('hello');

    expect(onError).toHaveBeenCalledWith({
      source: 'engine.onMessageReceived',
      error: expect.objectContaining({ message: 'hook failed' }),
    });
    expect(errorListener).toHaveBeenCalledWith({
      source: 'engine.onMessageReceived',
      error: expect.objectContaining({ message: 'hook failed' }),
    });
  });

  it('enterSession 会 bootstrap 并触发 onSessionEnter hook', async () => {
    const lifecycle = {
      bootstrap: vi.fn().mockResolvedValue({
        context: { core: {}, memories: [], currentMemory: null, scope: null },
        session: { id: 's1' },
      }),
      afterTurn: vi.fn(),
      prepareChildSpawn: vi.fn(),
    };
    const onSessionEnter = vi.fn();

    const engine = new StelloEngineImpl({
      session: {
        id: 's1',
        meta: { id: 's1', turnCount: 0, status: 'active' as const },
        turnCount: 0,
        send: vi.fn(),
        consolidate: vi.fn(),
      },
      sessions,
      memory,
      skills,
      confirm,
      lifecycle,
      tools: {
        getToolDefinitions: vi.fn().mockReturnValue([]),
        executeTool: vi.fn(),
      },
      hooks: { onSessionEnter },
    });

    const result = await engine.enterSession();

    expect(lifecycle.bootstrap).toHaveBeenCalledWith('s1');
    expect(onSessionEnter).toHaveBeenCalledWith({ sessionId: 's1' });
    expect(result.session.id).toBe('s1');
  });

  it('leaveSession 会触发 onSessionLeave hook', async () => {
    const session = {
      id: 's1',
      meta: { id: 's1', turnCount: 2, status: 'active' as const },
      turnCount: 2,
      send: vi.fn(),
      consolidate: vi.fn(),
    };
    const onSessionLeave = vi.fn();

    const engine = new StelloEngineImpl({
      session,
      sessions,
      memory,
      skills,
      confirm,
      lifecycle: {
        bootstrap: vi.fn(),
        afterTurn: vi.fn(),
        prepareChildSpawn: vi.fn(),
      },
      tools: {
        getToolDefinitions: vi.fn().mockReturnValue([]),
        executeTool: vi.fn(),
      },
      hooks: { onSessionLeave },
    });

    const result = await engine.leaveSession();

    expect(onSessionLeave).toHaveBeenCalledWith({ sessionId: 's1' });
    expect(result.sessionId).toBe('s1');
  });

  it('archiveSession 会归档指定 session 并触发 onSessionArchive hook', async () => {
    const session = {
      id: 's1',
      meta: { id: 's1', turnCount: 2, status: 'active' as const },
      turnCount: 2,
      send: vi.fn(),
      consolidate: vi.fn(),
    };
    const archive = vi.fn().mockResolvedValue(undefined);
    const onSessionArchive = vi.fn();

    const engine = new StelloEngineImpl({
      session,
      sessions: { archive, getNode: vi.fn(), getTree: vi.fn() } as unknown as SessionTree,
      memory,
      skills,
      confirm,
      lifecycle: {
        bootstrap: vi.fn(),
        afterTurn: vi.fn(),
        prepareChildSpawn: vi.fn(),
      },
      tools: {
        getToolDefinitions: vi.fn().mockReturnValue([]),
        executeTool: vi.fn(),
      },
      hooks: { onSessionArchive },
    });

    const result = await engine.archiveSession();

    expect(archive).toHaveBeenCalledWith('s1');
    expect(onSessionArchive).toHaveBeenCalledWith({ sessionId: 's1' });
    expect(result.sessionId).toBe('s1');
  });

  it('forkSession 会先过 splitGuard，再创建子 session', async () => {
    const prepareChildSpawn = vi.fn().mockResolvedValue({
      id: 'child-1',
      parentId: 's1',
      children: [],
      refs: [],
      depth: 1,
      index: 0,
      label: 'UI',
    });
    const splitGuard = {
      checkCanSplit: vi.fn().mockResolvedValue({ canSplit: true }),
      recordSplit: vi.fn(),
    };

    const engine = new StelloEngineImpl({
      session: {
        id: 's1',
        meta: { id: 's1', turnCount: 3, status: 'active' as const },
        turnCount: 3,
        send: vi.fn(),
        consolidate: vi.fn(),
      },
      sessions,
      memory,
      skills,
      confirm,
      lifecycle: {
        bootstrap: vi.fn(),
        afterTurn: vi.fn(),
        prepareChildSpawn,
      },
      tools: {
        getToolDefinitions: vi.fn().mockReturnValue([]),
        executeTool: vi.fn(),
      },
      splitGuard: splitGuard as never,
      hooks: {
        onSessionFork: vi.fn(),
      },
    });

    const child = await engine.forkSession({ label: 'UI', scope: 'ui' });

    expect(splitGuard.checkCanSplit).toHaveBeenCalledWith('s1');
    expect(prepareChildSpawn).toHaveBeenCalledWith({
      parentId: 's1',
      label: 'UI',
      scope: 'ui',
    });
    expect(splitGuard.recordSplit).toHaveBeenCalledWith('s1', 3);
    expect(child.id).toBe('child-1');
  });

  describe('stello_create_session 内置拦截', () => {
    it('executeTool 拦截 stello_create_session，走 forkSession 完整路径', async () => {
      const childNode = {
        id: 'child-1',
        parentId: 's1',
        children: [],
        refs: [],
        depth: 1,
        index: 0,
        label: 'UI',
      };
      const prepareChildSpawn = vi.fn().mockResolvedValue(childNode);

      const engine = new StelloEngineImpl({
        session: {
          id: 's1',
          meta: { id: 's1', turnCount: 2, status: 'active' as const },
          turnCount: 2,
          send: vi.fn(),
          consolidate: vi.fn(),
        },
        sessions,
        memory,
        skills,
        confirm,
        lifecycle: {
          bootstrap: vi.fn(),
          afterTurn: vi.fn(),
          prepareChildSpawn,
        },
        tools: {
          getToolDefinitions: vi.fn().mockReturnValue([]),
          executeTool: vi.fn(),
        },
      });

      const result = await engine.executeTool('stello_create_session', {
        label: 'UI',
        systemPrompt: 'you are a UI expert',
        prompt: 'hello',
        context: 'inherit',
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ sessionId: 'child-1', label: 'UI' });
      expect(prepareChildSpawn).toHaveBeenCalledWith({
        parentId: 's1',
        label: 'UI',
        systemPrompt: 'you are a UI expert',
        prompt: 'hello',
        context: 'inherit',
      });
    });

    it('forkSession 失败时 executeTool 返回 error', async () => {
      const splitGuard = {
        checkCanSplit: vi.fn().mockResolvedValue({ canSplit: false, reason: '不允许拆分' }),
        recordSplit: vi.fn(),
      };

      const engine = new StelloEngineImpl({
        session: {
          id: 's1',
          meta: { id: 's1', turnCount: 0, status: 'active' as const },
          turnCount: 0,
          send: vi.fn(),
          consolidate: vi.fn(),
        },
        sessions,
        memory,
        skills,
        confirm,
        lifecycle: {
          bootstrap: vi.fn(),
          afterTurn: vi.fn(),
          prepareChildSpawn: vi.fn(),
        },
        tools: {
          getToolDefinitions: vi.fn().mockReturnValue([]),
          executeTool: vi.fn(),
        },
        splitGuard: splitGuard as never,
      });

      const result = await engine.executeTool('stello_create_session', { label: 'x' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('不允许拆分');
    });

    it('getToolDefinitions 自动包含 stello_create_session', () => {
      const engine = new StelloEngineImpl({
        session: {
          id: 's1',
          meta: { id: 's1', turnCount: 0, status: 'active' as const },
          turnCount: 0,
          send: vi.fn(),
          consolidate: vi.fn(),
        },
        sessions,
        memory,
        skills,
        confirm,
        lifecycle: {
          bootstrap: vi.fn(),
          afterTurn: vi.fn(),
          prepareChildSpawn: vi.fn(),
        },
        tools: {
          getToolDefinitions: vi.fn().mockReturnValue([]),
          executeTool: vi.fn(),
        },
      });

      const defs = engine.getToolDefinitions();
      expect(defs.some(d => d.name === 'stello_create_session')).toBe(true);
    });

    it('用户注册了同名 tool 时去重，Engine 内置版优先', () => {
      const userTool = {
        name: 'stello_create_session',
        description: 'user version',
        parameters: {},
      };

      const engine = new StelloEngineImpl({
        session: {
          id: 's1',
          meta: { id: 's1', turnCount: 0, status: 'active' as const },
          turnCount: 0,
          send: vi.fn(),
          consolidate: vi.fn(),
        },
        sessions,
        memory,
        skills,
        confirm,
        lifecycle: {
          bootstrap: vi.fn(),
          afterTurn: vi.fn(),
          prepareChildSpawn: vi.fn(),
        },
        tools: {
          getToolDefinitions: vi.fn().mockReturnValue([userTool]),
          executeTool: vi.fn(),
        },
      });

      const defs = engine.getToolDefinitions();
      const matched = defs.filter(d => d.name === 'stello_create_session');
      expect(matched).toHaveLength(1);
      // 应该是 Engine 内置版（包含 context 参数）
      expect((matched[0]!.parameters as Record<string, unknown>).properties).toHaveProperty('context');
    });

    it('用户通过 tools 调用 stello_create_session 时，Engine 拦截而非透传', async () => {
      const userExecuteTool = vi.fn();
      const prepareChildSpawn = vi.fn().mockResolvedValue({
        id: 'c1', parentId: 's1', children: [], refs: [], depth: 1, index: 0, label: 'test',
      });

      const engine = new StelloEngineImpl({
        session: {
          id: 's1',
          meta: { id: 's1', turnCount: 0, status: 'active' as const },
          turnCount: 0,
          send: vi.fn(),
          consolidate: vi.fn(),
        },
        sessions,
        memory,
        skills,
        confirm,
        lifecycle: {
          bootstrap: vi.fn(),
          afterTurn: vi.fn(),
          prepareChildSpawn,
        },
        tools: {
          getToolDefinitions: vi.fn().mockReturnValue([]),
          executeTool: userExecuteTool,
        },
      });

      await engine.executeTool('stello_create_session', { label: 'test' });

      expect(userExecuteTool).not.toHaveBeenCalled();
      expect(prepareChildSpawn).toHaveBeenCalled();
    });

    it('指定 profile 时，合成 systemPrompt 并透传 resolved', async () => {
      const mockLlm = {} as never;
      const mockTools = [{ name: 'search' }] as never;
      const profileRegistry = new ForkProfileRegistryImpl();
      profileRegistry.register('research', {
        systemPrompt: '你是研究助手',
        systemPromptMode: 'prepend',
        llm: mockLlm,
        tools: mockTools,
        context: 'inherit',
      });

      const prepareChildSpawn = vi.fn().mockResolvedValue({
        id: 'c1', parentId: 's1', children: [], refs: [],
        depth: 1, index: 0, label: '深度研究',
      });

      const engine = new StelloEngineImpl({
        session: {
          id: 's1',
          meta: { id: 's1', turnCount: 2, status: 'active' as const },
          turnCount: 2,
          send: vi.fn(),
          consolidate: vi.fn(),
        },
        sessions,
        memory,
        skills,
        confirm,
        lifecycle: { bootstrap: vi.fn(), afterTurn: vi.fn(), prepareChildSpawn },
        tools: { getToolDefinitions: vi.fn().mockReturnValue([]), executeTool: vi.fn() },
        profiles: profileRegistry,
      });

      await engine.executeTool('stello_create_session', {
        label: '深度研究',
        systemPrompt: '当前话题是量子计算',
        profile: 'research',
      });

      expect(prepareChildSpawn).toHaveBeenCalledWith(expect.objectContaining({
        label: '深度研究',
        systemPrompt: '你是研究助手\n\n当前话题是量子计算',
        context: 'inherit',
        resolved: {
          llm: mockLlm,
          tools: mockTools,
        },
      }));
    });

    it('指定不存在的 profile 时返回 error', async () => {
      const profileRegistry = new ForkProfileRegistryImpl();

      const engine = new StelloEngineImpl({
        session: {
          id: 's1',
          meta: { id: 's1', turnCount: 0, status: 'active' as const },
          turnCount: 0,
          send: vi.fn(),
          consolidate: vi.fn(),
        },
        sessions,
        memory,
        skills,
        confirm,
        lifecycle: { bootstrap: vi.fn(), afterTurn: vi.fn(), prepareChildSpawn: vi.fn() },
        tools: { getToolDefinitions: vi.fn().mockReturnValue([]), executeTool: vi.fn() },
        profiles: profileRegistry,
      });

      const result = await engine.executeTool('stello_create_session', {
        label: 'test',
        profile: 'nonexistent',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('nonexistent');
    });

    it('preset 模式忽略 LLM systemPrompt', async () => {
      const profileRegistry = new ForkProfileRegistryImpl();
      profileRegistry.register('strict', {
        systemPrompt: '固定角色',
        systemPromptMode: 'preset',
      });

      const prepareChildSpawn = vi.fn().mockResolvedValue({
        id: 'c1', parentId: 's1', children: [], refs: [],
        depth: 1, index: 0, label: 'test',
      });

      const engine = new StelloEngineImpl({
        session: {
          id: 's1',
          meta: { id: 's1', turnCount: 0, status: 'active' as const },
          turnCount: 0,
          send: vi.fn(),
          consolidate: vi.fn(),
        },
        sessions,
        memory,
        skills,
        confirm,
        lifecycle: { bootstrap: vi.fn(), afterTurn: vi.fn(), prepareChildSpawn },
        tools: { getToolDefinitions: vi.fn().mockReturnValue([]), executeTool: vi.fn() },
        profiles: profileRegistry,
      });

      await engine.executeTool('stello_create_session', {
        label: 'test',
        systemPrompt: '这个应该被忽略',
        profile: 'strict',
      });

      expect(prepareChildSpawn).toHaveBeenCalledWith(
        expect.objectContaining({ systemPrompt: '固定角色' }),
      );
    });

    it('getToolDefinitions 中 profile 列表动态注入', () => {
      const profileRegistry = new ForkProfileRegistryImpl();
      profileRegistry.register('research', { systemPrompt: '研究' });
      profileRegistry.register('lightweight', { systemPrompt: '轻量' });

      const engine = new StelloEngineImpl({
        session: {
          id: 's1',
          meta: { id: 's1', turnCount: 0, status: 'active' as const },
          turnCount: 0,
          send: vi.fn(),
          consolidate: vi.fn(),
        },
        sessions,
        memory,
        skills,
        confirm,
        lifecycle: { bootstrap: vi.fn(), afterTurn: vi.fn(), prepareChildSpawn: vi.fn() },
        tools: { getToolDefinitions: vi.fn().mockReturnValue([]), executeTool: vi.fn() },
        profiles: profileRegistry,
      });

      const defs = engine.getToolDefinitions();
      const createTool = defs.find(d => d.name === 'stello_create_session')!;
      const props = (createTool.parameters as Record<string, unknown>).properties as Record<string, unknown>;
      const profileDef = props.profile as Record<string, unknown>;
      expect(profileDef.enum).toEqual(['research', 'lightweight']);
    });
  });

  it('splitGuard 拒绝时不会创建子 session', async () => {
    const prepareChildSpawn = vi.fn();
    const splitGuard = {
      checkCanSplit: vi.fn().mockResolvedValue({ canSplit: false, reason: 'turns not enough' }),
      recordSplit: vi.fn(),
    };

    const engine = new StelloEngineImpl({
      session: {
        id: 's1',
        meta: { id: 's1', turnCount: 0, status: 'active' as const },
        turnCount: 0,
        send: vi.fn(),
        consolidate: vi.fn(),
      },
      sessions,
      memory,
      skills,
      confirm,
      lifecycle: {
        bootstrap: vi.fn(),
        afterTurn: vi.fn(),
        prepareChildSpawn,
      },
      tools: {
        getToolDefinitions: vi.fn().mockReturnValue([]),
        executeTool: vi.fn(),
      },
      splitGuard: splitGuard as never,
    });

    await expect(engine.forkSession({ label: 'UI' })).rejects.toThrow('turns not enough');
    expect(prepareChildSpawn).not.toHaveBeenCalled();
  });
});
