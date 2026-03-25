import OpenAI from 'openai'
import type { LLMAdapter, LLMResult, Message, LLMCompleteOptions } from '../types/llm.js'

/** OpenAI 兼容协议的配置选项 */
export interface OpenAICompatibleOptions {
  apiKey: string
  model: string
  baseURL: string
  /** 额外的请求参数（如 MiniMax 的 reasoning_split 等） */
  extraBody?: Record<string, unknown>
}

/** 创建 OpenAI 兼容协议的 LLMAdapter，可对接 MiniMax / DeepSeek / OpenAI 等 */
export function createOpenAICompatibleAdapter(options: OpenAICompatibleOptions): LLMAdapter {
  const client = new OpenAI({
    apiKey: options.apiKey,
    baseURL: options.baseURL,
  })

  /** 构建公共请求参数 */
  function buildParams(messages: Message[], completeOptions?: LLMCompleteOptions) {
    return {
      model: options.model,
      max_tokens: completeOptions?.maxTokens ?? 1024,
      ...(completeOptions?.temperature !== undefined && { temperature: completeOptions.temperature }),
      ...(completeOptions?.tools
        ? {
            tools: completeOptions.tools.map((tool) => ({
              type: 'function' as const,
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.inputSchema,
              },
            })),
          }
        : {}),
      messages: messages.map((m) => ({
        role: m.role as 'system' | 'user' | 'assistant',
        content: m.content,
      })),
    }
  }

  return {
    async complete(messages: Message[], completeOptions?: LLMCompleteOptions): Promise<LLMResult> {
      const response = await client.chat.completions.create({
        ...buildParams(messages, completeOptions),
        ...(options.extraBody ?? {}),
      } as Parameters<typeof client.chat.completions.create>[0])

      const choice = response.choices[0]

      return {
        content: choice?.message?.content ?? null,
        toolCalls: (choice?.message?.tool_calls ?? []).flatMap((call) => {
          if (!('function' in call) || !call.function) return []
          return [{
            id: call.id,
            name: call.function.name ?? 'unknown_tool',
            input: call.function.arguments ? JSON.parse(call.function.arguments) as Record<string, unknown> : {},
          }]
        }),
        usage: response.usage
          ? {
              promptTokens: response.usage.prompt_tokens,
              completionTokens: response.usage.completion_tokens,
          }
          : undefined,
      }
    },
    async *stream(messages: Message[], completeOptions?: LLMCompleteOptions) {
      const stream = await client.chat.completions.create({
        ...buildParams(messages, completeOptions),
        ...(options.extraBody ?? {}),
        stream: true,
      } as Parameters<typeof client.chat.completions.create>[0])

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content ?? ''
        const toolCallDeltas = (chunk.choices[0]?.delta?.tool_calls ?? []).map((call) => ({
          index: call.index ?? 0,
          id: call.id,
          name: call.function?.name,
          input: call.function?.arguments,
        }))
        if (delta || toolCallDeltas.length > 0) {
          yield { delta, toolCallDeltas }
        }
      }
    },
  }
}
