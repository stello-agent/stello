import { describe, it, expectTypeOf } from 'vitest'
import type { CreateSessionOptions } from '../types/session'

describe('CreateSessionOptions 类型', () => {
  it('包含 fork 选项字段', () => {
    expectTypeOf<CreateSessionOptions>().toHaveProperty('systemPrompt')
    expectTypeOf<CreateSessionOptions>().toHaveProperty('prompt')
    expectTypeOf<CreateSessionOptions>().toHaveProperty('context')
  })

  it('fork 选项字段全部可选', () => {
    const minimal: CreateSessionOptions = { parentId: 'p', label: 'test' }
    expectTypeOf(minimal).toMatchTypeOf<CreateSessionOptions>()
  })

  it('context 只接受 none 或 inherit', () => {
    const _opts: CreateSessionOptions = {
      parentId: 'p', label: 'test', context: 'inherit'
    }
    const _opts2: CreateSessionOptions = {
      parentId: 'p', label: 'test', context: 'none'
    }
    // @ts-expect-error - 不接受任意字符串
    const _bad: CreateSessionOptions['context'] = 'custom'
  })
})
