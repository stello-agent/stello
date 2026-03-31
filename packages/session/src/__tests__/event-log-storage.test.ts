import { describe, it, expect } from 'vitest'
import { InMemoryStorageAdapter } from '../mocks/in-memory-storage.js'
import { createSession, createMainSession } from '../index.js'

describe('InMemoryStorageAdapter — memory event log', () => {
  it('appendMemoryEvent 生成全局递增 sequence，并支持按 cursor 读取', async () => {
    const storage = new InMemoryStorageAdapter()
    const main = await createMainSession({ storage, label: 'Main' })
    const child1 = await createSession({ storage, label: '美国选校' })
    const child2 = await createSession({ storage, label: '英国选校' })

    const event1 = await storage.appendMemoryEvent(child1.meta.id, '确认预算 50 万')
    const event2 = await storage.appendMemoryEvent(child2.meta.id, '优先考虑就业导向项目')

    expect(event1.sequence).toBe(1)
    expect(event2.sequence).toBe(2)

    await storage.setIntegrationCursor(main.meta.id, 1)
    const unread = await storage.listMemoryEvents(await storage.getIntegrationCursor(main.meta.id))

    expect(unread).toHaveLength(1)
    expect(unread[0]!.sequence).toBe(2)
    expect(unread[0]!.content).toBe('优先考虑就业导向项目')
  })
})

describe('InMemoryStorageAdapter — append-only insights', () => {
  it('多条 insight 追加后会一起暴露给下一次 send，再由 clearInsight 消费', async () => {
    const storage = new InMemoryStorageAdapter()
    const child = await createSession({ storage, label: '美国选校' })

    await storage.appendInsightEvent(child.meta.id, '英国方向发现用户更看重就业')
    await storage.appendInsightEvent(child.meta.id, '预算上限更新为 50 万')

    expect(await storage.getInsight(child.meta.id)).toBe(
      '英国方向发现用户更看重就业\n\n预算上限更新为 50 万',
    )

    await storage.clearInsight(child.meta.id)
    expect(await storage.getInsight(child.meta.id)).toBeNull()

    await storage.appendInsightEvent(child.meta.id, '新增：优先推荐 OPT 友好项目')
    expect(await storage.getInsight(child.meta.id)).toBe('新增：优先推荐 OPT 友好项目')
  })
})
