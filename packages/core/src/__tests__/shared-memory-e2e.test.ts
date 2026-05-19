import { describe, it, expect } from 'vitest'
import { adaptSessionToEngineRuntime } from '../adapters/session-runtime'
import { InMemorySharedMemoryStore } from '../shared-memory/in-memory-shared-memory-store'
import { renderSharedMemoryIndex } from '../shared-memory/render-index'
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
  it('adapter injects current index on every send', async () => {
    const store = new InMemorySharedMemoryStore()
    const { session, capturedOptions } = makeFakeSession()
    const runtime = await adaptSessionToEngineRuntime(session, {
      sharedMemoryIndexProvider: () => renderSharedMemoryIndex(store),
    })

    // first send — store empty, no index
    await runtime.send('hi', {})
    expect(capturedOptions[0]!.sharedMemoryIndex).toBeUndefined()

    // write one entry
    await store.upsert('a', 'sa', 'BODY')

    // second send — index present
    await runtime.send('hi again', {})
    expect(capturedOptions[1]!.sharedMemoryIndex).toBeDefined()
    expect(capturedOptions[1]!.sharedMemoryIndex).toContain('<shared_memory_index>')
    expect(capturedOptions[1]!.sharedMemoryIndex).toContain('- a: sa')

    // delete the entry
    await store.remove('a')

    // third send — back to undefined
    await runtime.send('hi once more', {})
    expect(capturedOptions[2]!.sharedMemoryIndex).toBeUndefined()
  })
})
