import { describe, it, expect } from 'vitest'
import { adaptSessionToEngineRuntime } from '../adapters/session-runtime'
import { InMemorySharedMemoryStore } from '../shared-memory/in-memory-shared-memory-store'
import { renderSharedMemoryContext } from '../shared-memory/render-shared-memory'
import type {
  SessionCompatible,
  SessionCompatibleSendOptions,
  SessionCompatibleSendResult,
} from '../adapters/session-runtime'

function makeFakeSession(): {
  session: SessionCompatible
  capturedOptions: SessionCompatibleSendOptions[]
} {
  const capturedOptions: SessionCompatibleSendOptions[] = []
  const session: SessionCompatible = {
    meta: { id: 'r', status: 'active' },
    async send(_input, options) {
      capturedOptions.push(options ?? {})
      const result: SessionCompatibleSendResult = { content: 'ok' }
      return result
    },
    stream(_input, options) {
      capturedOptions.push(options ?? {})
      return {
        result: Promise.resolve({ content: 'ok' }),
        async *[Symbol.asyncIterator]() {},
      }
    },
    async messages() {
      return []
    },
    async consolidate() {
      // no-op
    },
    setTools() {
      // no-op
    },
  }
  return { session, capturedOptions }
}

describe('shared memory end-to-end', () => {
  it('adapter injects current context on every send', async () => {
    const store = new InMemorySharedMemoryStore()
    const { session, capturedOptions } = makeFakeSession()
    const runtime = await adaptSessionToEngineRuntime(session, {
      sharedMemoryContextProvider: () => renderSharedMemoryContext(store),
    })

    // first send — store empty, no context
    await runtime.send('hi', {})
    expect(capturedOptions[0]!.sharedMemoryContext).toBeUndefined()

    // write one entry
    await store.upsert('a', 'BODY')

    // second send — context present
    await runtime.send('hi again', {})
    expect(capturedOptions[1]!.sharedMemoryContext).toBeDefined()
    expect(capturedOptions[1]!.sharedMemoryContext).toContain('<shared_memory>')
    expect(capturedOptions[1]!.sharedMemoryContext).toContain('## a')
    expect(capturedOptions[1]!.sharedMemoryContext).toContain('BODY')

    // delete the entry
    await store.remove('a')

    // third send — back to undefined
    await runtime.send('hi once more', {})
    expect(capturedOptions[2]!.sharedMemoryContext).toBeUndefined()
  })
})
