import { describe, it, expect } from 'vitest'
import { assembleSessionContext } from '../context-utils.js'
import type { SessionStorage } from '../types/storage.js'

function makeStorage(overrides: Partial<SessionStorage> = {}): SessionStorage {
  return {
    getSystemPrompt: async () => 'SP',
    getInsight: async () => null,
    listRecords: async () => [],
    putRecords: async () => {},
    putSystemPrompt: async () => {},
    putInsight: async () => {},
    clearInsight: async () => {},
    getMemory: async () => null,
    putMemory: async () => {},
    ...overrides,
  } as unknown as SessionStorage
}

describe('assembleSessionContext with topologyContext', () => {
  it('injects topologyContext as a system message after sharedMemoryContext', async () => {
    const storage = makeStorage()
    const result = await assembleSessionContext(
      's1',
      storage,
      'hello',
      { compressFn: async () => '', maxContextTokens: 100000, compressionCache: null, lastPromptTokens: null },
      undefined,
      'SHARED',
      '<topology>TOP</topology>',
    )
    const systemContents = result.messages.filter(m => m.role === 'system').map(m => m.content)
    expect(systemContents).toContain('<topology>TOP</topology>')
    const idxShared = systemContents.indexOf('SHARED')
    const idxTopo = systemContents.indexOf('<topology>TOP</topology>')
    expect(idxShared).toBeGreaterThanOrEqual(0)
    expect(idxTopo).toBeGreaterThan(idxShared)
  })

  it('skips topologyContext system message when undefined', async () => {
    const storage = makeStorage()
    const result = await assembleSessionContext(
      's1',
      storage,
      'hello',
      { compressFn: async () => '', maxContextTokens: 100000, compressionCache: null, lastPromptTokens: null },
    )
    const contents = result.messages.filter(m => m.role === 'system').map(m => m.content)
    expect(contents.every(c => !c.includes('<topology>'))).toBe(true)
  })

  it('skips topologyContext system message when empty string', async () => {
    const storage = makeStorage()
    const result = await assembleSessionContext(
      's1', storage, 'hello',
      { compressFn: async () => '', maxContextTokens: 100000, compressionCache: null, lastPromptTokens: null },
      undefined, undefined, '',
    )
    const contents = result.messages.filter(m => m.role === 'system').map(m => m.content)
    expect(contents.every(c => !c.includes('<topology>'))).toBe(true)
  })
})
