/** 单个 WS 连接的状态 */
export interface ConnectionState {
  connectionId: string
  userId: string
  spaceId: string
  /** 当前附着的 sessionId，null 表示未进入任何 session */
  sessionId: string | null
}

/**
 * ConnectionManager — 纯内存的 WS 连接态管理
 * 维护 connectionId ↔ sessionId 的映射关系
 */
export class ConnectionManager {
  private connections = new Map<string, ConnectionState>()

  /** 绑定新连接 */
  bind(connectionId: string, userId: string, spaceId: string): void {
    this.connections.set(connectionId, {
      connectionId,
      userId,
      spaceId,
      sessionId: null,
    })
  }

  /** 获取连接状态 */
  getState(connectionId: string): ConnectionState | null {
    return this.connections.get(connectionId) ?? null
  }

  /** 将连接附着到指定 session */
  attachSession(connectionId: string, sessionId: string): void {
    const state = this.connections.get(connectionId)
    if (!state) throw new Error(`连接不存在: ${connectionId}`)
    state.sessionId = sessionId
  }

  /** 从 session 断开，返回旧 sessionId */
  detachSession(connectionId: string): string | null {
    const state = this.connections.get(connectionId)
    if (!state) return null
    const old = state.sessionId
    state.sessionId = null
    return old
  }

  /** 解绑连接，返回最终状态 */
  unbind(connectionId: string): ConnectionState | null {
    const state = this.connections.get(connectionId) ?? null
    this.connections.delete(connectionId)
    return state
  }

  /** 当前连接数 */
  get size(): number {
    return this.connections.size
  }
}
