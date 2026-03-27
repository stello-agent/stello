import { describe, it, expect } from 'vitest'
import { makeSession, createMockLLM } from './helpers.js'
import { createMainSession } from '../create-main-session.js'
import { InMemoryStorageAdapter } from '../mocks/in-memory-storage.js'
import { SessionArchivedError } from '../types/session-api.js'
import type { LLMResult, Message } from '../types/llm.js'
import type { CountTokensFn, ContextWindowOptions } from '../types/functions.js'

/** 简单的 token 计数：每条消息的内容长度之和 */
const charCounter: CountTokensFn = (msgs) =>
  msgs.reduce((sum, m) => sum + m.content.length, 0)

const simpleResponse: LLMResult = {
  content: 'OK',
  usage: { promptTokens: 10, completionTokens: 2 },
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

    const messages = await session.messages()
    expect(messages).toHaveLength(1)
  })

  it('keepRecent = 0 时清空所有记录', async () => {
    const { session, storage } = await makeSession()
    await storage.appendRecord(session.meta.id, { role: 'user', content: 'msg1' })
    await storage.appendRecord(session.meta.id, { role: 'assistant', content: 'reply1' })

    await session.trimRecords(0)

    const messages = await session.messages()
    expect(messages).toHaveLength(0)
  })

  it('空 session trimRecords 不报错', async () => {
    const { session } = await makeSession()
    await expect(session.trimRecords(5)).resolves.not.toThrow()
  })

  it('archived session 调用 trimRecords 抛错', async () => {
    const { session } = await makeSession()
    await session.archive()
    await expect(session.trimRecords(5)).rejects.toThrow(SessionArchivedError)
  })
})

describe('Session 上下文压缩', () => {
  it('无 contextWindow 时全量回放所有 L3', async () => {
    const capturedMessages: Message[][] = []
    const llm = createMockLLM([simpleResponse, simpleResponse])
    const origComplete = llm.complete.bind(llm)
    llm.complete = async (msgs) => {
      capturedMessages.push([...msgs])
      return origComplete(msgs)
    }

    const { session } = await makeSession({ llm })
    await session.send('msg1')
    await session.send('msg2')

    // 第二次 send：2 条 L3 历史(user+assistant) + 当前用户消息 = 3
    const secondCall = capturedMessages[1]!
    expect(secondCall).toHaveLength(3)
    expect(secondCall[0]!.content).toBe('msg1')
    expect(secondCall[1]!.content).toBe('OK')
    expect(secondCall[2]!.content).toBe('msg2')
  })

  it('配置 contextWindow 且有 L2 时注入 L2 并按预算裁剪 L3', async () => {
    const capturedMessages: Message[][] = []
    const llm = createMockLLM([simpleResponse])
    const origComplete = llm.complete.bind(llm)
    llm.complete = async (msgs) => {
      capturedMessages.push([...msgs])
      return origComplete(msgs)
    }

    const contextWindow: ContextWindowOptions = {
      maxContextTokens: 100,
      countTokens: charCounter,
    }

    const { session, storage } = await makeSession({ llm, contextWindow })
    const id = session.meta.id

    // 存入 L2
    await storage.putMemory(id, 'summary of past conversation')
    // 存入一些 L3 历史
    await storage.appendRecord(id, { role: 'user', content: 'old-message-that-is-very-long-and-should-be-trimmed-away' })
    await storage.appendRecord(id, { role: 'assistant', content: 'old-reply-also-long-enough-to-exceed-budget' })
    await storage.appendRecord(id, { role: 'user', content: 'recent' })
    await storage.appendRecord(id, { role: 'assistant', content: 'ok' })

    await session.send('new question')

    const call = capturedMessages[0]!
    // 应该包含: L2 (system) + 能放入预算的最近 L3 + 当前用户消息
    // L2 作为 system 消息应该在上下文中
    const systemMessages = call.filter(m => m.role === 'system')
    expect(systemMessages.some(m => m.content === 'summary of past conversation')).toBe(true)

    // 最后一条应该是当前用户消息
    expect(call[call.length - 1]!.content).toBe('new question')

    // 由于预算有限，不应包含所有 4 条 L3
    const totalL3 = call.filter(m => m.role !== 'system')
    // 至少包含当前用户消息
    expect(totalL3.length).toBeGreaterThanOrEqual(1)
    // 不应包含全部历史（否则超出预算）
    expect(totalL3.length).toBeLessThanOrEqual(4) // at most recent L3 + current
  })

  it('配置 contextWindow 但无 L2 时仍按预算裁剪 L3', async () => {
    const capturedMessages: Message[][] = []
    const llm = createMockLLM([simpleResponse])
    const origComplete = llm.complete.bind(llm)
    llm.complete = async (msgs) => {
      capturedMessages.push([...msgs])
      return origComplete(msgs)
    }

    const contextWindow: ContextWindowOptions = {
      maxContextTokens: 30, // very tight
      countTokens: charCounter,
    }

    const { session, storage } = await makeSession({ llm, contextWindow })
    const id = session.meta.id

    // 不设置 L2
    await storage.appendRecord(id, { role: 'user', content: 'aaaaaaaaaa' }) // 10 chars
    await storage.appendRecord(id, { role: 'assistant', content: 'bbbbbbbbbb' }) // 10 chars
    await storage.appendRecord(id, { role: 'user', content: 'cccc' }) // 4 chars
    await storage.appendRecord(id, { role: 'assistant', content: 'dddd' }) // 4 chars

    await session.send('hi') // 2 chars for user msg

    const call = capturedMessages[0]!
    // 预算 30，用户消息 2，剩余 28 给 L3
    // 应该只包含能装入预算的最近几条
    expect(call[call.length - 1]!.content).toBe('hi')
    // 不应包含 system 消息（无 L2、无 system prompt、无 insight）
    expect(call.filter(m => m.role === 'system')).toHaveLength(0)
  })

  it('预算极小时至少包含用户消息', async () => {
    const capturedMessages: Message[][] = []
    const llm = createMockLLM([simpleResponse])
    const origComplete = llm.complete.bind(llm)
    llm.complete = async (msgs) => {
      capturedMessages.push([...msgs])
      return origComplete(msgs)
    }

    const contextWindow: ContextWindowOptions = {
      maxContextTokens: 5, // barely enough for user msg
      countTokens: charCounter,
    }

    const { session, storage } = await makeSession({ llm, contextWindow })
    await storage.appendRecord(session.meta.id, { role: 'user', content: 'old message' })

    await session.send('hi')

    const call = capturedMessages[0]!
    // 应该至少有用户消息
    expect(call.length).toBeGreaterThanOrEqual(1)
    expect(call[call.length - 1]!.content).toBe('hi')
  })

  it('stream() 同样支持 contextWindow 压缩', async () => {
    const capturedMessages: Message[][] = []
    const llm = {
      async complete(msgs: Message[]) {
        capturedMessages.push([...msgs])
        return { content: 'streamed' }
      },
      async *stream(msgs: Message[]) {
        capturedMessages.push([...msgs])
        yield { delta: 'streamed' }
      },
    }

    const contextWindow: ContextWindowOptions = {
      maxContextTokens: 50,
      countTokens: charCounter,
    }

    const { session, storage } = await makeSession({ llm, contextWindow })
    const id = session.meta.id
    await storage.putMemory(id, 'L2 summary')
    await storage.appendRecord(id, { role: 'user', content: 'old msg very very long to exceed budget' })
    await storage.appendRecord(id, { role: 'assistant', content: 'old reply also very long to exceed budget' })

    const stream = session.stream('new')
    for await (const _ of stream) { void _ }
    await stream.result

    const call = capturedMessages[0]!
    // L2 应该在上下文中
    expect(call.some(m => m.role === 'system' && m.content === 'L2 summary')).toBe(true)
    expect(call[call.length - 1]!.content).toBe('new')
  })
})

describe('MainSession 上下文压缩', () => {
  it('MainSession 配置 contextWindow 后按预算裁剪 L3', async () => {
    const capturedMessages: Message[][] = []
    const storage = new InMemoryStorageAdapter()
    const llm = createMockLLM([simpleResponse])
    const origComplete = llm.complete.bind(llm)
    llm.complete = async (msgs) => {
      capturedMessages.push([...msgs])
      return origComplete(msgs)
    }

    const contextWindow: ContextWindowOptions = {
      maxContextTokens: 80,
      countTokens: charCounter,
    }

    const mainSession = await createMainSession({
      storage,
      llm,
      contextWindow,
      systemPrompt: 'you are main',
    })

    const id = mainSession.meta.id
    // 设置 synthesis
    await storage.putMemory(id, 'global synthesis')
    // 添加长 L3 历史
    await storage.appendRecord(id, { role: 'user', content: 'very long old message that should be trimmed' })
    await storage.appendRecord(id, { role: 'assistant', content: 'very long old reply that should be trimmed' })
    await storage.appendRecord(id, { role: 'user', content: 'recent' })
    await storage.appendRecord(id, { role: 'assistant', content: 'ok' })

    await mainSession.send('hello')

    const call = capturedMessages[0]!
    // system prompt 和 synthesis 都应在上下文中
    expect(call[0]!.content).toBe('you are main')
    expect(call[1]!.content).toBe('global synthesis')
    // 最后是当前用户消息
    expect(call[call.length - 1]!.content).toBe('hello')
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
    expect(msgs[1]!.content).toBe('d')
  })
})

describe('trimRecords 边界条件', () => {
  it('负数 keepRecent 抛错', async () => {
    const { session } = await makeSession()
    await expect(session.trimRecords(-1)).rejects.toThrow('keepRecent must be a non-negative integer')
  })
})

describe('上下文预算边界', () => {
  it('固定部分已超预算时仍发送固定消息（不含 L3）', async () => {
    const capturedMessages: Message[][] = []
    const llm = createMockLLM([simpleResponse])
    const origComplete = llm.complete.bind(llm)
    llm.complete = async (msgs) => {
      capturedMessages.push([...msgs])
      return origComplete(msgs)
    }

    const contextWindow: ContextWindowOptions = {
      maxContextTokens: 10, // system prompt + user msg 就超了
      countTokens: charCounter,
    }

    const { session, storage } = await makeSession({
      llm,
      contextWindow,
      systemPrompt: 'a very long system prompt that exceeds budget',
    })
    await storage.appendRecord(session.meta.id, { role: 'user', content: 'old msg' })

    await session.send('hi')

    const call = capturedMessages[0]!
    // 固定消息（system prompt + user msg）应该在，L3 不应在
    expect(call[0]!.content).toBe('a very long system prompt that exceeds budget')
    expect(call[call.length - 1]!.content).toBe('hi')
    // 不应包含旧的 L3
    expect(call.find(m => m.content === 'old msg')).toBeUndefined()
  })
})

describe('consolidate + trimRecords 工作流', () => {
  it('consolidate 生成 L2 后 trimRecords 裁剪旧 L3，后续 send 使用 L2 + 最近 L3', async () => {
    const capturedMessages: Message[][] = []
    const llm = createMockLLM([simpleResponse, simpleResponse, simpleResponse])
    const origComplete = llm.complete.bind(llm)
    llm.complete = async (msgs) => {
      capturedMessages.push([...msgs])
      return origComplete(msgs)
    }

    const contextWindow: ContextWindowOptions = {
      maxContextTokens: 200,
      countTokens: charCounter,
    }

    const { session } = await makeSession({ llm, contextWindow })

    // 模拟几轮对话
    await session.send('msg1')
    await session.send('msg2')

    // consolidate 生成 L2
    await session.consolidate(async (_mem, msgs) => {
      return `Summary: ${msgs.length} messages consolidated`
    })

    // 验证 L2 已生成
    const l2 = await session.memory()
    expect(l2).toBe('Summary: 4 messages consolidated')

    // 裁剪旧 L3，只保留最近 2 条
    await session.trimRecords(2)
    const remaining = await session.messages()
    expect(remaining).toHaveLength(2)

    // 再次 send — 上下文应包含 L2 + 最近 L3 + 当前消息
    await session.send('msg3')

    const lastCall = capturedMessages[2]!
    // L2 作为 system 消息
    expect(lastCall.some(m =>
      m.role === 'system' && m.content.includes('Summary:')
    )).toBe(true)
    // 最后是当前用户消息
    expect(lastCall[lastCall.length - 1]!.content).toBe('msg3')
  })
})
