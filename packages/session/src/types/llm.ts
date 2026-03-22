/** 对话消息，角色涵盖 system/user/assistant/tool */
export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  /** 关联的工具调用 ID，仅 role=tool 时有效 */
  toolCallId?: string
  /** 消息写入时间（ISO 字符串） */
  timestamp?: string
}

/** LLM 返回的工具调用请求 */
export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

/** LLM complete 的选项 */
export interface LLMCompleteOptions {
  /** 最大生成 token 数 */
  maxTokens?: number
  /** 温度参数 */
  temperature?: number
  /** 可用工具列表的 schema（JSON Schema 格式） */
  tools?: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>
}

/** LLM 完成后的返回结果 */
export interface LLMResult {
  content: string | null
  toolCalls?: ToolCall[]
  usage?: {
    promptTokens: number
    completionTokens: number
  }
}

/** 流式输出的单个 chunk */
export interface LLMChunk {
  /** 文本增量片段 */
  delta: string
  /** 工具调用增量片段（用于流式拼接 tool call） */
  toolCallDeltas?: Array<{
    index: number
    id?: string
    name?: string
    input?: string
  }>
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
}
