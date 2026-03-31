import type { Message, LLMAdapter, ToolCall, LLMCompleteOptions } from './llm.js'
import type { SessionStorage, MainStorage } from './storage.js'

/** consolidate 函数签名：L3 → L2，接收当前 L2 和 L3 记录，返回新 L2 */
export type ConsolidateFn = (currentMemory: string | null, messages: Message[]) => Promise<string>

/**
 * EventEnvelope — 事件信封
 * 包裹 L2/insight 内容的 metadata 层，框架只读信封字段不解析 content
 */
export interface EventEnvelope {
  /** 产出该事件的 Session ID */
  sessionId: string
  /** 单调递增序号，用于 cursor 追踪 */
  sequence: number
  /** 事件产生时间（ISO 8601） */
  timestamp: string
  /** 框架不解析的内容 — ConsolidateFn/IntegrateFn 自行定义格式 */
  content: string
}

/** 子 Session 的 L2 摘要，供 IntegrateFn 消费 */
export interface ChildL2Summary {
  sessionId: string
  label: string
  l2: string
  /** L2 产出时的序号（consolidation 次数计数） */
  sequence: number
  /** L2 产出时间（ISO 8601） */
  timestamp: string
}

/** IntegrateFn 的返回结果 */
export interface IntegrateResult {
  /** Main Session 的综合认知 */
  synthesis: string
  /** 推送给各子 Session 的定向 insights */
  insights: Array<{ sessionId: string; content: string }>
}

/** integrate 函数签名：所有子 L2 + 当前 synthesis → 新 synthesis + per-child insights */
export type IntegrateFn = (
  children: ChildL2Summary[],
  currentSynthesis: string | null
) => Promise<IntegrateResult>

/** createSession() 的选项 */
export interface CreateSessionOptions {
  /** 指定存储适配器（普通 Session 只需 SessionStorage） */
  storage: SessionStorage
  /** 指定 LLM 适配器 */
  llm?: LLMAdapter
  /** Session 标签 */
  label?: string
  /** 系统提示词 */
  systemPrompt?: string
  /** 初始标签 */
  tags?: string[]
  /** 初始元数据 */
  metadata?: Record<string, unknown>
  /** 可用工具定义 */
  tools?: LLMCompleteOptions['tools']

}

/** loadSession() 的选项 */
export interface LoadSessionOptions {
  /** 指定存储适配器 */
  storage: SessionStorage
  /** LLM 适配器 */
  llm?: LLMAdapter
  /** 系统提示词 */
  systemPrompt?: string
  /** 可用工具定义 */
  tools?: LLMCompleteOptions['tools']

}

/** createMainSession() 的选项 */
export interface CreateMainSessionOptions {
  /** 指定存储适配器（Main Session 需要 MainStorage） */
  storage: MainStorage
  /** 指定 LLM 适配器 */
  llm?: LLMAdapter
  /** Main Session 标签 */
  label?: string
  /** 系统提示词 */
  systemPrompt?: string
  /** 初始标签 */
  tags?: string[]
  /** 初始元数据 */
  metadata?: Record<string, unknown>
  /** 可用工具定义 */
  tools?: LLMCompleteOptions['tools']

}

/** loadMainSession() 的选项 */
export interface LoadMainSessionOptions {
  /** 指定存储适配器（Main Session 需要 MainStorage） */
  storage: MainStorage
  /** LLM 适配器 */
  llm?: LLMAdapter
  /** 系统提示词 */
  systemPrompt?: string
  /** 可用工具定义 */
  tools?: LLMCompleteOptions['tools']

}

/** send() 的返回结果 */
export interface SendResult {
  /** LLM 文本响应 */
  content: string | null
  /** LLM 返回的工具调用（由上层决定是否执行） */
  toolCalls?: ToolCall[]
  /** token 用量统计 */
  usage?: {
    promptTokens: number
    completionTokens: number
  }
}

/**
 * StreamResult — stream() 的返回值
 * 既是 AsyncIterable<string>（逐 chunk 消费），又能通过 result 拿最终结果
 * L3 在流结束后（result resolve 时）自动保存
 */
export interface StreamResult extends AsyncIterable<string> {
  /** 流结束后 resolve，此时 L3 已保存 */
  result: Promise<SendResult>
}
