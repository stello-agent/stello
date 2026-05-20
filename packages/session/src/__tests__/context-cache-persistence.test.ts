import { describe, it, expect, expectTypeOf, vi, beforeEach, afterEach } from 'vitest'
import type { SessionStorage, CompressionCacheSnapshot } from '../types/storage'

describe('SessionStorage compression cache extension', () => {
  it('CompressionCacheSnapshot has the expected shape', () => {
    expectTypeOf<CompressionCacheSnapshot>().toEqualTypeOf<{
      summary: string
      compressedCount: number
    }>()
  })

  it('get/putCompressionCache are optional on SessionStorage', () => {
    expectTypeOf<SessionStorage['getCompressionCache']>().toEqualTypeOf<
      ((sessionId: string) => Promise<CompressionCacheSnapshot | null>) | undefined
    >()
    expectTypeOf<SessionStorage['putCompressionCache']>().toEqualTypeOf<
      ((sessionId: string, snapshot: CompressionCacheSnapshot) => Promise<void>) | undefined
    >()
  })
})

describe('hydrateCompressionCache', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('returns null when storage has no method', async () => {
    const { hydrateCompressionCache } = await import('../context-utils')
    const storage = {} as unknown as SessionStorage
    const result = await hydrateCompressionCache(storage, 'sid-1')
    expect(result).toBeNull()
  })

  it('returns null when storage returns null', async () => {
    const { hydrateCompressionCache } = await import('../context-utils')
    const storage = {
      getCompressionCache: async () => null,
    } as unknown as SessionStorage
    const result = await hydrateCompressionCache(storage, 'sid-1')
    expect(result).toBeNull()
  })

  it('returns CompressionCache mirroring snapshot', async () => {
    const { hydrateCompressionCache } = await import('../context-utils')
    const storage = {
      getCompressionCache: async () => ({ summary: 's', compressedCount: 7 }),
    } as unknown as SessionStorage
    const result = await hydrateCompressionCache(storage, 'sid-1')
    expect(result).toEqual({ summary: 's', compressedCount: 7 })
  })

  it('swallows errors and returns null', async () => {
    const { hydrateCompressionCache } = await import('../context-utils')
    const storage = {
      getCompressionCache: async () => { throw new Error('db down') },
    } as unknown as SessionStorage
    const result = await hydrateCompressionCache(storage, 'sid-1')
    expect(result).toBeNull()
    expect(warnSpy).toHaveBeenCalledWith(
      '[stello/session] hydrateCompressionCache failed',
      expect.objectContaining({ sessionId: 'sid-1', err: expect.any(Error) }),
    )
  })
})

describe('flushCompressionCache', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('is a no-op when storage has no putCompressionCache method', async () => {
    const { flushCompressionCache } = await import('../context-utils')
    const storage = {} as unknown as SessionStorage
    expect(() => flushCompressionCache(storage, 'sid-1', { summary: 's', compressedCount: 3 })).not.toThrow()
  })

  it('calls putCompressionCache when present', async () => {
    const { flushCompressionCache } = await import('../context-utils')
    const calls: Array<[string, CompressionCacheSnapshot]> = []
    const storage = {
      putCompressionCache: async (sid: string, snap: CompressionCacheSnapshot) => { calls.push([sid, snap]) },
    } as unknown as SessionStorage
    flushCompressionCache(storage, 'sid-1', { summary: 's', compressedCount: 3 })
    // 等待 microtask queue flush
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(calls).toEqual([['sid-1', { summary: 's', compressedCount: 3 }]])
  })

  it('swallows put errors (must not block caller)', async () => {
    const { flushCompressionCache } = await import('../context-utils')
    const storage = {
      putCompressionCache: async () => { throw new Error('disk full') },
    } as unknown as SessionStorage
    expect(() => flushCompressionCache(storage, 'sid-1', { summary: 's', compressedCount: 1 })).not.toThrow()
    // 让 microtask 跑完;不应产生 unhandled rejection
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(warnSpy).toHaveBeenCalledWith(
      '[stello/session] flushCompressionCache failed',
      expect.objectContaining({ sessionId: 'sid-1', err: expect.any(Error) }),
    )
  })
})

describe('createSession compressionCache hydration', () => {
  it('hydrates compressionCache from storage on creation when getCompressionCache returns a snapshot', async () => {
    const { createSession } = await import('../create-session')
    const calls: string[] = []
    const fakeStorage: SessionStorage = {
      getSession: async (id: string) => ({ id, label: 'test', status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }),
      putSession: async () => {},
      listSessions: async () => [],
      appendRecord: async () => {},
      listRecords: async () => [],
      trimRecords: async () => {},
      getSystemPrompt: async () => null,
      putSystemPrompt: async () => {},
      getInsight: async () => null,
      putInsight: async () => {},
      clearInsight: async () => {},
      getMemory: async () => null,
      putMemory: async () => {},
      transaction: async <T,>(fn: (tx: SessionStorage) => Promise<T>) => fn(fakeStorage),
      getCompressionCache: async (sid: string) => {
        calls.push(sid)
        return { summary: 'hydrated', compressedCount: 5 }
      },
    }

    const session = await createSession({
      id: 'sid-1',
      storage: fakeStorage,
    })

    // 等待 microtask + I/O 跑完(fire-and-forget hydrate)
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(calls).toEqual(['sid-1'])
    expect(session).toBeDefined()
    expect(session.meta.id).toBe('sid-1')
  })
})

describe('compress persistence — flush after success', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('calls storage.putCompressionCache after a successful compress in send()', async () => {
    const { createSession } = await import('../create-session')
    const { InMemoryStorageAdapter } = await import('../mocks/in-memory-storage')
    const { createMockLLM } = await import('./helpers')

    // 基于 InMemoryStorageAdapter,但额外捕获 putCompressionCache 调用
    const baseStorage = new InMemoryStorageAdapter()
    const puts: Array<[string, CompressionCacheSnapshot]> = []
    const storage: SessionStorage = baseStorage
    storage.putCompressionCache = async (sid, snap) => {
      puts.push([sid, snap])
    }

    // 极小上下文窗口 → 必然触发压缩;mock LLM 一次响应即可
    const llm = { ...createMockLLM([{ content: 'OK', usage: { promptTokens: 100, completionTokens: 10 } }]), maxContextTokens: 50 }
    const compressFn = async () => 'compressed summary text'

    const session = await createSession({
      id: 'sid-flush-1',
      storage,
      llm,
      compressFn,
      label: 'Test',
    })

    // 预填充足量历史,确保超阈触发 compress
    for (let i = 0; i < 20; i++) {
      await storage.appendRecord(session.meta.id, { role: 'user', content: `message number ${i} with some padding text` })
      await storage.appendRecord(session.meta.id, { role: 'assistant', content: `reply number ${i} with some padding text` })
    }

    await session.send('trigger compress')

    // flush 是 fire-and-forget,等 microtask 跑完
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(puts).toHaveLength(1)
    expect(puts[0]![0]).toBe('sid-flush-1')
    expect(puts[0]![1]).toEqual({ summary: 'compressed summary text', compressedCount: expect.any(Number) })
    expect(puts[0]![1].compressedCount).toBeGreaterThan(0)
  })

  it('does NOT flush when no compress occurs (under threshold)', async () => {
    const { createSession } = await import('../create-session')
    const { InMemoryStorageAdapter } = await import('../mocks/in-memory-storage')
    const { createMockLLM } = await import('./helpers')

    const baseStorage = new InMemoryStorageAdapter()
    const puts: Array<[string, CompressionCacheSnapshot]> = []
    const storage: SessionStorage = baseStorage
    storage.putCompressionCache = async (sid, snap) => {
      puts.push([sid, snap])
    }

    // 巨大上下文窗口 → 不触发 compress
    const llm = { ...createMockLLM([{ content: 'OK', usage: { promptTokens: 100, completionTokens: 10 } }]), maxContextTokens: 1_000_000 }
    const compressFn = async () => 'should not be called'

    const session = await createSession({
      id: 'sid-noflush',
      storage,
      llm,
      compressFn,
      label: 'Test',
    })

    await session.send('a normal message')
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(puts).toHaveLength(0)
  })

  it('does NOT re-flush on cache hits (same reference returned)', async () => {
    const { createSession } = await import('../create-session')
    const { InMemoryStorageAdapter } = await import('../mocks/in-memory-storage')
    const { createMockLLM } = await import('./helpers')

    const baseStorage = new InMemoryStorageAdapter()
    const puts: Array<[string, CompressionCacheSnapshot]> = []
    const storage: SessionStorage = baseStorage
    storage.putCompressionCache = async (sid, snap) => {
      puts.push([sid, snap])
    }

    // 用统一长度的 user / assistant 消息(包括 send 时的输入和 mock LLM 的回复),
    // 这样每轮 send 后历史增长的 token 量与旧消息一致,recentMessages 选择窗口
    // 会等量右移,history.length - recentMessages.length 保持稳定 → 触发缓存命中。
    const UNIFORM = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' // 44 chars ≈ 11 tokens
    const llm = {
      ...createMockLLM([
        { content: UNIFORM, usage: { promptTokens: 100, completionTokens: 10 } },
        { content: UNIFORM, usage: { promptTokens: 100, completionTokens: 10 } },
      ]),
      maxContextTokens: 200,
    }

    // 计数 compressFn 实际被调用的次数;返回稳定摘要
    let compressFnCalls = 0
    const compressFn = async () => {
      compressFnCalls++
      return 'stable'
    }

    const session = await createSession({
      id: 'sid-cachehit',
      storage,
      llm,
      compressFn,
      label: 'Test',
    })

    // 预填充足量历史,确保第一次 send 时超阈触发 compress
    for (let i = 0; i < 30; i++) {
      await storage.appendRecord(session.meta.id, { role: 'user', content: UNIFORM })
      await storage.appendRecord(session.meta.id, { role: 'assistant', content: UNIFORM })
    }

    // 第一次 send → 产生新压缩快照,flush 一次
    await session.send(UNIFORM)
    await new Promise<void>((resolve) => setImmediate(resolve))

    // 第二次 send → 缓存命中(compressedCount 不变),compressWithFn 返回同引用,
    // persistAndApplyCompressionCache 跳过 flush
    await session.send(UNIFORM)
    await new Promise<void>((resolve) => setImmediate(resolve))

    // 关键断言:flush 只发生一次,即使两次 send 都走 compress 路径
    expect(puts).toHaveLength(1)
    // 同时验证 compressFn 也只被实际调用一次(进一步佐证第二次是缓存命中)
    expect(compressFnCalls).toBe(1)
  })

  it('does NOT flush when compressFn throws (failed compress)', async () => {
    const { createSession } = await import('../create-session')
    const { InMemoryStorageAdapter } = await import('../mocks/in-memory-storage')
    const { createMockLLM } = await import('./helpers')

    const baseStorage = new InMemoryStorageAdapter()
    const puts: Array<[string, CompressionCacheSnapshot]> = []
    const storage: SessionStorage = baseStorage
    storage.putCompressionCache = async (sid, snap) => {
      puts.push([sid, snap])
    }

    const llm = { ...createMockLLM([{ content: 'OK', usage: { promptTokens: 100, completionTokens: 10 } }]), maxContextTokens: 50 }
    const compressFn = async () => { throw new Error('compress boom') }

    const session = await createSession({
      id: 'sid-failcompress',
      storage,
      llm,
      compressFn,
      label: 'Test',
    })

    for (let i = 0; i < 20; i++) {
      await storage.appendRecord(session.meta.id, { role: 'user', content: `message number ${i} with some padding text` })
      await storage.appendRecord(session.meta.id, { role: 'assistant', content: `reply number ${i} with some padding text` })
    }

    await expect(session.send('trigger')).rejects.toThrow('compress boom')
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(puts).toHaveLength(0)
  })
})

describe('end-to-end: flush ↔ hydrate cycle', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('flushed snapshot from one session is readable via hydrate on the next', async () => {
    const { createSession } = await import('../create-session')
    const { InMemoryStorageAdapter } = await import('../mocks/in-memory-storage')
    const { hydrateCompressionCache } = await import('../context-utils')
    const { createMockLLM } = await import('./helpers')

    // 单一 storage 实例,跨两个 session 生命周期共享(模拟"重启后同 sid 再起")
    const baseStorage = new InMemoryStorageAdapter()
    const persistedCaches = new Map<string, CompressionCacheSnapshot>()
    const storage: SessionStorage = baseStorage
    storage.getCompressionCache = async (sid) => persistedCaches.get(sid) ?? null
    storage.putCompressionCache = async (sid, snap) => {
      persistedCaches.set(sid, { summary: snap.summary, compressedCount: snap.compressedCount })
    }

    // 统一长度的 user/assistant 消息,让 send 时历史增长平稳,与 S4 cache-hit 测试同款
    const UNIFORM = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const SHARED_SID = 'sid-e2e'
    const makeLLM = () => ({
      ...createMockLLM([
        { content: UNIFORM, usage: { promptTokens: 100, completionTokens: 10 } },
        { content: UNIFORM, usage: { promptTokens: 100, completionTokens: 10 } },
      ]),
      maxContextTokens: 200,
    })

    // —— Session A:产生压缩,flush 写入"持久化" map
    const sessionA = await createSession({
      id: SHARED_SID,
      storage,
      llm: makeLLM(),
      compressFn: async () => 'PERSISTED-SUMMARY-FROM-SESSION-A',
      label: 'A',
    })

    // 预填充足量历史,确保第一次 send 时超阈触发 compress
    for (let i = 0; i < 30; i++) {
      await storage.appendRecord(sessionA.meta.id, { role: 'user', content: UNIFORM })
      await storage.appendRecord(sessionA.meta.id, { role: 'assistant', content: UNIFORM })
    }

    await sessionA.send(UNIFORM)
    // fire-and-forget flush 跑完
    await new Promise<void>((resolve) => setImmediate(resolve))

    // 1) Session A 之后,storage 中已有快照
    expect(persistedCaches.has(SHARED_SID)).toBe(true)
    const persisted = persistedCaches.get(SHARED_SID)!
    expect(persisted.summary).toBe('PERSISTED-SUMMARY-FROM-SESSION-A')
    expect(persisted.compressedCount).toBeGreaterThan(0)

    // —— Session B:同 sid + 同 storage(模拟进程重启 / 新 session 实例)
    // 仅为触发 createSession 内部的 fire-and-forget hydrate 副作用,session 实例本身不参与断言
    await createSession({
      id: SHARED_SID,
      storage,
      llm: makeLLM(),
      compressFn: async () => 'would-not-affect-test',
      label: 'B',
    })

    // 等待 createSession 内部的 fire-and-forget hydrate 完成
    await new Promise<void>((resolve) => setImmediate(resolve))

    // 2) hydrateCompressionCache 直接调用应该返回与 session A flush 同样的快照
    //    (hydrate 自身契约,不依赖 session 内部状态,是真实的 round-trip 证明)
    const restored = await hydrateCompressionCache(storage, SHARED_SID)
    expect(restored).toEqual({
      summary: 'PERSISTED-SUMMARY-FROM-SESSION-A',
      compressedCount: persisted.compressedCount,
    })
  })
})
