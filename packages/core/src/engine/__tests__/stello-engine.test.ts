import { describe, it, expect, vi } from 'vitest';
import { Scheduler } from '../scheduler';
import { TurnRunner } from '../turn-runner';
import { createStelloEngine } from '../stello-engine';
import type { TurnRecord } from '../../types/memory';

/** 创建测试用 engine 依赖。 */
function makeDeps() {
  const childSession = {
    id: 'child-1',
    parentId: 's1',
    children: [],
    refs: [],
    label: 'Child',
    index: 0,
    scope: 'design',
    status: 'active' as const,
    depth: 1,
    turnCount: 0,
    metadata: {},
    tags: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    lastActiveAt: '2026-01-01T00:00:00Z',
  };
  const runtimeSession = {
    meta: { id: 's1', turnCount: 2, consolidatedTurn: 0 },
    send: vi.fn().mockResolvedValue({ content: 'done' }),
    consolidate: vi.fn().mockResolvedValue(undefined),
  };
  const mainSession = {
    integrate: vi.fn().mockResolvedValue(undefined),
  };
  const lifecycle = {
    bootstrap: vi.fn().mockResolvedValue({
      context: { core: {}, memories: [], currentMemory: null, scope: null },
      session: { id: 's2' },
    }),
    assemble: vi.fn().mockResolvedValue({
      core: { name: 'Alice' },
      memories: [],
      currentMemory: null,
      scope: null,
    }),
    afterTurn: vi.fn().mockResolvedValue({
      coreUpdated: true,
      memoryUpdated: true,
      recordAppended: true,
    }),
    onSessionSwitch: vi.fn().mockResolvedValue({
      context: { core: {}, memories: [], currentMemory: null, scope: null },
      session: { id: 's2' },
    }),
    prepareChildSpawn: vi.fn().mockResolvedValue(childSession),
  };
  const tools = {
    getToolDefinitions: vi.fn().mockReturnValue([{ name: 'tool_a', description: 'a', parameters: {} }]),
    executeTool: vi.fn().mockResolvedValue({ success: true, data: { ok: true } }),
  };
  const sessionResolver = {
    getSession: vi.fn().mockResolvedValue(runtimeSession),
    getMainSession: vi.fn().mockResolvedValue(mainSession),
  };
  const skills = {
    register: vi.fn(),
    match: vi.fn(),
    getAll: vi.fn().mockReturnValue([]),
  };
  const sessions = {
    createChild: vi.fn(),
    get: vi.fn(),
    getRoot: vi.fn(),
    listAll: vi.fn(),
    archive: vi.fn(),
    addRef: vi.fn(),
    updateMeta: vi.fn(),
    getAncestors: vi.fn(),
    getSiblings: vi.fn(),
  };
  const memory = {
    readCore: vi.fn(),
    writeCore: vi.fn(),
    readMemory: vi.fn(),
    writeMemory: vi.fn(),
    readScope: vi.fn(),
    writeScope: vi.fn(),
    readIndex: vi.fn(),
    writeIndex: vi.fn(),
    appendRecord: vi.fn(),
    readRecords: vi.fn(),
    assembleContext: vi.fn(),
  };
  const confirm = {
    confirmSplit: vi.fn(),
    dismissSplit: vi.fn(),
    confirmUpdate: vi.fn(),
    dismissUpdate: vi.fn(),
  };
  const splitGuard = {
    checkCanSplit: vi.fn().mockResolvedValue({ canSplit: true }),
    recordSplit: vi.fn(),
  };

  return {
    childSession,
    runtimeSession,
    mainSession,
    lifecycle,
    tools,
    sessionResolver,
    skills,
    sessions,
    memory,
    confirm,
    splitGuard,
  };
}

describe('StelloEngineImpl', () => {
  it('turn() 串起 TurnRunner 和 Scheduler', async () => {
    const deps = makeDeps();
    const engine = createStelloEngine({
      currentSessionId: 's1',
      sessions: deps.sessions,
      memory: deps.memory,
      skills: deps.skills,
      confirm: deps.confirm,
      lifecycle: deps.lifecycle,
      tools: deps.tools,
      sessionResolver: deps.sessionResolver,
      splitGuard: deps.splitGuard,
      turnRunner: new TurnRunner(),
      scheduler: new Scheduler({
        consolidation: { mode: 'everyNTurns', everyNTurns: 2 },
        integration: { mode: 'afterConsolidate' },
      }),
    });

    const result = await engine.turn('hello');

    expect(deps.sessionResolver.getSession).toHaveBeenCalledWith('s1');
    expect(deps.runtimeSession.send).toHaveBeenCalledWith('hello');
    expect(deps.runtimeSession.consolidate).toHaveBeenCalledTimes(1);
    expect(deps.mainSession.integrate).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      turn: {
        finalContent: 'done',
        toolRoundCount: 0,
        toolCallsExecuted: 0,
      },
      schedule: {
        consolidated: true,
        integrated: true,
      },
    });
  });

  it('switchSession() 更新 currentSessionId 并委托 lifecycle', async () => {
    const deps = makeDeps();
    const engine = createStelloEngine({
      currentSessionId: 's1',
      sessions: deps.sessions,
      memory: deps.memory,
      skills: deps.skills,
      confirm: deps.confirm,
      lifecycle: deps.lifecycle,
      tools: deps.tools,
      sessionResolver: deps.sessionResolver,
      splitGuard: deps.splitGuard,
    });

    const result = await engine.switchSession('s2');

    expect(deps.lifecycle.onSessionSwitch).toHaveBeenCalledWith('s1', 's2');
    expect(engine.currentSessionId).toBe('s2');
    expect(result.session.id).toBe('s2');
  });

  it('switchSessionWithSchedule() 在切换时触发 scheduler.onSessionSwitch', async () => {
    const deps = makeDeps();
    const engine = createStelloEngine({
      currentSessionId: 's1',
      sessions: deps.sessions,
      memory: deps.memory,
      skills: deps.skills,
      confirm: deps.confirm,
      lifecycle: deps.lifecycle,
      tools: deps.tools,
      sessionResolver: deps.sessionResolver,
      splitGuard: deps.splitGuard,
      scheduler: new Scheduler({
        consolidation: { mode: 'onSwitch' },
        integration: { mode: 'onSwitch' },
      }),
    });

    const result = await engine.switchSessionWithSchedule('s2');

    expect(deps.runtimeSession.consolidate).toHaveBeenCalledTimes(1);
    expect(deps.mainSession.integrate).toHaveBeenCalledTimes(1);
    expect(engine.currentSessionId).toBe('s2');
    expect(result.schedule).toEqual({ consolidated: true, integrated: true });
  });

  it('ingest() 返回技能匹配结果', async () => {
    const deps = makeDeps();
    deps.skills.match.mockReturnValue({ name: 'translate' });
    const engine = createStelloEngine({
      currentSessionId: 's1',
      sessions: deps.sessions,
      memory: deps.memory,
      skills: deps.skills,
      confirm: deps.confirm,
      lifecycle: deps.lifecycle,
      tools: deps.tools,
      sessionResolver: deps.sessionResolver,
      splitGuard: deps.splitGuard,
    });
    const message: TurnRecord = {
      role: 'user',
      content: 'please translate this',
      timestamp: '2026-01-01T00:00:00Z',
    };

    const result = await engine.ingest(message);

    expect(deps.skills.match).toHaveBeenCalledWith(message);
    expect(result).toEqual({ matchedSkill: 'translate' });
  });

  it('assemble() 和 afterTurn() 委托给 lifecycle', async () => {
    const deps = makeDeps();
    const engine = createStelloEngine({
      currentSessionId: 's1',
      sessions: deps.sessions,
      memory: deps.memory,
      skills: deps.skills,
      confirm: deps.confirm,
      lifecycle: deps.lifecycle,
      tools: deps.tools,
      sessionResolver: deps.sessionResolver,
      splitGuard: deps.splitGuard,
    });
    const userMsg: TurnRecord = {
      role: 'user',
      content: 'hello',
      timestamp: '2026-01-01T00:00:00Z',
    };
    const assistantMsg: TurnRecord = {
      role: 'assistant',
      content: 'hi',
      timestamp: '2026-01-01T00:00:01Z',
    };

    const context = await engine.assemble();
    const result = await engine.afterTurn(userMsg, assistantMsg);

    expect(deps.lifecycle.assemble).toHaveBeenCalledWith('s1');
    expect(deps.lifecycle.afterTurn).toHaveBeenCalledWith('s1', userMsg, assistantMsg);
    expect(context.core).toEqual({ name: 'Alice' });
    expect(result.recordAppended).toBe(true);
  });

  it('getToolDefinitions() 和 executeTool() 委托给 tools', async () => {
    const deps = makeDeps();
    const engine = createStelloEngine({
      currentSessionId: 's1',
      sessions: deps.sessions,
      memory: deps.memory,
      skills: deps.skills,
      confirm: deps.confirm,
      lifecycle: deps.lifecycle,
      tools: deps.tools,
      sessionResolver: deps.sessionResolver,
    });

    const defs = engine.getToolDefinitions();
    const result = await engine.executeTool('tool_a', { x: 1 });

    expect(defs).toEqual([{ name: 'tool_a', description: 'a', parameters: {} }]);
    expect(deps.tools.executeTool).toHaveBeenCalledWith('tool_a', { x: 1 });
    expect(result).toEqual({ success: true, data: { ok: true } });
  });

  it('archiveSession() 委托 sessions.archive 并触发 onArchive 调度', async () => {
    const deps = makeDeps();
    const engine = createStelloEngine({
      currentSessionId: 's1',
      sessions: deps.sessions,
      memory: deps.memory,
      skills: deps.skills,
      confirm: deps.confirm,
      lifecycle: deps.lifecycle,
      tools: deps.tools,
      sessionResolver: deps.sessionResolver,
      splitGuard: deps.splitGuard,
      scheduler: new Scheduler({
        consolidation: { mode: 'onArchive' },
        integration: { mode: 'manual' },
      }),
    });

    const result = await engine.archiveSession();

    expect(deps.sessions.archive).toHaveBeenCalledWith('s1');
    expect(deps.runtimeSession.consolidate).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      sessionId: 's1',
      schedule: { consolidated: true, integrated: false },
    });
  });

  it('forkSession() 先经过 splitGuard，再委托 lifecycle.prepareChildSpawn', async () => {
    const deps = makeDeps();
    deps.sessions.get.mockResolvedValue({ turnCount: 2 });
    const engine = createStelloEngine({
      currentSessionId: 's1',
      sessions: deps.sessions,
      memory: deps.memory,
      skills: deps.skills,
      confirm: deps.confirm,
      lifecycle: deps.lifecycle,
      tools: deps.tools,
      sessionResolver: deps.sessionResolver,
      splitGuard: deps.splitGuard,
    });

    const result = await engine.forkSession({
      label: 'Child',
      scope: 'design',
    });

    expect(deps.splitGuard.checkCanSplit).toHaveBeenCalledWith('s1');
    expect(deps.lifecycle.prepareChildSpawn).toHaveBeenCalledWith({
      parentId: 's1',
      label: 'Child',
      scope: 'design',
    });
    expect(deps.splitGuard.recordSplit).toHaveBeenCalledWith('s1', 2);
    expect(result).toEqual({ child: deps.childSession });
  });

  it('forkSession() 在 splitGuard 拒绝时抛错且不创建子 Session', async () => {
    const deps = makeDeps();
    deps.splitGuard.checkCanSplit.mockResolvedValue({
      canSplit: false,
      reason: '轮次不足',
    });
    const engine = createStelloEngine({
      currentSessionId: 's1',
      sessions: deps.sessions,
      memory: deps.memory,
      skills: deps.skills,
      confirm: deps.confirm,
      lifecycle: deps.lifecycle,
      tools: deps.tools,
      sessionResolver: deps.sessionResolver,
      splitGuard: deps.splitGuard,
    });

    await expect(engine.forkSession({ label: 'Child' })).rejects.toThrow('轮次不足');
    expect(deps.lifecycle.prepareChildSpawn).not.toHaveBeenCalled();
    expect(deps.splitGuard.recordSplit).not.toHaveBeenCalled();
  });
});
