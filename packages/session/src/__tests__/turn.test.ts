import { describe, it, expect } from 'vitest'
import { makeSession } from './helpers.js'
import { NotImplementedError, SessionArchivedError } from '../types/session-api.js'

/**
 * send/stream 契约测试 — RED phase
 *
 * 当前 send()/stream() 抛出 NotImplementedError。
 * - 验证"抛 NotImplementedError"的测试会通过
 * - 验证实际对话行为的测试标记为 todo
 */
describe('send() 契约', () => {
  describe('NotImplementedError（当前预期行为）', () => {
    it('调用 send() 抛出 NotImplementedError', async () => {
      const { session } = await makeSession()
      await expect(session.send('hello')).rejects.toThrow(NotImplementedError)
    })

    it('NotImplementedError 消息包含 send', async () => {
      const { session } = await makeSession()
      await expect(session.send('hello')).rejects.toThrow(/send/i)
    })
  })

  describe('SessionArchivedError（当前可验证）', () => {
    it('archived session 上调用 send() 抛 SessionArchivedError', async () => {
      const { session } = await makeSession()
      await session.archive()
      await expect(session.send('hello')).rejects.toThrow(SessionArchivedError)
    })
  })

  describe('TODO: 实现后补全的 send() 契约', () => {
    it.todo('send() 调用 LLMAdapter.complete')
    it.todo('send() 返回 SendResult，content 为 LLM 文本响应')
    it.todo('send() 自动存 L3（用户消息 + LLM 响应）')
    it.todo('send() 返回 toolCalls 时由上层决定后续')
    it.todo('send() 结束后触发 sent 事件')
  })
})

describe('stream() 契约', () => {
  describe('NotImplementedError（当前预期行为）', () => {
    it('调用 stream() 抛出 NotImplementedError', () => {
      // stream() 是同步返回，不需要 await
      const makeStream = async () => {
        const { session } = await makeSession()
        session.stream('hello')
      }
      expect(makeStream()).rejects.toThrow(NotImplementedError)
    })
  })

  describe('SessionArchivedError（当前可验证）', () => {
    it('archived session 上调用 stream() 抛 SessionArchivedError', async () => {
      const { session } = await makeSession()
      await session.archive()
      expect(() => session.stream('hello')).toThrow(SessionArchivedError)
    })
  })

  describe('TODO: 实现后补全的 stream() 契约', () => {
    it.todo('stream() 返回 AsyncIterable，逐 chunk 输出')
    it.todo('stream().result 在流结束后 resolve 为 SendResult')
    it.todo('stream 结束后自动存 L3')
    it.todo('LLMAdapter 无 stream 方法时退化为 complete + 单次 yield')
  })
})
