import { describe, it, expect, beforeEach } from 'vitest'
import { ConnectionManager } from '../ws/connection-manager.js'

let cm: ConnectionManager

beforeEach(() => {
  cm = new ConnectionManager()
})

describe('ConnectionManager', () => {
  it('bind + getState', () => {
    cm.bind('c1', 'user1', 'space1')
    const state = cm.getState('c1')
    expect(state).not.toBeNull()
    expect(state!.connectionId).toBe('c1')
    expect(state!.userId).toBe('user1')
    expect(state!.spaceId).toBe('space1')
    expect(state!.sessionId).toBeNull()
  })

  it('不存在的连接返回 null', () => {
    expect(cm.getState('unknown')).toBeNull()
  })

  it('attachSession + detachSession', () => {
    cm.bind('c1', 'user1', 'space1')
    cm.attachSession('c1', 'sess1')
    expect(cm.getState('c1')!.sessionId).toBe('sess1')

    const old = cm.detachSession('c1')
    expect(old).toBe('sess1')
    expect(cm.getState('c1')!.sessionId).toBeNull()
  })

  it('attachSession 对不存在的连接抛错', () => {
    expect(() => cm.attachSession('unknown', 'sess1')).toThrow('连接不存在')
  })

  it('detachSession 对不存在的连接返回 null', () => {
    expect(cm.detachSession('unknown')).toBeNull()
  })

  it('unbind 返回最终状态并移除', () => {
    cm.bind('c1', 'user1', 'space1')
    cm.attachSession('c1', 'sess1')

    const state = cm.unbind('c1')
    expect(state).not.toBeNull()
    expect(state!.sessionId).toBe('sess1')
    expect(cm.getState('c1')).toBeNull()
    expect(cm.size).toBe(0)
  })

  it('unbind 不存在的连接返回 null', () => {
    expect(cm.unbind('unknown')).toBeNull()
  })

  it('size 正确计数', () => {
    expect(cm.size).toBe(0)
    cm.bind('c1', 'u1', 's1')
    cm.bind('c2', 'u2', 's2')
    expect(cm.size).toBe(2)
    cm.unbind('c1')
    expect(cm.size).toBe(1)
  })
})
