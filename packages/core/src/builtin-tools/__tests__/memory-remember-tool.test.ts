import { describe, it, expect } from 'vitest'
import { memoryRememberTool } from '../memory-remember-tool'
import { InMemorySharedMemoryStore } from '../../shared-memory/in-memory-shared-memory-store'
import type { ToolExecutionContext } from '../../types/tool'
import type { StelloAgent } from '../../agent/stello-agent'

function fakeAgent(store: InMemorySharedMemoryStore | undefined): StelloAgent {
  return { sharedMemory: store } as unknown as StelloAgent
}

function ctx(agent: StelloAgent): ToolExecutionContext {
  return { agent, sessionId: 's1', toolName: 'stello_memory_remember' }
}

describe('memoryRememberTool', () => {
  it('returns ToolRegistryEntry named "stello_memory_remember"', () => {
    expect(memoryRememberTool().name).toBe('stello_memory_remember')
  })

  it('upserts a new entry', async () => {
    const store = new InMemorySharedMemoryStore()
    const r = await memoryRememberTool().execute(
      { slug: 'a', summary: 'sa', body: 'BODY' },
      ctx(fakeAgent(store)),
    )
    expect(r).toEqual({ success: true, data: { slug: 'a' } })
    expect(await store.get('a')).toEqual({ slug: 'a', summary: 'sa', body: 'BODY' })
  })

  it('overwrites existing entry', async () => {
    const store = new InMemorySharedMemoryStore()
    await store.upsert('a', 'sa', 'old')
    await memoryRememberTool().execute(
      { slug: 'a', summary: 'sa2', body: 'NEW' },
      ctx(fakeAgent(store)),
    )
    expect(await store.get('a')).toEqual({ slug: 'a', summary: 'sa2', body: 'NEW' })
  })

  it('returns error for empty slug', async () => {
    const store = new InMemorySharedMemoryStore()
    const r = await memoryRememberTool().execute(
      { slug: '', summary: 's', body: 'b' },
      ctx(fakeAgent(store)),
    )
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/slug/i)
  })

  it('returns error for missing summary', async () => {
    const store = new InMemorySharedMemoryStore()
    const r = await memoryRememberTool().execute(
      { slug: 'a', body: 'b' },
      ctx(fakeAgent(store)),
    )
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/summary/i)
  })

  it('returns error for missing body', async () => {
    const store = new InMemorySharedMemoryStore()
    const r = await memoryRememberTool().execute(
      { slug: 'a', summary: 's' },
      ctx(fakeAgent(store)),
    )
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/body/i)
  })

  it('returns error when sharedMemory is not configured', async () => {
    const r = await memoryRememberTool().execute(
      { slug: 'a', summary: 's', body: 'b' },
      ctx(fakeAgent(undefined)),
    )
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/sharedMemory not configured/i)
  })
})
