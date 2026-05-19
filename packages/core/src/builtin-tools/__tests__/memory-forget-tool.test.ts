import { describe, it, expect } from 'vitest'
import { memoryForgetTool } from '../memory-forget-tool'
import { InMemorySharedMemoryStore } from '../../shared-memory/in-memory-shared-memory-store'
import type { ToolExecutionContext } from '../../types/tool'
import type { StelloAgent } from '../../agent/stello-agent'

function fakeAgent(store: InMemorySharedMemoryStore | undefined): StelloAgent {
  return { sharedMemory: store } as unknown as StelloAgent
}

function ctx(agent: StelloAgent): ToolExecutionContext {
  return { agent, sessionId: 's1', toolName: 'stello_memory_forget' }
}

describe('memoryForgetTool', () => {
  it('returns ToolRegistryEntry named "stello_memory_forget"', () => {
    expect(memoryForgetTool().name).toBe('stello_memory_forget')
  })

  it('removes existing entry', async () => {
    const store = new InMemorySharedMemoryStore()
    await store.upsert('a', 'sa', 'ba')
    const r = await memoryForgetTool().execute({ slug: 'a' }, ctx(fakeAgent(store)))
    expect(r).toEqual({ success: true, data: { slug: 'a' } })
    expect(await store.get('a')).toBeNull()
  })

  it('returns success even when slug does not exist (no-op)', async () => {
    const store = new InMemorySharedMemoryStore()
    const r = await memoryForgetTool().execute({ slug: 'missing' }, ctx(fakeAgent(store)))
    expect(r).toEqual({ success: true, data: { slug: 'missing' } })
  })

  it('returns error for empty slug', async () => {
    const store = new InMemorySharedMemoryStore()
    const r = await memoryForgetTool().execute({ slug: '' }, ctx(fakeAgent(store)))
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/slug/i)
  })

  it('returns error when sharedMemory is not configured', async () => {
    const r = await memoryForgetTool().execute({ slug: 'a' }, ctx(fakeAgent(undefined)))
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/sharedMemory not configured/i)
  })
})
