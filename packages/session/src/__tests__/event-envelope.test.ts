import { describe, it, expect, vi } from 'vitest'
import { createSession } from '../create-session.js'
import { createMainSession } from '../create-main-session.js'
import { InMemoryStorageAdapter } from '../mocks/in-memory-storage.js'
import type { ConsolidateFn, IntegrateFn, EventEnvelope } from '../types/functions.js'
import { tryParseEnvelope } from '../context-utils.js'

/** 快速创建测试用 Session + 共享 storage */
async function makeSession() {
  const storage = new InMemoryStorageAdapter()
  const session = await createSession({ storage, label: 'Test' })
  return { session, storage }
}

describe('EventEnvelope — consolidate 产出信封', () => {
  it('consolidate 后 storage 中的 memory 是信封 JSON', async () => {
    const { session, storage } = await makeSession()
    await storage.appendRecord(session.meta.id, { role: 'user', content: 'Hello' })

    await session.consolidate(async () => 'Summarized content')

    const raw = await storage.getMemory(session.meta.id)
    expect(raw).not.toBeNull()

    const envelope = tryParseEnvelope(raw)
    expect(envelope).not.toBeNull()
    expect(envelope!.sessionId).toBe(session.meta.id)
    expect(envelope!.sequence).toBe(1)
    expect(envelope!.content).toBe('Summarized content')
    expect(envelope!.timestamp).toBeTruthy()
  })

  it('多次 consolidate sequence 单调递增', async () => {
    const { session, storage } = await makeSession()

    await session.consolidate(async () => 'first')
    const raw1 = await storage.getMemory(session.meta.id)
    const env1 = tryParseEnvelope(raw1)

    await session.consolidate(async () => 'second')
    const raw2 = await storage.getMemory(session.meta.id)
    const env2 = tryParseEnvelope(raw2)

    expect(env1!.sequence).toBe(1)
    expect(env2!.sequence).toBe(2)
    expect(env2!.content).toBe('second')
  })

  it('consolidate fn 接收信封内的 content 而非原始 JSON', async () => {
    const { session } = await makeSession()

    // 第一次 consolidate
    await session.consolidate(async () => 'first summary')

    // 第二次 consolidate — fn 应该收到 'first summary' 而不是整个信封 JSON
    const fn = vi.fn<ConsolidateFn>(async (currentMemory) => `updated: ${currentMemory}`)
    await session.consolidate(fn)

    expect(fn).toHaveBeenCalledWith('first summary', expect.any(Array))
    expect(await session.memory()).toBe('updated: first summary')
  })

  it('memory() 返回解包后的 content', async () => {
    const { session } = await makeSession()
    await session.consolidate(async () => 'my memory')
    expect(await session.memory()).toBe('my memory')
  })
})

describe('EventEnvelope — getAllSessionL2s 解包', () => {
  it('返回的 ChildL2Summary 包含 sequence 和 timestamp', async () => {
    const storage = new InMemoryStorageAdapter()
    const main = await createMainSession({ storage })
    const child = await createSession({ storage, label: '选校' })

    // 通过 consolidate 写入信封格式的 L2
    await storage.appendRecord(child.meta.id, { role: 'user', content: 'test' })
    await child.consolidate(async () => '已确定 top5 CS 项目')

    const l2s = await storage.getAllSessionL2s()
    expect(l2s).toHaveLength(1)
    expect(l2s[0]!.l2).toBe('已确定 top5 CS 项目')
    expect(l2s[0]!.sequence).toBe(1)
    expect(l2s[0]!.timestamp).toBeTruthy()
  })

  it('向后兼容裸字符串 L2（无信封）', async () => {
    const storage = new InMemoryStorageAdapter()
    await createMainSession({ storage })
    const child = await createSession({ storage, label: '文书' })

    // 直接写入裸字符串（模拟旧数据）
    await storage.putMemory(child.meta.id, 'legacy L2 content')

    const l2s = await storage.getAllSessionL2s()
    expect(l2s).toHaveLength(1)
    expect(l2s[0]!.l2).toBe('legacy L2 content')
    expect(l2s[0]!.sequence).toBe(0)
    expect(l2s[0]!.timestamp).toBe('')
  })
})

describe('EventEnvelope — integration 链路', () => {
  it('IntegrateFn 接收带 sequence/timestamp 的 ChildL2Summary', async () => {
    const storage = new InMemoryStorageAdapter()
    const main = await createMainSession({ storage })
    const child = await createSession({ storage, label: '选校' })

    await child.consolidate(async () => 'CS top5')

    const fn = vi.fn<IntegrateFn>(async (children) => ({
      synthesis: `共 ${children.length} 个子任务`,
      insights: [],
    }))
    await main.integrate(fn)

    const children = fn.mock.calls[0]![0]
    expect(children[0]!.sequence).toBe(1)
    expect(children[0]!.timestamp).toBeTruthy()
    expect(children[0]!.l2).toBe('CS top5')
  })

  it('synthesis() 正确解包', async () => {
    const storage = new InMemoryStorageAdapter()
    const main = await createMainSession({ storage })
    const child = await createSession({ storage, label: '选校' })
    await child.consolidate(async () => 'CS top5')

    await main.integrate(async () => ({
      synthesis: '综合分析',
      insights: [],
    }))

    // synthesis 是 MainSession 存的，不经过 consolidate，所以是裸字符串
    expect(await main.synthesis()).toBe('综合分析')
  })
})
