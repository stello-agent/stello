import Anthropic from '@anthropic-ai/sdk'
import type { LLMAdapter, LLMResult, Message, LLMCompleteOptions } from '../types/llm.js'

/** Anthropic 原生协议的配置选项 */
export interface AnthropicAdapterOptions {
  apiKey: string
  model: string
  /** 模型上下文窗口大小（token 数） */
  maxContextTokens: number
  /** 自定义 API 端点，兼容 MiniMax 等 Anthropic 协议服务 */
  baseURL?: string
}

/** 创建基于 Anthropic 原生协议的 LLMAdapter */
export function createAnthropicAdapter(options: AnthropicAdapterOptions): LLMAdapter {
  const client = new Anthropic({
    apiKey: options.apiKey,
    ...(options.baseURL && { baseURL: options.baseURL }),
  })

  return {
    maxContextTokens: options.maxContextTokens,
    async complete(messages: Message[], completeOptions?: LLMCompleteOptions): Promise<LLMResult> {
      const systemMessages = messages.filter((m) => m.role === 'system')
      const nonSystemMessages = messages.filter((m) => m.role !== 'system')

      const system = systemMessages.length > 0
        ? systemMessages.map((m) => m.content).join('\n\n')
        : undefined

      const response = await client.messages.create({
        model: options.model,
        max_tokens: completeOptions?.maxTokens ?? 1024,
        ...(completeOptions?.temperature !== undefined && { temperature: completeOptions.temperature }),
        ...(system && { system }),
        messages: nonSystemMessages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      })

      const textBlock = response.content.find((b) => b.type === 'text')

      return {
        content: textBlock ? textBlock.text : null,
        usage: {
          promptTokens: response.usage.input_tokens,
          completionTokens: response.usage.output_tokens,
        },
      }
    },
  }
}
