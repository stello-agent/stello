/** Stello SDK 版本号 */
export const VERSION = '0.1.1';

// 导出所有类型定义
export type {
  // Session 系统
  SessionStatus,
  SessionMeta,
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
  IngestResult,
  AfterTurnResult,
  LifecycleHooks,
  // Skill 插槽
  SkillContext,
  SkillResult,
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
  BubblePolicy,
  CoreChangeEvent,
  StelloError,
  StelloEventMap,
  StelloConfig,
  StelloEngine,
} from './types';

// 导出实现
export { NodeFileSystemAdapter } from './fs';
export { SessionTreeImpl } from './session';
export { CoreMemory } from './memory/core-memory';
export { SessionMemory } from './memory/session-memory';
export { LifecycleManager } from './lifecycle/lifecycle-manager';
export { BubbleManager } from './memory/bubble';
export { ConfirmManager } from './confirm/confirm-manager';
export { SplitGuard } from './session/split-guard';
export type { SplitCheckResult } from './session/split-guard';
export { SkillRouterImpl } from './skill/skill-router';
export { AgentTools } from './tools/agent-tools';
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
  StelloAgentCreateConfig,
  StelloAgentLegacyConfig,
  StelloAgentSessionConfig,
  StelloAgentCapabilitiesConfig,
  StelloAgentRuntimeConfig,
  StelloAgentOrchestrationConfig,
} from './agent/stello-agent';

// 导出辅助函数
export { toVisualizerFormat } from './utils/export';
export type { VisualizerNode } from './utils/export';
export { exportForBrowser } from './utils/export-browser';
export type { BrowserExport } from './utils/export-browser';
