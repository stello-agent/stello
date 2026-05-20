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

    try {
      await createSession({
        id: 'sid-1',
        storage: fakeStorage,
      } as any)
    } catch {
      // 即使 createSession 因不完整的 stub 抛错,只要 getCompressionCache 已经被调用,我们就 PASS
    }

    // 等待 microtask + I/O 跑完(fire-and-forget hydrate)
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(calls).toEqual(['sid-1'])
  })
})
