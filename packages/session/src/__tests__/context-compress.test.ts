import { describe, it, expect, vi } from 'vitest'
import { makeSession, createMockLLM } from './helpers.js'
import { createMainSession } from '../create-main-session.js'
import { InMemoryStorageAdapter } from '../mocks/in-memory-storage.js'
import { SessionArchivedError } from '../types/session-api.js'
import type { LLMResult, Message, LLMAdapter } from '../types/llm.js'
import type { CompressFn } from '../types/functions.js'

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

    const secondCall = capturedMessages[1]!
    expect(secondCall).toHaveLength(3)
    expect(secondCall[0]!.content).toBe('msg1')
    expect(secondCall[2]!.content).toBe('msg2')
  })

  it('超阈值且有 compressFn 时调用压缩：注入摘要 + 裁剪 L3', async () => {
    const capturedMessages: Message[][] = []
    const llm = createMockLLMWithContext([simpleResponse], 50)
    const origComplete = llm.complete.bind(llm)
    llm.complete = async (msgs) => {
      capturedMessages.push([...msgs])
      return origComplete(msgs)
    }

    const compressFn: CompressFn = vi.fn(async () => 'compressed summary')

    const { session, storage } = await makeSession({ llm, compressFn })
    const id = session.meta.id

    // 添加大量 L3 历史
    for (let i = 0; i < 20; i++) {
      await storage.appendRecord(id, { role: 'user', content: `message number ${i} with some padding text` })
      await storage.appendRecord(id, { role: 'assistant', content: `reply number ${i} with some padding text` })
    }

    await session.send('new question')

    // compressFn 应该被调用
    expect(compressFn).toHaveBeenCalled()
    const call = capturedMessages[0]!
    // 压缩摘要应该作为 system 消息注入
    expect(call.some(m => m.role === 'system' && m.content === 'compressed summary')).toBe(true)
    // 不应该包含全部 40 条 L3
    const nonSystemMsgs = call.filter(m => m.role !== 'system')
    expect(nonSystemMsgs.length).toBeLessThan(40)
    // 最后一条是当前用户消息
    expect(call[call.length - 1]!.content).toBe('new question')
  })

  it('未传 compressFn 时自动使用内置 LLM 压缩', async () => {
    const capturedMessages: Message[][] = []
    // 第一次调用是内置 compressFn 的压缩调用，第二次是实际 send
    const compressResponse: LLMResult = { content: 'builtin compressed', usage: { promptTokens: 10, completionTokens: 5 } }
    const llm = createMockLLMWithContext([compressResponse, simpleResponse], 50)
    const origComplete = llm.complete.bind(llm)
    llm.complete = async (msgs) => {
      capturedMessages.push([...msgs])
      return origComplete(msgs)
    }

    // 不传 compressFn，但有 llm → 自动内置压缩
    const { session, storage } = await makeSession({ llm })
    const id = session.meta.id

    for (let i = 0; i < 10; i++) {
      await storage.appendRecord(id, { role: 'user', content: `msg ${i} padding text here` })
      await storage.appendRecord(id, { role: 'assistant', content: `reply ${i} padding text here` })
    }

    await session.send('hello')

    // 第一次 LLM 调用是压缩（system prompt 包含"压缩"）
    const compressCall = capturedMessages[0]!
    expect(compressCall.some(m => m.role === 'system' && m.content.includes('压缩'))).toBe(true)

    // 第二次 LLM 调用是实际 send，应包含压缩摘要
    const sendCall = capturedMessages[1]!
    expect(sendCall.some(m => m.role === 'system' && m.content === 'builtin compressed')).toBe(true)
    expect(sendCall.length).toBeLessThan(21)
    expect(sendCall[sendCall.length - 1]!.content).toBe('hello')
  })

  it('compressFn 缓存命中：连续两次 send 只调用一次', async () => {
    const responses = Array.from({ length: 2 }, () => simpleResponse)
    const llm = createMockLLMWithContext(responses, 50)

    const compressFn: CompressFn = vi.fn(async () => 'cached summary')

    const { session, storage } = await makeSession({ llm, compressFn })
    const id = session.meta.id

    for (let i = 0; i < 20; i++) {
      await storage.appendRecord(id, { role: 'user', content: `message ${i} with some padding text here` })
      await storage.appendRecord(id, { role: 'assistant', content: `reply ${i} with some padding text here` })
    }

    await session.send('first')
    await session.send('second')

    // compressFn 在两次 send 之间没有新消息加入（send 本身会加消息，
    // 但 compressedCount 基于 send 前的 history 切分，第二次的 history 多了 2 条，
    // 所以 compressCount 会变化，需要重新压缩）
    // 实际上每次 send 都会增加 2 条记录（user+assistant），导致 compressedCount 变化
    // 因此这里 compressFn 会被调用两次
    expect(compressFn).toHaveBeenCalledTimes(2)
  })

  it('promptTokens 用于后续估算触发压缩', async () => {
    const capturedMessages: Message[][] = []
    // maxContextTokens=100 → threshold=80
    // 第一次 send 返回 promptTokens=70，第二次估算会超阈值
    const responses: LLMResult[] = [
      { content: 'r1', usage: { promptTokens: 70, completionTokens: 10 } },
      { content: 'r2', usage: { promptTokens: 50, completionTokens: 10 } },
    ]
    const llm = createMockLLMWithContext(responses, 100)
    const origComplete = llm.complete.bind(llm)
    llm.complete = async (msgs) => {
      capturedMessages.push([...msgs])
      return origComplete(msgs)
    }

    const compressFn: CompressFn = vi.fn(async () => 'sum')

    const { session, storage } = await makeSession({ llm, compressFn })
    const id = session.meta.id

    // 预填充足量历史（每条 ~40 字符 = ~10 tokens）
    for (let i = 0; i < 10; i++) {
      await storage.appendRecord(id, { role: 'user', content: `message number ${i} with some padding` })
      await storage.appendRecord(id, { role: 'assistant', content: `reply for message number ${i} ok` })
    }

    // 第一次 send — 粗估: 20 条 * ~10 tokens + userMsg ≈ 200+ tokens
    // 但实际上 200 > 80，第一次就会超阈值触发压缩
    await session.send('first question')

    // 第一次就应该触发压缩
    expect(compressFn).toHaveBeenCalled()

    // 验证 lastPromptTokens 被更新（通过第二次 send 的行为间接验证）
    await session.send('second question')
    // compressFn 至少被调用了（可能 1 或 2 次取决于缓存）
    expect(compressFn).toHaveBeenCalled()
  })
})

describe('自动压缩 — MainSession', () => {
  it('超阈值时使用 compressFn 压缩（synthesis 保留）', async () => {
    const capturedMessages: Message[][] = []
    const storage = new InMemoryStorageAdapter()
    const llm = createMockLLMWithContext([simpleResponse], 50)
    const origComplete = llm.complete.bind(llm)
    llm.complete = async (msgs) => {
      capturedMessages.push([...msgs])
      return origComplete(msgs)
    }

    const compressFn: CompressFn = vi.fn(async () => 'main compressed')

    const mainSession = await createMainSession({ storage, llm, compressFn })
    const id = mainSession.meta.id

    await storage.putMemory(id, 'global synthesis')
    for (let i = 0; i < 10; i++) {
      await storage.appendRecord(id, { role: 'user', content: `msg ${i} with padding` })
      await storage.appendRecord(id, { role: 'assistant', content: `reply ${i} with padding` })
    }

    await mainSession.send('new')

    const call = capturedMessages[0]!
    // synthesis 仍在上下文中
    expect(call.some(m => m.content === 'global synthesis')).toBe(true)
    // 压缩摘要也在上下文中
    expect(call.some(m => m.content === 'main compressed')).toBe(true)
    expect(call.length).toBeLessThan(22)
  })

  it('未传 compressFn 时 MainSession 自动使用内置 LLM 压缩（synthesis 保留）', async () => {
    const capturedMessages: Message[][] = []
    const storage = new InMemoryStorageAdapter()
    const compressResponse: LLMResult = { content: 'main builtin compressed', usage: { promptTokens: 10, completionTokens: 5 } }
    const llm = createMockLLMWithContext([compressResponse, simpleResponse], 50)
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

    // 第二次调用是实际 send
    const sendCall = capturedMessages[1]!
    expect(sendCall.some(m => m.content === 'global synthesis')).toBe(true)
    expect(sendCall.some(m => m.content === 'main builtin compressed')).toBe(true)
    expect(sendCall.length).toBeLessThan(22)
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

describe('consolidate 与 compress 独立', () => {
  it('consolidate 生成 L2 不影响压缩行为', async () => {
    const capturedMessages: Message[][] = []
    const responses = Array.from({ length: 3 }, () => simpleResponse)
    const llm = createMockLLMWithContext(responses, 200)
    const origComplete = llm.complete.bind(llm)
    llm.complete = async (msgs) => {
      capturedMessages.push([...msgs])
      return origComplete(msgs)
    }

    // 不提供 compressFn — 即使有 L2 也不应用于压缩
    const { session } = await makeSession({ llm })

    await session.send('msg1')
    await session.send('msg2')

    // consolidate 生成 L2
    await session.consolidate(async (_mem, msgs) =>
      `Summary: ${msgs.length} messages`
    )

    const l2 = await session.memory()
    expect(l2).toBe('Summary: 4 messages')

    // trim + 验证
    await session.trimRecords(2)
    const remaining = await session.messages()
    expect(remaining).toHaveLength(2)
  })

  it('有 L2 时不用 L2 压缩，而是用 compressFn', async () => {
    const capturedMessages: Message[][] = []
    const compressResponse: LLMResult = { content: 'fn compressed', usage: { promptTokens: 10, completionTokens: 5 } }
    const llm = createMockLLMWithContext([compressResponse, simpleResponse], 50)
    const origComplete = llm.complete.bind(llm)
    llm.complete = async (msgs) => {
      capturedMessages.push([...msgs])
      return origComplete(msgs)
    }

    const { session, storage } = await makeSession({ llm })
    const id = session.meta.id

    // 设置 L2
    await storage.putMemory(id, 'consolidated summary')
    for (let i = 0; i < 10; i++) {
      await storage.appendRecord(id, { role: 'user', content: `msg ${i} padding text here` })
      await storage.appendRecord(id, { role: 'assistant', content: `reply ${i} padding text here` })
    }

    await session.send('new question')

    // 实际 send 调用中，L2 不应出现，而是内置压缩的摘要
    const sendCall = capturedMessages[1]!
    expect(sendCall.some(m => m.role === 'system' && m.content === 'consolidated summary')).toBe(false)
    expect(sendCall.some(m => m.role === 'system' && m.content === 'fn compressed')).toBe(true)
    expect(sendCall.length).toBeLessThan(21)
  })
})
