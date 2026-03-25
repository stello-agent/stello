import type { Server as HttpServer } from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'
import type { StelloAgent } from '@stello-ai/core'

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

/** 创建 DevTools WS 处理器 */
export function createWsHandler(
  httpServer: HttpServer,
  agent: StelloAgent,
): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true })

  /* DevTools 无需认证（本地工具），直接升级 /ws 路径 */
  httpServer.on('upgrade', (req, socket, head) => {
    const url = req.url ?? ''
    if (!url.startsWith('/ws')) {
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      handleConnection(ws, agent)
    })
  })

  return wss
}

/** 处理单个 WS 连接 */
function handleConnection(ws: WebSocket, agent: StelloAgent): void {
  let currentSessionId: string | null = null

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
        case 'session.enter': {
          const bootstrap = await agent.enterSession(msg.sessionId)
          currentSessionId = msg.sessionId
          send(ws, { type: 'session.entered', sessionId: msg.sessionId, bootstrap })
          break
        }
        case 'session.leave': {
          if (!currentSessionId) {
            sendError(ws, 'Not in a session', 'NOT_ENTERED')
            break
          }
          const sessionId = currentSessionId
          await agent.leaveSession(sessionId)
          currentSessionId = null
          send(ws, { type: 'session.left', sessionId })
          break
        }
        case 'session.message': {
          if (!currentSessionId) {
            sendError(ws, 'Not in a session', 'NOT_ENTERED')
            break
          }
          const result = await agent.turn(currentSessionId, msg.input)
          send(ws, { type: 'turn.complete', result })
          break
        }
        case 'session.stream': {
          if (!currentSessionId) {
            sendError(ws, 'Not in a session', 'NOT_ENTERED')
            break
          }
          const stream = await agent.stream(currentSessionId, msg.input)
          for await (const chunk of stream) {
            send(ws, { type: 'stream.delta', chunk })
          }
          const streamResult = await stream.result
          send(ws, { type: 'stream.end', result: streamResult })
          break
        }
        case 'session.fork': {
          if (!currentSessionId) {
            sendError(ws, 'Not in a session', 'NOT_ENTERED')
            break
          }
          const child = await agent.forkSession(currentSessionId, msg.options)
          send(ws, { type: 'session.forked', child })
          break
        }
        default:
          sendError(ws, `Unknown message type: ${(msg as { type: string }).type}`, 'UNKNOWN_TYPE')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal error'
      sendError(ws, message, 'HANDLER_ERROR')
    }
  })
}
