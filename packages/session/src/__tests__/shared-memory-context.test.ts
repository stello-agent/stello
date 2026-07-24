import { describe, it, expect } from 'vitest'
import { createSession } from '../create-session'
import { InMemoryStorageAdapter } from '../mocks/in-memory-storage'
import type { LLMAdapter, Message } from '../types/llm'

function makeLLM(): { adapter: LLMAdapter; lastMessages: () => Message[] } {
  let captured: Message[] = []
  const adapter: LLMAdapter = {
    async complete() {
      return { content: 'ok' }
    },
    async *stream(messages) {
      captured = messages
      yield { delta: 'ok' }
    },
    maxContextTokens: 1_000_000,
  }
  return { adapter, lastMessages: () => captured }
}

describe('shared memory context injection', () => {
  it('inserts shared memory context between systemPrompt and session_identity', async () => {
    const storage = new InMemoryStorageAdapter()
    const { adapter, lastMessages } = makeLLM()
    const session = await createSession({
      id: 's1',
      label: 'child',
      storage,
      llm: adapter,
    })
    await session.setSystemPrompt('SYS')
    await session.send('hello', {
      sharedMemoryContext: '<shared_memory>\n## a\nbody-a\n</shared_memory>',
    })

    const msgs = lastMessages()
    const sysIdx = msgs.findIndex(m => m.role === 'system' && m.content === 'SYS')
    const memIdx = msgs.findIndex(m => m.role === 'system' && m.content.includes('<shared_memory>'))
    const idIdx  = msgs.findIndex(m => m.role === 'system' && m.content.includes('<session_identity>'))

    expect(sysIdx).toBeGreaterThanOrEqual(0)
    expect(memIdx).toBeGreaterThan(sysIdx)
    expect(idIdx).toBeGreaterThan(memIdx)
  })

  it('omits the slot when sharedMemoryContext is undefined', async () => {
    const storage = new InMemoryStorageAdapter()
    const { adapter, lastMessages } = makeLLM()
    const session = await createSession({
      id: 's1',
      label: 'child',
      storage,
      llm: adapter,
    })
    await session.setSystemPrompt('SYS')
    await session.send('hello')

    const msgs = lastMessages()
    expect(msgs.find(m => m.content.includes('<shared_memory>'))).toBeUndefined()
  })

  it('omits the slot when sharedMemoryContext is empty string', async () => {
    const storage = new InMemoryStorageAdapter()
    const { adapter, lastMessages } = makeLLM()
    const session = await createSession({
      id: 's1',
      label: 'child',
      storage,
      llm: adapter,
    })
    await session.send('hi', { sharedMemoryContext: '' })

    const msgs = lastMessages()
    expect(msgs.find(m => m.content.includes('<shared_memory>'))).toBeUndefined()
  })
})
