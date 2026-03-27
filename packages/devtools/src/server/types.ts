import type { StelloAgentHotConfig } from '@stello-ai/core'

/** LLM 配置的 getter/setter，由调用方实现具体的 adapter 切换 */
export interface LLMConfigProvider {
  getConfig(): { model: string; baseURL: string; apiKey?: string; temperature?: number; maxTokens?: number }
  setConfig(config: { model: string; baseURL: string; apiKey?: string; temperature?: number; maxTokens?: number }): void
}

/** Consolidation/Integration 提示词的 getter/setter */
export interface PromptProvider {
  getPrompts(): { consolidate: string; integrate: string }
  setPrompts(prompts: { consolidate?: string; integrate?: string }): void
}

/** Session 级别的访问能力 */
export interface SessionAccessProvider {
  /** 读取 system prompt */
  getSystemPrompt(sessionId: string): Promise<string | null>
  /** 写入 system prompt */
  setSystemPrompt(sessionId: string, content: string): Promise<void>
  /** 读取 per-session consolidate prompt */
  getConsolidatePrompt?(sessionId: string): Promise<string | null>
  /** 写入 per-session consolidate prompt */
  setConsolidatePrompt?(sessionId: string, content: string): Promise<void>
  /** 读取 per-session integrate prompt */
  getIntegratePrompt?(sessionId: string): Promise<string | null>
  /** 写入 per-session integrate prompt */
  setIntegratePrompt?(sessionId: string, content: string): Promise<void>
  /** 读取 scope/insights */
  getScope?(sessionId: string): Promise<string | null>
  /** 写入 scope/insights */
  setScope?(sessionId: string, content: string): Promise<void>
  /** 注入一条对话记录 */
  injectRecord?(sessionId: string, record: { role: string; content: string }): Promise<void>
}

/** Tool 定义 */
export interface ToolInfo {
  name: string
  description: string
  parameters?: Record<string, unknown>
}

/** Tools 动态开关提供者 */
export interface ToolsProvider {
  /** 获取所有工具（含启用状态） */
  getTools(): Array<ToolInfo & { enabled: boolean }>
  /** 设置工具启用/禁用 */
  setEnabled(toolName: string, enabled: boolean): void
}

/** Skills 动态开关提供者 */
export interface SkillsProvider {
  /** 获取所有技能（含启用状态） */
  getSkills(): Array<{ name: string; description: string; enabled: boolean }>
  /** 设置技能启用/禁用 */
  setEnabled(skillName: string, enabled: boolean): void
}

/** 手动触发 integration 的回调 */
export interface IntegrationProvider {
  trigger(): Promise<{ synthesis: string; insightCount: number }>
}

/** DevTools 可持久化的全局状态 */
export interface DevtoolsPersistedState {
  hotConfig?: StelloAgentHotConfig
  llm?: {
    model: string
    baseURL: string
    apiKey?: string
    temperature?: number
    maxTokens?: number
  }
  prompts?: {
    consolidate?: string
    integrate?: string
  }
  disabledTools?: string[]
  disabledSkills?: string[]
}

/** DevTools 状态持久化存储 */
export interface DevtoolsStateStore {
  /** 启动时读取已保存的状态 */
  load(): Promise<DevtoolsPersistedState | null>
  /** 变更后保存当前状态 */
  save(state: DevtoolsPersistedState): Promise<void>
  /** 可选：清空已保存状态 */
  reset?(): Promise<void>
}

/** startDevtools 配置 */
export interface DevtoolsOptions {
  /** 监听端口，默认 4800 */
  port?: number
  /** 是否自动打开浏览器，默认 true */
  open?: boolean
  /** LLM 配置提供者 */
  llm?: LLMConfigProvider
  /** Consolidation/Integration 提示词提供者 */
  prompts?: PromptProvider
  /** Session 级别访问 */
  sessionAccess?: SessionAccessProvider
  /** Tools 动态开关 */
  tools?: ToolsProvider
  /** Skills 动态开关 */
  skills?: SkillsProvider
  /** 手动触发 integration */
  integration?: IntegrationProvider
  /** 全局 DevTools 状态持久化 */
  stateStore?: DevtoolsStateStore
}

/** startDevtools 返回值 */
export interface DevtoolsInstance {
  /** 实际监听端口 */
  port: number
  /** 关闭 devtools server */
  close(): Promise<void>
}
