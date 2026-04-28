import Anthropic from '@anthropic-ai/sdk'
import type {
  MessageParam,
  ContentBlockParam,
  ToolResultBlockParam,
  ToolUseBlockParam,
  Tool,
  ContentBlock,
} from '@anthropic-ai/sdk/resources/messages/messages'
import type { LLMAdapter, LLMResult, LLMChunk, Message, ToolCall, LLMCompleteOptions } from '../types/llm.js'

/** Anthropic 原生协议的配置选项 */
export interface AnthropicAdapterOptions {
  apiKey: string
  model: string
  /** 模型上下文窗口大小（token 数） */
  maxContextTokens: number
  /** 自定义 API 端点，兼容 MiniMax 等 Anthropic 协议服务 */
  baseURL?: string
}

/** 将 Stello 内部 Message 转换为 Anthropic MessageParam 格式 */
function toAnthropicMessages(messages: Message[]): MessageParam[] {
  const result: MessageParam[] = []

  for (const msg of messages) {
    if (msg.role === 'system') continue

    if (msg.role === 'assistant') {
      const content: ContentBlockParam[] = []

      // 文本内容
      if (msg.content) {
        content.push({ type: 'text', text: msg.content })
      }

      // tool_use content blocks
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        for (const tc of msg.toolCalls) {
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: tc.input,
          } as ToolUseBlockParam)
        }
      }

      const first = content[0]
      result.push({
        role: 'assistant',
        content: content.length === 1 && first?.type === 'text'
          ? (first as { text: string }).text
          : content,
      })
      continue
    }

    if (msg.role === 'tool') {
      // tool_result 在 Anthropic 中是 user message 的 content block
      const toolResult: ToolResultBlockParam = {
        type: 'tool_result',
        tool_use_id: msg.toolCallId ?? '',
        content: msg.content,
      }

      // 合并连续的 tool results 到同一个 user message
      const lastMsg = result[result.length - 1]
      if (lastMsg?.role === 'user' && Array.isArray(lastMsg.content)) {
        const lastContent = lastMsg.content as ContentBlockParam[]
        const allToolResults = lastContent.every(
          (b) => b.type === 'tool_result',
        )
        if (allToolResults) {
          lastContent.push(toolResult)
          continue
        }
      }

      result.push({ role: 'user', content: [toolResult] })
      continue
    }

    // role === 'user'
    result.push({ role: 'user', content: msg.content })
  }

  return result
}

/** 将 Stello tools schema 转换为 Anthropic Tool 格式 */
function toAnthropicTools(
  tools: NonNullable<LLMCompleteOptions['tools']>,
): Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Tool['input_schema'],
  }))
}

/** 从 Anthropic response content blocks 中提取 tool calls */
function extractToolCalls(content: ContentBlock[]): ToolCall[] {
  return content
    .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    .map((b) => ({
      id: b.id,
      name: b.name,
      input: (b.input ?? {}) as Record<string, unknown>,
    }))
}

/** 从 Anthropic response content blocks 中提取文本 */
function extractText(content: ContentBlock[]): string | null {
  const texts = content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
  return texts.length > 0 ? texts.join('') : null
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

      const response = await client.messages.create(
        {
          model: options.model,
          max_tokens: completeOptions?.maxTokens ?? 4096,
          ...(completeOptions?.temperature !== undefined && { temperature: completeOptions.temperature }),
          ...(system && { system }),
          ...(completeOptions?.tools && completeOptions.tools.length > 0
            ? { tools: toAnthropicTools(completeOptions.tools) }
            : {}),
          messages: toAnthropicMessages(nonSystemMessages),
        },
        completeOptions?.signal ? { signal: completeOptions.signal } : undefined,
      )

      const toolCalls = extractToolCalls(response.content)

      return {
        content: extractText(response.content),
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
        usage: {
          promptTokens: response.usage.input_tokens,
          completionTokens: response.usage.output_tokens,
        },
      }
    },

    async *stream(messages: Message[], completeOptions?: LLMCompleteOptions): AsyncIterable<LLMChunk> {
      const systemMessages = messages.filter((m) => m.role === 'system')
      const nonSystemMessages = messages.filter((m) => m.role !== 'system')

      const system = systemMessages.length > 0
        ? systemMessages.map((m) => m.content).join('\n\n')
        : undefined

      const stream = client.messages.stream(
        {
          model: options.model,
          max_tokens: completeOptions?.maxTokens ?? 4096,
          ...(completeOptions?.temperature !== undefined && { temperature: completeOptions.temperature }),
          ...(system && { system }),
          ...(completeOptions?.tools && completeOptions.tools.length > 0
            ? { tools: toAnthropicTools(completeOptions.tools) }
            : {}),
          messages: toAnthropicMessages(nonSystemMessages),
        },
        completeOptions?.signal ? { signal: completeOptions.signal } : undefined,
      )

      for await (const event of stream) {
        if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            yield { delta: event.delta.text }
          } else if (event.delta.type === 'input_json_delta') {
            yield {
              delta: '',
              toolCallDeltas: [{
                index: event.index,
                input: event.delta.partial_json,
              }],
            }
          }
        }
      }
    },
  }
}
