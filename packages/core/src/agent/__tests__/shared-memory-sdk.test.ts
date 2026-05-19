import { describe, it, expect } from 'vitest'
import { StelloAgent } from '../stello-agent'
import { InMemorySharedMemoryStore } from '../../shared-memory/in-memory-shared-memory-store'
import { SkillRouterImpl } from '../../skill/skill-router'
import { ToolRegistryImpl } from '../../tool/tool-registry'
import type { StelloAgentConfig } from '../stello-agent'
import type { SessionTree } from '../../types/session'
import type { EngineLifecycleAdapter } from '../../engine/stello-engine'
import type { ConfirmProtocol } from '../../types/lifecycle'

function makeAgent(sharedMemory?: InMemorySharedMemoryStore): StelloAgent {
  const config: StelloAgentConfig = {
    sessions: {
      createSession: async () => ({ id: 'r', label: 'r', parentId: null, status: 'active' }),
      listRoots:     async () => [],
      getTree:       async () => [],
      getNode:       async () => null,
      listAll:       async () => [],
      get:           async () => null,
      archive:       async () => undefined,
      addRef:        async () => undefined,
      updateMeta:    async () => undefined,
      getAncestors:  async () => [],
      getSiblings:   async () => [],
      getConfig:     async () => null,
      putConfig:     async () => undefined,
    } as unknown as SessionTree,
    capabilities: {
      lifecycle: {} as EngineLifecycleAdapter,
      tools: new ToolRegistryImpl(),
      skills: new SkillRouterImpl(),
      confirm: {} as ConfirmProtocol,
    },
    runtime: { resolver: { resolve: async () => ({} as never) } },
    ...(sharedMemory ? { sharedMemory } : {}),
  }
  return new StelloAgent(config)
}

describe('StelloAgent shared memory SDK', () => {
  it('exposes agent.sharedMemory when configured', () => {
    const store = new InMemorySharedMemoryStore()
    const agent = makeAgent(store)
    expect(agent.sharedMemory).toBe(store)
  })

  it('listSharedMemory returns [] when store is empty', async () => {
    const agent = makeAgent(new InMemorySharedMemoryStore())
    expect(await agent.listSharedMemory()).toEqual([])
  })

  it('upsertSharedMemoryEntry + listSharedMemory round-trip', async () => {
    const agent = makeAgent(new InMemorySharedMemoryStore())
    await agent.upsertSharedMemoryEntry('a', 'sa', 'ba')
    await agent.upsertSharedMemoryEntry('b', 'sb', 'bb')
    expect(await agent.listSharedMemory()).toEqual([
      { slug: 'a', summary: 'sa', body: 'ba' },
      { slug: 'b', summary: 'sb', body: 'bb' },
    ])
  })

  it('getSharedMemoryEntry returns null when missing, entry when present', async () => {
    const agent = makeAgent(new InMemorySharedMemoryStore())
    expect(await agent.getSharedMemoryEntry('a')).toBeNull()
    await agent.upsertSharedMemoryEntry('a', 'sa', 'ba')
    expect(await agent.getSharedMemoryEntry('a')).toEqual({ slug: 'a', summary: 'sa', body: 'ba' })
  })

  it('removeSharedMemoryEntry deletes the entry', async () => {
    const agent = makeAgent(new InMemorySharedMemoryStore())
    await agent.upsertSharedMemoryEntry('a', 'sa', 'ba')
    await agent.removeSharedMemoryEntry('a')
    expect(await agent.getSharedMemoryEntry('a')).toBeNull()
  })

  it('throws "sharedMemory not configured" when store is absent', async () => {
    const agent = makeAgent(undefined)
    await expect(agent.listSharedMemory()).rejects.toThrow(/sharedMemory not configured/)
    await expect(agent.getSharedMemoryEntry('a')).rejects.toThrow(/sharedMemory not configured/)
    await expect(agent.upsertSharedMemoryEntry('a', 's', 'b')).rejects.toThrow(/sharedMemory not configured/)
    await expect(agent.removeSharedMemoryEntry('a')).rejects.toThrow(/sharedMemory not configured/)
  })
})
