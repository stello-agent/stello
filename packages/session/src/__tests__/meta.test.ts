import { describe, it, expect } from 'vitest'
import { makeSession } from './helpers.js'

describe('meta 同步访问', () => {
  it('createSession 后 meta 立即可读', async () => {
    const { session } = await makeSession({ label: 'Hello' })
    expect(session.meta.label).toBe('Hello')
    expect(session.meta.status).toBe('active')
    expect(session.meta.turnCount).toBe(0)
    expect(session.meta.depth).toBe(0)
  })

  it('meta 包含所有必要字段', async () => {
    const { session } = await makeSession({ tags: ['a', 'b'], metadata: { foo: 'bar' } })
    const m = session.meta
    expect(m.id).toBeTruthy()
    expect(m.parentId).toBeNull()
    expect(m.role).toBe('standard')
    expect(m.consolidatedTurn).toBe(0)
    expect(m.tags).toEqual(['a', 'b'])
    expect(m.metadata).toEqual({ foo: 'bar' })
    expect(m.createdAt).toBeTruthy()
    expect(m.updatedAt).toBeTruthy()
  })

  it('createSession 默认 role 为 standard', async () => {
    const { session } = await makeSession()
    expect(session.meta.role).toBe('standard')
  })

  it('updateMeta 后 meta 同步更新', async () => {
    const { session } = await makeSession({ label: 'Old' })
    await session.updateMeta({ label: 'New', tags: ['x'] })
    expect(session.meta.label).toBe('New')
    expect(session.meta.tags).toEqual(['x'])
  })

  it('meta 更新后 updatedAt 变化', async () => {
    const { session } = await makeSession()
    const before = session.meta.updatedAt
    await new Promise((r) => setTimeout(r, 2))
    await session.updateMeta({ label: 'Changed' })
    expect(session.meta.updatedAt).not.toBe(before)
  })

  it('archived session 上调用 updateMeta 抛 SessionArchivedError', async () => {
    const { session } = await makeSession()
    await session.archive()
    await expect(session.updateMeta({ label: 'X' })).rejects.toThrow('archived')
  })
})
