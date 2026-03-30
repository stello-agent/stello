import { describe, expect, it, vi } from 'vitest';
import type { SessionTree } from '../../types/session';
import type { MemoryEngine } from '../../types/memory';
import type { ConfirmProtocol, SkillRouter } from '../../types/lifecycle';
import { StelloEngineImpl } from '../stello-engine';
import { TurnRunner, type ToolCallParser } from '../turn-runner';

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
