import { describe, it, expect } from 'vitest'
import type { SessionStorage, CompressionCacheSnapshot } from '../types/storage'

describe('SessionStorage compression cache extension', () => {
  it('CompressionCacheSnapshot has summary and compressedCount fields', () => {
    const snapshot: CompressionCacheSnapshot = {
      summary: 'previously discussed X',
      compressedCount: 12,
    }
    expect(snapshot.summary).toBe('previously discussed X')
    expect(snapshot.compressedCount).toBe(12)
  })

  it('SessionStorage methods are optional (storage without them still satisfies interface)', () => {
    const storage: SessionStorage = {
      getSession: async () => null,
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
      transaction: async (fn) => fn({} as SessionStorage),
    }
    expect(storage.getCompressionCache).toBeUndefined()
    expect(storage.putCompressionCache).toBeUndefined()
  })
})
