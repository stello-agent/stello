import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import type pg from 'pg'
import { createTestPool, setupDatabase, cleanDatabase, createTestUserWithKey } from './helpers.js'
import { createStelloServer } from '../create-server.js'
import type { StelloServer } from '../types.js'
import type { AgentPoolOptions } from '../space/agent-pool.js'

let pool: pg.Pool
let server: StelloServer
let apiKey: string
let userId: string

/** 最小 AgentPoolOptions mock */
function mockPoolOptions(): AgentPoolOptions {
  return {
    buildConfig: () => ({
      capabilities: {
        lifecycle: {
          bootstrap: async () => ({
            context: { core: {}, memories: [], currentMemory: null, scope: null },
            session: {
              id: '', parentId: null, children: [], refs: [], label: '', index: 0,
              scope: null, status: 'active' as const, depth: 0, turnCount: 0,
              metadata: {}, tags: [], createdAt: '', updatedAt: '', lastActiveAt: '',
            },
          }),
          afterTurn: async () => ({ coreUpdated: false, memoryUpdated: false, recordAppended: false }),
          prepareChildSpawn: async (opts) => ({ ...opts, id: 'mock', parentId: null, children: [], refs: [], index: 0, scope: null, status: 'active' as const, depth: 0, turnCount: 0, metadata: {}, tags: [], createdAt: '', updatedAt: '', lastActiveAt: '' }),
        },
        tools: {
          getToolDefinitions: () => [],
          executeTool: async () => ({ success: false, error: 'not implemented' }),
        },
        skills: {
          register: () => {},
          match: () => null,
          getAll: () => [],
        },
        confirm: {
          confirmSplit: async () => { throw new Error('not implemented') },
          dismissSplit: async () => {},
          confirmUpdate: async () => {},
          dismissUpdate: async () => {},
        },
      },
      session: {
        sessionResolver: async () => { throw new Error('not implemented') },
        consolidateFn: async (mem) => mem ?? 'consolidated',
      },
    }),
    idleTtlMs: 60_000,
  }
}

/** 发起请求的辅助函数 */
function req(method: string, path: string, body?: unknown, key?: string) {
  const headers: Record<string, string> = {}
  if (key !== undefined) headers['X-API-Key'] = key
  else if (apiKey) headers['X-API-Key'] = apiKey
  if (body) headers['Content-Type'] = 'application/json'

  return server.app.request(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
}

beforeAll(async () => {
  pool = createTestPool()
  await setupDatabase(pool)
  server = await createStelloServer({ pool, agentPoolOptions: mockPoolOptions(), skipMigrate: true })
})

beforeEach(async () => {
  await cleanDatabase(pool)
  const result = await createTestUserWithKey(pool)
  apiKey = result.apiKey
  userId = result.userId
})

afterAll(async () => {
  server.agentPool.dispose()
  await pool.end()
})

describe('REST /spaces', () => {
  describe('认证', () => {
    it('缺少 API key 返回 401', async () => {
      const res = await req('GET', '/spaces', undefined, '')
      expect(res.status).toBe(401)
    })

    it('无效 API key 返回 401', async () => {
      const res = await req('GET', '/spaces', undefined, 'invalid-key')
      expect(res.status).toBe(401)
    })
  })

  describe('POST /spaces', () => {
    it('创建 space', async () => {
      const res = await req('POST', '/spaces', { label: 'Test Space', systemPrompt: 'Be helpful' })
      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.label).toBe('Test Space')
      expect(body.systemPrompt).toBe('Be helpful')
      expect(body.userId).toBe(userId)
    })

    it('缺少 label 返回 400', async () => {
      const res = await req('POST', '/spaces', {})
      expect(res.status).toBe(400)
    })
  })

  describe('GET /spaces', () => {
    it('列出用户的 spaces', async () => {
      await req('POST', '/spaces', { label: 'Space 1' })
      await req('POST', '/spaces', { label: 'Space 2' })

      const res = await req('GET', '/spaces')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toHaveLength(2)
      expect(body.map((s: { label: string }) => s.label)).toEqual(['Space 1', 'Space 2'])
    })

    it('不同用户互不可见', async () => {
      await req('POST', '/spaces', { label: 'My Space' })

      const other = await createTestUserWithKey(pool, 'other')
      const res = await req('GET', '/spaces', undefined, other.apiKey)
      const body = await res.json()
      expect(body).toHaveLength(0)
    })
  })

  describe('GET /spaces/:spaceId', () => {
    it('获取 space 详情', async () => {
      const createRes = await req('POST', '/spaces', { label: 'Detail' })
      const created = await createRes.json()

      const res = await req('GET', `/spaces/${created.id}`)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.id).toBe(created.id)
    })

    it('不存在返回 404', async () => {
      const res = await req('GET', '/spaces/00000000-0000-0000-0000-000000000000')
      expect(res.status).toBe(404)
    })

    it('他人的 space 返回 403', async () => {
      const createRes = await req('POST', '/spaces', { label: 'Private' })
      const created = await createRes.json()

      const other = await createTestUserWithKey(pool, 'other')
      const res = await req('GET', `/spaces/${created.id}`, undefined, other.apiKey)
      expect(res.status).toBe(403)
    })
  })

  describe('PATCH /spaces/:spaceId', () => {
    it('更新 label', async () => {
      const createRes = await req('POST', '/spaces', { label: 'Old' })
      const created = await createRes.json()

      const res = await req('PATCH', `/spaces/${created.id}`, { label: 'New' })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.label).toBe('New')
    })
  })

  describe('DELETE /spaces/:spaceId', () => {
    it('删除 space', async () => {
      const createRes = await req('POST', '/spaces', { label: 'Delete Me' })
      const created = await createRes.json()

      const delRes = await req('DELETE', `/spaces/${created.id}`)
      expect(delRes.status).toBe(204)

      const getRes = await req('GET', `/spaces/${created.id}`)
      expect(getRes.status).toBe(404)
    })
  })
})
