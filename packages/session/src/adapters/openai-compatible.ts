import OpenAI from 'openai'
import type { ChatCompletion, ChatCompletionChunk } from 'openai/resources/chat/completions'
import type { Stream } from 'openai/streaming'
import type {
  ContentPart,
  LLMAdapter,
  LLMResult,
  Message,
  LLMCompleteOptions,
  ProviderToolDefinition,
  ProviderToolEvent,
} from '../types/llm.js'

type RawOpenAIToolCall = {
  index?: number
  id?: string
  type?: string
  function?: {
    name?: string
    arguments?: string
    results?: unknown
  }
} & Record<string, unknown>

/** OpenAI 兼容协议的配置选项 */
export interface OpenAICompatibleOptions {
  apiKey: string
  model: string
  /** 模型上下文窗口大小（token 数），用于自动压缩判断 */
  maxContextTokens: number
  baseURL: string
  /** 额外的请求参数（如 MiniMax 的 reasoning_split 等） */
  extraBody?: Record<string, unknown>
  /**
   * 单次请求的输出 token 上限。被写入请求的 `max_tokens`。
   * 优先级：`completeOptions.maxTokens` > `options.maxOutputTokens` > 4096。
   * 设过低会让长输出（多个子话题的 tool call args、长 synthesis 等）
   * 在中途被截断，引发上层 JSON 解析失败。
   */
  maxOutputTokens?: number
  /** Provider-hosted tools to send with every request for this adapter. */
  providerTools?: ProviderToolDefinition[]
  /** 将 KitKit 托管的多模态文件转成模型服务可访问的 URL。 */
  resolveMediaUrl?: (source: Extract<Extract<ContentPart, { kind: 'image' | 'video' }>['source'], { type: 'kitkit_file' }>) => string | Promise<string>
}

/** 合并连续的 system 消息，兼容只接受单条 system 的提供方。 */
function mergeConsecutiveSystemMessages(messages: Message[]): Message[] {
  const merged: Message[] = []

  for (const message of messages) {
    const previous = merged[merged.length - 1]
    if (message.role === 'system' && previous?.role === 'system') {
      previous.content = `${previous.content}\n\n${message.content}`
      continue
    }
    merged.push({ ...message })
  }

  return merged
}

function isStepFun37Flash(options: OpenAICompatibleOptions): boolean {
  // StepFun 的不同套餐/入口可能使用不同 baseURL（如 /v1 与 /step_plan/v1）。
  // 多模态能力跟随模型名判断，不能把能力限定死在某一个 endpoint。
  return options.model === 'step-3.7-flash'
}

function isOpenAICompatibleProviderTool(tool: ProviderToolDefinition): boolean {
  return tool.provider === 'openai' || tool.provider === 'openai-compatible'
}

function buildProviderTools(
  adapterTools: ProviderToolDefinition[] | undefined,
  requestTools: ProviderToolDefinition[] | undefined,
): Record<string, unknown>[] {
  return [...(adapterTools ?? []), ...(requestTools ?? [])]
    .filter(isOpenAICompatibleProviderTool)
    .map((tool) => tool.spec)
}

function parseProviderToolArguments(value: string | undefined): unknown {
  if (!value) return undefined
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function isProviderToolCall(call: RawOpenAIToolCall): boolean {
  return typeof call.type === 'string' && call.type !== 'function'
}

function toProviderToolEvent(call: RawOpenAIToolCall): ProviderToolEvent {
  const event: ProviderToolEvent = {
    ...(call.id ? { id: call.id } : {}),
    type: call.type ?? 'provider_tool',
    ...(call.function?.name ? { name: call.function.name } : {}),
    raw: call,
  }
  const input = parseProviderToolArguments(call.function?.arguments)
  if (input !== undefined) event.input = input
  if (call.function && 'results' in call.function) event.results = call.function.results
  return event
}

function escapeDocumentAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function renderExtractedFilePart(part: Extract<ContentPart, { kind: 'file' }>): string {
  const filename = part.filename || '未命名文件'
  const mediaType = part.mediaType || 'application/octet-stream'
  const content = part.extraction?.content
  if (!content) {
    throw new Error('StepFun file content part requires extracted text content before reaching the OpenAI-compatible adapter')
  }
  return [
    `用户上传了文档：${filename}`,
    `<document filename="${escapeDocumentAttribute(filename)}" media_type="${escapeDocumentAttribute(mediaType)}">`,
    content,
    '</document>',
  ].join('\n')
}

async function sourceToURL(part: Extract<ContentPart, { kind: 'image' | 'video' }>, options: OpenAICompatibleOptions): Promise<string> {
  const source = part.source
  if (source.type === 'url') return source.url
  if (source.type === 'data') return `data:${source.mediaType};base64,${source.data}`
  if (source.type === 'provider_file') {
    if (source.uri) return source.uri
    if (source.provider === 'stepfun') return `stepfile://${source.fileId}`
    throw new Error(`Unsupported provider_file source provider: ${source.provider}`)
  }
  if (source.type === 'kitkit_file') {
    if (options.resolveMediaUrl) return options.resolveMediaUrl(source)
    if (source.url && /^https?:\/\//.test(source.url)) return source.url
    throw new Error('kitkit_file source must be converted to a model-readable URL before reaching the OpenAI-compatible adapter')
  }
  const unreachable = source as never
  throw new Error(`Unsupported media source: ${JSON.stringify(unreachable)}`)
}

async function toOpenAIContent(message: Message, allowMultimodal: boolean, options: OpenAICompatibleOptions): Promise<string | Array<Record<string, unknown>>> {
  if (!message.parts || message.parts.length === 0) return message.content
  if (!allowMultimodal) {
    throw new Error('Multimodal content parts are only supported for StepFun step-3.7-flash in this adapter')
  }
  if (message.role !== 'user') {
    throw new Error(`Multimodal content parts are only supported on user messages, got role=${message.role}`)
  }

  const blocks: Array<Record<string, unknown>> = []
  const hasTextPart = message.parts.some((part) => part.kind === 'text')
  if (message.content && !hasTextPart) {
    blocks.push({ type: 'text', text: message.content })
  }

  for (const part of message.parts) {
    if (part.kind === 'text') {
      blocks.push({ type: 'text', text: part.text })
      continue
    }
    if (part.kind === 'image') {
      const imageUrl: Record<string, unknown> = { url: await sourceToURL(part, options) }
      if (part.detail && part.detail !== 'auto') imageUrl.detail = part.detail
      blocks.push({ type: 'image_url', image_url: imageUrl })
      continue
    }
    if (part.kind === 'video') {
      blocks.push({ type: 'video_url', video_url: { url: await sourceToURL(part, options) } })
      continue
    }
    if (part.kind === 'file') {
      blocks.push({ type: 'text', text: renderExtractedFilePart(part) })
      continue
    }
    throw new Error(`Unsupported multimodal content part kind: ${part.kind}`)
  }

  return blocks.length > 0 ? blocks : message.content
}

/** 创建 OpenAI 兼容协议的 LLMAdapter，可对接 MiniMax / DeepSeek / OpenAI 等 */
export function createOpenAICompatibleAdapter(options: OpenAICompatibleOptions): LLMAdapter {
  const client = new OpenAI({
    apiKey: options.apiKey,
    baseURL: options.baseURL,
  })

  /** 构建公共请求参数 */
  async function buildParams(messages: Message[], completeOptions?: LLMCompleteOptions) {
    const normalizedMessages = mergeConsecutiveSystemMessages(messages)
    const allowMultimodal = isStepFun37Flash(options)
    const clientTools = completeOptions?.tools?.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    })) ?? []
    const providerTools = buildProviderTools(options.providerTools, completeOptions?.providerTools)
    const requestTools = [...clientTools, ...providerTools]
    return {
      model: options.model,
      max_tokens: completeOptions?.maxTokens ?? options.maxOutputTokens ?? 4096,
      ...(completeOptions?.temperature !== undefined && { temperature: completeOptions.temperature }),
      ...(requestTools.length > 0 ? { tools: requestTools } : {}),
      ...(providerTools.length > 0 ? { tool_choice: 'auto' as const } : {}),
      messages: await Promise.all(normalizedMessages.map(async (m) => ({
        role: m.role as 'system' | 'user' | 'assistant' | 'tool',
        content: await toOpenAIContent(m, allowMultimodal, options),
        ...(m.role === 'tool' && m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
        ...(m.role === 'assistant' && m.reasoningContent
          ? { reasoning_content: m.reasoningContent }
          : {}),
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
      }))),
    }
  }

  return {
    maxContextTokens: options.maxContextTokens,
    async complete(messages: Message[], completeOptions?: LLMCompleteOptions): Promise<LLMResult> {
      const response = await client.chat.completions.create(
        {
          ...(await buildParams(messages, completeOptions)),
          ...(options.extraBody ?? {}),
          stream: false,
        } as Parameters<typeof client.chat.completions.create>[0],
        completeOptions?.signal ? { signal: completeOptions.signal } : undefined,
      ) as ChatCompletion

      const choice = response.choices[0]
      // 提取推理模型的思考内容（stepFun/DeepSeek 等使用 reasoning_content 字段）
      const rawMessage = choice?.message as Record<string, unknown> | undefined
      const reasoningContent = typeof rawMessage?.reasoning_content === 'string'
        ? rawMessage.reasoning_content
        : null
      const rawToolCalls = (choice?.message?.tool_calls ?? []) as RawOpenAIToolCall[]
      const providerToolEvents = rawToolCalls
        .filter(isProviderToolCall)
        .map(toProviderToolEvent)

      return {
        content: choice?.message?.content ?? null,
        ...(reasoningContent ? { reasoningContent } : {}),
        toolCalls: rawToolCalls.flatMap((call) => {
          if (isProviderToolCall(call)) return []
          if (!('function' in call) || !call.function) return []
          return [{
            id: call.id ?? 'unknown_tool_call',
            name: call.function.name ?? 'unknown_tool',
            input: call.function.arguments ? JSON.parse(call.function.arguments) as Record<string, unknown> : {},
          }]
        }),
        ...(providerToolEvents.length > 0 ? { providerToolEvents } : {}),
        usage: response.usage
          ? {
              promptTokens: response.usage.prompt_tokens,
              completionTokens: response.usage.completion_tokens,
          }
          : undefined,
      }
    },
    async *stream(messages: Message[], completeOptions?: LLMCompleteOptions) {
      const stream = await client.chat.completions.create(
        {
          ...(await buildParams(messages, completeOptions)),
          ...(options.extraBody ?? {}),
          stream: true,
        } as Parameters<typeof client.chat.completions.create>[0],
        completeOptions?.signal ? { signal: completeOptions.signal } : undefined,
      ) as Stream<ChatCompletionChunk>

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content ?? ''
        // 提取推理模型的思考内容增量（stepFun/DeepSeek 等使用 reasoning_content 字段）
        const rawDelta = chunk.choices[0]?.delta as Record<string, unknown> | undefined
        const reasoningDelta = typeof rawDelta?.reasoning_content === 'string'
          ? rawDelta.reasoning_content
          : undefined
        const rawToolCalls = (chunk.choices[0]?.delta?.tool_calls ?? []) as RawOpenAIToolCall[]
        const providerToolEvents = rawToolCalls
          .filter(isProviderToolCall)
          .map(toProviderToolEvent)
        const toolCallDeltas = rawToolCalls.filter((call) => !isProviderToolCall(call)).map((call) => ({
          index: call.index ?? 0,
          id: call.id,
          name: call.function?.name,
          input: call.function?.arguments,
        }))
        if (delta || reasoningDelta || toolCallDeltas.length > 0 || providerToolEvents.length > 0) {
          yield {
            delta,
            ...(reasoningDelta ? { reasoningDelta } : {}),
            ...(toolCallDeltas.length > 0 ? { toolCallDeltas } : {}),
            ...(providerToolEvents.length > 0 ? { providerToolEvents } : {}),
          }
        }
      }
    },
  }
}
