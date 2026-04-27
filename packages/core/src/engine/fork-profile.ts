import type { ForkContextFn } from '@stello-ai/session'
import type { SessionConfig } from '../types/session-config'

/**
 * Fork Profile — 预注册的 fork 配置模板
 *
 * 继承 SessionConfig 的字段（systemPrompt/llm/tools/skills/consolidateFn/compressFn），
 * 另加 fork 专属的合成策略（systemPromptMode）、上下文策略（context）、开场消息（prompt），
 * 以及 systemPrompt 的动态模板函数（systemPromptFn，优先于 systemPrompt 字段）。
 */
export interface ForkProfile extends SessionConfig {
  /** systemPrompt 动态模板函数（优先于 SessionConfig.systemPrompt 字段） */
  systemPromptFn?: (vars: Record<string, string>) => string
  /**
   * systemPrompt 合成策略：
   * - 'preset': profile 提供完整 prompt，忽略 fork options 的 systemPrompt
   * - 'prepend': profile prompt 在前，fork options 的 systemPrompt 在后（默认）
   * - 'append': fork options 的 systemPrompt 在前，profile prompt 在后
   */
  systemPromptMode?: 'preset' | 'prepend' | 'append'
  /** 上下文继承策略（与 EngineForkOptions.context 一致） */
  context?: 'none' | 'inherit' | 'compress' | ForkContextFn
  /** 子会话的首条 assistant 开场消息（profile 级默认，可被 EngineForkOptions.prompt 覆盖） */
  prompt?: string
}

/**
 * ForkProfile 注册表
 *
 * Engine 通过此接口查找 LLM 请求的 profile。
 */
export interface ForkProfileRegistry {
  /** 注册一个 profile */
  register(name: string, profile: ForkProfile): void
  /** 按名称获取 profile */
  get(name: string): ForkProfile | undefined
  /** 是否已注册指定 profile */
  has(name: string): boolean
  /** 列出所有已注册 profile 名 */
  listNames(): string[]
}

/** ForkProfileRegistry 默认实现 */
export class ForkProfileRegistryImpl implements ForkProfileRegistry {
  private readonly profiles = new Map<string, ForkProfile>()

  register(name: string, profile: ForkProfile): void {
    this.profiles.set(name, profile)
  }

  get(name: string): ForkProfile | undefined {
    return this.profiles.get(name)
  }

  has(name: string): boolean {
    return this.profiles.has(name)
  }

  listNames(): string[] {
    return [...this.profiles.keys()]
  }
}

/** 解析 profile 的 systemPrompt 模板：优先 systemPromptFn(vars)，否则 systemPrompt 字段 */
function resolveProfilePrompt(
  profile: ForkProfile,
  vars: Record<string, string> | undefined,
): string | undefined {
  if (profile.systemPromptFn) {
    return profile.systemPromptFn(vars ?? {})
  }
  return profile.systemPrompt
}

/**
 * 合成最终 systemPrompt
 *
 * 按 profile.systemPromptMode 决定 profile prompt 与 LLM prompt 的叠加方式。
 */
export function resolveSystemPrompt(
  profile: ForkProfile | undefined,
  llmPrompt: string | undefined,
  vars: Record<string, string> | undefined,
): string | undefined {
  if (!profile) return llmPrompt

  const profilePrompt = resolveProfilePrompt(profile, vars)
  const mode = profile.systemPromptMode ?? 'prepend'

  if (mode === 'preset') {
    return profilePrompt ?? llmPrompt
  }

  if (!profilePrompt) return llmPrompt
  if (!llmPrompt) return profilePrompt

  if (mode === 'prepend') {
    return `${profilePrompt}\n\n${llmPrompt}`
  }
  // append
  return `${llmPrompt}\n\n${profilePrompt}`
}
