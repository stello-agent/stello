import Anthropic from '@anthropic-ai/sdk'
import type {
  MessageParam,
  ContentBlockParam,
  ToolResultBlockParam,
  ToolUseBlockParam,
  Tool,
  ContentBlock,
} from '@anthropic-ai/sdk/resources/messages/messages'
import type {
  LLMAdapter,
  LLMResult,
  LLMChunk,
  Message,
  ToolCall,
  LLMCompleteOptions,
  ProviderToolDefinition,
  ProviderToolEvent,
} from '../types/llm.js'

type AnthropicProviderBlock = {
  type: string
  id?: string
  tool_use_id?: string
  name?: string
  input?: unknown
  content?: unknown
} & Record<string, unknown>

/** Anthropic 原生协议的配置选项 */
export interface AnthropicAdapterOptions {
  apiKey: string
  model: string
  /** 模型上下文窗口大小（token 数），用于自动压缩判断 */
  maxContextTokens: number
  /** 自定义 API 端点，兼容 MiniMax 等 Anthropic 协议服务 */
  baseURL?: string
  /**
   * 单次请求的输出 token 上限。被写入 Anthropic API 的 `max_tokens`。
   * 优先级：`completeOptions.maxTokens` > `options.maxOutputTokens` > 4096。
   * 设过低会让长输出（多个子话题的 tool call args、长 synthesis 等）
   * 在中途被截断，引发上层 JSON 解析失败。建议按模型上限设置。
   */
  maxOutputTokens?: number
  /** Provider-hosted tools to send with every request for this adapter. */
  providerTools?: ProviderToolDefinition[]
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

function isAnthropicProviderTool(tool: ProviderToolDefinition): boolean {
  return tool.provider === 'anthropic'
}

function buildProviderTools(
  adapterTools: ProviderToolDefinition[] | undefined,
  requestTools: ProviderToolDefinition[] | undefined,
): Record<string, unknown>[] {
  return [...(adapterTools ?? []), ...(requestTools ?? [])]
    .filter(isAnthropicProviderTool)
    .map((tool) => tool.spec)
}

function buildRequestTools(completeOptions: LLMCompleteOptions | undefined, adapterTools: ProviderToolDefinition[] | undefined): Tool[] {
  const clientTools = completeOptions?.tools && completeOptions.tools.length > 0
    ? toAnthropicTools(completeOptions.tools)
    : []
  const providerTools = buildProviderTools(adapterTools, completeOptions?.providerTools)
  return [...clientTools, ...providerTools] as Tool[]
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

function toProviderToolEvent(block: AnthropicProviderBlock): ProviderToolEvent | null {
  if (block.type === 'text' || block.type === 'tool_use') return null
  const event: ProviderToolEvent = {
    type: block.type,
    raw: block,
  }
  const id = block.id ?? block.tool_use_id
  if (id) event.id = id
  if (block.name) event.name = block.name
  if ('input' in block) event.input = block.input
  if ('content' in block) event.results = block.content
  return event
}

function extractProviderToolEvents(content: ContentBlock[]): ProviderToolEvent[] {
  return content.flatMap((block) => {
    const event = toProviderToolEvent(block as AnthropicProviderBlock)
    return event ? [event] : []
  })
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
      const requestTools = buildRequestTools(completeOptions, options.providerTools)

      const response = await client.messages.create(
        {
          model: options.model,
          max_tokens: completeOptions?.maxTokens ?? options.maxOutputTokens ?? 4096,
          ...(completeOptions?.temperature !== undefined && { temperature: completeOptions.temperature }),
          ...(system && { system }),
          ...(requestTools.length > 0 ? { tools: requestTools } : {}),
          messages: toAnthropicMessages(nonSystemMessages),
        },
        completeOptions?.signal ? { signal: completeOptions.signal } : undefined,
      )

      const toolCalls = extractToolCalls(response.content)
      const providerToolEvents = extractProviderToolEvents(response.content)

      return {
        content: extractText(response.content),
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
        ...(providerToolEvents.length > 0 ? { providerToolEvents } : {}),
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
      const requestTools = buildRequestTools(completeOptions, options.providerTools)

      const stream = client.messages.stream(
        {
          model: options.model,
          max_tokens: completeOptions?.maxTokens ?? options.maxOutputTokens ?? 4096,
          ...(completeOptions?.temperature !== undefined && { temperature: completeOptions.temperature }),
          ...(system && { system }),
          ...(requestTools.length > 0 ? { tools: requestTools } : {}),
          messages: toAnthropicMessages(nonSystemMessages),
        },
        completeOptions?.signal ? { signal: completeOptions.signal } : undefined,
      )

      for await (const event of stream) {
        if (event.type === 'content_block_start') {
          // tool_use 块的 id 和 name 只在 start 事件里下发，
          // 后续的 input_json_delta 只追加参数 JSON。
          // 不处理 start 会让下游累加器拿不到 name，
          // fallback 到 'unknown_tool' 触发幻觉调用。
          if (event.content_block.type === 'tool_use') {
            yield {
              delta: '',
              toolCallDeltas: [{
                index: event.index,
                id: event.content_block.id,
                name: event.content_block.name,
              }],
            }
          } else {
            const providerEvent = toProviderToolEvent(event.content_block as AnthropicProviderBlock)
            if (providerEvent) {
              yield { delta: '', providerToolEvents: [providerEvent] }
            }
          }
        } else if (event.type === 'content_block_delta') {
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
