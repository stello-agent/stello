/** WebSocket 客户端——连接 DevTools Server 的事件流 */

type WsMessage = Record<string, unknown>
type WsListener = (msg: WsMessage) => void

const listeners = new Set<WsListener>()
let ws: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null

/** 内部：创建新 WS 连接 */
function createConnection(): void {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const url = `${protocol}//${window.location.host}/ws`

  try {
    ws = new WebSocket(url)
  } catch {
    scheduleReconnect()
    return
  }

  ws.onopen = () => {
    console.log('[DevTools WS] connected')
  }

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data as string) as WsMessage
      listeners.forEach((fn) => fn(msg))
    } catch {
      /* 忽略解析错误 */
    }
  }

  ws.onclose = () => {
    console.log('[DevTools WS] closed, reconnecting...')
    ws = null
    scheduleReconnect()
  }

  ws.onerror = () => {
    ws?.close()
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    createConnection()
  }, 3000)
}

/** 连接 WS（幂等，多次调用安全） */
export function connectWs(): void {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return
  try {
    createConnection()
  } catch {
    scheduleReconnect()
  }
}

/** 订阅 WS 消息 */
export function subscribeWs(listener: WsListener): () => void {
  listeners.add(listener)
  /* 如果 WS 还没连，延迟自动连（避免在 React 渲染周期中抛错） */
  setTimeout(() => { try { connectWs() } catch { /* ignore */ } }, 0)
  return () => listeners.delete(listener)
}

/** 发送 WS 消息 */
export function sendWs(msg: WsMessage): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg))
  }
}
