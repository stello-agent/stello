import { randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Server as HttpServer } from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'
import type pg from 'pg'
import type { AgentPool } from '../space/agent-pool.js'
import type { SpaceManager } from '../space/space-manager.js'
import { ConnectionManager } from './connection-manager.js'

/** WS 客户端消息 */
type WsClientMessage =
  | { type: 'session.enter'; sessionId: string }
  | { type: 'session.leave' }
  | { type: 'session.message'; input: string }
  | { type: 'session.stream'; input: string }
  | { type: 'session.fork'; options: { label: string; scope?: string } }

/** 发送 JSON 消息到客户端 */
function send(ws: WebSocket, data: Record<string, unknown>): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data))
  }
}

/** 发送错误消息 */
function sendError(ws: WebSocket, message: string, code?: string): void {
  send(ws, { type: 'error', message, ...(code ? { code } : {}) })
}

/** 从 URL 路径解析 spaceId（/spaces/:spaceId/ws） */
function parseSpaceId(url: string): string | null {
  const match = url.match(/^\/spaces\/([^/]+)\/ws/)
  return match?.[1] ?? null
}

/** 从请求头认证，返回 userId */
async function authenticateUpgrade(pool: pg.Pool, req: IncomingMessage): Promise<string | null> {
  const apiKey = req.headers['x-api-key'] as string | undefined
  if (!apiKey) return null

  const { rows } = await pool.query('SELECT id FROM users WHERE api_key = $1', [apiKey])
  if (rows.length === 0) return null
  return rows[0]!['id'] as string
}

/** 创建 WS Gateway 并附着到 HTTP server */
export function createWsGateway(
  httpServer: HttpServer,
  pool: pg.Pool,
  spaceManager: SpaceManager,
  agentPool: AgentPool,
): { connectionManager: ConnectionManager; wss: WebSocketServer } {
  const wss = new WebSocketServer({ noServer: true })
  const connectionManager = new ConnectionManager()

  // 处理 HTTP upgrade
  httpServer.on('upgrade', async (req, socket, head) => {
    try {
      const url = req.url ?? ''
      const spaceId = parseSpaceId(url)
      if (!spaceId) {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
        socket.destroy()
        return
      }

      // 认证
      const userId = await authenticateUpgrade(pool, req)
      if (!userId) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        return
      }

      // 所有权校验
      const space = await spaceManager.getSpace(spaceId)
      if (!space || space.userId !== userId) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
        socket.destroy()
        return
      }

      // 升级连接
      wss.handleUpgrade(req, socket, head, (ws) => {
        const connectionId = randomUUID()
        connectionManager.bind(connectionId, userId, spaceId)
        handleConnection(ws, connectionId, spaceId, connectionManager, agentPool)
      })
    } catch {
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n')
      socket.destroy()
    }
  })

  return { connectionManager, wss }
}

/** 处理单个 WS 连接的消息 */
function handleConnection(
  ws: WebSocket,
  connectionId: string,
  spaceId: string,
  cm: ConnectionManager,
  agentPool: AgentPool,
): void {
  ws.on('message', async (data) => {
    let msg: WsClientMessage
    try {
      msg = JSON.parse(data.toString()) as WsClientMessage
    } catch {
      sendError(ws, 'Invalid JSON', 'PARSE_ERROR')
      return
    }

    try {
      switch (msg.type) {
        case 'session.enter':
          await handleEnter(ws, connectionId, spaceId, msg.sessionId, cm, agentPool)
          break
        case 'session.leave':
          await handleLeave(ws, connectionId, cm, agentPool)
          break
        case 'session.message':
          await handleMessage(ws, connectionId, msg.input, cm, agentPool)
          break
        case 'session.stream':
          await handleStream(ws, connectionId, msg.input, cm, agentPool)
          break
        case 'session.fork':
          await handleFork(ws, connectionId, msg.options, cm, agentPool)
          break
        default:
          sendError(ws, `Unknown message type: ${(msg as { type: string }).type}`, 'UNKNOWN_TYPE')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal error'
      sendError(ws, message, 'HANDLER_ERROR')
    }
  })

  ws.on('close', async () => {
    const state = cm.getState(connectionId)
    if (state?.sessionId) {
      try {
        const agent = await agentPool.getAgent(spaceId)
        agent.detachSession(state.sessionId, connectionId)
      } catch {
        // 忽略清理错误
      }
    }
    cm.unbind(connectionId)
  })
}

/** 处理 session.enter */
async function handleEnter(
  ws: WebSocket,
  connectionId: string,
  spaceId: string,
  sessionId: string,
  cm: ConnectionManager,
  agentPool: AgentPool,
): Promise<void> {
  const state = cm.getState(connectionId)
  if (state?.sessionId) {
    sendError(ws, 'Already in a session, leave first', 'ALREADY_ENTERED')
    return
  }

  const agent = await agentPool.getAgent(spaceId)
  agent.attachSession(sessionId, connectionId)
  const bootstrap = await agent.enterSession(sessionId)
  cm.attachSession(connectionId, sessionId)
  send(ws, { type: 'session.entered', sessionId, bootstrap })
}

/** 处理 session.leave */
async function handleLeave(
  ws: WebSocket,
  connectionId: string,
  cm: ConnectionManager,
  agentPool: AgentPool,
): Promise<void> {
  const state = cm.getState(connectionId)
  if (!state?.sessionId) {
    sendError(ws, 'Not in a session', 'NOT_ENTERED')
    return
  }

  const sessionId = state.sessionId
  const agent = await agentPool.getAgent(state.spaceId)
  await agent.leaveSession(sessionId)
  agent.detachSession(sessionId, connectionId)
  cm.detachSession(connectionId)
  send(ws, { type: 'session.left', sessionId })
}

/** 处理 session.message（非流式） */
async function handleMessage(
  ws: WebSocket,
  connectionId: string,
  input: string,
  cm: ConnectionManager,
  agentPool: AgentPool,
): Promise<void> {
  const state = cm.getState(connectionId)
  if (!state?.sessionId) {
    sendError(ws, 'Not in a session', 'NOT_ENTERED')
    return
  }

  const agent = await agentPool.getAgent(state.spaceId)
  const result = await agent.turn(state.sessionId, input)
  send(ws, { type: 'turn.complete', result })
}

/** 处理 session.stream（流式） */
async function handleStream(
  ws: WebSocket,
  connectionId: string,
  input: string,
  cm: ConnectionManager,
  agentPool: AgentPool,
): Promise<void> {
  const state = cm.getState(connectionId)
  if (!state?.sessionId) {
    sendError(ws, 'Not in a session', 'NOT_ENTERED')
    return
  }

  const agent = await agentPool.getAgent(state.spaceId)
  const stream = await agent.stream(state.sessionId, input)
  for await (const chunk of stream) {
    send(ws, { type: 'stream.delta', chunk })
  }
  const result = await stream.result
  send(ws, { type: 'stream.end', result })
}

/** 处理 session.fork */
async function handleFork(
  ws: WebSocket,
  connectionId: string,
  options: { label: string; scope?: string },
  cm: ConnectionManager,
  agentPool: AgentPool,
): Promise<void> {
  const state = cm.getState(connectionId)
  if (!state?.sessionId) {
    sendError(ws, 'Not in a session', 'NOT_ENTERED')
    return
  }

  const agent = await agentPool.getAgent(state.spaceId)
  const child = await agent.forkSession(state.sessionId, {
    label: options.label,
    scope: options.scope,
  })
  send(ws, { type: 'session.forked', child })
}
