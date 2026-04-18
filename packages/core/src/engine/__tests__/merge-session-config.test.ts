import { describe, it, expect } from 'vitest'
import type { LLMAdapter } from '@stello-ai/session'
import { mergeSessionConfig } from '../merge-session-config'
import type { ForkProfile } from '../fork-profile'
import type { SessionConfig } from '../../types/session-config'
import type { EngineForkOptions } from '../../types/engine'
import type {
  SessionCompatibleConsolidateFn,
  SessionCompatibleCompressFn,
} from '../../adapters/session-runtime'

// 构造测试用 LLMAdapter 探针
function makeLLM(tag: string): LLMAdapter {
  return {
    maxContextTokens: 1000,
    async complete() {
      return { content: tag }
    },
  }
}

// 构造测试用 consolidateFn 探针
function makeConsolidateFn(tag: string): SessionCompatibleConsolidateFn {
  const fn: SessionCompatibleConsolidateFn = async () => tag
  return fn
}

// 构造测试用 compressFn 探针
function makeCompressFn(tag: string): SessionCompatibleCompressFn {
  const fn: SessionCompatibleCompressFn = async () => tag
  return fn
}

describe('mergeSessionConfig', () => {
  it('空 baseline：仅 label 的 forkOptions 返回空配置', () => {
    const forkOptions: EngineForkOptions = { label: 'test' }
    const result = mergeSessionConfig({
      defaults: {},
      forkOptions,
    })
    expect(result.systemPrompt).toBeUndefined()
    expect(result.llm).toBeUndefined()
    expect(result.tools).toBeUndefined()
    expect(result.skills).toBeUndefined()
    expect(result.consolidateFn).toBeUndefined()
    expect(result.compressFn).toBeUndefined()
  })

  it('defaults → parent → profile → forkOptions 字段级覆盖', () => {
    const llmDefaults = makeLLM('defaults')
    const llmParent = makeLLM('parent')
    const llmProfile = makeLLM('profile')
    const llmFork = makeLLM('fork')

    const defaults: SessionConfig = { llm: llmDefaults }
    const parent: SessionConfig = { llm: llmParent }
    const profile: ForkProfile = { llm: llmProfile, systemPromptMode: 'preset' }
    const forkOptions: EngineForkOptions = { label: 't', llm: llmFork }

    const result = mergeSessionConfig({ defaults, parent, profile, forkOptions })
    expect(result.llm).toBe(llmFork)
  })

  it('profile 未定义某字段时 parent 值保留', () => {
    const llmParent = makeLLM('parent')
    const parent: SessionConfig = { llm: llmParent }
    const profile: ForkProfile = { systemPromptMode: 'preset' } // 无 llm
    const forkOptions: EngineForkOptions = { label: 't' } // 无 llm

    const result = mergeSessionConfig({ defaults: {}, parent, profile, forkOptions })
    expect(result.llm).toBe(llmParent)
  })

  it('defaults 提供值，上游均未覆盖时保留', () => {
    const consolidate = makeConsolidateFn('defaults-consolidate')
    const defaults: SessionConfig = { consolidateFn: consolidate }
    const forkOptions: EngineForkOptions = { label: 't' }

    const result = mergeSessionConfig({ defaults, forkOptions })
    expect(result.consolidateFn).toBe(consolidate)
  })

  it('每层独立贡献不同字段：最终结果汇聚', () => {
    const llmFork = makeLLM('fork')
    const compressParent = makeCompressFn('parent-compress')
    const consolidateDefaults = makeConsolidateFn('defaults-consolidate')

    const defaults: SessionConfig = { consolidateFn: consolidateDefaults }
    const parent: SessionConfig = { compressFn: compressParent }
    const profile: ForkProfile = { tools: [{ name: 'profile_tool', description: 'x', inputSchema: {} }] }
    const forkOptions: EngineForkOptions = { label: 't', llm: llmFork }

    const result = mergeSessionConfig({ defaults, parent, profile, forkOptions })
    expect(result.consolidateFn).toBe(consolidateDefaults)
    expect(result.compressFn).toBe(compressParent)
    expect(result.tools).toEqual([{ name: 'profile_tool', description: 'x', inputSchema: {} }])
    expect(result.llm).toBe(llmFork)
  })

  it('skills 整数组替换（不合并）', () => {
    const parent: SessionConfig = { skills: ['a', 'b'] }
    const profile: ForkProfile = { skills: ['c'] }
    const forkOptions: EngineForkOptions = { label: 't' }

    const result = mergeSessionConfig({ defaults: {}, parent, profile, forkOptions })
    expect(result.skills).toEqual(['c'])
  })

  it('skills 三态：profile 显式设 [] 覆盖 parent 非空', () => {
    const parent: SessionConfig = { skills: ['a', 'b'] }
    const profile: ForkProfile = { skills: [] }
    const forkOptions: EngineForkOptions = { label: 't' }

    const result = mergeSessionConfig({ defaults: {}, parent, profile, forkOptions })
    expect(result.skills).toEqual([])
  })

  it('skills 三态：profile undefined 时 parent skills 保留', () => {
    const parent: SessionConfig = { skills: ['a', 'b'] }
    const profile: ForkProfile = {} // skills 未定义
    const forkOptions: EngineForkOptions = { label: 't' }

    const result = mergeSessionConfig({ defaults: {}, parent, profile, forkOptions })
    expect(result.skills).toEqual(['a', 'b'])
  })

  it('skills 三态：forkOptions 显式设 [] 覆盖 profile 非空', () => {
    const profile: ForkProfile = { skills: ['a'] }
    const forkOptions: EngineForkOptions = { label: 't', skills: [] }

    const result = mergeSessionConfig({ defaults: {}, profile, forkOptions })
    expect(result.skills).toEqual([])
  })

  it('systemPrompt preset 模式：profile 完整替代 forkOptions', () => {
    const profile: ForkProfile = {
      systemPrompt: 'P',
      systemPromptMode: 'preset',
    }
    const forkOptions: EngineForkOptions = { label: 't', systemPrompt: 'F' }

    const result = mergeSessionConfig({ defaults: {}, profile, forkOptions })
    expect(result.systemPrompt).toBe('P')
  })

  it('systemPrompt prepend 模式（默认）：profile 在前 fork 在后', () => {
    const profile: ForkProfile = { systemPrompt: 'P' } // 默认 prepend
    const forkOptions: EngineForkOptions = { label: 't', systemPrompt: 'F' }

    const result = mergeSessionConfig({ defaults: {}, profile, forkOptions })
    expect(result.systemPrompt).toBe('P\n\nF')
  })

  it('systemPrompt append 模式：fork 在前 profile 在后', () => {
    const profile: ForkProfile = {
      systemPrompt: 'P',
      systemPromptMode: 'append',
    }
    const forkOptions: EngineForkOptions = { label: 't', systemPrompt: 'F' }

    const result = mergeSessionConfig({ defaults: {}, profile, forkOptions })
    expect(result.systemPrompt).toBe('F\n\nP')
  })

  it('systemPrompt：profile 无 prompt 时 forkOptions 胜出', () => {
    const profile: ForkProfile = { systemPromptMode: 'prepend' }
    const forkOptions: EngineForkOptions = { label: 't', systemPrompt: 'F' }

    const result = mergeSessionConfig({ defaults: {}, profile, forkOptions })
    expect(result.systemPrompt).toBe('F')
  })

  it('systemPrompt：forkOptions 无 prompt 时 profile 胜出', () => {
    const profile: ForkProfile = {
      systemPrompt: 'P',
      systemPromptMode: 'prepend',
    }
    const forkOptions: EngineForkOptions = { label: 't' }

    const result = mergeSessionConfig({ defaults: {}, profile, forkOptions })
    expect(result.systemPrompt).toBe('P')
  })

  it('systemPrompt：无 profile 时 defaults 提供的值贯穿', () => {
    const defaults: SessionConfig = { systemPrompt: 'D' }
    const forkOptions: EngineForkOptions = { label: 't' }

    const result = mergeSessionConfig({ defaults, forkOptions })
    expect(result.systemPrompt).toBe('D')
  })

  it('systemPrompt：无 profile 时 forkOptions 覆盖 defaults / parent', () => {
    const defaults: SessionConfig = { systemPrompt: 'D' }
    const parent: SessionConfig = { systemPrompt: 'Par' }
    const forkOptions: EngineForkOptions = { label: 't', systemPrompt: 'F' }

    const result = mergeSessionConfig({ defaults, parent, forkOptions })
    expect(result.systemPrompt).toBe('F')
  })

  it('systemPrompt：无 profile 时 parent 覆盖 defaults', () => {
    const defaults: SessionConfig = { systemPrompt: 'D' }
    const parent: SessionConfig = { systemPrompt: 'Par' }
    const forkOptions: EngineForkOptions = { label: 't' }

    const result = mergeSessionConfig({ defaults, parent, forkOptions })
    expect(result.systemPrompt).toBe('Par')
  })

  it('systemPrompt：systemPromptFn 优先于 systemPrompt 字段，按 prepend 合成', () => {
    const profile: ForkProfile = {
      systemPrompt: '静态',
      systemPromptFn: (vars) => `动态:${vars.x}`,
      systemPromptMode: 'prepend',
    }
    const forkOptions: EngineForkOptions = { label: 't', systemPrompt: 'F' }

    const result = mergeSessionConfig({
      defaults: {},
      profile,
      profileVars: { x: '42' },
      forkOptions,
    })
    expect(result.systemPrompt).toBe('动态:42\n\nF')
  })

  it('systemPrompt：profileVars 透传给 systemPromptFn', () => {
    const profile: ForkProfile = {
      systemPromptFn: (vars) => `region=${vars.region}`,
      systemPromptMode: 'preset',
    }
    const forkOptions: EngineForkOptions = { label: 't' }

    const result = mergeSessionConfig({
      defaults: {},
      profile,
      profileVars: { region: '北京' },
      forkOptions,
    })
    expect(result.systemPrompt).toBe('region=北京')
  })

  it('parent undefined（从 main session fork）时正常合成', () => {
    const profile: ForkProfile = {
      systemPrompt: 'P',
      systemPromptMode: 'preset',
    }
    const forkOptions: EngineForkOptions = { label: 't', systemPrompt: 'F' }

    const result = mergeSessionConfig({
      defaults: {},
      parent: undefined,
      profile,
      forkOptions,
    })
    expect(result.systemPrompt).toBe('P')
  })
})
