import { describe, it, expect } from 'vitest'
import { makeSession, createMockLLM } from './helpers.js'
import { createMainSession } from '../create-main-session.js'
import { InMemoryStorageAdapter } from '../mocks/in-memory-storage.js'
import { SessionArchivedError } from '../types/session-api.js'
import type { LLMResult, Message, LLMAdapter } from '../types/llm.js'

/** 创建带 maxContextTokens 的 mock LLM */
function createMockLLMWithContext(
  responses: LLMResult[],
  maxContextTokens: number,
): LLMAdapter {
  const base = createMockLLM(responses)
  return { ...base, maxContextTokens }
}

const simpleResponse: LLMResult = {
  content: 'OK',
  usage: { promptTokens: 100, completionTokens: 10 },
}

describe('trimRecords()', () => {
  it('保留最近 N 条，删除更早的记录', async () => {
    const { session, storage } = await makeSession()
    const id = session.meta.id
    await storage.appendRecord(id, { role: 'user', content: 'msg1' })
    await storage.appendRecord(id, { role: 'assistant', content: 'reply1' })
    await storage.appendRecord(id, { role: 'user', content: 'msg2' })
    await storage.appendRecord(id, { role: 'assistant', content: 'reply2' })

    await session.trimRecords(2)

    const messages = await session.messages()
    expect(messages).toHaveLength(2)
    expect(messages[0]!.content).toBe('msg2')
    expect(messages[1]!.content).toBe('reply2')
  })

  it('keepRecent 大于总数时无操作', async () => {
    const { session, storage } = await makeSession()
    await storage.appendRecord(session.meta.id, { role: 'user', content: 'msg1' })

    await session.trimRecords(10)
    expect(await session.messages()).toHaveLength(1)
  })

  it('keepRecent = 0 时清空所有记录', async () => {
    const { session, storage } = await makeSession()
    await storage.appendRecord(session.meta.id, { role: 'user', content: 'msg1' })
    await storage.appendRecord(session.meta.id, { role: 'assistant', content: 'reply1' })

    await session.trimRecords(0)
    expect(await session.messages()).toHaveLength(0)
  })

  it('负数 keepRecent 抛错', async () => {
    const { session } = await makeSession()
    await expect(session.trimRecords(-1)).rejects.toThrow('keepRecent must be a non-negative integer')
  })

  it('archived session 调用 trimRecords 抛错', async () => {
    const { session } = await makeSession()
    await session.archive()
    await expect(session.trimRecords(5)).rejects.toThrow(SessionArchivedError)
  })
})

describe('自动压缩 — Session', () => {
  it('未超阈值时全量回放所有 L3', async () => {
    const capturedMessages: Message[][] = []
    const llm = createMockLLMWithContext([simpleResponse, simpleResponse], 1_000_000)
    const origComplete = llm.complete.bind(llm)
    llm.complete = async (msgs) => {
      capturedMessages.push([...msgs])
      return origComplete(msgs)
    }

    const { session } = await makeSession({ llm })
    await session.send('msg1')
    await session.send('msg2')

    // 第二次 send：2 条 L3 + 当前用户消息 = 3
    const secondCall = capturedMessages[1]!
    expect(secondCall).toHaveLength(3)
    expect(secondCall[0]!.content).toBe('msg1')
    expect(secondCall[2]!.content).toBe('msg2')
  })

  it('超阈值且有 L2 时自动压缩：注入 L2 + 裁剪 L3', async () => {
    const capturedMessages: Message[][] = []
    const llm = createMockLLMWithContext([simpleResponse], 50)
    const origComplete = llm.complete.bind(llm)
    llm.complete = async (msgs) => {
      capturedMessages.push([...msgs])
      return origComplete(msgs)
    }

    const { session, storage } = await makeSession({ llm })
    const id = session.meta.id

    // 设置 L2
    await storage.putMemory(id, 'consolidated summary')
    // 添加大量 L3 历史
    for (let i = 0; i < 20; i++) {
      await storage.appendRecord(id, { role: 'user', content: `message number ${i} with some padding text` })
      await storage.appendRecord(id, { role: 'assistant', content: `reply number ${i} with some padding text` })
    }

    await session.send('new question')

    const call = capturedMessages[0]!
    // L2 应该作为 system 消息注入
    expect(call.some(m => m.role === 'system' && m.content === 'consolidated summary')).toBe(true)
    // 不应该包含全部 40 条 L3
    const nonSystemMsgs = call.filter(m => m.role !== 'system')
    expect(nonSystemMsgs.length).toBeLessThan(40)
    // 最后一条是当前用户消息
    expect(call[call.length - 1]!.content).toBe('new question')
  })

  it('超阈值但无 L2 时仍全量发送', async () => {
    const capturedMessages: Message[][] = []
    const llm = createMockLLMWithContext([simpleResponse], 50)
    const origComplete = llm.complete.bind(llm)
    llm.complete = async (msgs) => {
      capturedMessages.push([...msgs])
      return origComplete(msgs)
    }

    const { session, storage } = await makeSession({ llm })
    const id = session.meta.id

    for (let i = 0; i < 10; i++) {
      await storage.appendRecord(id, { role: 'user', content: `msg ${i} padding` })
      await storage.appendRecord(id, { role: 'assistant', content: `reply ${i} padding` })
    }

    await session.send('hello')

    const call = capturedMessages[0]!
    // 无 L2 → 全量：20 条 L3 + 1 当前 = 21
    expect(call).toHaveLength(21)
  })

  it('promptTokens 用于后续估算', async () => {
    const capturedMessages: Message[][] = []
    const responses: LLMResult[] = [
      { content: 'r1', usage: { promptTokens: 900, completionTokens: 50 } },
      { content: 'r2', usage: { promptTokens: 100, completionTokens: 10 } },
    ]
    const llm = createMockLLMWithContext(responses, 1000)
    const origComplete = llm.complete.bind(llm)
    llm.complete = async (msgs) => {
      capturedMessages.push([...msgs])
      return origComplete(msgs)
    }

    const { session, storage } = await makeSession({ llm })
    const id = session.meta.id
    await storage.putMemory(id, 'summary')

    // 第一次 send — 字符少，粗估不超阈值
    await session.send('short')

    // 第二次 send — lastPromptTokens=900，加上新消息估算超 80% of 1000
    await session.send('another message')

    const secondCall = capturedMessages[1]!
    // 第二次应该触发了压缩（L2 在上下文中）
    expect(secondCall.some(m => m.role === 'system' && m.content === 'summary')).toBe(true)
  })
})

describe('自动压缩 — MainSession', () => {
  it('超阈值时裁剪 L3（synthesis 保留）', async () => {
    const capturedMessages: Message[][] = []
    const storage = new InMemoryStorageAdapter()
    const llm = createMockLLMWithContext([simpleResponse], 50)
    const origComplete = llm.complete.bind(llm)
    llm.complete = async (msgs) => {
      capturedMessages.push([...msgs])
      return origComplete(msgs)
    }

    const mainSession = await createMainSession({ storage, llm })
    const id = mainSession.meta.id

    await storage.putMemory(id, 'global synthesis')
    for (let i = 0; i < 10; i++) {
      await storage.appendRecord(id, { role: 'user', content: `msg ${i} with padding` })
      await storage.appendRecord(id, { role: 'assistant', content: `reply ${i} with padding` })
    }

    await mainSession.send('new')

    const call = capturedMessages[0]!
    expect(call.some(m => m.content === 'global synthesis')).toBe(true)
    expect(call.length).toBeLessThan(22)
  })

  it('MainSession trimRecords 正常工作', async () => {
    const storage = new InMemoryStorageAdapter()
    const mainSession = await createMainSession({ storage })
    const id = mainSession.meta.id

    await storage.appendRecord(id, { role: 'user', content: 'a' })
    await storage.appendRecord(id, { role: 'assistant', content: 'b' })
    await storage.appendRecord(id, { role: 'user', content: 'c' })
    await storage.appendRecord(id, { role: 'assistant', content: 'd' })

    await mainSession.trimRecords(2)

    const msgs = await mainSession.messages()
    expect(msgs).toHaveLength(2)
    expect(msgs[0]!.content).toBe('c')
  })
})

describe('consolidate + 自动压缩工作流', () => {
  it('consolidate 后有 L2，后续可自动压缩', async () => {
    const responses: LLMResult[] = [
      { content: 'r1', usage: { promptTokens: 50, completionTokens: 10 } },
      { content: 'r2', usage: { promptTokens: 50, completionTokens: 10 } },
      { content: 'r3', usage: { promptTokens: 50, completionTokens: 10 } },
    ]
    const llm = createMockLLMWithContext(responses, 200)

    const { session } = await makeSession({ llm })



    await session.send('msg1')
    await session.send('msg2')

    // consolidate 生成 L2
    await session.consolidate(async (_mem, msgs) =>
      `Summary: ${msgs.length} messages`
    )

    // trim old L3
    await session.trimRecords(2)

    // 验证 L2 存在
    const l2 = await session.memory()
    expect(l2).toBe('Summary: 4 messages')

    // 验证 trim 后只剩 2 条
    const remaining = await session.messages()
    expect(remaining).toHaveLength(2)
  })
})
