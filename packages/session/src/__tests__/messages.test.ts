import { describe, it, expect } from 'vitest'
import { makeSession } from './helpers.js'

describe('messages() CRUD', () => {
  it('初始状态消息列表为空', async () => {
    const { session } = await makeSession()
    const msgs = await session.messages()
    expect(msgs).toEqual([])
  })

  it('appendRecord 后可通过 messages() 读取', async () => {
    const { session, storage } = await makeSession()
    await storage.appendRecord(session.meta.id, { role: 'user', content: 'Hello' })
    const msgs = await session.messages()
    expect(msgs).toHaveLength(1)
    expect(msgs[0]!.content).toBe('Hello')
  })

  it('多条消息按顺序返回', async () => {
    const { session, storage } = await makeSession()
    const id = session.meta.id
    await storage.appendRecord(id, { role: 'user', content: 'First' })
    await storage.appendRecord(id, { role: 'assistant', content: 'Second' })
    await storage.appendRecord(id, { role: 'user', content: 'Third' })
    const msgs = await session.messages()
    expect(msgs.map((m) => m.content)).toEqual(['First', 'Second', 'Third'])
  })

  it('limit 选项限制返回数量', async () => {
    const { session, storage } = await makeSession()
    const id = session.meta.id
    for (let i = 0; i < 5; i++) {
      await storage.appendRecord(id, { role: 'user', content: `msg${i}` })
    }
    const msgs = await session.messages({ limit: 2 })
    expect(msgs).toHaveLength(2)
  })

  it('offset 选项跳过前 N 条', async () => {
    const { session, storage } = await makeSession()
    const id = session.meta.id
    for (let i = 0; i < 4; i++) {
      await storage.appendRecord(id, { role: 'user', content: `msg${i}` })
    }
    const msgs = await session.messages({ offset: 2 })
    expect(msgs.map((m) => m.content)).toEqual(['msg2', 'msg3'])
  })

  it('role 过滤只返回指定角色消息', async () => {
    const { session, storage } = await makeSession()
    const id = session.meta.id
    await storage.appendRecord(id, { role: 'user', content: 'u1' })
    await storage.appendRecord(id, { role: 'assistant', content: 'a1' })
    await storage.appendRecord(id, { role: 'user', content: 'u2' })
    const userMsgs = await session.messages({ role: 'user' })
    expect(userMsgs.map((m) => m.content)).toEqual(['u1', 'u2'])
  })
})
