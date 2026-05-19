import { describe, expect, it, vi } from 'vitest';
import type { SessionTree } from '../../types/session';
import type { ConfirmProtocol, SkillRouter } from '../../types/lifecycle';
import { StelloEngineImpl } from '../stello-engine';
import { TurnRunner, type ToolCallParser } from '../turn-runner';
import { ToolRegistryImpl, type ToolRegistryEntry } from '../../tool/tool-registry';

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
    getConfig: vi.fn().mockResolvedValue(null),
    putConfig: vi.fn().mockResolvedValue(undefined),
  } as unknown as SessionTree;

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
      messages: vi.fn().mockResolvedValue([]),
      setTools: vi.fn(),
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
      skills,
      confirm,
      agent: {} as never,
      lifecycle: {
        bootstrap: vi.fn(),
        afterTurn: vi.fn(),

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
      messages: vi.fn().mockResolvedValue([]),
      setTools: vi.fn(),
    };
    const onToolCall = vi.fn();
    const onToolResult = vi.fn();

    const engine = new StelloEngineImpl({
      session,
      sessions,
      skills,
      confirm,
      agent: {} as never,
      lifecycle: {
        bootstrap: vi.fn(),
        afterTurn: vi.fn(),

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
        messages: vi.fn().mockResolvedValue([]),
        setTools: vi.fn(),
      },
      sessions,
      skills,
      confirm,
      agent: {} as never,
      lifecycle: {
        bootstrap: vi.fn(),
        afterTurn: vi.fn(),

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
    };
    const onSessionEnter = vi.fn();

    const engine = new StelloEngineImpl({
      session: {
        id: 's1',
        meta: { id: 's1', turnCount: 0, status: 'active' as const },
        turnCount: 0,
        send: vi.fn(),
        consolidate: vi.fn(),
        messages: vi.fn().mockResolvedValue([]),
        setTools: vi.fn(),
      },
      sessions,
      skills,
      confirm,
      agent: {} as never,
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
      messages: vi.fn().mockResolvedValue([]),
      setTools: vi.fn(),
    };
    const onSessionLeave = vi.fn();

    const engine = new StelloEngineImpl({
      session,
      sessions,
      skills,
      confirm,
      agent: {} as never,
      lifecycle: {
        bootstrap: vi.fn(),
        afterTurn: vi.fn(),

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
      messages: vi.fn().mockResolvedValue([]),
      setTools: vi.fn(),
    };
    const archive = vi.fn().mockResolvedValue(undefined);
    const onSessionArchive = vi.fn();

    const engine = new StelloEngineImpl({
      session,
      sessions: { archive, getNode: vi.fn(), getTree: vi.fn() } as unknown as SessionTree,
      skills,
      confirm,
      agent: {} as never,
      lifecycle: {
        bootstrap: vi.fn(),
        afterTurn: vi.fn(),

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
    const createSession = vi.fn().mockResolvedValue({
      id: 'child-1', parentId: 's1', children: [], refs: [],
      depth: 1, index: 0, label: 'UI',
    });
    const sessionFork = vi.fn().mockResolvedValue({
      id: 'child-1', meta: { id: 'child-1', turnCount: 0, status: 'active' },
      turnCount: 0, send: vi.fn(), consolidate: vi.fn(), setTools: vi.fn(),
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
        messages: vi.fn().mockResolvedValue([]),
        setTools: vi.fn(),
        fork: sessionFork,
      },
      sessions: { ...sessions, createSession } as unknown as SessionTree,
      skills,
      confirm,
      agent: {} as never,
      lifecycle: { bootstrap: vi.fn(), afterTurn: vi.fn() },
      tools: {
        getToolDefinitions: vi.fn().mockReturnValue([]),
        executeTool: vi.fn(),
      },
      splitGuard: splitGuard as never,
      hooks: {
        onSessionFork: vi.fn(),
      },
    });

    const child = await engine.forkSession({ label: 'UI' });

    expect(splitGuard.checkCanSplit).toHaveBeenCalledWith('s1');
    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
      parentId: 's1', label: 'UI', sourceSessionId: 's1',
    }));
    expect(sessionFork).toHaveBeenCalledWith(expect.objectContaining({
      id: 'child-1', label: 'UI',
    }));
    expect(splitGuard.recordSplit).toHaveBeenCalledWith('s1', 3);
    expect(child.id).toBe('child-1');
  });


  it('splitGuard 拒绝时不会创建子 session', async () => {
    const createSession = vi.fn();
    const sessionFork = vi.fn();
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
        messages: vi.fn().mockResolvedValue([]),
        setTools: vi.fn(),
        fork: sessionFork,
      },
      sessions: { ...sessions, createSession } as unknown as SessionTree,
      skills, confirm, agent: {} as never,
      lifecycle: { bootstrap: vi.fn(), afterTurn: vi.fn() },
      tools: { getToolDefinitions: vi.fn().mockReturnValue([]), executeTool: vi.fn() },
      splitGuard: splitGuard as never,
    });

    await expect(engine.forkSession({ label: 'UI' })).rejects.toThrow('turns not enough');
    expect(createSession).not.toHaveBeenCalled();
  });

  describe('forkSession 新路径（session.fork）', () => {
    it('有 session.fork 时走新路径：createSession + session.fork', async () => {
      const createSession = vi.fn().mockResolvedValue({
        id: 'child-1', parentId: 's1', children: [], refs: [],
        depth: 1, index: 0, label: 'UI',
      });
      const sessionFork = vi.fn().mockResolvedValue({
        id: 'child-1', meta: { id: 'child-1', turnCount: 0, status: 'active' },
        turnCount: 0, send: vi.fn(), consolidate: vi.fn(), setTools: vi.fn(),
      });

      const engine = new StelloEngineImpl({
        session: {
          id: 's1', meta: { id: 's1', turnCount: 2, status: 'active' as const },
          turnCount: 2, send: vi.fn(), consolidate: vi.fn(),
          messages: vi.fn().mockResolvedValue([]),
          setTools: vi.fn(),
          fork: sessionFork,
        },
        sessions: { ...sessions, createSession } as unknown as SessionTree,
        skills, confirm, agent: {} as never,
        lifecycle: { bootstrap: vi.fn(), afterTurn: vi.fn() },
        tools: { getToolDefinitions: vi.fn().mockReturnValue([]), executeTool: vi.fn() },
      });

      const child = await engine.forkSession({
        label: 'UI', systemPrompt: 'you are UI expert', prompt: 'hello',
      });

      expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
        parentId: 's1', label: 'UI',
      }));
      expect(sessionFork).toHaveBeenCalledWith(expect.objectContaining({
        id: 'child-1', label: 'UI', systemPrompt: 'you are UI expert', prompt: 'hello',
      }));
      expect(child.id).toBe('child-1');
    });

    it('session 无 fork 方法时抛错', async () => {
      const engine = new StelloEngineImpl({
        session: {
          id: 's1', meta: { id: 's1', turnCount: 0, status: 'active' as const },
          turnCount: 0, send: vi.fn(), consolidate: vi.fn(),
          messages: vi.fn().mockResolvedValue([]),
          setTools: vi.fn(),
        },
        sessions, skills, confirm, agent: {} as never,
        lifecycle: { bootstrap: vi.fn(), afterTurn: vi.fn() },
        tools: { getToolDefinitions: vi.fn().mockReturnValue([]), executeTool: vi.fn() },
      });

      await expect(engine.forkSession({ label: 'UI' })).rejects.toThrow('Fork 不可用');
    });
  });

  describe('forkSession from root session', () => {
    it('从 root session fork 时正常读取 root 的 getConfig 并继承 systemPrompt', async () => {
      const getConfig = vi.fn().mockResolvedValue({ systemPrompt: 'root sys' });
      const putConfig = vi.fn().mockResolvedValue(undefined);
      const createSessionFn = vi.fn().mockResolvedValue({
        id: 'child-1',
        parentId: 'root-id',
        children: [],
        refs: [],
        depth: 1,
        index: 0,
        label: 'UI',
      });
      const sessionFork = vi.fn().mockResolvedValue({
        id: 'child-1',
        meta: { id: 'child-1', turnCount: 0, status: 'active' as const },
        turnCount: 0,
        send: vi.fn(),
        consolidate: vi.fn(),
        setTools: vi.fn(),
      });

      const engine = new StelloEngineImpl({
        session: {
          id: 'root-id',
          meta: { id: 'root-id', turnCount: 0, status: 'active' as const },
          turnCount: 0,
          send: vi.fn(),
          consolidate: vi.fn(),
          messages: vi.fn().mockResolvedValue([]),
          setTools: vi.fn(),
          fork: sessionFork,
        },
        sessions: { ...sessions, createSession: createSessionFn, getConfig, putConfig } as unknown as SessionTree,
        skills,
        confirm,
        agent: {} as never,
        lifecycle: { bootstrap: vi.fn(), afterTurn: vi.fn() },
        tools: { getToolDefinitions: vi.fn().mockReturnValue([]), executeTool: vi.fn() },
      });

      await engine.forkSession({ label: 'UI' });

      expect(getConfig).toHaveBeenCalledWith('root-id');
      expect(sessionFork).toHaveBeenCalledWith(
        expect.objectContaining({ systemPrompt: 'root sys' }),
      );
    });
  });

  describe('Engine pushes setTools to session', () => {
    it('pushes union(session.tools, capabilities.tools) at construction', () => {
      const userTool: ToolRegistryEntry = {
        name: 'user_tool',
        description: 'd',
        parameters: { type: 'object', properties: {} },
        execute: async () => ({ success: true }),
      };
      const sessionLevelTool = {
        name: 'session_tool',
        description: 's',
        inputSchema: { type: 'object' as const },
      };

      const sessionTools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> = [
        sessionLevelTool,
      ];
      const setTools = vi.fn((t: typeof sessionTools | undefined) => {
        sessionTools.length = 0;
        if (t) sessionTools.push(...t);
      });
      const session = {
        id: 's1',
        meta: { id: 's1', turnCount: 0, status: 'active' as const },
        turnCount: 0,
        send: vi.fn(),
        consolidate: vi.fn(),
        messages: vi.fn().mockResolvedValue([]),
        get tools() { return sessionTools; },
        setTools,
      };

      new StelloEngineImpl({
        session,
        sessions,
        skills,
        confirm,
        agent: {} as never,
        lifecycle: { bootstrap: vi.fn(), afterTurn: vi.fn() },
        tools: new ToolRegistryImpl([userTool]),
      });

      expect(setTools).toHaveBeenCalledTimes(1);
      const names = sessionTools.map(t => t.name);
      expect(names).toContain('user_tool');
      expect(names).toContain('session_tool');
    });

    it('pushes setTools to child runtime after forkSession', async () => {
      const userTool: ToolRegistryEntry = {
        name: 'user_tool',
        description: 'd',
        parameters: { type: 'object', properties: {} },
        execute: async () => ({ success: true }),
      };

      const childSetTools = vi.fn();
      const childRuntime = {
        id: 'child-1',
        meta: { id: 'child-1', turnCount: 0, status: 'active' as const },
        turnCount: 0,
        send: vi.fn(),
        consolidate: vi.fn(),
        messages: vi.fn().mockResolvedValue([]),
        tools: undefined as undefined | Array<{ name: string }>,
        setTools: childSetTools,
      };
      const sessionFork = vi.fn().mockResolvedValue(childRuntime);
      const createSession = vi.fn().mockResolvedValue({
        id: 'child-1', parentId: 's1', children: [], refs: [],
        depth: 1, index: 0, label: 'UI',
      });

      const parentSetTools = vi.fn();
      const engine = new StelloEngineImpl({
        session: {
          id: 's1',
          meta: { id: 's1', turnCount: 2, status: 'active' as const },
          turnCount: 2,
          send: vi.fn(),
          consolidate: vi.fn(),
          messages: vi.fn().mockResolvedValue([]),
          tools: undefined,
          setTools: parentSetTools,
          fork: sessionFork,
        },
        sessions: { ...sessions, createSession } as unknown as SessionTree,
        skills,
        confirm,
        agent: {} as never,
        lifecycle: { bootstrap: vi.fn(), afterTurn: vi.fn() },
        tools: new ToolRegistryImpl([userTool]),
      });

      // sanity: parent session received setTools at construction
      expect(parentSetTools).toHaveBeenCalledTimes(1);

      await engine.forkSession({ label: 'UI' });

      expect(childSetTools).toHaveBeenCalledTimes(1);
      const pushed = childSetTools.mock.calls[0]![0] as Array<{ name: string }>;
      const names = pushed.map(t => t.name);
      expect(names).toContain('user_tool');
    });
  });
});
