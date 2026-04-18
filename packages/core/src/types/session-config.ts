// ─── Session 统一配置类型定义 ───

import type { LLMAdapter, LLMCompleteOptions } from '@stello-ai/session';
import type {
  SessionCompatibleConsolidateFn,
  SessionCompatibleCompressFn,
  SessionCompatibleIntegrateFn,
} from '../adapters/session-runtime';

/**
 * 普通 Session 的配置字段集
 *
 * 固化后写入存储，不可变。覆盖单个 Session 在上下文组装、LLM 调用、
 * tool 调度、L3→L2 提炼、上下文压缩等环节所需的全部可配置项。
 */
export interface SessionConfig {
  /** 该 Session 的 system prompt */
  systemPrompt?: string;
  /** 该 Session 使用的 LLM 适配器 */
  llm?: LLMAdapter;
  /** 用户 tool 定义集合 */
  tools?: LLMCompleteOptions['tools'];
  /** skill 白名单：undefined=继承全局；[]=禁用 activate_skill；['a','b']=仅允许指定 skill */
  skills?: string[];
  /** L3→L2 提炼函数 */
  consolidateFn?: SessionCompatibleConsolidateFn;
  /** 上下文压缩函数 */
  compressFn?: SessionCompatibleCompressFn;
}

/**
 * Main Session 的配置字段集
 *
 * 独立于 SessionConfig，不参与 fallback 链。覆盖 Main Session
 * 在上下文组装、LLM 调用、tool 调度、integration、上下文压缩等
 * 环节所需的全部可配置项。
 */
export interface MainSessionConfig {
  /** Main Session 的 system prompt */
  systemPrompt?: string;
  /** Main Session 使用的 LLM 适配器 */
  llm?: LLMAdapter;
  /** 用户 tool 定义集合 */
  tools?: LLMCompleteOptions['tools'];
  /** skill 白名单：undefined=继承全局；[]=禁用 activate_skill；['a','b']=仅允许指定 skill */
  skills?: string[];
  /** all L2s → synthesis + insights 的 integration 函数 */
  integrateFn?: SessionCompatibleIntegrateFn;
  /** 上下文压缩函数 */
  compressFn?: SessionCompatibleCompressFn;
}

/**
 * SessionConfig 的可序列化子集
 *
 * 用于存储固化配置：只保留纯数据字段，丢弃函数/适配器等运行时引用。
 * 运行时通过 mergeSessionConfig 与 sessionDefaults 重新合成完整 SessionConfig。
 */
export interface SerializableSessionConfig {
  /** 该 Session 的 system prompt */
  systemPrompt?: string;
  /** skill 白名单 */
  skills?: string[];
}

/**
 * MainSessionConfig 的可序列化子集
 *
 * 语义与 SerializableSessionConfig 相同，但独立声明以保持与 MainSessionConfig
 * 的一一对应关系，便于未来各自扩展。
 */
export interface SerializableMainSessionConfig {
  /** Main Session 的 system prompt */
  systemPrompt?: string;
  /** skill 白名单 */
  skills?: string[];
}
