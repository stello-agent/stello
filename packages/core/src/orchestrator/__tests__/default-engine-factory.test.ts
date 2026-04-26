import { describe, expect, it, vi } from 'vitest';
import type { SessionTree } from '../../types/session';
import type { MemoryEngine } from '../../types/memory';
import type { ConfirmProtocol, SkillRouter } from '../../types/lifecycle';
import { DefaultEngineFactory } from '../default-engine-factory';

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

  it.skip('固化 SessionConfig.skills 为白名单时，engine 使用过滤后的 skills', async () => {
    // TODO(Task 12): Rewrite or delete — relied on old auto-injection of activate_skill.
    const runtimeSession = makeSession()
    const globalSkills = {
      get: vi.fn((name: string) => ({ name, description: `${name} desc`, content: `${name} content` })),
      register: vi.fn(),
      getAll: vi.fn().mockReturnValue([
        { name: 'research', description: 'research desc', content: 'research content' },
        { name: 'coding', description: 'coding desc', content: 'coding content' },
        { name: 'translate', description: 'translate desc', content: 'translate content' },
      ]),
    } as unknown as SkillRouter

    const opts = baseOptions()
    const factory = new DefaultEngineFactory({
      ...opts,
      skills: globalSkills,
      sessions: {
        ...opts.sessions,
        getConfig: vi.fn().mockResolvedValue({ skills: ['research', 'coding'] }),
      } as unknown as SessionTree,
      sessionRuntimeResolver: {
        resolve: vi.fn().mockResolvedValue(runtimeSession),
      },
    })

    const engine = await factory.create('s1')
    const defs = engine.getToolDefinitions()
    const skillTool = defs.find(d => d.name === 'activate_skill')

    expect(skillTool).toBeDefined()
    expect(skillTool!.description).toContain('research')
    expect(skillTool!.description).toContain('coding')
    expect(skillTool!.description).not.toContain('translate')
  })

  it('固化 SessionConfig.skills: [] 时，activate_skill 工具不出现', async () => {
    const runtimeSession = makeSession()
    const globalSkills = {
      get: vi.fn(),
      register: vi.fn(),
      getAll: vi.fn().mockReturnValue([
        { name: 'research', description: 'research desc', content: 'research content' },
      ]),
    } as unknown as SkillRouter

    const opts = baseOptions()
    const factory = new DefaultEngineFactory({
      ...opts,
      skills: globalSkills,
      sessions: {
        ...opts.sessions,
        getConfig: vi.fn().mockResolvedValue({ skills: [] }),
      } as unknown as SessionTree,
      sessionRuntimeResolver: {
        resolve: vi.fn().mockResolvedValue(runtimeSession),
      },
    })

    const engine = await factory.create('s1')
    const defs = engine.getToolDefinitions()
    expect(defs.find(d => d.name === 'activate_skill')).toBeUndefined()
  })

  it.skip('固化 SessionConfig.skills 未定义（或为 null）时，使用全局 skills（不过滤）', async () => {
    // TODO(Task 12): Rewrite or delete — relied on old auto-injection of activate_skill.
    const runtimeSession = makeSession()
    const globalSkills = {
      get: vi.fn(),
      register: vi.fn(),
      getAll: vi.fn().mockReturnValue([
        { name: 'research', description: 'research desc', content: 'research content' },
      ]),
    } as unknown as SkillRouter

    const opts = baseOptions()
    const factory = new DefaultEngineFactory({
      ...opts,
      skills: globalSkills,
      sessions: {
        ...opts.sessions,
        getConfig: vi.fn().mockResolvedValue(null),
      } as unknown as SessionTree,
      sessionRuntimeResolver: {
        resolve: vi.fn().mockResolvedValue(runtimeSession),
      },
    })

    const engine = await factory.create('s1')
    const defs = engine.getToolDefinitions()
    const skillTool = defs.find(d => d.name === 'activate_skill')
    expect(skillTool).toBeDefined()
    expect(skillTool!.description).toContain('research')
  })

  const makeSessionWithTurnCount = (id = 's1', initialTurnCount = 0) => ({
    id,
    meta: { id, turnCount: initialTurnCount, status: 'active' as const },
    turnCount: initialTurnCount,
    send: vi.fn().mockResolvedValue(JSON.stringify({ content: 'done', toolCalls: [] })),
    consolidate: vi.fn().mockResolvedValue(undefined),
  });

  it('consolidateEveryNTurns 到达阈值时自动触发 consolidate', async () => {
    // turnCount 从 1 开始，+1 后为 2，2 % 2 === 0，应触发
    const runtimeSession = makeSessionWithTurnCount('s1', 1);
    const opts = baseOptions();

    const factory = new DefaultEngineFactory({
      ...opts,
      sessionRuntimeResolver: {
        resolve: vi.fn().mockResolvedValue(runtimeSession),
      },
      consolidateEveryNTurns: 2,
    });

    const engine = await factory.create('s1');
    await engine.turn('hello');
    // fire-and-forget，等 microtasks 完成
    await Promise.resolve();

    expect(runtimeSession.consolidate).toHaveBeenCalled();
  });

  it('未达阈值时不触发 consolidate', async () => {
    // turnCount 从 0 开始，+1 后为 1，1 % 2 !== 0，不触发
    const runtimeSession = makeSessionWithTurnCount('s1', 0);
    const opts = baseOptions();

    const factory = new DefaultEngineFactory({
      ...opts,
      sessionRuntimeResolver: {
        resolve: vi.fn().mockResolvedValue(runtimeSession),
      },
      consolidateEveryNTurns: 2,
    });

    const engine = await factory.create('s1');
    await engine.turn('hello');
    await Promise.resolve();

    expect(runtimeSession.consolidate).not.toHaveBeenCalled();
  });

  it('未配置 consolidateEveryNTurns 时无自动 consolidation', async () => {
    const runtimeSession = makeSessionWithTurnCount('s1', 1);
    const opts = baseOptions();

    const factory = new DefaultEngineFactory({
      ...opts,
      sessionRuntimeResolver: {
        resolve: vi.fn().mockResolvedValue(runtimeSession),
      },
      // 没有 consolidateEveryNTurns
    });

    const engine = await factory.create('s1');
    await engine.turn('hello');
    await Promise.resolve();

    expect(runtimeSession.consolidate).not.toHaveBeenCalled();
  });

  it('用户 hooks 和自动 consolidation hook 合并后都能触发', async () => {
    // turnCount 从 1 开始，+1 后为 2，2 % 2 === 0，应触发
    const runtimeSession = makeSessionWithTurnCount('s1', 1);
    const opts = baseOptions();
    const userOnRoundEnd = vi.fn();

    const factory = new DefaultEngineFactory({
      ...opts,
      sessionRuntimeResolver: {
        resolve: vi.fn().mockResolvedValue(runtimeSession),
      },
      consolidateEveryNTurns: 2,
      hooks: {
        onRoundEnd: userOnRoundEnd,
      },
    });

    const engine = await factory.create('s1');
    await engine.turn('hello');
    await Promise.resolve();

    expect(userOnRoundEnd).toHaveBeenCalled();
    expect(runtimeSession.consolidate).toHaveBeenCalled();
  });
});
