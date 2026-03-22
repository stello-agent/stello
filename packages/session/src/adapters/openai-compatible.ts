import OpenAI from 'openai'
import type { LLMAdapter, LLMResult, Message, LLMCompleteOptions } from '../types/llm.js'

/** OpenAI 兼容协议的配置选项 */
export interface OpenAICompatibleOptions {
  apiKey: string
  model: string
  baseURL: string
}

/** 创建 OpenAI 兼容协议的 LLMAdapter，可对接 MiniMax / DeepSeek / OpenAI 等 */
export function createOpenAICompatibleAdapter(options: OpenAICompatibleOptions): LLMAdapter {
  const client = new OpenAI({
    apiKey: options.apiKey,
    baseURL: options.baseURL,
  })

  return {
    async complete(messages: Message[], completeOptions?: LLMCompleteOptions): Promise<LLMResult> {
      const response = await client.chat.completions.create({
        model: options.model,
        max_tokens: completeOptions?.maxTokens ?? 1024,
        ...(completeOptions?.temperature !== undefined && { temperature: completeOptions.temperature }),
        messages: messages.map((m) => ({
          role: m.role as 'system' | 'user' | 'assistant',
          content: m.content,
        })),
      })

      const choice = response.choices[0]

      return {
        content: choice?.message?.content ?? null,
        usage: response.usage
          ? {
              promptTokens: response.usage.prompt_tokens,
              completionTokens: response.usage.completion_tokens,
            }
          : undefined,
      }
    },
  }
}
