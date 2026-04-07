import { describe, it, expectTypeOf } from 'vitest'
import type { CreateSessionOptions } from '../types/session'
import type { EngineForkOptions } from '../types/engine'

describe('CreateSessionOptions 类型（纯拓扑）', () => {
  it('只包含拓扑字段', () => {
    expectTypeOf<CreateSessionOptions>().toHaveProperty('parentId')
    expectTypeOf<CreateSessionOptions>().toHaveProperty('label')
  })

  it('所有可选字段确实可选', () => {
    const minimal: CreateSessionOptions = { parentId: 'p', label: 'test' }
    expectTypeOf(minimal).toMatchTypeOf<CreateSessionOptions>()
  })
})

describe('EngineForkOptions 类型', () => {
  it('包含 fork 选项字段', () => {
    expectTypeOf<EngineForkOptions>().toHaveProperty('label')
    expectTypeOf<EngineForkOptions>().toHaveProperty('systemPrompt')
    expectTypeOf<EngineForkOptions>().toHaveProperty('prompt')
    expectTypeOf<EngineForkOptions>().toHaveProperty('context')
    expectTypeOf<EngineForkOptions>().toHaveProperty('llm')
    expectTypeOf<EngineForkOptions>().toHaveProperty('tools')
    expectTypeOf<EngineForkOptions>().toHaveProperty('topologyParentId')
  })
})
