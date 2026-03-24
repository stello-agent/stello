import type { StelloAgent } from '@stello-ai/core'

/** DevTools 事件 */
export interface DevtoolsEvent {
  type: string
  sessionId?: string
  timestamp: string
  data?: Record<string, unknown>
}

type EventListener = (event: DevtoolsEvent) => void

/** 事件总线——收集 agent 操作事件，广播给所有 WS 客户端 */
export class EventBus {
  private listeners = new Set<EventListener>()

  /** 订阅事件 */
  on(listener: EventListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** 广播事件 */
  emit(event: Omit<DevtoolsEvent, 'timestamp'>): void {
    const full: DevtoolsEvent = { ...event, timestamp: new Date().toISOString() }
    this.listeners.forEach((fn) => fn(full))
  }
}

/** 用 Proxy 包装 agent，拦截方法调用自动广播事件 */
export function wrapAgentWithEvents(agent: StelloAgent, bus: EventBus): StelloAgent {
  return new Proxy(agent, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      if (typeof value !== 'function') return value

      switch (prop) {
        case 'enterSession':
          return async (sessionId: string) => {
            bus.emit({ type: 'session.enter', sessionId })
            const result = await value.call(target, sessionId)
            bus.emit({ type: 'session.entered', sessionId })
            return result
          }
        case 'turn':
          return async (sessionId: string, input: string, options?: unknown) => {
            bus.emit({ type: 'turn.start', sessionId, data: { input } })
            const result = await value.call(target, sessionId, input, options)
            const content = result?.turn?.finalContent ?? result?.turn?.rawResponse ?? ''
            bus.emit({ type: 'turn.end', sessionId, data: {
              toolCalls: result?.turn?.toolCallsExecuted ?? 0,
              content: String(content).slice(0, 100),
            }})
            return result
          }
        case 'leaveSession':
          return async (sessionId: string) => {
            bus.emit({ type: 'session.leave', sessionId })
            const result = await value.call(target, sessionId)
            bus.emit({ type: 'session.left', sessionId })
            return result
          }
        case 'forkSession':
          return async (sessionId: string, options: unknown) => {
            bus.emit({ type: 'fork.start', sessionId })
            const result = await value.call(target, sessionId, options)
            bus.emit({ type: 'fork.created', sessionId, data: { childId: result?.id, label: result?.label } })
            return result
          }
        case 'archiveSession':
          return async (sessionId: string) => {
            const result = await value.call(target, sessionId)
            bus.emit({ type: 'session.archived', sessionId })
            return result
          }
        default:
          return value.bind(target)
      }
    },
  })
}
