import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import type pg from 'pg'
import { PgMemoryEngine } from '../storage/pg-memory-engine.js'
import { PgSessionTree } from '../storage/pg-session-tree.js'
import { createTestPool, setupDatabase, cleanDatabase, createTestUser, createTestSpace } from './helpers.js'

let pool: pg.Pool
let spaceId: string
let memory: PgMemoryEngine
let tree: PgSessionTree

beforeAll(async () => {
  pool = createTestPool()
  await setupDatabase(pool)
})

beforeEach(async () => {
  await cleanDatabase(pool)
  const userId = await createTestUser(pool)
  spaceId = await createTestSpace(pool, userId)
  memory = new PgMemoryEngine(pool, spaceId)
  tree = new PgSessionTree(pool, spaceId)
})

afterAll(async () => {
  await pool.end()
})

describe('PgMemoryEngine', () => {
  describe('readCore / writeCore', () => {
    it('读写单个路径', async () => {
      expect(await memory.readCore('name')).toBeNull()

      await memory.writeCore('name', 'Alice')
      expect(await memory.readCore('name')).toBe('Alice')
    })

    it('读取所有路径', async () => {
      await memory.writeCore('name', 'Alice')
      await memory.writeCore('age', 25)

      const all = await memory.readCore()
      expect(all).toEqual({ name: 'Alice', age: 25 })
    })

    it('覆盖已有值', async () => {
      await memory.writeCore('name', 'Alice')
      await memory.writeCore('name', 'Bob')
      expect(await memory.readCore('name')).toBe('Bob')
    })
  })

  describe('memory / scope / index slots', () => {
    let sessionId: string

    beforeEach(async () => {
      const root = await tree.createRoot()
      sessionId = root.id
    })

    it('readMemory / writeMemory', async () => {
      expect(await memory.readMemory(sessionId)).toBeNull()
      await memory.writeMemory(sessionId, 'L2 content')
      expect(await memory.readMemory(sessionId)).toBe('L2 content')
    })

    it('readScope / writeScope', async () => {
      expect(await memory.readScope(sessionId)).toBeNull()
      await memory.writeScope(sessionId, 'scope content')
      expect(await memory.readScope(sessionId)).toBe('scope content')
    })

    it('readIndex / writeIndex', async () => {
      expect(await memory.readIndex(sessionId)).toBeNull()
      await memory.writeIndex(sessionId, 'index content')
      expect(await memory.readIndex(sessionId)).toBe('index content')
    })
  })

  describe('appendRecord / readRecords', () => {
    let sessionId: string

    beforeEach(async () => {
      const root = await tree.createRoot()
      sessionId = root.id
    })

    it('追加并读取 TurnRecord', async () => {
      const now = new Date().toISOString()
      await memory.appendRecord(sessionId, {
        role: 'user',
        content: 'hello',
        timestamp: now,
      })
      await memory.appendRecord(sessionId, {
        role: 'assistant',
        content: 'hi there',
        timestamp: now,
        metadata: { model: 'test' },
      })

      const records = await memory.readRecords(sessionId)
      expect(records).toHaveLength(2)
      expect(records[0]!.role).toBe('user')
      expect(records[0]!.content).toBe('hello')
      expect(records[1]!.role).toBe('assistant')
      expect(records[1]!.metadata).toEqual({ model: 'test' })
    })
  })

  describe('assembleContext', () => {
    it('组装包含 core、父链 memory、当前 memory/scope', async () => {
      // 写 core 数据
      await memory.writeCore('profile.name', 'Alice')

      // 创建 root → L1 → L2 的三层结构
      const root = await tree.createRoot()
      const l1 = await tree.createChild({ parentId: root.id, label: 'L1' })
      const l2 = await tree.createChild({ parentId: l1.id, label: 'L2' })

      // 给各层写 memory
      await memory.writeMemory(root.id, 'Root memory')
      await memory.writeMemory(l1.id, 'L1 memory')
      await memory.writeMemory(l2.id, 'L2 memory')
      await memory.writeScope(l2.id, 'L2 scope')

      const ctx = await memory.assembleContext(l2.id)
      expect(ctx.core).toEqual({ 'profile.name': 'Alice' })
      expect(ctx.memories).toContain('Root memory')
      expect(ctx.memories).toContain('L1 memory')
      expect(ctx.currentMemory).toBe('L2 memory')
      expect(ctx.scope).toBe('L2 scope')
    })

    it('无父链时 memories 为空', async () => {
      const root = await tree.createRoot()
      await memory.writeMemory(root.id, 'Root only')

      const ctx = await memory.assembleContext(root.id)
      expect(ctx.memories).toHaveLength(0)
      expect(ctx.currentMemory).toBe('Root only')
    })
  })
})
