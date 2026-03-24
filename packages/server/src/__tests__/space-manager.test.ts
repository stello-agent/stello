import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import type pg from 'pg'
import { SpaceManager } from '../space/space-manager.js'
import { createTestPool, setupDatabase, cleanDatabase, createTestUser } from './helpers.js'

let pool: pg.Pool
let manager: SpaceManager
let userId: string

beforeAll(async () => {
  pool = createTestPool()
  await setupDatabase(pool)
})

beforeEach(async () => {
  await cleanDatabase(pool)
  userId = await createTestUser(pool)
  manager = new SpaceManager(pool)
})

afterAll(async () => {
  await pool.end()
})

describe('SpaceManager', () => {
  describe('createSpace', () => {
    it('创建 space 并自动创建 root session', async () => {
      const space = await manager.createSpace(userId, {
        label: 'Test Space',
        systemPrompt: 'You are helpful.',
        consolidatePrompt: 'Summarize.',
        integratePrompt: 'Synthesize.',
      })

      expect(space.label).toBe('Test Space')
      expect(space.systemPrompt).toBe('You are helpful.')
      expect(space.consolidatePrompt).toBe('Summarize.')
      expect(space.integratePrompt).toBe('Synthesize.')

      // 验证 root session 已创建
      const { rows } = await pool.query(
        `SELECT * FROM sessions WHERE space_id = $1 AND parent_id IS NULL`,
        [space.id],
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]!['role']).toBe('main')

      // 验证 root session 的 system prompt 已写入
      const { rows: dataRows } = await pool.query(
        `SELECT content FROM session_data WHERE session_id = $1 AND key = 'system_prompt'`,
        [rows[0]!['id']],
      )
      expect(dataRows).toHaveLength(1)
      expect(dataRows[0]!['content']).toBe('You are helpful.')
    })

    it('不带 system prompt 也能创建', async () => {
      const space = await manager.createSpace(userId, { label: 'Minimal' })
      expect(space.systemPrompt).toBeNull()

      // root session 存在但没有 system prompt
      const { rows } = await pool.query(
        `SELECT s.id FROM sessions s
         LEFT JOIN session_data sd ON s.id = sd.session_id AND sd.key = 'system_prompt'
         WHERE s.space_id = $1 AND s.parent_id IS NULL`,
        [space.id],
      )
      expect(rows).toHaveLength(1)
    })
  })

  describe('getSpace', () => {
    it('获取已有 space', async () => {
      const created = await manager.createSpace(userId, { label: 'My Space' })
      const fetched = await manager.getSpace(created.id)
      expect(fetched).not.toBeNull()
      expect(fetched!.id).toBe(created.id)
      expect(fetched!.label).toBe('My Space')
    })

    it('不存在返回 null', async () => {
      expect(await manager.getSpace('00000000-0000-0000-0000-000000000000')).toBeNull()
    })
  })

  describe('updateSpace', () => {
    it('更新 label', async () => {
      const space = await manager.createSpace(userId, { label: 'Old' })
      const updated = await manager.updateSpace(space.id, { label: 'New' })
      expect(updated.label).toBe('New')
    })

    it('更新 systemPrompt 并同步到 root session', async () => {
      const space = await manager.createSpace(userId, {
        label: 'Test',
        systemPrompt: 'Original',
      })

      await manager.updateSpace(space.id, { systemPrompt: 'Updated prompt' })

      // 验证 space 表
      const fetched = await manager.getSpace(space.id)
      expect(fetched!.systemPrompt).toBe('Updated prompt')

      // 验证 root session 的 session_data 也更新了
      const { rows } = await pool.query(
        `SELECT sd.content FROM sessions s
         JOIN session_data sd ON s.id = sd.session_id AND sd.key = 'system_prompt'
         WHERE s.space_id = $1 AND s.parent_id IS NULL`,
        [space.id],
      )
      expect(rows[0]!['content']).toBe('Updated prompt')
    })

    it('更新 consolidatePrompt', async () => {
      const space = await manager.createSpace(userId, { label: 'Test' })
      const updated = await manager.updateSpace(space.id, { consolidatePrompt: 'New consolidate' })
      expect(updated.consolidatePrompt).toBe('New consolidate')
    })

    it('更新 integratePrompt', async () => {
      const space = await manager.createSpace(userId, { label: 'Test' })
      const updated = await manager.updateSpace(space.id, { integratePrompt: 'New integrate' })
      expect(updated.integratePrompt).toBe('New integrate')
    })
  })

  describe('listSpaces', () => {
    it('列出用户的所有 spaces', async () => {
      await manager.createSpace(userId, { label: 'Space 1' })
      await manager.createSpace(userId, { label: 'Space 2' })

      const spaces = await manager.listSpaces(userId)
      expect(spaces).toHaveLength(2)
      expect(spaces.map(s => s.label)).toEqual(['Space 1', 'Space 2'])
    })

    it('不同用户的 spaces 互不可见', async () => {
      await manager.createSpace(userId, { label: 'User1 Space' })

      const otherUserId = await createTestUser(pool, 'other-user')
      await manager.createSpace(otherUserId, { label: 'User2 Space' })

      const user1Spaces = await manager.listSpaces(userId)
      expect(user1Spaces).toHaveLength(1)
      expect(user1Spaces[0]!.label).toBe('User1 Space')
    })
  })

  describe('deleteSpace', () => {
    it('删除 space 及级联数据', async () => {
      const space = await manager.createSpace(userId, { label: 'Delete Me' })
      await manager.deleteSpace(space.id)

      expect(await manager.getSpace(space.id)).toBeNull()

      // 级联删除 sessions
      const { rows } = await pool.query(
        'SELECT COUNT(*)::int AS cnt FROM sessions WHERE space_id = $1',
        [space.id],
      )
      expect(rows[0]!['cnt']).toBe(0)
    })
  })
})
