import type { LLMAdapter, LLMCompleteOptions, ForkContextFn } from '@stello-ai/session'
import type {
  SessionCompatibleConsolidateFn,
  SessionCompatibleCompressFn,
} from '../adapters/session-runtime'

/**
 * Fork Profile — 预注册的 fork 配置模板
 *
 * 开发者注册 profile，LLM 通过 tool call 中的 profile 参数引用。
 * Engine 解析 profile 并与 LLM 提供的参数合成最终 fork 选项。
 */
export interface ForkProfile {
  /** 系统提示词模板；字符串或接收 vars 的函数 */
  systemPrompt?: string | ((vars: Record<string, string>) => string)
  /**
   * systemPrompt 合成策略：
   * - 'preset': profile 提供完整 prompt，忽略 LLM 的 systemPrompt
   * - 'prepend': profile prompt 在前，LLM prompt 在后（默认）
   * - 'append': LLM prompt 在前，profile prompt 在后
   */
  systemPromptMode?: 'preset' | 'prepend' | 'append'
  /** 覆盖 LLM 适配器 */
  llm?: LLMAdapter
  /** 覆盖工具列表 */
  tools?: LLMCompleteOptions['tools']
  /** 上下文继承策略（字符串值） */
  context?: 'none' | 'inherit'
  /** 自定义上下文转换函数（优先于 context 字段） */
  contextFn?: ForkContextFn
  /**
   * 可用 skill 白名单
   *
   * - `undefined`（不传）：继承全局所有 skills
   * - `['a', 'b']`：只能 activate_skill 白名单内的 skills
   * - `[]`（空数组）：完全禁用 activate_skill 工具
   */
  skills?: string[]
  /** 子会话的第一条 assistant 开场消息（优先于 LLM 提供的 prompt） */
  prompt?: string
  /** 子 session 的 L3→L2 提炼函数（不传则继承父 session 的） */
  consolidateFn?: SessionCompatibleConsolidateFn
  /** 子 session 的上下文压缩函数（不传则继承父 session 的） */
  compressFn?: SessionCompatibleCompressFn
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

  listNames(): string[] {
    return [...this.profiles.keys()]
  }
}

/** 解析 profile 的 systemPrompt 模板 */
function resolveProfilePrompt(
  profile: ForkProfile,
  vars: Record<string, string> | undefined,
): string | undefined {
  if (!profile.systemPrompt) return undefined
  if (typeof profile.systemPrompt === 'function') {
    return profile.systemPrompt(vars ?? {})
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
