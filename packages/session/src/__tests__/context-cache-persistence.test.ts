import { describe, it, expect, expectTypeOf, vi, beforeEach, afterEach } from 'vitest'
import type { SessionStorage, CompressionCacheSnapshot } from '../types/storage'

describe('SessionStorage compression cache extension', () => {
  it('CompressionCacheSnapshot has the expected shape', () => {
    expectTypeOf<CompressionCacheSnapshot>().toEqualTypeOf<{
      summary: string
      compressedCount: number
    }>()
  })

  it('get/put/clearCompressionCache are optional on SessionStorage', () => {
    expectTypeOf<SessionStorage['getCompressionCache']>().toEqualTypeOf<
      ((sessionId: string) => Promise<CompressionCacheSnapshot | null>) | undefined
    >()
    expectTypeOf<SessionStorage['putCompressionCache']>().toEqualTypeOf<
      ((sessionId: string, snapshot: CompressionCacheSnapshot) => Promise<void>) | undefined
    >()
    expectTypeOf<SessionStorage['clearCompressionCache']>().toEqualTypeOf<
      ((sessionId: string) => Promise<void>) | undefined
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
    const storage = {} as any
    const result = await hydrateCompressionCache(storage, 'sid-1')
    expect(result).toBeNull()
  })

  it('returns null when storage returns null', async () => {
    const { hydrateCompressionCache } = await import('../context-utils')
    const storage: any = {
      getCompressionCache: async () => null,
    }
    const result = await hydrateCompressionCache(storage, 'sid-1')
    expect(result).toBeNull()
  })

  it('returns CompressionCache mirroring snapshot', async () => {
    const { hydrateCompressionCache } = await import('../context-utils')
    const storage: any = {
      getCompressionCache: async () => ({ summary: 's', compressedCount: 7 }),
    }
    const result = await hydrateCompressionCache(storage, 'sid-1')
    expect(result).toEqual({ summary: 's', compressedCount: 7 })
  })

  it('swallows errors and returns null', async () => {
    const { hydrateCompressionCache } = await import('../context-utils')
    const storage: any = {
      getCompressionCache: async () => { throw new Error('db down') },
    }
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
    const storage = {} as any
    expect(() => flushCompressionCache(storage, 'sid-1', { summary: 's', compressedCount: 3 })).not.toThrow()
  })

  it('calls putCompressionCache when present', async () => {
    const { flushCompressionCache } = await import('../context-utils')
    const calls: any[] = []
    const storage: any = {
      putCompressionCache: async (sid: string, snap: any) => { calls.push([sid, snap]) },
    }
    flushCompressionCache(storage, 'sid-1', { summary: 's', compressedCount: 3 })
    // 等待 microtask queue flush
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(calls).toEqual([['sid-1', { summary: 's', compressedCount: 3 }]])
  })

  it('swallows put errors (must not block caller)', async () => {
    const { flushCompressionCache } = await import('../context-utils')
    const storage: any = {
      putCompressionCache: async () => { throw new Error('disk full') },
    }
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
    const fakeStorage: any = {
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
      transaction: async (fn: any) => fn(fakeStorage),
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
    const puts: Array<[string, { summary: string; compressedCount: number }]> = []
    const storage: any = baseStorage
    storage.putCompressionCache = async (sid: string, snap: { summary: string; compressedCount: number }) => {
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
    const puts: Array<[string, unknown]> = []
    const storage: any = baseStorage
    storage.putCompressionCache = async (sid: string, snap: unknown) => {
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

  it('does NOT flush when compressFn throws (failed compress)', async () => {
    const { createSession } = await import('../create-session')
    const { InMemoryStorageAdapter } = await import('../mocks/in-memory-storage')
    const { createMockLLM } = await import('./helpers')

    const baseStorage = new InMemoryStorageAdapter()
    const puts: Array<[string, unknown]> = []
    const storage: any = baseStorage
    storage.putCompressionCache = async (sid: string, snap: unknown) => {
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
