import { describe, it, expect } from 'vitest'
import { memoryRecallTool } from '../memory-recall-tool'
import { InMemorySharedMemoryStore } from '../../shared-memory/in-memory-shared-memory-store'
import type { ToolExecutionContext } from '../../types/tool'
import type { StelloAgent } from '../../agent/stello-agent'

function fakeAgent(store: InMemorySharedMemoryStore | undefined): StelloAgent {
  return { sharedMemory: store } as unknown as StelloAgent
}

function ctx(agent: StelloAgent): ToolExecutionContext {
  return { agent, sessionId: 's1', toolName: 'stello_memory_recall' }
}

describe('memoryRecallTool', () => {
  it('returns ToolRegistryEntry named "stello_memory_recall"', () => {
    expect(memoryRecallTool().name).toBe('stello_memory_recall')
  })

  it('returns body for known slug', async () => {
    const store = new InMemorySharedMemoryStore()
    await store.upsert('a', 'sa', 'BODY-A')
    const r = await memoryRecallTool().execute({ slug: 'a' }, ctx(fakeAgent(store)))
    expect(r).toEqual({ success: true, data: { body: 'BODY-A' } })
  })

  it('returns error for unknown slug', async () => {
    const store = new InMemorySharedMemoryStore()
    const r = await memoryRecallTool().execute({ slug: 'nope' }, ctx(fakeAgent(store)))
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/slug.*nope/i)
  })

  it('returns error when slug is empty', async () => {
    const store = new InMemorySharedMemoryStore()
    const r = await memoryRecallTool().execute({ slug: '' }, ctx(fakeAgent(store)))
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/slug/i)
  })

  it('returns error when sharedMemory is not configured', async () => {
    const r = await memoryRecallTool().execute({ slug: 'a' }, ctx(fakeAgent(undefined)))
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/sharedMemory not configured/i)
  })
})
