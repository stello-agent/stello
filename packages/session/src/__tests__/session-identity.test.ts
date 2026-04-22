import { describe, it, expect } from 'vitest'
import { makeSession, createMockLLM } from './helpers.js'
import type { LLMResult, Message } from '../types/llm.js'

describe('session identity (label) injection', () => {
  const simpleResponse: LLMResult = {
    content: 'ok',
    usage: { promptTokens: 10, completionTokens: 5 },
  }

  it('send 时在 systemPrompt 之后注入 <session_identity> system 消息', async () => {
    const captured: Message[][] = []
    const llm = createMockLLM([simpleResponse])
    const original = llm.complete.bind(llm)
    llm.complete = async (msgs) => {
      captured.push([...msgs])
      return original(msgs)
    }

    const { session } = await makeSession({
      llm,
      label: '战略规划',
      systemPrompt: '你是助手',
    })

    await session.send('你好')

    const call = captured[0]!
    expect(call[0]).toEqual({ role: 'system', content: '你是助手' })
    expect(call[1]!.role).toBe('system')
    expect(call[1]!.content).toBe('<session_identity>\n你当前在「战略规划」子会话中。\n</session_identity>')
  })

  it('无 systemPrompt 时 identity 作为首条 system 消息', async () => {
    const captured: Message[][] = []
    const llm = createMockLLM([simpleResponse])
    const original = llm.complete.bind(llm)
    llm.complete = async (msgs) => {
      captured.push([...msgs])
      return original(msgs)
    }

    const { session } = await makeSession({ llm, label: '调研分支' })
    await session.send('hi')

    const call = captured[0]!
    expect(call[0]!.role).toBe('system')
    expect(call[0]!.content).toBe('<session_identity>\n你当前在「调研分支」子会话中。\n</session_identity>')
  })

  it('identity 位于 insight 之前', async () => {
    const captured: Message[][] = []
    const llm = createMockLLM([simpleResponse])
    const original = llm.complete.bind(llm)
    llm.complete = async (msgs) => {
      captured.push([...msgs])
      return original(msgs)
    }

    const { session } = await makeSession({
      llm,
      label: '文书',
      systemPrompt: '你是顾问',
    })
    await session.setInsight('关注文书进度')
    await session.send('推进')

    const call = captured[0]!
    expect(call[0]!.content).toBe('你是顾问')
    expect(call[1]!.content).toContain('<session_identity>')
    expect(call[1]!.content).toContain('文书')
    expect(call[2]!.content).toBe('关注文书进度')
  })

  it('label 为空字符串时不注入', async () => {
    const captured: Message[][] = []
    const llm = createMockLLM([simpleResponse])
    const original = llm.complete.bind(llm)
    llm.complete = async (msgs) => {
      captured.push([...msgs])
      return original(msgs)
    }

    const { session } = await makeSession({
      llm,
      label: '',
      systemPrompt: '你是助手',
    })

    await session.send('hi')

    const call = captured[0]!
    expect(call.some((m) => m.role === 'system' && m.content.includes('<session_identity>'))).toBe(false)
  })
})
