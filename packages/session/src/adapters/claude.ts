import type { LLMAdapter } from '../types/llm.js'
import { createAnthropicAdapter } from './anthropic.js'

/** 支持的 Claude 模型 */
export type ClaudeModel =
  | 'claude-opus-4-20250514'
  | 'claude-sonnet-4-20250514'
  | 'claude-haiku-4-5-20251001'

/** Claude 模型的上下文窗口大小（token 数） */
const CLAUDE_CONTEXT_WINDOWS: Record<ClaudeModel, number> = {
  'claude-opus-4-20250514': 200_000,
  'claude-sonnet-4-20250514': 200_000,
  'claude-haiku-4-5-20251001': 200_000,
}

/** createClaude 的选项 */
export interface ClaudeOptions {
  /** Claude 模型名 */
  model: ClaudeModel
  /** Anthropic API Key */
  apiKey: string
  /** 自定义 API 端点 */
  baseURL?: string
}

/** 创建 Claude LLM 适配器，自动填充模型元数据 */
export function createClaude(options: ClaudeOptions): LLMAdapter {
  return createAnthropicAdapter({
    model: options.model,
    apiKey: options.apiKey,
    maxContextTokens: CLAUDE_CONTEXT_WINDOWS[options.model],
    baseURL: options.baseURL,
  })
}
