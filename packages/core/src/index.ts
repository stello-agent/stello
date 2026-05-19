/** Stello SDK 版本号 */
export const VERSION = '0.10.0';

// 导出所有类型定义
export type {
  // Session 系统
  SessionStatus,
  SessionMeta,
  TopologyNode,
  SessionTreeNode,
  CreateSessionOptions,
  SessionTree,
  // 文件系统适配器
  FileSystemAdapter,
  // 生命周期钩子
  BootstrapResult,
  AfterTurnResult,
  // Skill 插槽
  Skill,
  SkillRouter,
  // Agent Tools
  ToolDefinition,
  ToolExecutionResult,
  // 确认协议
  SplitProposal,
  UpdateProposal,
  ConfirmProtocol,
  // 引擎
  SplitStrategy,
  CoreChangeEvent,
  StelloError,
  StelloEventMap,
  StelloEngine,
  EngineForkOptions,
  SessionRuntimeResolver,
  // Session 统一配置类型
  SessionConfig,
  SerializableSessionConfig,
} from './types';

export type { ToolExecutionContext } from './types/tool';
// Re-export internal types that appear in public interfaces (BootstrapResult,
// StelloEngine) so consumers can type their lifecycle implementations.
export type { TurnRecord, AssembledContext } from './types/memory';

// 导出实现
export { NodeFileSystemAdapter } from './fs';
export { SessionTreeImpl } from './session';
export { SplitGuard } from './session/split-guard';
export type { SplitCheckResult } from './session/split-guard';
export { SkillRouterImpl } from './skill/skill-router';
export { createSkillToolDefinition, executeSkillTool } from './skill/skill-tool';
export { loadSkillsFromDirectory, parseFrontmatter } from './skill/skill-loader';
export {
  adaptSessionToEngineRuntime,
  serializeSessionSendResult,
  sessionSendResultParser,
  toCoreToolCalls,
} from './adapters/session-runtime';
export type {
  SessionRuntimeAdapterOptions,
  SessionCompatible,
  SessionCompatibleToolCall,
  SessionCompatibleSendResult,
  SessionCompatibleConsolidateFn,
  SessionCompatibleCompressFn,
  SessionCompatibleForkOptions,
} from './adapters/session-runtime';
export { ForkProfileRegistryImpl } from './engine/fork-profile';
export type { ForkProfile, ForkProfileRegistry } from './engine/fork-profile';
export { ToolRegistryImpl, buildSessionToolList } from './tool/tool-registry';
export type { ToolRegistry, ToolRegistryEntry } from './tool/tool-registry';
export { TurnRunner } from './engine/turn-runner';
export type {
  ToolCall,
  ToolCallResult,
  ParsedTurnResponse,
  TurnRunnerSession,
  TurnRunnerToolExecutor,
  ToolCallParser,
  TurnRunnerOptions,
  TurnRunnerResult,
} from './engine/turn-runner';
export { StelloEngineImpl } from './engine/stello-engine';
export type {
  EngineRuntimeSession,
  EngineLifecycleAdapter,
  EngineToolRuntime,
  StelloEngineOptions,
  EngineTurnResult,
  EngineRoundContext,
  EngineRoundResultContext,
  EngineHooks,
} from './engine/stello-engine';
export { SessionOrchestrator } from './orchestrator/session-orchestrator';
export type {
  OrchestratorEngine,
  EngineFactory,
} from './orchestrator/session-orchestrator';
export { DefaultEngineRuntimeManager } from './orchestrator/engine-runtime-manager';
export type {
  EngineRuntimeManager,
  RuntimeRecyclePolicy,
  RuntimeHolderId,
} from './orchestrator/engine-runtime-manager';
export { DefaultEngineFactory } from './orchestrator/default-engine-factory';
export type {
  EngineHookProvider,
  DefaultEngineFactoryOptions,
} from './orchestrator/default-engine-factory';
export { StelloAgent, createStelloAgent } from './agent/stello-agent';
export type {
  StelloAgentConfig,
  StelloAgentHotConfig,
  StelloAgentSessionConfig,
  StelloAgentCapabilitiesConfig,
  StelloAgentRuntimeConfig,
  StelloAgentOrchestrationConfig,
  SessionMetadataView,
  SessionDigest,
} from './agent/stello-agent';

// 共享 memory
export { InMemorySharedMemoryStore } from './shared-memory/in-memory-shared-memory-store';
export { renderSharedMemoryIndex } from './shared-memory/render-index';
export type { SharedMemoryEntry, SharedMemoryStore } from './shared-memory/types';

// 内置 tool 工厂（builtin-tools redesign）
export {
  createSessionTool,
  activateSkillTool,
  memoryRecallTool,
  memoryRememberTool,
  memoryForgetTool,
} from './builtin-tools';

// 导出 LLM 默认实现
export {
  createDefaultConsolidateFn,
  createDefaultCompressFn,
  DEFAULT_CONSOLIDATE_PROMPT,
  DEFAULT_COMPRESS_PROMPT,
} from './llm/defaults';
export type { LLMCallFn, DefaultFnOptions } from './llm/defaults';

// Re-export @stello-ai/session 常用接口，core 用户无需额外 import session 包
export { createSession, loadSession } from '@stello-ai/session';
export { createClaude } from '@stello-ai/session';
export { createGPT } from '@stello-ai/session';
export { createOpenAICompatibleAdapter } from '@stello-ai/session';
export { createAnthropicAdapter } from '@stello-ai/session';
export { InMemoryStorageAdapter } from '@stello-ai/session';
// Note: session 包的 createSessionTool 已被 core 的 builtin-tools 工厂替代，
// 不再从 core 重新导出（避免与 './builtin-tools' 同名冲突）。
export { tool } from '@stello-ai/session';
export { SessionArchivedError, NotImplementedError } from '@stello-ai/session';
export type {
  // LLM 适配器
  LLMAdapter, LLMResult, LLMChunk, LLMCompleteOptions, Message,
  ClaudeModel, ClaudeOptions,
  GPTModel, GPTOptions,
  OpenAICompatibleOptions,
  AnthropicAdapterOptions,
  // Session API
  Session, SendResult, StreamResult,
  MessageQueryOptions,
  // Session 元数据
  SessionMetaUpdate, SessionFilter,
  // Fork
  ForkOptions, ForkContextFn,
  // 存储
  SessionStorage, ListRecordsOptions,
  // 函数签名
  CompressFn, ConsolidateFn,
  CreateSessionOptions as SessionCreateOptions,
  LoadSessionOptions,
  // 工具
  Tool, CallToolResult, ToolAnnotations,
} from '@stello-ai/session';
