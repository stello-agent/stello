import OpenAI from 'openai'
import type { ChatCompletion, ChatCompletionChunk } from 'openai/resources/chat/completions'
import type { Stream } from 'openai/streaming'
import type { LLMAdapter, LLMResult, Message, LLMCompleteOptions } from '../types/llm.js'

type ChatToolCallDelta = NonNullable<
  NonNullable<ChatCompletionChunk['choices'][number]['delta']['tool_calls']>[number]
>

/** OpenAI 兼容协议的配置选项 */
export interface OpenAICompatibleOptions {
  apiKey: string
  model: string
  /** 模型上下文窗口大小（token 数） */
  maxContextTokens: number
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
        role: m.role as 'system' | 'user' | 'assistant' | 'tool',
        content: m.content,
        ...(m.role === 'tool' && m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
        ...(m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0
          ? {
              tool_calls: m.toolCalls.map((toolCall) => ({
                id: toolCall.id,
                type: 'function' as const,
                function: {
                  name: toolCall.name,
                  arguments: JSON.stringify(toolCall.input),
                },
              })),
            }
          : {}),
      })),
    }
  }

  return {
    maxContextTokens: options.maxContextTokens,
    async complete(messages: Message[], completeOptions?: LLMCompleteOptions): Promise<LLMResult> {
      const response = await client.chat.completions.create({
        ...buildParams(messages, completeOptions),
        ...(options.extraBody ?? {}),
        stream: false,
      } as Parameters<typeof client.chat.completions.create>[0]) as ChatCompletion

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
      } as Parameters<typeof client.chat.completions.create>[0]) as Stream<ChatCompletionChunk>

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content ?? ''
        const toolCallDeltas = (chunk.choices[0]?.delta?.tool_calls ?? []).map((call: ChatToolCallDelta) => ({
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
