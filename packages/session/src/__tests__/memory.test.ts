import { describe, it, expect, vi } from 'vitest'
import { makeSession } from './helpers.js'
import type { ConsolidateFn } from '../types/functions.js'

describe('memory() + consolidate()', () => {
  it('初始记忆为 null', async () => {
    const { session } = await makeSession()
    expect(await session.memory()).toBeNull()
  })

  it('consolidate 后记忆可读', async () => {
    const { session, storage } = await makeSession()
    await storage.appendRecord(session.meta.id, { role: 'user', content: 'Hello' })

    const fn: ConsolidateFn = async (_mem, _msgs) => 'Summarized memory'
    await session.consolidate(fn)

    expect(await session.memory()).toBe('Summarized memory')
  })

  it('consolidate fn 接收正确参数', async () => {
    const { session, storage } = await makeSession()
    await storage.appendRecord(session.meta.id, { role: 'user', content: 'msg1' })
    await storage.putMemory(session.meta.id, 'existing memory')

    const fn = vi.fn<ConsolidateFn>(async (mem, msgs) => `updated: ${mem} + ${msgs.length} msgs`)
    await session.consolidate(fn)

    expect(fn).toHaveBeenCalledWith('existing memory', expect.arrayContaining([
      expect.objectContaining({ content: 'msg1' }),
    ]))
  })

  it('consolidate 后 consolidatedTurn 等于 turnCount', async () => {
    const { session } = await makeSession()
    await session.consolidate(async () => 'mem')
    expect(session.meta.consolidatedTurn).toBe(session.meta.turnCount)
  })

  it('多次 consolidate 覆盖记忆', async () => {
    const { session } = await makeSession()
    await session.consolidate(async () => 'first')
    await session.consolidate(async () => 'second')
    expect(await session.memory()).toBe('second')
  })

  it('archived session 上调用 consolidate 抛错', async () => {
    const { session } = await makeSession()
    await session.archive()
    await expect(session.consolidate(async () => 'mem')).rejects.toThrow('archived')
  })
})
