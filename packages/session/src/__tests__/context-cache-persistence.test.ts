import { describe, it, expectTypeOf } from 'vitest'
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
