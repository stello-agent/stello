import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import type pg from 'pg'
import { PgSessionStorage } from '../storage/pg-session-storage.js'
import { createTestPool, setupDatabase, cleanDatabase, createTestUser, createTestSpace, uuid } from './helpers.js'

let pool: pg.Pool
let spaceId: string
let storage: PgSessionStorage

beforeAll(async () => {
  pool = createTestPool()
  await setupDatabase(pool)
})

beforeEach(async () => {
  await cleanDatabase(pool)
  const userId = await createTestUser(pool)
  spaceId = await createTestSpace(pool, userId)
  storage = new PgSessionStorage(pool, spaceId)
})

afterAll(async () => {
  await pool.end()
})

/** 创建一个 session 并返回 id */
async function createSession(s: PgSessionStorage, overrides: Partial<{ id: string; label: string; role: string; status: string }> = {}): Promise<string> {
  const id = overrides.id ?? uuid()
  const now = new Date().toISOString()
  await s.putSession({
    id,
    label: overrides.label ?? 'Test',
    role: (overrides.role ?? 'standard') as 'standard' | 'main',
    status: (overrides.status ?? 'active') as 'active' | 'archived',
    tags: [],
    metadata: {},
    createdAt: now,
    updatedAt: now,
  })
  return id
}

describe('PgSessionStorage', () => {
  describe('getSession / putSession', () => {
    it('不存在时返回 null', async () => {
      const result = await storage.getSession(uuid())
      expect(result).toBeNull()
    })

    it('写入并读取 SessionMeta', async () => {
      const id = uuid()
      const now = new Date().toISOString()
      await storage.putSession({
        id,
        label: 'Test Session',
        role: 'standard',
        status: 'active',
        tags: ['tag1'],
        metadata: { key: 'value' },
        createdAt: now,
        updatedAt: now,
      })

      const result = await storage.getSession(id)
      expect(result).not.toBeNull()
      expect(result!.id).toBe(id)
      expect(result!.label).toBe('Test Session')
      expect(result!.role).toBe('standard')
      expect(result!.status).toBe('active')
      expect(result!.tags).toEqual(['tag1'])
      expect(result!.metadata).toEqual({ key: 'value' })
    })

    it('upsert 更新已有记录', async () => {
      const id = uuid()
      const now = new Date().toISOString()
      await storage.putSession({
        id,
        label: 'Original',
        role: 'standard',
        status: 'active',
        tags: [],
        metadata: {},
        createdAt: now,
        updatedAt: now,
      })

      await storage.putSession({
        id,
        label: 'Updated',
        role: 'standard',
        status: 'archived',
        tags: ['new'],
        metadata: { updated: true },
        createdAt: now,
        updatedAt: new Date().toISOString(),
      })

      const result = await storage.getSession(id)
      expect(result!.label).toBe('Updated')
      expect(result!.status).toBe('archived')
    })
  })

  describe('appendRecord / listRecords', () => {
    let sessionId: string

    beforeEach(async () => {
      sessionId = await createSession(storage)
    })

    it('追加并读取记录', async () => {
      await storage.appendRecord(sessionId, { role: 'user', content: 'hello' })
      await storage.appendRecord(sessionId, { role: 'assistant', content: 'hi' })

      const records = await storage.listRecords(sessionId)
      expect(records).toHaveLength(2)
      expect(records[0]!.role).toBe('user')
      expect(records[0]!.content).toBe('hello')
      expect(records[1]!.role).toBe('assistant')
    })

    it('按 role 过滤', async () => {
      await storage.appendRecord(sessionId, { role: 'user', content: 'q1' })
      await storage.appendRecord(sessionId, { role: 'assistant', content: 'a1' })
      await storage.appendRecord(sessionId, { role: 'user', content: 'q2' })

      const userOnly = await storage.listRecords(sessionId, { role: 'user' })
      expect(userOnly).toHaveLength(2)
      expect(userOnly.every(r => r.role === 'user')).toBe(true)
    })

    it('limit 和 offset', async () => {
      for (let i = 0; i < 5; i++) {
        await storage.appendRecord(sessionId, { role: 'user', content: `msg-${i}` })
      }

      const page = await storage.listRecords(sessionId, { limit: 2, offset: 1 })
      expect(page).toHaveLength(2)
      expect(page[0]!.content).toBe('msg-1')
      expect(page[1]!.content).toBe('msg-2')
    })
  })

  describe('slots: system_prompt / insight / memory', () => {
    let sessionId: string

    beforeEach(async () => {
      sessionId = await createSession(storage)
    })

    it('system prompt 读写', async () => {
      expect(await storage.getSystemPrompt(sessionId)).toBeNull()

      await storage.putSystemPrompt(sessionId, 'You are a helpful assistant.')
      expect(await storage.getSystemPrompt(sessionId)).toBe('You are a helpful assistant.')

      await storage.putSystemPrompt(sessionId, 'Updated prompt')
      expect(await storage.getSystemPrompt(sessionId)).toBe('Updated prompt')
    })

    it('insight 读写清除', async () => {
      expect(await storage.getInsight(sessionId)).toBeNull()

      await storage.putInsight(sessionId, 'some insight')
      expect(await storage.getInsight(sessionId)).toBe('some insight')

      await storage.clearInsight(sessionId)
      expect(await storage.getInsight(sessionId)).toBeNull()
    })

    it('memory 读写', async () => {
      expect(await storage.getMemory(sessionId)).toBeNull()

      await storage.putMemory(sessionId, 'L2 summary')
      expect(await storage.getMemory(sessionId)).toBe('L2 summary')
    })
  })

  describe('event logs', () => {
    let sessionId: string

    beforeEach(async () => {
      sessionId = await createSession(storage)
    })

    it('memory event 追加后可读取最新事件', async () => {
      const event1 = await storage.appendMemoryEvent(sessionId, 'first')
      const event2 = await storage.appendMemoryEvent(sessionId, 'second')

      expect(event2.sequence).toBeGreaterThan(event1.sequence)

      const latest = await storage.getLatestMemoryEvent(sessionId)
      expect(latest).not.toBeNull()
      expect(latest!.content).toBe('second')
      expect(latest!.sequence).toBe(event2.sequence)
    })

    it('insight event 采用追加 + cursor 消费语义', async () => {
      await storage.appendInsightEvent(sessionId, 'insight-a')
      await storage.appendInsightEvent(sessionId, 'insight-b')

      expect(await storage.getInsight(sessionId)).toBe('insight-a\n\ninsight-b')

      await storage.clearInsight(sessionId)
      expect(await storage.getInsight(sessionId)).toBeNull()

      await storage.appendInsightEvent(sessionId, 'insight-c')
      expect(await storage.getInsight(sessionId)).toBe('insight-c')
    })
  })

  describe('transaction', () => {
    it('成功提交', async () => {
      const id = uuid()
      const now = new Date().toISOString()
      await storage.transaction(async (tx) => {
        await tx.putSession({
          id,
          label: 'TX Test',
          role: 'standard',
          status: 'active',
          tags: [],
          metadata: {},
          createdAt: now,
          updatedAt: now,
        })
        await tx.putSystemPrompt(id, 'tx prompt')
      })

      expect(await storage.getSession(id)).not.toBeNull()
      expect(await storage.getSystemPrompt(id)).toBe('tx prompt')
    })

    it('失败回滚', async () => {
      const id = uuid()
      const now = new Date().toISOString()
      await expect(
        storage.transaction(async (tx) => {
          await tx.putSession({
            id,
            label: 'Will Fail',
            role: 'standard',
            status: 'active',
            tags: [],
            metadata: {},
            createdAt: now,
            updatedAt: now,
          })
          throw new Error('intentional failure')
        }),
      ).rejects.toThrow('intentional failure')

      expect(await storage.getSession(id)).toBeNull()
    })
  })

  describe('space 隔离', () => {
    it('不同 space 的数据互不可见', async () => {
      const userId = await createTestUser(pool, 'user-2')
      const otherSpaceId = await createTestSpace(pool, userId, 'other-space')
      const otherStorage = new PgSessionStorage(pool, otherSpaceId)

      const id = await createSession(storage, { label: 'Mine' })

      expect(await storage.getSession(id)).not.toBeNull()
      expect(await otherStorage.getSession(id)).toBeNull()
    })
  })
})
