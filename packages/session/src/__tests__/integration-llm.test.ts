import { describe, it, expect } from 'vitest'
import { createSession } from '../create-session.js'
import { createMainSession } from '../create-main-session.js'
import { InMemoryStorageAdapter } from '../mocks/in-memory-storage.js'
import { createOpenAICompatibleAdapter } from '../adapters/openai-compatible.js'
import { createAnthropicAdapter } from '../adapters/anthropic.js'
import type { LLMAdapter } from '../types/llm.js'

/** 共享的集成测试用例，adapter 无关 */
function defineLLMTests(getLLM: () => LLMAdapter) {
  it('单轮对话：send() 返回非空内容并存 L3', async () => {
    const storage = new InMemoryStorageAdapter()
    const session = await createSession({
      storage,
      llm: getLLM(),
      systemPrompt: '你是一个简洁的助手，用一句话回答问题',
    })

    const result = await session.send('1+1等于几？')
    console.log('[Session 单轮] content:', result.content)
    console.log('[Session 单轮] usage:', result.usage)

    expect(result.content).toBeTruthy()
    expect(result.usage).toBeDefined()

    const messages = await session.messages()
    expect(messages).toHaveLength(2)
    expect(messages[0]!.role).toBe('user')
    expect(messages[1]!.role).toBe('assistant')
  }, 30_000)

  it('多轮对话：连续 send 两次，L3 有 4 条记录', async () => {
    const storage = new InMemoryStorageAdapter()
    const session = await createSession({
      storage,
      llm: getLLM(),
      systemPrompt: '你是一个简洁的助手，用一句话回答问题',
    })

    const r1 = await session.send('我叫小明')
    console.log('[Session 多轮] turn1:', r1.content)
    const result = await session.send('我叫什么名字？')
    console.log('[Session 多轮] turn2:', result.content)

    expect(result.content).toBeTruthy()

    const messages = await session.messages()
    expect(messages).toHaveLength(4)
    expect(messages[0]!.role).toBe('user')
    expect(messages[1]!.role).toBe('assistant')
    expect(messages[2]!.role).toBe('user')
    expect(messages[3]!.role).toBe('assistant')
  }, 60_000)
}

/** MainSession 集成测试用例 */
function defineMainSessionLLMTests(getLLM: () => LLMAdapter) {
  it('MainSession 单轮对话：send() 返回非空内容并存 L3', async () => {
    const storage = new InMemoryStorageAdapter()
    const main = await createMainSession({
      storage,
      llm: getLLM(),
      systemPrompt: '你是一个简洁的助手，用一句话回答问题',
    })

    const result = await main.send('1+1等于几？')
    console.log('[MainSession 单轮] content:', result.content)
    console.log('[MainSession 单轮] usage:', result.usage)

    expect(result.content).toBeTruthy()
    expect(result.usage).toBeDefined()

    const messages = await main.messages()
    expect(messages).toHaveLength(2)
    expect(messages[0]!.role).toBe('user')
    expect(messages[1]!.role).toBe('assistant')
  }, 30_000)
}

// --- OpenAI 兼容协议（MiniMax / DeepSeek / OpenAI 等） ---

const openaiKey = process.env.OPENAI_API_KEY
const openaiModel = process.env.OPENAI_MODEL ?? 'gpt-4o-mini'
const openaiBaseURL = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1'

describe.skipIf(!openaiKey)('OpenAI 兼容集成测试', () => {
  let llm: LLMAdapter
  // 延迟创建，避免无 key 时 SDK 抛错
  if (openaiKey) {
    llm = createOpenAICompatibleAdapter({
      apiKey: openaiKey,
      model: openaiModel,
      maxContextTokens: 128_000,
      baseURL: openaiBaseURL,
    })
  }
  defineLLMTests(() => llm)
  defineMainSessionLLMTests(() => llm)
})

// --- Anthropic 原生协议 ---

const anthropicKey = process.env.ANTHROPIC_API_KEY
const anthropicModel = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-20250514'
const anthropicBaseURL = process.env.ANTHROPIC_BASE_URL

describe.skipIf(!anthropicKey)('Anthropic 集成测试', () => {
  let llm: LLMAdapter
  if (anthropicKey) {
    llm = createAnthropicAdapter({
      apiKey: anthropicKey,
      model: anthropicModel,
      maxContextTokens: 200_000,
      baseURL: anthropicBaseURL,
    })
  }
  defineLLMTests(() => llm)
  defineMainSessionLLMTests(() => llm)
})
