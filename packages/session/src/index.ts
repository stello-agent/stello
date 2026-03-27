// 类型导出 — Session
export type { SessionMeta, SessionMetaUpdate, SessionFilter, ForkOptions, ForkContextFn } from './types/session.js'
export type { SessionStorage, MainStorage, ListRecordsOptions, TopologyNode } from './types/storage.js'
export type {
  Message, ToolCall, LLMCompleteOptions, LLMResult, LLMChunk, LLMAdapter,
} from './types/llm.js'
export type {
  Session,
  MessageQueryOptions,
} from './types/session-api.js'
export {
  SessionArchivedError,
  NotImplementedError,
} from './types/session-api.js'

// 类型导出 — MainSession
export type {
  MainSession,
} from './types/main-session-api.js'

// 类型导出 — 函数签名与选项
export type {
  ConsolidateFn,
  IntegrateFn,
  IntegrateResult,
  ChildL2Summary,
  CreateSessionOptions,
  LoadSessionOptions,
  CreateMainSessionOptions,
  LoadMainSessionOptions,
  SendResult,
  StreamResult,
} from './types/functions.js'

// 工具工厂
export type { Tool, CallToolResult, ToolAnnotations } from './tool.js'
export { tool } from './tool.js'

// Session 工厂函数
export { createSession, loadSession } from './create-session.js'

// MainSession 工厂函数
export { createMainSession, loadMainSession } from './create-main-session.js'

// LLM Adapter — 高层工厂（推荐）
export type { ClaudeModel, ClaudeOptions } from './adapters/claude.js'
export { createClaude } from './adapters/claude.js'
export type { GPTModel, GPTOptions } from './adapters/gpt.js'
export { createGPT } from './adapters/gpt.js'

// LLM Adapter — 底层工厂（自定义模型用）
export type { OpenAICompatibleOptions } from './adapters/openai-compatible.js'
export { createOpenAICompatibleAdapter } from './adapters/openai-compatible.js'
export type { AnthropicAdapterOptions } from './adapters/anthropic.js'
export { createAnthropicAdapter } from './adapters/anthropic.js'

// 内置工具
export { createSessionTool } from './tools/create-session-tool.js'

// Mock 实现（用于测试）
export { InMemoryStorageAdapter } from './mocks/in-memory-storage.js'
