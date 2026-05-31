/** 对话消息，角色涵盖 system/user/assistant/tool */
export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  /** Provider 中性的多模态内容块。content 仍是文本投影；adapter 可按需使用 parts。 */
  parts?: ContentPart[]
  /** 推理模型的思考内容（stepFun/DeepSeek 等），仅 role=assistant 时有效 */
  reasoningContent?: string
  /** assistant 发起的工具调用列表，仅 role=assistant 时有效 */
  toolCalls?: ToolCall[]
  /** 关联的工具调用 ID，仅 role=tool 时有效 */
  toolCallId?: string
  /** 消息写入时间（ISO 字符串） */
  timestamp?: string
  /** 持久化层附加元数据（例如 KitKit 的 turnId/turnSeq）。LLM adapter 应忽略该字段。 */
  metadata?: Record<string, unknown>
}

export type ContentPart = TextPart | ImagePart | VideoPart | FilePart | AudioPart

export interface TextPart {
  kind: 'text'
  text: string
}

export interface ImagePart {
  kind: 'image'
  source: MediaSource
  detail?: 'low' | 'high' | 'auto'
  altText?: string
  filename?: string
  mediaType?: string
  sizeBytes?: number
}

export interface VideoPart {
  kind: 'video'
  source: MediaSource
  filename?: string
  mediaType?: string
  durationSeconds?: number
  sizeBytes?: number
}

export interface FilePart {
  kind: 'file'
  source: MediaSource
  filename?: string
  mediaType?: string
  sizeBytes?: number
  /** Parsed document text supplied by an upstream document extraction service. */
  extraction?: DocumentExtraction
}

export interface DocumentExtraction {
  provider: 'stepfun'
  fileId: string
  status?: 'processed' | 'success' | 'failed'
  content?: string
  contentChars?: number
}

export interface AudioPart {
  kind: 'audio'
  source: MediaSource
  filename?: string
  mediaType?: string
  durationSeconds?: number
  sizeBytes?: number
}

export type MediaSource =
  | { type: 'url'; url: string }
  | { type: 'data'; mediaType: string; data: string }
  | { type: 'provider_file'; provider: string; fileId: string; uri?: string }
  | { type: 'kitkit_file'; fileId: string; objectKey: string; backend: 'local' | 's3'; bucket?: string; url?: string }

/** LLM 返回的工具调用请求 */
export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

/** 客户端执行的 function-calling tool 定义。 */
export interface ClientToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export type ProviderToolProvider = 'openai' | 'openai-compatible' | 'anthropic'

/** Provider 执行的内置 tool 原生描述符。Stello 只透传，不本地执行。 */
export interface ProviderToolDefinition {
  id: string
  provider: ProviderToolProvider
  spec: Record<string, unknown>
}

/** Provider 内置 tool 的事件 / 结果。由 adapter 从 provider 响应中提取。 */
export interface ProviderToolEvent {
  id?: string
  type: string
  name?: string
  input?: unknown
  results?: unknown
  raw: unknown
}

/** LLM complete 的选项 */
export interface LLMCompleteOptions {
  /** 最大生成 token 数 */
  maxTokens?: number
  /** 温度参数 */
  temperature?: number
  /** 可用工具列表的 schema（JSON Schema 格式） */
  tools?: ClientToolDefinition[]
  /** Provider 执行的内置 tool 原生描述符。 */
  providerTools?: ProviderToolDefinition[]
  /**
   * AbortSignal — adapter 应在 abort 时中断 LLM 调用并以 AbortError reject。
   * 不支持取消的 adapter 可忽略此字段（best-effort 语义）。
   */
  signal?: AbortSignal
}

/** LLM 完成后的返回结果 */
export interface LLMResult {
  content: string | null
  /** 推理模型的思考内容，多轮对话时需回传给 API */
  reasoningContent?: string | null
  toolCalls?: ToolCall[]
  /** Provider 内置 tool 事件 / 结果，不进入客户端 tool loop。 */
  providerToolEvents?: ProviderToolEvent[]
  usage?: {
    promptTokens: number
    completionTokens: number
  }
}

/** 流式输出的单个 chunk */
export interface LLMChunk {
  /** 文本增量片段 */
  delta: string
  /** 推理内容增量片段（stepFun/DeepSeek 等推理模型） */
  reasoningDelta?: string
  /** 工具调用增量片段（用于流式拼接 tool call） */
  toolCallDeltas?: Array<{
    index: number
    id?: string
    name?: string
    input?: string
  }>
  /** Provider 内置 tool 事件 / 结果，不进入客户端 tool loop。 */
  providerToolEvents?: ProviderToolEvent[]
}

/**
 * LLMAdapter — 自有接口，不依赖任何 AI SDK
 * 实现者负责将此接口映射到具体 LLM 服务
 */
export interface LLMAdapter {
  /** 发送消息列表，返回完整 LLM 响应 */
  complete(messages: Message[], options?: LLMCompleteOptions): Promise<LLMResult>
  /** 流式输出，逐 chunk 返回。未实现时 Session 退化为 complete + 单次 yield */
  stream?(messages: Message[], options?: LLMCompleteOptions): AsyncIterable<LLMChunk>
  /** 模型上下文窗口大小（token 数），用于自动压缩判断 */
  maxContextTokens: number
}
