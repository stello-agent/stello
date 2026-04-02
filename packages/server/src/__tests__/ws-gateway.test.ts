import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import type pg from 'pg'
import WebSocket from 'ws'
import { createTestPool, setupDatabase, cleanDatabase, createTestUserWithKey } from './helpers.js'
import { createStelloServer } from '../create-server.js'
import { SpaceManager } from '../space/space-manager.js'
import type { AgentPoolOptions } from '../space/agent-pool.js'

let pool: pg.Pool
let apiKey: string
let userId: string
let spaceManager: SpaceManager
let serverPort: number
let closeServer: () => Promise<void>

/** 最小 AgentPoolOptions mock */
function mockPoolOptions(): AgentPoolOptions {
  return {
    buildConfig: () => ({
      capabilities: {
        lifecycle: {
          bootstrap: async () => ({
            context: { core: {}, memories: [], currentMemory: null, scope: null },
            session: {
              id: '', label: '', scope: null, status: 'active' as const,
              turnCount: 0, metadata: {}, tags: [], createdAt: '', updatedAt: '', lastActiveAt: '',
            },
          }),
          afterTurn: async () => ({ coreUpdated: false, memoryUpdated: false, recordAppended: false }),
          prepareChildSpawn: async (opts) => ({
            ...opts, id: 'mock', parentId: null, children: [], refs: [], index: 0,
            depth: 0, label: opts.label,
          }),
        },
        tools: {
          getToolDefinitions: () => [],
          executeTool: async () => ({ success: false, error: 'not implemented' }),
        },
        skills: {
          register: () => {},
          get: () => undefined,
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

/** 连接 WS 并等待打开 */
function connectWs(spaceId: string, key: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${serverPort}/spaces/${spaceId}/ws`, {
      headers: { 'X-API-Key': key },
    })
    ws.on('open', () => resolve(ws))
    ws.on('error', reject)
  })
}

/** 发送 JSON 消息 */
function sendMsg(ws: WebSocket, msg: Record<string, unknown>): void {
  ws.send(JSON.stringify(msg))
}

/** 等待下一条消息 */
function waitMsg(ws: WebSocket, timeoutMs = 5000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WS message timeout')), timeoutMs)
    ws.once('message', (data) => {
      clearTimeout(timer)
      resolve(JSON.parse(data.toString()))
    })
  })
}

/** 等待连接关闭 */
function waitClose(ws: WebSocket, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WS close timeout')), timeoutMs)
    ws.once('close', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

beforeAll(async () => {
  pool = createTestPool()
  await setupDatabase(pool)
  spaceManager = new SpaceManager(pool)

  const server = await createStelloServer({ pool, agentPoolOptions: mockPoolOptions(), skipMigrate: true })
  const info = await server.listen()
  serverPort = info.port
  closeServer = info.close
})

beforeEach(async () => {
  await cleanDatabase(pool)
  const result = await createTestUserWithKey(pool)
  apiKey = result.apiKey
  userId = result.userId
})

afterAll(async () => {
  if (closeServer) await closeServer()
  await pool.end()
})

describe('WS Gateway', () => {
  it('成功建立连接', async () => {
    const space = await spaceManager.createSpace(userId, { label: 'WS Test' })
    const ws = await connectWs(space.id, apiKey)
    expect(ws.readyState).toBe(WebSocket.OPEN)
    ws.close()
    await waitClose(ws)
  })

  it('无 API key 拒绝连接', async () => {
    const space = await spaceManager.createSpace(userId, { label: 'WS Test' })
    await expect(connectWs(space.id, '')).rejects.toThrow()
  })

  it('无效 API key 拒绝连接', async () => {
    const space = await spaceManager.createSpace(userId, { label: 'WS Test' })
    await expect(connectWs(space.id, 'invalid-key')).rejects.toThrow()
  })

  it('他人 space 拒绝连接', async () => {
    const space = await spaceManager.createSpace(userId, { label: 'WS Test' })
    const other = await createTestUserWithKey(pool, 'other')
    await expect(connectWs(space.id, other.apiKey)).rejects.toThrow()
  })

  it('无效 JSON 返回错误消息', async () => {
    const space = await spaceManager.createSpace(userId, { label: 'WS Test' })
    const ws = await connectWs(space.id, apiKey)

    ws.send('not json')
    const msg = await waitMsg(ws)
    expect(msg.type).toBe('error')
    expect(msg.code).toBe('PARSE_ERROR')

    ws.close()
    await waitClose(ws)
  })

  it('未 enter 就发 message 返回 NOT_ENTERED', async () => {
    const space = await spaceManager.createSpace(userId, { label: 'WS Test' })
    const ws = await connectWs(space.id, apiKey)

    sendMsg(ws, { type: 'session.message', input: 'hello' })
    const msg = await waitMsg(ws)
    expect(msg.type).toBe('error')
    expect(msg.code).toBe('NOT_ENTERED')

    ws.close()
    await waitClose(ws)
  })

  it('未知消息类型返回 UNKNOWN_TYPE', async () => {
    const space = await spaceManager.createSpace(userId, { label: 'WS Test' })
    const ws = await connectWs(space.id, apiKey)

    sendMsg(ws, { type: 'unknown.type' })
    const msg = await waitMsg(ws)
    expect(msg.type).toBe('error')
    expect(msg.code).toBe('UNKNOWN_TYPE')

    ws.close()
    await waitClose(ws)
  })
})
