/** Session 元数据，描述一个独立对话单元 */
export interface SessionMeta {
  readonly id: string
  label: string
  /** 'standard' 为普通会话，'main' 为根主会话 */
  role: 'standard' | 'main'
  status: 'active' | 'archived'
  tags: string[]
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

/** 可更新的 SessionMeta 字段子集 */
export interface SessionMetaUpdate {
  label?: string
  tags?: string[]
  metadata?: Record<string, unknown>
}

/** 列举 Session 时的过滤条件 */
export interface SessionFilter {
  status?: 'active' | 'archived'
  role?: 'standard' | 'main'
  tags?: string[]
}

import type { Message, LLMAdapter, LLMCompleteOptions } from './llm.js'

/** fork 时的上下文转换函数：接收父 Session 的 L3 记录，返回写入子 Session 的记录 */
export type ForkContextFn = (parentRecords: Message[]) => Message[] | Promise<Message[]>

/** fork 操作的选项 */
export interface ForkOptions {
  label: string
  /** 系统提示词；不提供则继承父 Session */
  systemPrompt?: string
  /** 上下文策略：'none'(默认) 空 L3；'inherit' 拷贝父 L3；函数则自定义转换 */
  context?: 'none' | 'inherit' | ForkContextFn
  /** 子 Session 的第一条用户消息 */
  prompt?: string
  /** 覆盖父 Session 的 LLM 适配器 */
  llm?: LLMAdapter
  /** 覆盖父 Session 的工具列表 */
  tools?: LLMCompleteOptions['tools']
  tags?: string[]
  metadata?: Record<string, unknown>
}
