import { describe, expect, it, vi } from 'vitest';
import type { SessionTree } from '../../types/session';
import type { MemoryEngine } from '../../types/memory';
import type { ConfirmProtocol, SkillRouter } from '../../types/lifecycle';
import { DefaultEngineFactory } from '../default-engine-factory';

describe('DefaultEngineFactory', () => {
  it('会把 sessionId 解析成 runtime session，并返回对应 engine', async () => {
    const runtimeSession = {
      id: 's1',
      meta: { id: 's1', turnCount: 0, status: 'active' as const },
      turnCount: 0,
      send: vi.fn().mockResolvedValue(JSON.stringify({ content: 'done', toolCalls: [] })),
      consolidate: vi.fn(),
    };

    const factory = new DefaultEngineFactory({
      sessions: {
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
          session: { id: 's1' },
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

    const engine = await factory.create('s1');
    const result = await engine.turn('hello');

    expect(engine.sessionId).toBe('s1');
    expect(runtimeSession.send).toHaveBeenCalledWith('hello');
    expect(result.turn.rawResponse).toContain('"content":"done"');
  });

  it('支持按 sessionId 提供不同 hooks', async () => {
    const runtimeSession = {
      id: 's-special',
      meta: { id: 's-special', turnCount: 0, status: 'active' as const },
      turnCount: 0,
      send: vi.fn().mockResolvedValue(JSON.stringify({ content: 'done', toolCalls: [] })),
      consolidate: vi.fn(),
    };
    const onSessionEnter = vi.fn();

    const factory = new DefaultEngineFactory({
      sessions: {
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
          session: { id: 's-special' },
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
      hooks: (sessionId) => ({
        onSessionEnter: sessionId === 's-special' ? onSessionEnter : vi.fn(),
      }),
    });

    const engine = await factory.create('s-special');
    await engine.enterSession();

    expect(onSessionEnter).toHaveBeenCalledWith({ sessionId: 's-special' });
  });
});
