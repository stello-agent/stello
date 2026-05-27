import { describe, it, expect } from 'vitest'
import { assembleSessionContext } from '../context-utils.js'
import { createSession } from '../create-session'
import { InMemoryStorageAdapter } from '../mocks/in-memory-storage'
import type { SessionStorage } from '../types/storage.js'
import type { LLMAdapter, Message } from '../types/llm'

function makeStorage(overrides: Partial<SessionStorage> = {}): SessionStorage {
  return {
    getSystemPrompt: async () => 'SP',
    getInsight: async () => null,
    listRecords: async () => [],
    putRecords: async () => {},
    putSystemPrompt: async () => {},
    putInsight: async () => {},
    clearInsight: async () => {},
    getMemory: async () => null,
    putMemory: async () => {},
    ...overrides,
  } as unknown as SessionStorage
}

describe('assembleSessionContext with topologyContext', () => {
  it('injects topologyContext as a system message after sharedMemoryContext', async () => {
    const storage = makeStorage()
    const result = await assembleSessionContext(
      's1',
      storage,
      'hello',
      { compressFn: async () => '', maxContextTokens: 100000, compressionCache: null, lastPromptTokens: null },
      undefined,
      'SHARED',
      '<topology>TOP</topology>',
    )
    const systemContents = result.messages.filter(m => m.role === 'system').map(m => m.content)
    expect(systemContents).toContain('<topology>TOP</topology>')
    const idxShared = systemContents.indexOf('SHARED')
    const idxTopo = systemContents.indexOf('<topology>TOP</topology>')
    expect(idxShared).toBeGreaterThanOrEqual(0)
    expect(idxTopo).toBeGreaterThan(idxShared)
  })

  it('skips topologyContext system message when undefined', async () => {
    const storage = makeStorage()
    const result = await assembleSessionContext(
      's1',
      storage,
      'hello',
      { compressFn: async () => '', maxContextTokens: 100000, compressionCache: null, lastPromptTokens: null },
    )
    const contents = result.messages.filter(m => m.role === 'system').map(m => m.content)
    expect(contents.every(c => !c.includes('<topology>'))).toBe(true)
  })

  it('skips topologyContext system message when empty string', async () => {
    const storage = makeStorage()
    const result = await assembleSessionContext(
      's1', storage, 'hello',
      { compressFn: async () => '', maxContextTokens: 100000, compressionCache: null, lastPromptTokens: null },
      undefined, undefined, '',
    )
    const contents = result.messages.filter(m => m.role === 'system').map(m => m.content)
    expect(contents.every(c => !c.includes('<topology>'))).toBe(true)
  })
})

function makeCapturingLLM(responses: Array<{ content: string; toolCalls?: Array<{ id: string; name: string; input: Record<string, unknown> }> }>): { adapter: LLMAdapter; calls: () => Message[][] } {
  const captured: Message[][] = []
  let i = 0
  const adapter: LLMAdapter = {
    async complete(messages) {
      captured.push(messages.map((m) => ({ ...m })))
      const r = responses[i++] ?? { content: 'ok' }
      return { content: r.content, toolCalls: r.toolCalls }
    },
    maxContextTokens: 1_000_000,
  }
  return { adapter, calls: () => captured }
}

describe('topologyContext in tool-result replay path', () => {
  it('injects topologyContext as a system message in the replay continuation', async () => {
    const { adapter, calls } = makeCapturingLLM([
      { content: '', toolCalls: [{ id: 'tc_1', name: 'search', input: { q: 'x' } }] },
      { content: 'final' },
    ])
    const storage = new InMemoryStorageAdapter()
    const session = await createSession({
      id: 's1',
      label: 'child',
      storage,
      llm: adapter,
    })
    await session.setSystemPrompt('SYS')

    // 1st turn: user message + assistant tool call
    await session.send('do search', {
      sharedMemoryContext: '<shared_memory>mem</shared_memory>',
      topologyContext: '<topology>TOP</topology>',
    })

    // 2nd turn: tool-result envelope — triggers replay path
    await session.send(JSON.stringify({
      toolResults: [{
        toolCallId: 'tc_1',
        toolName: 'search',
        args: { q: 'x' },
        success: true,
        data: { hits: 1 },
        error: null,
      }],
    }), {
      sharedMemoryContext: '<shared_memory>mem</shared_memory>',
      topologyContext: '<topology>TOP</topology>',
    })

    const replayCall = calls()[1]!
    const systemContents = replayCall.filter(m => m.role === 'system').map(m => m.content)

    // topologyContext must appear
    expect(systemContents).toContain('<topology>TOP</topology>')

    // Slot order: sysPrompt → sharedMemory → topology → session_identity
    const idxSys = systemContents.indexOf('SYS')
    const idxShared = systemContents.findIndex(c => c.includes('<shared_memory>'))
    const idxTopo = systemContents.indexOf('<topology>TOP</topology>')
    const idxIdent = systemContents.findIndex(c => c.includes('<session_identity>'))

    expect(idxSys).toBeGreaterThanOrEqual(0)
    expect(idxShared).toBeGreaterThan(idxSys)
    expect(idxTopo).toBeGreaterThan(idxShared)
    expect(idxIdent).toBeGreaterThan(idxTopo)
  })

  it('omits the topology slot in replay when topologyContext is undefined', async () => {
    const { adapter, calls } = makeCapturingLLM([
      { content: '', toolCalls: [{ id: 'tc_1', name: 'search', input: {} }] },
      { content: 'final' },
    ])
    const storage = new InMemoryStorageAdapter()
    const session = await createSession({
      id: 's1',
      label: 'child',
      storage,
      llm: adapter,
    })

    await session.send('do search')
    await session.send(JSON.stringify({
      toolResults: [{
        toolCallId: 'tc_1',
        toolName: 'search',
        args: {},
        success: true,
        data: null,
        error: null,
      }],
    }))

    const replayCall = calls()[1]!
    expect(replayCall.find(m => m.role === 'system' && m.content.includes('<topology>'))).toBeUndefined()
  })

  it('omits the topology slot in replay when topologyContext is empty string', async () => {
    const { adapter, calls } = makeCapturingLLM([
      { content: '', toolCalls: [{ id: 'tc_1', name: 'search', input: {} }] },
      { content: 'final' },
    ])
    const storage = new InMemoryStorageAdapter()
    const session = await createSession({
      id: 's1',
      label: 'child',
      storage,
      llm: adapter,
    })

    await session.send('do search', { topologyContext: '' })
    await session.send(JSON.stringify({
      toolResults: [{
        toolCallId: 'tc_1',
        toolName: 'search',
        args: {},
        success: true,
        data: null,
        error: null,
      }],
    }), { topologyContext: '' })

    const replayCall = calls()[1]!
    expect(replayCall.find(m => m.role === 'system' && m.content.includes('<topology>'))).toBeUndefined()
  })
})
