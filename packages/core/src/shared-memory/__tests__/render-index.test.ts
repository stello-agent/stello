import { describe, it, expect } from 'vitest'
import { renderSharedMemoryIndex } from '../render-index'
import { InMemorySharedMemoryStore } from '../in-memory-shared-memory-store'

describe('renderSharedMemoryIndex', () => {
  it('returns undefined when store is undefined', async () => {
    expect(await renderSharedMemoryIndex(undefined)).toBeUndefined()
  })

  it('returns undefined when store has no entries', async () => {
    const store = new InMemorySharedMemoryStore()
    expect(await renderSharedMemoryIndex(store)).toBeUndefined()
  })

  it('renders entries inside <shared_memory_index> with hint footer', async () => {
    const store = new InMemorySharedMemoryStore()
    await store.upsert('prefer-concise', '用户偏好简短回答', 'body-1')
    await store.upsert('user-profile', '大三本科生 CS 专业', 'body-2')
    const out = await renderSharedMemoryIndex(store)
    expect(out).toContain('<shared_memory_index>')
    expect(out).toContain('- prefer-concise: 用户偏好简短回答')
    expect(out).toContain('- user-profile: 大三本科生 CS 专业')
    expect(out).toContain('</shared_memory_index>')
    expect(out).toMatch(/stello_memory_recall/)
    expect(out).toMatch(/stello_memory_remember/)
    expect(out).toMatch(/stello_memory_forget/)
  })

  it('preserves entry order in output', async () => {
    const store = new InMemorySharedMemoryStore()
    await store.upsert('a', 'sa', 'ba')
    await store.upsert('b', 'sb', 'bb')
    await store.upsert('c', 'sc', 'bc')
    const out = await renderSharedMemoryIndex(store)
    const aIdx = out!.indexOf('- a:')
    const bIdx = out!.indexOf('- b:')
    const cIdx = out!.indexOf('- c:')
    expect(aIdx).toBeGreaterThan(-1)
    expect(aIdx).toBeLessThan(bIdx)
    expect(bIdx).toBeLessThan(cIdx)
  })
})
