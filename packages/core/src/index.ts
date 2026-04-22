/** Stello SDK 版本号 */
export const VERSION = '0.5.2';

// 导出所有类型定义
export type {
  // Session 系统
  SessionStatus,
  SessionMeta,
  TopologyNode,
  SessionTreeNode,
  CreateSessionOptions,
  SessionTree,
  // 记忆系统
  InheritancePolicy,
  CoreSchemaField,
  CoreSchema,
  TurnRecord,
  AssembledContext,
  MemoryEngine,
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
  MainSessionConfig,
  SerializableSessionConfig,
  SerializableMainSessionConfig,
} from './types';

// 导出常量
export { MAIN_SESSION_ID } from './types/session';

// 导出实现
export { NodeFileSystemAdapter } from './fs';
export { SessionTreeImpl } from './session';
export { FileSystemMemoryEngine } from './memory/file-system-memory-engine';
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
  MainSessionCompatible,
  SessionCompatibleToolCall,
  SessionCompatibleSendResult,
  SessionCompatibleConsolidateFn,
  SessionCompatibleIntegrateFn,
  SessionCompatibleCompressFn,
  SessionCompatibleForkOptions,
} from './adapters/session-runtime';
export { ForkProfileRegistryImpl } from './engine/fork-profile';
export type { ForkProfile, ForkProfileRegistry } from './engine/fork-profile';
export { ToolRegistryImpl, CompositeToolRuntime, createBuiltinToolEntries, buildSessionToolList } from './tool/tool-registry';
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
} from './agent/stello-agent';

// 导出 LLM 默认实现
export {
  createDefaultConsolidateFn,
  createDefaultIntegrateFn,
  createDefaultCompressFn,
  DEFAULT_CONSOLIDATE_PROMPT,
  DEFAULT_INTEGRATE_PROMPT,
  DEFAULT_COMPRESS_PROMPT,
} from './llm/defaults';
export type { LLMCallFn, DefaultFnOptions } from './llm/defaults';

// Re-export @stello-ai/session 常用接口，core 用户无需额外 import session 包
export { createSession, loadSession } from '@stello-ai/session';
export { createMainSession, loadMainSession } from '@stello-ai/session';
export { createClaude } from '@stello-ai/session';
export { createGPT } from '@stello-ai/session';
export { createOpenAICompatibleAdapter } from '@stello-ai/session';
export { createAnthropicAdapter } from '@stello-ai/session';
export { InMemoryStorageAdapter } from '@stello-ai/session';
export { createSessionTool } from '@stello-ai/session';
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
  Session, MainSession, SendResult, StreamResult,
  MessageQueryOptions,
  // Session 元数据
  SessionMetaUpdate, SessionFilter,
  // Fork
  ForkOptions, ForkContextFn,
  // 存储
  SessionStorage, MainStorage, ListRecordsOptions,
  // 函数签名
  CompressFn, ConsolidateFn, IntegrateFn, IntegrateResult, ChildL2Summary,
  CreateSessionOptions as SessionCreateOptions,
  LoadSessionOptions, CreateMainSessionOptions, LoadMainSessionOptions,
  // 工具
  Tool, CallToolResult, ToolAnnotations,
} from '@stello-ai/session';
