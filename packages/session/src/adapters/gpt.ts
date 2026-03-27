import type { LLMAdapter } from '../types/llm.js'
import { createOpenAICompatibleAdapter } from './openai-compatible.js'

/** 支持的 GPT 模型 */
export type GPTModel =
  | 'gpt-4o'
  | 'gpt-4o-mini'
  | 'gpt-4.1'
  | 'gpt-4.1-mini'
  | 'gpt-4.1-nano'
  | 'o3'
  | 'o3-mini'
  | 'o4-mini'

/** GPT 模型的上下文窗口大小（token 数） */
const GPT_CONTEXT_WINDOWS: Record<GPTModel, number> = {
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  'gpt-4.1': 1_047_576,
  'gpt-4.1-mini': 1_047_576,
  'gpt-4.1-nano': 1_047_576,
  'o3': 200_000,
  'o3-mini': 200_000,
  'o4-mini': 200_000,
}

/** createGPT 的选项 */
export interface GPTOptions {
  /** GPT 模型名 */
  model: GPTModel
  /** OpenAI API Key */
  apiKey: string
  /** 自定义 API 端点（默认 OpenAI 官方） */
  baseURL?: string
}

/** 创建 GPT LLM 适配器，自动填充模型元数据 */
export function createGPT(options: GPTOptions): LLMAdapter {
  return createOpenAICompatibleAdapter({
    model: options.model,
    apiKey: options.apiKey,
    maxContextTokens: GPT_CONTEXT_WINDOWS[options.model],
    baseURL: options.baseURL ?? 'https://api.openai.com/v1',
  })
}
