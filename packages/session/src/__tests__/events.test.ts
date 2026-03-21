import { describe, it, expect, vi } from 'vitest'
import { makeSession } from './helpers.js'

describe('on/off 事件系统', () => {
  it('on 订阅后事件触发时调用 handler', async () => {
    const { session } = await makeSession()
    const handler = vi.fn()
    session.on('archived', handler)
    await session.archive()
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('off 取消订阅后不再调用', async () => {
    const { session } = await makeSession()
    const handler = vi.fn()
    session.on('archived', handler)
    session.off('archived', handler)
    await session.archive()
    expect(handler).not.toHaveBeenCalled()
  })

  it('metaUpdated 事件在 updateMeta 时触发', async () => {
    const { session } = await makeSession()
    const handler = vi.fn()
    session.on('metaUpdated', handler)
    await session.updateMeta({ label: 'New' })
    expect(handler).toHaveBeenCalledWith({ updates: { label: 'New' } })
  })

  it('systemPromptUpdated 事件在 setSystemPrompt 时触发', async () => {
    const { session } = await makeSession()
    const handler = vi.fn()
    session.on('systemPromptUpdated', handler)
    await session.setSystemPrompt('new prompt')
    expect(handler).toHaveBeenCalledWith({ content: 'new prompt' })
  })

  it('insightUpdated 事件在 setInsight 时触发', async () => {
    const { session } = await makeSession()
    const handler = vi.fn()
    session.on('insightUpdated', handler)
    await session.setInsight('new insight')
    expect(handler).toHaveBeenCalledWith({ content: 'new insight' })
  })

  it('consolidated 事件在 consolidate 时触发', async () => {
    const { session } = await makeSession()
    const handler = vi.fn()
    session.on('consolidated', handler)
    await session.consolidate(async () => 'memory content')
    expect(handler).toHaveBeenCalledWith({ memory: 'memory content' })
  })

  it('多个 handler 都被调用', async () => {
    const { session } = await makeSession()
    const h1 = vi.fn()
    const h2 = vi.fn()
    session.on('archived', h1)
    session.on('archived', h2)
    await session.archive()
    expect(h1).toHaveBeenCalledTimes(1)
    expect(h2).toHaveBeenCalledTimes(1)
  })

  it('只取消特定 handler，其余仍触发', async () => {
    const { session } = await makeSession()
    const h1 = vi.fn()
    const h2 = vi.fn()
    session.on('archived', h1)
    session.on('archived', h2)
    session.off('archived', h1)
    await session.archive()
    expect(h1).not.toHaveBeenCalled()
    expect(h2).toHaveBeenCalledTimes(1)
  })
})
