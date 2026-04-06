import { describe, it, expect } from 'vitest'
import { ForkProfileRegistryImpl, resolveSystemPrompt } from '../fork-profile'
import type { ForkProfile } from '../fork-profile'

describe('ForkProfileRegistryImpl', () => {
  it('注册并获取 profile', () => {
    const registry = new ForkProfileRegistryImpl()
    const profile: ForkProfile = {
      systemPrompt: '你是研究助手',
      systemPromptMode: 'prepend',
    }
    registry.register('research', profile)
    expect(registry.get('research')).toEqual(profile)
  })

  it('获取不存在的 profile 返回 undefined', () => {
    const registry = new ForkProfileRegistryImpl()
    expect(registry.get('nonexistent')).toBeUndefined()
  })

  it('列出所有已注册 profile 名', () => {
    const registry = new ForkProfileRegistryImpl()
    registry.register('a', { systemPromptMode: 'prepend' })
    registry.register('b', { systemPromptMode: 'preset' })
    expect(registry.listNames()).toEqual(['a', 'b'])
  })

  it('重复注册同名 profile 覆盖旧值', () => {
    const registry = new ForkProfileRegistryImpl()
    registry.register('x', { systemPrompt: 'old' })
    registry.register('x', { systemPrompt: 'new' })
    expect(registry.get('x')!.systemPrompt).toBe('new')
  })
})

describe('resolveSystemPrompt', () => {
  it('无 profile 时直接返回 LLM prompt', () => {
    expect(resolveSystemPrompt(undefined, 'llm prompt', undefined)).toBe('llm prompt')
  })

  it('无 profile 且无 LLM prompt 时返回 undefined', () => {
    expect(resolveSystemPrompt(undefined, undefined, undefined)).toBeUndefined()
  })

  it('preset 模式：profile prompt 优先，忽略 LLM prompt', () => {
    const profile: ForkProfile = {
      systemPrompt: '固定角色',
      systemPromptMode: 'preset',
    }
    expect(resolveSystemPrompt(profile, 'LLM 补充', undefined)).toBe('固定角色')
  })

  it('preset 模式：支持函数模板 + vars', () => {
    const profile: ForkProfile = {
      systemPrompt: (vars) => `你是${vars.region}专家`,
      systemPromptMode: 'preset',
    }
    expect(resolveSystemPrompt(profile, undefined, { region: '美国' }))
      .toBe('你是美国专家')
  })

  it('prepend 模式（默认）：profile 在前，LLM 在后', () => {
    const profile: ForkProfile = {
      systemPrompt: '角色定义',
      systemPromptMode: 'prepend',
    }
    expect(resolveSystemPrompt(profile, '上下文补充', undefined))
      .toBe('角色定义\n\n上下文补充')
  })

  it('prepend 模式：只有 profile 没有 LLM prompt', () => {
    const profile: ForkProfile = {
      systemPrompt: '角色定义',
      systemPromptMode: 'prepend',
    }
    expect(resolveSystemPrompt(profile, undefined, undefined)).toBe('角色定义')
  })

  it('prepend 模式：只有 LLM prompt 没有 profile prompt', () => {
    const profile: ForkProfile = {
      systemPromptMode: 'prepend',
    }
    expect(resolveSystemPrompt(profile, 'LLM 写的', undefined)).toBe('LLM 写的')
  })

  it('append 模式：LLM 在前，profile 在后', () => {
    const profile: ForkProfile = {
      systemPrompt: '约束条件',
      systemPromptMode: 'append',
    }
    expect(resolveSystemPrompt(profile, '角色定义', undefined))
      .toBe('角色定义\n\n约束条件')
  })

  it('默认 systemPromptMode 为 prepend', () => {
    const profile: ForkProfile = {
      systemPrompt: '前置',
    }
    expect(resolveSystemPrompt(profile, '后置', undefined))
      .toBe('前置\n\n后置')
  })
})
