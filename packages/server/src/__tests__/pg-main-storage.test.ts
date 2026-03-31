import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import type pg from 'pg'
import { PgMainStorage } from '../storage/pg-main-storage.js'
import { createTestPool, setupDatabase, cleanDatabase, createTestUser, createTestSpace, uuid } from './helpers.js'

let pool: pg.Pool
let spaceId: string
let storage: PgMainStorage

beforeAll(async () => {
  pool = createTestPool()
  await setupDatabase(pool)
})

beforeEach(async () => {
  await cleanDatabase(pool)
  const userId = await createTestUser(pool)
  spaceId = await createTestSpace(pool, userId)
  storage = new PgMainStorage(pool, spaceId)
})

afterAll(async () => {
  await pool.end()
})

/** 在 sessions 表中创建一条记录，返回 id */
async function insertSession(
  overrides: Partial<{ id: string; label: string; role: string; status: string; parentId: string }> = {},
): Promise<string> {
  const id = overrides.id ?? uuid()
  await pool.query(
    `INSERT INTO sessions (id, space_id, parent_id, label, role, status, created_at, updated_at, last_active_at)
     VALUES ($1, $2, $3, $4, $5, $6, now(), now(), now())`,
    [id, spaceId, overrides.parentId ?? null, overrides.label ?? 'Test', overrides.role ?? 'standard', overrides.status ?? 'active'],
  )
  return id
}

describe('PgMainStorage', () => {
  describe('getAllSessionL2s', () => {
    it('只返回有 L2 的 active standard sessions', async () => {
      const mainId = await insertSession({ role: 'main', label: 'Main' })
      const s1 = await insertSession({ label: 'S1', parentId: mainId })
      await insertSession({ label: 'S2', parentId: mainId })
      const archived = await insertSession({ label: 'Archived', status: 'archived', parentId: mainId })

      // 给 s1 和 archived 写 memory
      await storage.putMemory(s1, 'L2 for S1')
      await storage.putMemory(archived, 'L2 for archived')
      // s2 没有 memory

      const l2s = await storage.getAllSessionL2s()
      expect(l2s).toHaveLength(1)
      expect(l2s[0]!.sessionId).toBe(s1)
      expect(l2s[0]!.label).toBe('S1')
      expect(l2s[0]!.l2).toBe('L2 for S1')
    })

    it('优先返回 memory event，并暴露 sequence / timestamp', async () => {
      const mainId = await insertSession({ role: 'main', label: 'Main' })
      const s1 = await insertSession({ label: 'S1', parentId: mainId })

      const event = await storage.appendMemoryEvent(s1, 'event L2 for S1')

      const l2s = await storage.getAllSessionL2s()
      expect(l2s).toHaveLength(1)
      expect(l2s[0]!.l2).toBe('event L2 for S1')
      expect(l2s[0]!.sequence).toBe(event.sequence)
      expect(l2s[0]!.timestamp).toBeTruthy()
    })
  })

  describe('memory events + integration cursor', () => {
    it('支持按 integration cursor 增量读取 memory events', async () => {
      const mainId = await insertSession({ role: 'main', label: 'Main' })
      const s1 = await insertSession({ label: 'S1', parentId: mainId })
      const s2 = await insertSession({ label: 'S2', parentId: mainId })

      const event1 = await storage.appendMemoryEvent(s1, 'L2-A')
      const event2 = await storage.appendMemoryEvent(s2, 'L2-B')

      await storage.setIntegrationCursor(mainId, event1.sequence)
      expect(await storage.getIntegrationCursor(mainId)).toBe(event1.sequence)

      const unread = await storage.listMemoryEvents(await storage.getIntegrationCursor(mainId))
      expect(unread).toHaveLength(1)
      expect(unread[0]!.sequence).toBe(event2.sequence)
      expect(unread[0]!.content).toBe('L2-B')
    })
  })

  describe('listSessions', () => {
    it('列出所有 sessions', async () => {
      await insertSession({ role: 'main', label: 'Main' })
      await insertSession({ label: 'Child 1' })
      await insertSession({ label: 'Child 2' })

      const all = await storage.listSessions()
      expect(all).toHaveLength(3)
    })

    it('按 status 过滤', async () => {
      await insertSession({ label: 'Active', status: 'active' })
      await insertSession({ label: 'Archived', status: 'archived' })

      const active = await storage.listSessions({ status: 'active' })
      expect(active).toHaveLength(1)
      expect(active[0]!.status).toBe('active')
    })

    it('按 role 过滤', async () => {
      await insertSession({ role: 'main', label: 'Main' })
      await insertSession({ role: 'standard', label: 'Child' })

      const mains = await storage.listSessions({ role: 'main' })
      expect(mains).toHaveLength(1)
      expect(mains[0]!.role).toBe('main')
    })

    it('按 tags 过滤', async () => {
      const id = await insertSession({ label: 'Tagged' })
      await pool.query(`UPDATE sessions SET tags = $1 WHERE id = $2`, [['alpha', 'beta'], id])

      const tagged = await storage.listSessions({ tags: ['alpha'] })
      expect(tagged).toHaveLength(1)

      const noMatch = await storage.listSessions({ tags: ['gamma'] })
      expect(noMatch).toHaveLength(0)
    })
  })

  describe('topology: putNode / getChildren / removeNode', () => {
    it('getChildren 返回直接子节点', async () => {
      const rootId = await insertSession({ role: 'main', label: 'Root' })
      const c1 = await insertSession({ label: 'Child 1', parentId: rootId })
      const c2 = await insertSession({ label: 'Child 2', parentId: rootId })

      const children = await storage.getChildren(rootId)
      expect(children).toHaveLength(2)
      expect(children.map(c => c.id).sort()).toEqual([c1, c2].sort())
    })

    it('removeNode 将 parent_id 设为 null', async () => {
      const rootId = await insertSession({ role: 'main', label: 'Root' })
      const childId = await insertSession({ label: 'Child', parentId: rootId })

      await storage.removeNode(childId)
      const children = await storage.getChildren(rootId)
      expect(children).toHaveLength(0)
    })
  })

  describe('globals: getGlobal / putGlobal', () => {
    it('读写全局键值', async () => {
      expect(await storage.getGlobal('foo')).toBeNull()

      await storage.putGlobal('foo', { bar: 42 })
      expect(await storage.getGlobal('foo')).toEqual({ bar: 42 })

      // 覆盖
      await storage.putGlobal('foo', 'simple')
      expect(await storage.getGlobal('foo')).toBe('simple')
    })
  })
})
