import { describe, it, expect } from 'vitest'
import { makeSession } from './helpers.js'

describe('updateMeta() + archive() + fork()', () => {
  describe('updateMeta()', () => {
    it('更新 label', async () => {
      const { session } = await makeSession({ label: 'Original' })
      await session.updateMeta({ label: 'Updated' })
      expect(session.meta.label).toBe('Updated')
    })

    it('更新 tags', async () => {
      const { session } = await makeSession()
      await session.updateMeta({ tags: ['tag1', 'tag2'] })
      expect(session.meta.tags).toEqual(['tag1', 'tag2'])
    })

    it('更新 metadata', async () => {
      const { session } = await makeSession()
      await session.updateMeta({ metadata: { key: 'value' } })
      expect(session.meta.metadata).toEqual({ key: 'value' })
    })

    it('部分更新不影响其他字段', async () => {
      const { session } = await makeSession({ label: 'Keep', tags: ['keep'] })
      await session.updateMeta({ label: 'New' })
      expect(session.meta.tags).toEqual(['keep'])
    })

    it('持久化到 storage', async () => {
      const { session, storage } = await makeSession({ label: 'Old' })
      await session.updateMeta({ label: 'Persisted' })
      const stored = await storage.getSession(session.meta.id)
      expect(stored?.label).toBe('Persisted')
    })
  })

  describe('archive()', () => {
    it('archive 后 status 变为 archived', async () => {
      const { session } = await makeSession()
      expect(session.meta.status).toBe('active')
      await session.archive()
      expect(session.meta.status).toBe('archived')
    })

    it('archive 后 storage 中的 status 也更新', async () => {
      const { session, storage } = await makeSession()
      await session.archive()
      const stored = await storage.getSession(session.meta.id)
      expect(stored?.status).toBe('archived')
    })

    it('归档不连带子 Session', async () => {
      const { session, storage } = await makeSession()
      const child = await session.fork({ label: 'Child' })
      await session.archive()
      const childStored = await storage.getSession(child.meta.id)
      expect(childStored?.status).toBe('active')
    })
  })

  describe('fork()', () => {
    it('fork 创建子 Session', async () => {
      const { session } = await makeSession({ label: 'Parent' })
      const child = await session.fork({ label: 'Child' })
      expect(child.meta.label).toBe('Child')
      expect(child.meta.parentId).toBe(session.meta.id)
      expect(child.meta.depth).toBe(session.meta.depth + 1)
    })

    it('子 Session 初始 turnCount 为 0', async () => {
      const { session } = await makeSession()
      const child = await session.fork({ label: 'Child' })
      expect(child.meta.turnCount).toBe(0)
    })

    it('fork 默认不继承记忆（forkRole 由上层根据角色决定）', async () => {
      const { session } = await makeSession()
      const child = await session.fork({ label: 'Child' })
      expect(await child.memory()).toBeNull()
    })

    it('fork forkRole: none 不继承记忆', async () => {
      const { session, storage } = await makeSession()
      await storage.putMemory(session.meta.id, 'parent memory')
      const child = await session.fork({ label: 'Child', forkRole: 'none' })
      expect(await child.memory()).toBeNull()
    })

    it('fork 支持传入 tags 和 metadata', async () => {
      const { session } = await makeSession()
      const child = await session.fork({
        label: 'Child',
        tags: ['forked'],
        metadata: { source: 'fork' },
      })
      expect(child.meta.tags).toEqual(['forked'])
      expect(child.meta.metadata).toEqual({ source: 'fork' })
    })

    it('fork 持久化子 Session 到 storage', async () => {
      const { session, storage } = await makeSession()
      const child = await session.fork({ label: 'Child' })
      const stored = await storage.getSession(child.meta.id)
      expect(stored).not.toBeNull()
      expect(stored?.label).toBe('Child')
    })
  })
})
