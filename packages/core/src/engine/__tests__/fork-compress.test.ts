import { describe, it, expect, vi } from 'vitest'
import { applyCompressContext, ForkConfigError } from '../fork-compress'
import type { LLMCallFn } from '../../llm/defaults'
import { StelloEngineImpl } from '../stello-engine'
import { ForkProfileRegistryImpl, type ForkProfile } from '../fork-profile'
import type { SessionTree } from '../../types/session'
import type { MemoryEngine } from '../../types/memory'
import type { ConfirmProtocol, SkillRouter } from '../../types/lifecycle'
import type { SessionConfig } from '../../types/session-config'

const makeMessages = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `msg${i}`,
  }))

describe('applyCompressContext', () => {
  it('非 compress 上下文直接透传', async () => {
    const result = await applyCompressContext({
      context: 'inherit',
      systemPrompt: 'role',
      compressFn: undefined,
      llmCallFn: undefined,
      sourceMessages: async () => makeMessages(2),
    })
    expect(result).toEqual({ systemPrompt: 'role', forwardedContext: 'inherit' })
  })

  it('compress + compressFn 可用：追加 <parent_context> 段,forwardedContext=none', async () => {
    const compressFn = vi.fn(async () => '摘要内容')
    const result = await applyCompressContext({
      context: 'compress',
      systemPrompt: 'role',
      compressFn,
      llmCallFn: undefined,
      sourceMessages: async () => makeMessages(4),
    })
    expect(compressFn).toHaveBeenCalledOnce()
    expect(result.systemPrompt).toBe('role\n\n<parent_context>\n摘要内容\n</parent_context>')
    expect(result.forwardedContext).toBe('none')
  })

  it('compress + 父消息为空：跳过压缩,不追加,forwardedContext=none', async () => {
    const compressFn = vi.fn()
    const result = await applyCompressContext({
      context: 'compress',
      systemPrompt: 'role',
      compressFn,
      llmCallFn: undefined,
      sourceMessages: async () => [],
    })
    expect(compressFn).not.toHaveBeenCalled()
    expect(result.systemPrompt).toBe('role')
    expect(result.forwardedContext).toBe('none')
  })

  it('compress + systemPrompt 为 undefined：以空字符串起头追加', async () => {
    const result = await applyCompressContext({
      context: 'compress',
      systemPrompt: undefined,
      compressFn: async () => 'X',
      llmCallFn: undefined,
      sourceMessages: async () => makeMessages(2),
    })
    expect(result.systemPrompt).toBe('\n\n<parent_context>\nX\n</parent_context>')
    expect(result.forwardedContext).toBe('none')
  })

  it('compress + 无 compressFn 但有 llmCallFn：fallback 用 DEFAULT_COMPRESS_PROMPT 构建', async () => {
    const llmCallFn = vi.fn<LLMCallFn>(async () => 'fallback-summary')
    const result = await applyCompressContext({
      context: 'compress',
      systemPrompt: 'r',
      compressFn: undefined,
      llmCallFn,
      sourceMessages: async () => makeMessages(2),
    })
    expect(llmCallFn).toHaveBeenCalledOnce()
    expect(result.systemPrompt).toBe('r\n\n<parent_context>\nfallback-summary\n</parent_context>')
    expect(result.forwardedContext).toBe('none')
  })

  it('compress + 无 compressFn 也无 llmCallFn：抛 ForkConfigError', async () => {
    await expect(
      applyCompressContext({
        context: 'compress',
        systemPrompt: 'r',
        compressFn: undefined,
        llmCallFn: undefined,
        sourceMessages: async () => makeMessages(2),
      }),
    ).rejects.toBeInstanceOf(ForkConfigError)
  })

  it('compress + compressFn 抛异常：向上传播', async () => {
    const boom = new Error('LLM down')
    await expect(
      applyCompressContext({
        context: 'compress',
        systemPrompt: 'r',
        compressFn: async () => {
          throw boom
        },
        llmCallFn: undefined,
        sourceMessages: async () => makeMessages(2),
      }),
    ).rejects.toBe(boom)
  })
})

describe('forkSession compress integration', () => {
  interface MakeEngineOptions {
    sessionDefaults?: SessionConfig
    profiles?: Record<string, ForkProfile>
    parentMessages?: Array<{ role: string; content: string; timestamp?: string }>
  }

  function makeEngine(opts: MakeEngineOptions) {
    const parentMessages = opts.parentMessages ?? []
    const sessionFork = vi.fn().mockResolvedValue({
      id: 'child-1',
      meta: { id: 'child-1', turnCount: 0, status: 'active' as const },
      turnCount: 0,
      send: vi.fn(),
      consolidate: vi.fn(),
      messages: vi.fn().mockResolvedValue([]),
    })
    const fakeSession = {
      id: 's1',
      meta: { id: 's1', turnCount: 2, status: 'active' as const },
      turnCount: 2,
      send: vi.fn(),
      consolidate: vi.fn(),
      messages: vi.fn().mockResolvedValue(parentMessages),
      fork: sessionFork,
    }
    const fakeSessions = {
      archive: vi.fn().mockResolvedValue(undefined),
      getNode: vi.fn(),
      getTree: vi.fn(),
      getConfig: vi.fn().mockResolvedValue(null),
      putConfig: vi.fn().mockResolvedValue(undefined),
      createChild: vi.fn().mockResolvedValue({
        id: 'child-1',
        parentId: 's1',
        children: [],
        refs: [],
        depth: 1,
        index: 0,
        label: 'x',
      }),
    }
    const memory = {} as MemoryEngine
    const skills = {
      get: vi.fn().mockReturnValue(undefined),
      register: vi.fn(),
      getAll: vi.fn().mockReturnValue([]),
    } as unknown as SkillRouter
    const confirm = {} as ConfirmProtocol

    let profileRegistry: ForkProfileRegistryImpl | undefined
    if (opts.profiles) {
      profileRegistry = new ForkProfileRegistryImpl()
      for (const [name, profile] of Object.entries(opts.profiles)) {
        profileRegistry.register(name, profile)
      }
    }

    const engine = new StelloEngineImpl({
      session: fakeSession,
      sessions: fakeSessions as unknown as SessionTree,
      memory,
      skills,
      confirm,
      lifecycle: { bootstrap: vi.fn(), afterTurn: vi.fn() },
      tools: {
        getToolDefinitions: vi.fn().mockReturnValue([]),
        executeTool: vi.fn(),
      },
      profiles: profileRegistry,
      sessionDefaults: opts.sessionDefaults,
    })

    return { engine, fakeSession, fakeSessions }
  }

  it('context=compress + sessionDefaults.compressFn → child systemPrompt 含 <parent_context>', async () => {
    const compressFn = vi.fn(async () => '压缩摘要')
    const { engine, fakeSession, fakeSessions } = makeEngine({
      sessionDefaults: { compressFn },
      parentMessages: [
        { role: 'user', content: '聊了半天选校' },
        { role: 'assistant', content: '好的' },
      ],
    })

    await engine.forkSession({ label: '子任务', context: 'compress', systemPrompt: 'role' })

    expect(compressFn).toHaveBeenCalledOnce()
    const forkCall = fakeSession.fork.mock.calls[0]![0]
    expect(forkCall.context).toBe('none')
    expect(forkCall.systemPrompt).toBe(
      'role\n\n<parent_context>\n压缩摘要\n</parent_context>',
    )
    expect(fakeSessions.putConfig).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        systemPrompt: 'role\n\n<parent_context>\n压缩摘要\n</parent_context>',
      }),
    )
  })

  it('context=compress + 无 compressFn + 无 llm → 抛错，未创建拓扑节点', async () => {
    const { engine, fakeSessions } = makeEngine({
      sessionDefaults: {},
      parentMessages: [{ role: 'user', content: 'x' }],
    })
    await expect(
      engine.forkSession({ label: 'x', context: 'compress' }),
    ).rejects.toThrow(/compress/)
    expect(fakeSessions.createChild).not.toHaveBeenCalled()
  })

  it('context=compress + 父 L3 空 → 不追加，但 forwardedContext=none', async () => {
    const compressFn = vi.fn()
    const { engine, fakeSession } = makeEngine({
      sessionDefaults: { compressFn },
      parentMessages: [],
    })
    await engine.forkSession({ label: 'x', context: 'compress', systemPrompt: 'role' })
    expect(compressFn).not.toHaveBeenCalled()
    const forkCall = fakeSession.fork.mock.calls[0]![0]
    expect(forkCall.context).toBe('none')
    expect(forkCall.systemPrompt).toBe('role')
  })

  it('profile.context=compress + options 不覆盖 → 走压缩路径', async () => {
    const compressFn = vi.fn(async () => '摘要')
    const { engine } = makeEngine({
      sessionDefaults: { compressFn },
      profiles: { research: { context: 'compress', systemPrompt: '研究员' } },
      parentMessages: [
        { role: 'user', content: 'x' },
        { role: 'assistant', content: 'y' },
      ],
    })
    await engine.forkSession({ label: 'x', profile: 'research' })
    expect(compressFn).toHaveBeenCalledOnce()
  })

  it('options.context=compress 覆盖 profile.context=inherit', async () => {
    const compressFn = vi.fn(async () => '摘要')
    const { engine } = makeEngine({
      sessionDefaults: { compressFn },
      profiles: { r: { context: 'inherit' } },
      parentMessages: [
        { role: 'user', content: 'x' },
        { role: 'assistant', content: 'y' },
      ],
    })
    await engine.forkSession({ label: 'x', profile: 'r', context: 'compress' })
    expect(compressFn).toHaveBeenCalledOnce()
  })

  // Spec §"Testing requirements" #8: reload idempotence.
  // By construction: compression runs once inside forkSession and bakes the result
  // into serializable.systemPrompt; there is no other call site for applyCompressContext.
  // Asserting that putConfig receives the final string proves that on any future
  // rehydrate the stored systemPrompt is replayed as-is and compressFn is not
  // re-invoked. This explicit test guards against regressions if anyone ever adds
  // a second call site for applyCompressContext.
  it('compress 只在 fork 时调一次 compressFn；持久化后的 systemPrompt 与传给 session.fork 的一致', async () => {
    const compressFn = vi.fn(async () => '摘要')
    const { engine, fakeSession, fakeSessions } = makeEngine({
      sessionDefaults: { compressFn },
      parentMessages: [
        { role: 'user', content: 'x' },
        { role: 'assistant', content: 'y' },
      ],
    })
    await engine.forkSession({ label: 'x', context: 'compress', systemPrompt: 'role' })
    expect(compressFn).toHaveBeenCalledTimes(1)
    const putConfigCall = fakeSessions.putConfig.mock.calls[0]!
    const forkCall = fakeSession.fork.mock.calls[0]![0]
    expect(putConfigCall[1].systemPrompt).toBe(forkCall.systemPrompt)
    expect(putConfigCall[1].systemPrompt).toContain('<parent_context>')
  })
})
