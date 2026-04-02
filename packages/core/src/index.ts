/** Stello SDK 版本号 */
export const VERSION = '0.1.1';

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
  LifecycleHooks,
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
} from './types';

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
  adaptMainSessionToSchedulerMainSession,
  serializeSessionSendResult,
  sessionSendResultParser,
  toCoreToolCalls,
} from './adapters/session-runtime';
export type {
  SessionRuntimeAdapterOptions,
  MainSessionAdapterOptions,
  SessionCompatible,
  MainSessionCompatible,
  SessionCompatibleToolCall,
  SessionCompatibleSendResult,
  SessionCompatibleConsolidateFn,
  SessionCompatibleIntegrateFn,
  SessionCompatibleCompressFn,
} from './adapters/session-runtime';
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
export { Scheduler } from './engine/scheduler';
export type {
  ConsolidationTrigger,
  IntegrationTrigger,
  SchedulerSession,
  SchedulerMainSession,
  ConsolidationPolicy,
  IntegrationPolicy,
  SchedulerConfig,
  SchedulerResult,
  SchedulerContext,
} from './engine/scheduler';
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
  OrchestrationStrategy,
} from './orchestrator/session-orchestrator';
export { MainSessionFlatStrategy } from './orchestrator/session-orchestrator';
export { HierarchicalOkrStrategy } from './orchestrator/session-orchestrator';
export { DefaultEngineRuntimeManager } from './orchestrator/engine-runtime-manager';
export type {
  EngineRuntimeManager,
  RuntimeRecyclePolicy,
  RuntimeHolderId,
} from './orchestrator/engine-runtime-manager';
export { DefaultEngineFactory } from './orchestrator/default-engine-factory';
export type {
  SessionRuntimeResolver,
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
export type { LLMCallFn } from './llm/defaults';

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
export type {
  // LLM 适配器
  LLMAdapter, LLMResult, LLMChunk, LLMCompleteOptions, Message,
  ClaudeModel, ClaudeOptions,
  GPTModel, GPTOptions,
  OpenAICompatibleOptions,
  AnthropicAdapterOptions,
  // Session API
  Session, MainSession, SendResult, StreamResult,
  // 存储
  SessionStorage, MainStorage, ListRecordsOptions,
  // 函数签名
  CompressFn, ConsolidateFn, IntegrateFn, IntegrateResult, ChildL2Summary,
  CreateSessionOptions as SessionCreateOptions,
  LoadSessionOptions, CreateMainSessionOptions, LoadMainSessionOptions,
  // 工具
  Tool, CallToolResult,
} from '@stello-ai/session';
