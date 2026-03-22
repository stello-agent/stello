// ─── 引擎配置 + 主接口 + 事件类型定义 ───

import type { SessionTree } from './session';
import type {
  InheritancePolicy,
  CoreSchema,
  TurnRecord,
  AssembledContext,
  MemoryEngine,
} from './memory';
import type { FileSystemAdapter } from './fs';
import type {
  LifecycleHooks,
  BootstrapResult,
  IngestResult,
  AfterTurnResult,
  SkillRouter,
  ToolDefinition,
  ToolExecutionResult,
  SplitProposal,
  UpdateProposal,
  ConfirmProtocol,
} from './lifecycle';
import type { EngineStreamResult, EngineTurnResult } from '../engine/stello-engine';
import type { TurnRunnerOptions } from '../engine/turn-runner';

// ─── 策略配置 ───

/** 拆分策略配置 */
export interface SplitStrategy {
  /** 最少轮次才允许拆分（默认 3） */
  minTurns?: number;
  /** 冷却期轮次（默认 5） */
  cooldownTurns?: number;
  /** 漂移阈值（0-1，默认 0.7），仅 embedder 启用时有效 */
  driftThreshold?: number;
}

/** 冒泡策略配置 */
export interface BubblePolicy {
  /** 冒泡时机（默认 immediate） */
  timing: 'immediate' | 'on-archive';
  /** 防抖毫秒数（默认 500） */
  debounceMs?: number;
  /** 冲突处理策略（默认 last-write-wins） */
  conflictStrategy: 'last-write-wins';
}

// ─── 事件系统 ───

/** L1 核心档案变更事件 */
export interface CoreChangeEvent {
  /** 变更字段路径 */
  path: string;
  /** 旧值 */
  oldValue: unknown;
  /** 新值 */
  newValue: unknown;
}

/** 错误事件 */
export interface StelloError {
  /** 错误来源（如 'afterTurn.l2'、'bubble'） */
  source: string;
  /** 错误对象 */
  error: Error;
}

/** 事件映射表 */
export interface StelloEventMap {
  /** 拆分建议事件 */
  splitProposal: SplitProposal;
  /** L1 更新建议事件 */
  updateProposal: UpdateProposal;
  /** L1 核心档案变更通知 */
  coreChange: CoreChangeEvent;
  /** 错误通知 */
  error: StelloError;
}

// ─── 引擎配置 ───

/**
 * Stello 引擎配置
 *
 * 创建 Stello 实例时传入。只有 dataDir、coreSchema、callLLM 是必填，
 * 其余都有合理默认值。
 */
export interface StelloConfig {
  /** 数据根目录路径 */
  dataDir: string;
  /** L1 核心档案的结构定义 */
  coreSchema: CoreSchema;
  /** LLM 调用函数（框架用来提取 L2 摘要等） */
  callLLM: (prompt: string) => Promise<string>;
  /** embedding 函数（可选，传入后激活路径 A 漂移检测） */
  embedder?: (text: string) => Promise<number[]>;
  /** 记忆继承策略（默认 'summary'） */
  inheritancePolicy?: InheritancePolicy;
  /** 冒泡策略 */
  bubblePolicy?: Partial<BubblePolicy>;
  /** 拆分策略 */
  splitStrategy?: Partial<SplitStrategy>;
  /** 生命周期钩子覆盖 */
  hooks?: Partial<LifecycleHooks>;
  /** 文件系统适配器（默认 FileSystemAdapter） */
  adapter?: FileSystemAdapter;
}

// ─── 引擎主接口 ───

/**
 * Stello 引擎主接口
 *
 * 开发者通过此接口驱动整个对话拓扑引擎。
 */
export interface StelloEngine {
  /** 当前绑定的 Session ID */
  readonly sessionId: string;
  /** Session 树操作 */
  readonly sessions: SessionTree;
  /** 记忆系统 */
  readonly memory: MemoryEngine;
  /** Skill 路由 */
  readonly skills: SkillRouter;
  /** 确认协议 */
  readonly confirm: ConfirmProtocol;

  /** 处理用户消息：意图识别 + 漂移检测 */
  ingest(message: TurnRecord): Promise<IngestResult>;
  /** 组装 prompt 上下文：按 scope + 继承策略注入记忆 */
  assemble(): Promise<AssembledContext>;
  /** 轮次结束处理：提取写 L1 + 提炼 L2 + 追加 L3 */
  afterTurn(userMsg: TurnRecord, assistantMsg: TurnRecord): Promise<AfterTurnResult>;
  /** 进入当前绑定 Session 的整轮对话 */
  enterSession(): Promise<BootstrapResult>;
  /** 离开当前绑定 Session 的整轮对话 */
  leaveSession(): Promise<{ sessionId: string }>;
  /** 流式处理当前绑定 Session 的一轮对话 */
  stream(input: string, options?: TurnRunnerOptions): EngineStreamResult;
  /** 非流式处理当前绑定 Session 的一轮对话 */
  turn?(input: string, options?: TurnRunnerOptions): Promise<EngineTurnResult>;
  /** 导出 Agent Tool 定义（兼容 OpenAI / Claude tool use） */
  getToolDefinitions(): ToolDefinition[];
  /** 执行 Agent Tool */
  executeTool(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult>;
  /** 监听事件 */
  on<K extends keyof StelloEventMap>(event: K, handler: (data: StelloEventMap[K]) => void): void;
  /** 取消监听 */
  off<K extends keyof StelloEventMap>(event: K, handler: (data: StelloEventMap[K]) => void): void;
}
