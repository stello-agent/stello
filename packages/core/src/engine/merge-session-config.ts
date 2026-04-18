import type { SessionConfig } from '../types/session-config'
import type { EngineForkOptions } from '../types/engine'
import type { ForkProfile } from './fork-profile'
import { resolveSystemPrompt } from './fork-profile'

/**
 * mergeSessionConfig 的输入参数集。
 *
 * 将分层配置合并为单一 SessionConfig，供 Engine 创建 Session 时使用。
 * 合成顺序 defaults → parent → profile → forkOptions，字段级后覆盖前。
 */
export interface MergeSessionConfigInput {
  /** Agent 级默认（最低优先级） */
  defaults?: SessionConfig
  /** 父 regular session 固化配置。fork from main session 时传 undefined。 */
  parent?: SessionConfig
  /** 命名模板（可含 systemPromptMode / systemPromptFn） */
  profile?: ForkProfile
  /** profile 模板变量 */
  profileVars?: Record<string, string>
  /** Fork 时用户传入的覆盖参数（最高优先级） */
  forkOptions: EngineForkOptions
}

/**
 * 合并层级化配置为单一 SessionConfig。
 *
 * 合成顺序：defaults → parent → profile → forkOptions，字段级覆盖，undefined 不覆盖。
 * systemPrompt 特殊：profile 存在时走 profile.systemPromptMode 规则合成 profile prompt
 * 与 forkOptions.systemPrompt（caller 层），profile 缺省时退化为常规 later-wins 链。
 * skills 整数组替换，显式设 [] 视作 disabled，可覆盖下层非空值。
 */
export function mergeSessionConfig(input: MergeSessionConfigInput): SessionConfig {
  const { defaults, parent, profile, profileVars, forkOptions } = input
  const layers: Array<SessionConfig | undefined> = [defaults, parent, profile, forkOptions]
  const result: SessionConfig = {}

  // 非 systemPrompt 字段：简单 later-wins 覆盖，undefined 不覆盖
  for (const layer of layers) {
    if (!layer) continue
    if (layer.llm !== undefined) result.llm = layer.llm
    if (layer.tools !== undefined) result.tools = layer.tools
    if (layer.skills !== undefined) result.skills = layer.skills
    if (layer.consolidateFn !== undefined) result.consolidateFn = layer.consolidateFn
    if (layer.compressFn !== undefined) result.compressFn = layer.compressFn
  }

  // systemPrompt 合成：profile 存在时走 mode 规则，缺省时退化为普通覆盖链
  if (profile) {
    const merged = resolveSystemPrompt(profile, forkOptions.systemPrompt, profileVars)
    if (merged !== undefined) {
      result.systemPrompt = merged
    } else {
      // profile 与 forkOptions 都没贡献 prompt，回落到 defaults / parent
      for (const layer of [defaults, parent]) {
        if (layer?.systemPrompt !== undefined) result.systemPrompt = layer.systemPrompt
      }
    }
  } else {
    // 无 profile：普通 later-wins 链
    for (const layer of [defaults, parent, forkOptions]) {
      if (layer?.systemPrompt !== undefined) result.systemPrompt = layer.systemPrompt
    }
  }

  return result
}
