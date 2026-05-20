import { describe, it, expect, expectTypeOf } from 'vitest'
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
  })
})

describe('flushCompressionCache', () => {
  it('is a no-op when storage has no putCompressionCache method', async () => {
    const { flushCompressionCache } = await import('../context-utils')
    const storage = {} as any
    await expect(flushCompressionCache(storage, 'sid-1', { summary: 's', compressedCount: 3 })).resolves.toBeUndefined()
  })

  it('calls putCompressionCache when present', async () => {
    const { flushCompressionCache } = await import('../context-utils')
    const calls: any[] = []
    const storage: any = {
      putCompressionCache: async (sid: string, snap: any) => { calls.push([sid, snap]) },
    }
    await flushCompressionCache(storage, 'sid-1', { summary: 's', compressedCount: 3 })
    expect(calls).toEqual([['sid-1', { summary: 's', compressedCount: 3 }]])
  })

  it('swallows put errors (must not block caller)', async () => {
    const { flushCompressionCache } = await import('../context-utils')
    const storage: any = {
      putCompressionCache: async () => { throw new Error('disk full') },
    }
    await expect(flushCompressionCache(storage, 'sid-1', { summary: 's', compressedCount: 1 })).resolves.toBeUndefined()
  })
})
