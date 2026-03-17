/** Stello SDK 版本号 */
export const VERSION = '0.1.0';

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
  SessionSummary,
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
