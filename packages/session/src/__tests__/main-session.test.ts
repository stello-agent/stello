import { describe, it, expect, vi } from 'vitest'
import { createMainSession } from '../create-main-session.js'
import { createSession } from '../create-session.js'
import { InMemoryStorageAdapter } from '../mocks/in-memory-storage.js'
import { NotImplementedError, SessionArchivedError } from '../types/session-api.js'
import type { IntegrateFn } from '../types/functions.js'

/** 快速创建测试用 MainSession */
async function makeMainSession() {
  const storage = new InMemoryStorageAdapter()
  const main = await createMainSession({ storage, label: 'Test Main' })
  return { main, storage }
}

/** 创建 MainSession + 带 L2 的子 Session */
async function makeWithChildren() {
  const storage = new InMemoryStorageAdapter()
  const main = await createMainSession({ storage })

  const child1 = await createSession({
    storage, label: '选校',
  })
  const child2 = await createSession({
    storage, label: '文书',
  })

  // 写入 L2
  await storage.putMemory(child1.meta.id, '已确定 top5 CS 项目')
  await storage.putMemory(child2.meta.id, 'PS 初稿已完成')

  return { main, storage, child1, child2 }
}

describe('MainSession meta', () => {
  it('创建后 role 为 main', async () => {
    const { main } = await makeMainSession()
    expect(main.meta.role).toBe('main')
    expect(main.meta.status).toBe('active')
  })

  it('updateMeta 更新 label', async () => {
    const { main } = await makeMainSession()
    await main.updateMeta({ label: 'Updated' })
    expect(main.meta.label).toBe('Updated')
  })

  it('archive 后 status 变为 archived', async () => {
    const { main } = await makeMainSession()
    await main.archive()
    expect(main.meta.status).toBe('archived')
  })

  it('archived 后 updateMeta 抛错', async () => {
    const { main } = await makeMainSession()
    await main.archive()
    await expect(main.updateMeta({ label: 'X' })).rejects.toThrow(SessionArchivedError)
  })
})

describe('MainSession synthesis()', () => {
  it('初始 synthesis 为 null', async () => {
    const { main } = await makeMainSession()
    expect(await main.synthesis()).toBeNull()
  })

  it('integrate 后 synthesis 可读', async () => {
    const { main } = await makeWithChildren()

    const fn: IntegrateFn = async (children, _current) => ({
      synthesis: `共 ${children.length} 个子任务`,
      insights: [],
    })
    await main.integrate(fn)

    expect(await main.synthesis()).toBe('共 2 个子任务')
  })
})

describe('MainSession integrate()', () => {
  it('IntegrateFn 接收所有子 Session 的 L2', async () => {
    const { main } = await makeWithChildren()

    const fn = vi.fn<IntegrateFn>(async (children, _current) => ({
      synthesis: 'ok',
      insights: [],
    }))
    await main.integrate(fn)

    expect(fn).toHaveBeenCalledTimes(1)
    const children = fn.mock.calls[0]![0]
    expect(children).toHaveLength(2)
    expect(children.map((c) => c.label).sort()).toEqual(['文书', '选校'])
    expect(children.find((c) => c.label === '选校')?.l2).toBe('已确定 top5 CS 项目')
  })

  it('IntegrateFn 接收当前 synthesis', async () => {
    const { main } = await makeWithChildren()

    // 先做一次 integrate
    await main.integrate(async () => ({
      synthesis: 'first synthesis',
      insights: [],
    }))

    // 第二次应收到 first synthesis
    const fn = vi.fn<IntegrateFn>(async (_children, current) => ({
      synthesis: `updated from: ${current}`,
      insights: [],
    }))
    await main.integrate(fn)

    expect(fn.mock.calls[0]![1]).toBe('first synthesis')
    expect(await main.synthesis()).toBe('updated from: first synthesis')
  })

  it('insights 推送到子 Session', async () => {
    const { main, storage, child1, child2 } = await makeWithChildren()

    await main.integrate(async (children) => ({
      synthesis: 'overview',
      insights: [
        { sessionId: children[0]!.sessionId, content: '加快进度' },
        { sessionId: children[1]!.sessionId, content: 'DDL 临近' },
      ],
    }))

    // 验证 insights 已写入子 Session
    const insight1 = await storage.getInsight(child1.meta.id)
    const insight2 = await storage.getInsight(child2.meta.id)
    expect(insight1).toBeTruthy()
    expect(insight2).toBeTruthy()
  })

  it('无子 Session 时 IntegrateFn 接收空数组', async () => {
    const { main } = await makeMainSession()

    const fn = vi.fn<IntegrateFn>(async () => ({
      synthesis: 'empty',
      insights: [],
    }))
    await main.integrate(fn)

    expect(fn.mock.calls[0]![0]).toEqual([])
  })

  it('archived 后 integrate 抛错', async () => {
    const { main } = await makeMainSession()
    await main.archive()
    await expect(main.integrate(async () => ({
      synthesis: '', insights: [],
    }))).rejects.toThrow(SessionArchivedError)
  })
})

describe('MainSession systemPrompt()', () => {
  it('初始返回 null（未设置时）', async () => {
    const { main } = await makeMainSession()
    expect(await main.systemPrompt()).toBeNull()
  })

  it('createMainSession 传入 systemPrompt 后可读', async () => {
    const storage = new InMemoryStorageAdapter()
    const main = await createMainSession({ storage, systemPrompt: 'Main prompt' })
    expect(await main.systemPrompt()).toBe('Main prompt')
  })

  it('setSystemPrompt + systemPrompt 往返正确', async () => {
    const { main } = await makeMainSession()
    await main.setSystemPrompt('New prompt')
    expect(await main.systemPrompt()).toBe('New prompt')
  })

  it('archived 后 setSystemPrompt 抛错', async () => {
    const { main } = await makeMainSession()
    await main.archive()
    await expect(main.setSystemPrompt('x')).rejects.toThrow(SessionArchivedError)
  })
})

describe('MainSession send/stream (NotImplemented)', () => {
  it('send() 抛出 NotImplementedError', async () => {
    const { main } = await makeMainSession()
    await expect(main.send('hello')).rejects.toThrow(NotImplementedError)
  })

  it('archived 时 send() 抛 SessionArchivedError', async () => {
    const { main } = await makeMainSession()
    await main.archive()
    await expect(main.send('hello')).rejects.toThrow(SessionArchivedError)
  })

  it.todo('send() 上下文使用 synthesis 而非 insights')
  it.todo('stream() 流式输出')
})
