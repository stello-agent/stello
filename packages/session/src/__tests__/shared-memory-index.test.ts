import { describe, it, expect } from 'vitest'
import { createSession } from '../create-session'
import { InMemoryStorageAdapter } from '../mocks/in-memory-storage'
import type { LLMAdapter, Message } from '../types/llm'

function makeLLM(): { adapter: LLMAdapter; lastMessages: () => Message[] } {
  let captured: Message[] = []
  const adapter: LLMAdapter = {
    async complete(messages) {
      captured = messages
      return { content: 'ok' }
    },
  }
  return { adapter, lastMessages: () => captured }
}

describe('shared memory index injection', () => {
  it('inserts shared memory index between systemPrompt and session_identity', async () => {
    const storage = new InMemoryStorageAdapter()
    const { adapter, lastMessages } = makeLLM()
    const session = await createSession({
      id: 's1',
      label: 'child',
      storage,
      llm: adapter,
    })
    await session.setSystemPrompt('SYS')
    await session.send('hello', { sharedMemoryIndex: '<shared_memory_index>\n- a: x\n</shared_memory_index>' })

    const msgs = lastMessages()
    const sysIdx = msgs.findIndex(m => m.role === 'system' && m.content === 'SYS')
    const memIdx = msgs.findIndex(m => m.role === 'system' && m.content.includes('<shared_memory_index>'))
    const idIdx  = msgs.findIndex(m => m.role === 'system' && m.content.includes('<session_identity>'))

    expect(sysIdx).toBeGreaterThanOrEqual(0)
    expect(memIdx).toBeGreaterThan(sysIdx)
    expect(idIdx).toBeGreaterThan(memIdx)
  })

  it('omits the slot when sharedMemoryIndex is undefined', async () => {
    const storage = new InMemoryStorageAdapter()
    const { adapter, lastMessages } = makeLLM()
    const session = await createSession({
      id: 's1',
      label: 'child',
      storage,
      llm: adapter,
    })
    await session.setSystemPrompt('SYS')
    await session.send('hello') // no options

    const msgs = lastMessages()
    expect(msgs.find(m => m.content.includes('<shared_memory_index>'))).toBeUndefined()
  })

  it('omits the slot when sharedMemoryIndex is empty string', async () => {
    const storage = new InMemoryStorageAdapter()
    const { adapter, lastMessages } = makeLLM()
    const session = await createSession({
      id: 's1',
      label: 'child',
      storage,
      llm: adapter,
    })
    await session.send('hi', { sharedMemoryIndex: '' })

    const msgs = lastMessages()
    expect(msgs.find(m => m.content.includes('<shared_memory_index>'))).toBeUndefined()
  })
})
