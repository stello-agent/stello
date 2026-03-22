import { describe, it, expect } from 'vitest'
import { makeSession } from './helpers.js'

describe('systemPrompt() + setSystemPrompt()', () => {
  it('初始返回 null（未设置时）', async () => {
    const { session } = await makeSession()
    expect(await session.systemPrompt()).toBeNull()
  })

  it('createSession 传入 systemPrompt 后可读', async () => {
    const { session } = await makeSession({ systemPrompt: 'You are helpful.' })
    expect(await session.systemPrompt()).toBe('You are helpful.')
  })

  it('setSystemPrompt + systemPrompt 往返正确', async () => {
    const { session } = await makeSession()
    await session.setSystemPrompt('New prompt')
    expect(await session.systemPrompt()).toBe('New prompt')
  })

  it('setSystemPrompt 覆盖已有值', async () => {
    const { session } = await makeSession({ systemPrompt: 'Old' })
    await session.setSystemPrompt('New')
    expect(await session.systemPrompt()).toBe('New')
  })

  it('archived session 上调用 setSystemPrompt 抛错', async () => {
    const { session } = await makeSession()
    await session.archive()
    await expect(session.setSystemPrompt('x')).rejects.toThrow('archived')
  })
})

describe('insight() + setInsight()', () => {
  it('初始返回 null', async () => {
    const { session } = await makeSession()
    expect(await session.insight()).toBeNull()
  })

  it('setInsight + insight 往返正确', async () => {
    const { session } = await makeSession()
    await session.setInsight('Some insights here')
    expect(await session.insight()).toBe('Some insights here')
  })

  it('setInsight 覆盖已有值', async () => {
    const { session } = await makeSession()
    await session.setInsight('first')
    await session.setInsight('second')
    expect(await session.insight()).toBe('second')
  })

  it('不同 session 的 insight 互不干扰', async () => {
    const { session: s1, storage } = await makeSession()
    const { session: s2 } = await makeSession()
    await s1.setInsight('insight-1')
    // s2 使用独立 storage，应为 null
    expect(await s2.insight()).toBeNull()
  })

  it('archived session 上调用 setInsight 抛错', async () => {
    const { session } = await makeSession()
    await session.archive()
    await expect(session.setInsight('x')).rejects.toThrow('archived')
  })
})
