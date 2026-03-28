import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import type pg from 'pg'
import { PgSessionTree } from '../storage/pg-session-tree.js'
import { createTestPool, setupDatabase, cleanDatabase, createTestUser, createTestSpace } from './helpers.js'

let pool: pg.Pool
let spaceId: string
let tree: PgSessionTree

beforeAll(async () => {
  pool = createTestPool()
  await setupDatabase(pool)
})

beforeEach(async () => {
  await cleanDatabase(pool)
  const userId = await createTestUser(pool)
  spaceId = await createTestSpace(pool, userId)
  tree = new PgSessionTree(pool, spaceId)
})

afterAll(async () => {
  await pool.end()
})

describe('PgSessionTree', () => {
  describe('createRoot', () => {
    it('创建根节点', async () => {
      const root = await tree.createRoot('My Root')
      expect(root.parentId).toBeNull()
      expect(root.label).toBe('My Root')
      expect(root.depth).toBe(0)
      expect(root.children).toEqual([])
      expect(root.refs).toEqual([])
    })
  })

  describe('createChild', () => {
    it('创建子节点', async () => {
      const root = await tree.createRoot()
      const child = await tree.createChild({
        parentId: root.id,
        label: 'Child 1',
        scope: 'coding',
        tags: ['test'],
        metadata: { key: 'val' },
      })

      // TopologyNode 字段
      expect(child.parentId).toBe(root.id)
      expect(child.label).toBe('Child 1')
      expect(child.depth).toBe(1)
      expect(child.index).toBe(0)

      // SessionMeta 字段通过 get() 验证
      const meta = await tree.get(child.id)
      expect(meta!.label).toBe('Child 1')
      expect(meta!.status).toBe('active')
    })

    it('多个子节点 index 递增', async () => {
      const root = await tree.createRoot()
      const c1 = await tree.createChild({ parentId: root.id, label: 'C1' })
      const c2 = await tree.createChild({ parentId: root.id, label: 'C2' })

      expect(c1.index).toBe(0)
      expect(c2.index).toBe(1)
    })

    it('不存在的父节点报错', async () => {
      await expect(
        tree.createChild({ parentId: '00000000-0000-0000-0000-000000000000', label: 'Orphan' }),
      ).rejects.toThrow('Session 不存在')
    })
  })

  describe('get', () => {
    it('返回精简 SessionMeta（不含树字段）', async () => {
      const root = await tree.createRoot()
      await tree.createChild({ parentId: root.id, label: 'C1' })

      const fetched = await tree.get(root.id)
      expect(fetched).not.toBeNull()
      expect(fetched!.id).toBe(root.id)
      expect(fetched!.status).toBe('active')
      // SessionMeta 不含树字段
      expect(fetched).not.toHaveProperty('children')
      expect(fetched).not.toHaveProperty('parentId')
      expect(fetched).not.toHaveProperty('depth')
    })

    it('不存在返回 null', async () => {
      expect(await tree.get('00000000-0000-0000-0000-000000000000')).toBeNull()
    })
  })

  describe('getNode', () => {
    it('返回含 children 和 refs 的 TopologyNode', async () => {
      const root = await tree.createRoot()
      const c1 = await tree.createChild({ parentId: root.id, label: 'C1' })
      const c2 = await tree.createChild({ parentId: root.id, label: 'C2' })

      const node = await tree.getNode(root.id)
      expect(node).not.toBeNull()
      expect(node!.children.sort()).toEqual([c1.id, c2.id].sort())
      expect(node!.depth).toBe(0)
    })

    it('不存在返回 null', async () => {
      expect(await tree.getNode('00000000-0000-0000-0000-000000000000')).toBeNull()
    })
  })

  describe('getTree', () => {
    it('返回递归树结构', async () => {
      const root = await tree.createRoot('Root')
      const c1 = await tree.createChild({ parentId: root.id, label: 'C1' })
      await tree.createChild({ parentId: c1.id, label: 'C1.1', metadata: { sourceSessionId: c1.id } })
      await tree.createChild({ parentId: root.id, label: 'C2' })

      const sessionTree = await tree.getTree()
      expect(sessionTree.id).toBe(root.id)
      expect(sessionTree.label).toBe('Root')
      expect(sessionTree.children).toHaveLength(2)
      expect(sessionTree.children[0]!.label).toBe('C1')
      expect(sessionTree.children[0]!.children).toHaveLength(1)
      expect(sessionTree.children[0]!.children[0]!.label).toBe('C1.1')
      expect(sessionTree.children[0]!.children[0]!.sourceSessionId).toBe(c1.id)
      expect(sessionTree.children[1]!.label).toBe('C2')
    })
  })

  describe('getRoot', () => {
    it('返回根节点', async () => {
      const root = await tree.createRoot('Root')
      const fetched = await tree.getRoot()
      expect(fetched.id).toBe(root.id)
    })

    it('无根节点时报错', async () => {
      await expect(tree.getRoot()).rejects.toThrow('根 Session 不存在')
    })
  })

  describe('listAll', () => {
    it('列出所有 sessions', async () => {
      const root = await tree.createRoot()
      await tree.createChild({ parentId: root.id, label: 'C1' })
      await tree.createChild({ parentId: root.id, label: 'C2' })

      const all = await tree.listAll()
      expect(all).toHaveLength(3)
    })
  })

  describe('archive', () => {
    it('归档 session', async () => {
      const root = await tree.createRoot()
      const child = await tree.createChild({ parentId: root.id, label: 'C1' })

      await tree.archive(child.id)
      const archived = await tree.get(child.id)
      expect(archived!.status).toBe('archived')
    })
  })

  describe('addRef', () => {
    it('创建跨分支引用', async () => {
      const root = await tree.createRoot()
      const c1 = await tree.createChild({ parentId: root.id, label: 'C1' })
      const c2 = await tree.createChild({ parentId: root.id, label: 'C2' })

      await tree.addRef(c1.id, c2.id)
      const node = await tree.getNode(c1.id)
      expect(node!.refs).toContain(c2.id)
    })

    it('不能引用自己', async () => {
      const root = await tree.createRoot()
      await expect(tree.addRef(root.id, root.id)).rejects.toThrow('不能引用自己')
    })

    it('不能引用直系祖先', async () => {
      const root = await tree.createRoot()
      const child = await tree.createChild({ parentId: root.id, label: 'Child' })
      await expect(tree.addRef(child.id, root.id)).rejects.toThrow('不能引用直系祖先')
    })

    it('不能引用直系后代', async () => {
      const root = await tree.createRoot()
      const child = await tree.createChild({ parentId: root.id, label: 'Child' })
      await expect(tree.addRef(root.id, child.id)).rejects.toThrow('不能引用直系后代')
    })

    it('幂等：重复引用不报错', async () => {
      const root = await tree.createRoot()
      const c1 = await tree.createChild({ parentId: root.id, label: 'C1' })
      const c2 = await tree.createChild({ parentId: root.id, label: 'C2' })

      await tree.addRef(c1.id, c2.id)
      await tree.addRef(c1.id, c2.id) // 不应报错
      const node = await tree.getNode(c1.id)
      expect(node!.refs).toHaveLength(1)
    })
  })

  describe('updateMeta', () => {
    it('部分更新', async () => {
      const root = await tree.createRoot()
      const child = await tree.createChild({ parentId: root.id, label: 'Original' })

      const updated = await tree.updateMeta(child.id, { label: 'Renamed', tags: ['new'] })
      expect(updated.label).toBe('Renamed')
      expect(updated.tags).toEqual(['new'])
    })
  })

  describe('getAncestors', () => {
    it('返回从父到根的祖先链', async () => {
      const root = await tree.createRoot()
      const l1 = await tree.createChild({ parentId: root.id, label: 'L1' })
      const l2 = await tree.createChild({ parentId: l1.id, label: 'L2' })

      const ancestors = await tree.getAncestors(l2.id)
      // ancestors 按 depth ASC：root(0), l1(1)
      expect(ancestors).toHaveLength(2)
      expect(ancestors[0]!.id).toBe(root.id)
      expect(ancestors[1]!.id).toBe(l1.id)
    })
  })

  describe('getSiblings', () => {
    it('返回同级兄弟', async () => {
      const root = await tree.createRoot()
      const c1 = await tree.createChild({ parentId: root.id, label: 'C1' })
      const c2 = await tree.createChild({ parentId: root.id, label: 'C2' })
      const c3 = await tree.createChild({ parentId: root.id, label: 'C3' })

      const siblings = await tree.getSiblings(c1.id)
      expect(siblings).toHaveLength(2)
      expect(siblings.map(s => s.id).sort()).toEqual([c2.id, c3.id].sort())
    })

    it('根节点无兄弟', async () => {
      const root = await tree.createRoot()
      const siblings = await tree.getSiblings(root.id)
      expect(siblings).toHaveLength(0)
    })
  })

  describe('space 隔离', () => {
    it('不同 space 的 session 互不可见', async () => {
      const root = await tree.createRoot('Root A')

      const userId = await createTestUser(pool, 'user-2')
      const otherSpaceId = await createTestSpace(pool, userId, 'other')
      const otherTree = new PgSessionTree(pool, otherSpaceId)

      expect(await otherTree.get(root.id)).toBeNull()
      const otherAll = await otherTree.listAll()
      expect(otherAll).toHaveLength(0)
    })
  })
})
