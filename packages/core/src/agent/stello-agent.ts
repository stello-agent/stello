import type { BootstrapResult } from '../types/lifecycle';
import { TurnRunner, type ToolCallParser, type TurnRunnerOptions } from '../engine/turn-runner';
import type { EngineTurnResult } from '../engine/stello-engine';
import type { EngineStreamResult } from '../engine/stello-engine';
import {
  DefaultEngineFactory,
  type EngineHookProvider,
} from '../orchestrator/default-engine-factory';
import type { SessionRuntimeResolver, EngineForkOptions } from '../types/engine';
import {
  DefaultEngineRuntimeManager,
  type EngineRuntimeManager,
  type RuntimeRecyclePolicy,
  type RuntimeHolderId,
} from '../orchestrator/engine-runtime-manager';
import {
  MainSessionFlatStrategy,
  SessionOrchestrator,
  type OrchestrationStrategy,
} from '../orchestrator/session-orchestrator';
import {
  adaptSessionToEngineRuntime,
  serializeSessionSendResult,
  sessionSendResultParser,
  type MainSessionCompatible,
  type SessionCompatible,
  type SessionCompatibleCompressFn,
  type SessionCompatibleSendResult,
} from '../adapters/session-runtime';
import type { SessionTree } from '../types/session';
import type { MemoryEngine } from '../types/memory';
import type { ConfirmProtocol, SkillRouter } from '../types/lifecycle';
import type { EngineLifecycleAdapter, EngineToolRuntime } from '../engine/stello-engine';
import type { ForkProfileRegistry } from '../engine/fork-profile';
import type { SplitGuard } from '../session/split-guard';

/** Session 能力相关配置 */
export interface StelloAgentCapabilitiesConfig {
  lifecycle: EngineLifecycleAdapter;
  tools: EngineToolRuntime;
  skills: SkillRouter;
  confirm: ConfirmProtocol;
  /** Fork profile 注册表（可选） */
  profiles?: ForkProfileRegistry;
}

/**
 * Session 组件接入配置。
 *
 * 这部分配置用于把 @stello-ai/session 的真实 Session / MainSession
 * 正式接入到 core 的 Engine 体系里。
 */
export interface StelloAgentSessionConfig {
  /** 按 sessionId 解析真实 Session */
  sessionResolver?: (sessionId: string) => Promise<SessionCompatible>;
  /** 解析 MainSession（可选，仅在需要 integration 时提供） */
  mainSessionResolver?: () => Promise<MainSessionCompatible | null>;
  /** 上下文压缩函数（超阈值时调用） */
  compressFn?: SessionCompatibleCompressFn;
  /** send() 结果序列化方式，默认 JSON 序列化 */
  serializeSendResult?: (result: SessionCompatibleSendResult) => string;
  /** TurnRunner 用的 tool call parser，默认 sessionSendResultParser */
  toolCallParser?: ToolCallParser;
  /** 预留给 Session 组件的透传配置 */
  options?: Record<string, unknown>;
}

/** Session runtime 相关配置 */
export interface StelloAgentRuntimeConfig {
  resolver: SessionRuntimeResolver;
  recyclePolicy?: RuntimeRecyclePolicy;
}

/** Engine / Orchestrator 编排相关配置 */
export interface StelloAgentOrchestrationConfig {
  strategy?: OrchestrationStrategy;
  splitGuard?: SplitGuard;
  turnRunner?: TurnRunner;
  hooks?: EngineHookProvider;
  /** 每 N 轮自动触发 consolidation（0 或不传则禁用） */
  consolidateEveryNTurns?: number;
}

/**
 * StelloAgent 新版顶层配置。
 *
 * 这是面向使用者的推荐配置形状：
 * - `capabilities` 放能力注入
 * - `runtime` 放 session runtime 与回收策略
 * - `orchestration` 放编排层策略
 */
export interface StelloAgentConfig {
  sessions: SessionTree;
  memory: MemoryEngine;
  session?: StelloAgentSessionConfig;
  capabilities: StelloAgentCapabilitiesConfig;
  runtime?: StelloAgentRuntimeConfig;
  orchestration?: StelloAgentOrchestrationConfig;
}


function resolveRuntimeResolver(config: StelloAgentConfig): SessionRuntimeResolver {
  if (config.runtime?.resolver) {
    return config.runtime.resolver;
  }

  if (config.session?.sessionResolver) {
    const adaptOptions = {
      compressFn: config.session!.compressFn,
      serializeResult: config.session!.serializeSendResult ?? serializeSessionSendResult,
    };
    return {
      resolve: async (sessionId: string) => {
        const session = await config.session!.sessionResolver!(sessionId);
        return adaptSessionToEngineRuntime(session, adaptOptions);
      },
    };
  }

  throw new Error(
    'StelloAgentConfig 缺少 runtime.resolver；若使用 session 配置接入，请提供 session.sessionResolver',
  );
}

function resolveTurnRunner(config: StelloAgentConfig): TurnRunner | undefined {
  if (config.orchestration?.turnRunner) {
    return config.orchestration.turnRunner;
  }

  if (config.session?.toolCallParser || config.session?.serializeSendResult) {
    return new TurnRunner(config.session.toolCallParser ?? sessionSendResultParser);
  }

  if (config.session?.sessionResolver) {
    return new TurnRunner(sessionSendResultParser);
  }

  return undefined;
}

/**
 * StelloAgent
 *
 * 这是当前 core 层推荐的最高层对象。
 * 使用者不需要手动装配 orchestrator / engine factory，
 * 只需要提供依赖配置即可完成初始化。
 */
export class StelloAgent {
  /** 归一化后的顶层配置 */
  readonly config: StelloAgentConfig;

  /** 暴露 SessionTree，方便调用方做拓扑查询 */
  readonly sessions: StelloAgentConfig['sessions'];

  /** 暴露 MemoryEngine，方便调用方做数据读写 */
  readonly memory: StelloAgentConfig['memory'];

  private readonly orchestrator: SessionOrchestrator;
  private readonly runtimeManager: EngineRuntimeManager;

  constructor(config: StelloAgentConfig) {
    this.config = config;
    this.sessions = config.sessions;
    this.memory = config.memory;
    const engineFactory = new DefaultEngineFactory({
      sessions: config.sessions,
      memory: config.memory,
      lifecycle: config.capabilities.lifecycle,
      tools: config.capabilities.tools,
      skills: config.capabilities.skills,
      confirm: config.capabilities.confirm,
      sessionRuntimeResolver: resolveRuntimeResolver(config),
      profiles: config.capabilities.profiles,
      splitGuard: config.orchestration?.splitGuard,
      turnRunner: resolveTurnRunner(config),
      hooks: config.orchestration?.hooks,
      consolidateEveryNTurns: config.orchestration?.consolidateEveryNTurns,
    });
    this.runtimeManager = new DefaultEngineRuntimeManager(
      engineFactory,
      config.runtime?.recyclePolicy,
    );
    this.orchestrator = new SessionOrchestrator(
      config.sessions,
      this.runtimeManager,
      config.orchestration?.strategy ?? new MainSessionFlatStrategy(),
    );
  }

  /** 进入指定 session 的整轮对话 */
  enterSession(sessionId: string): Promise<BootstrapResult> {
    return this.orchestrator.enterSession(sessionId);
  }

  /** 在指定 session 上运行一轮对话 */
  turn(
    sessionId: string,
    input: string,
    options?: TurnRunnerOptions,
  ): Promise<EngineTurnResult> {
    return this.orchestrator.turn(sessionId, input, options);
  }

  /** 在指定 session 上流式运行一轮对话 */
  stream(
    sessionId: string,
    input: string,
    options?: TurnRunnerOptions,
  ): Promise<EngineStreamResult> {
    return this.orchestrator.stream(sessionId, input, options);
  }

  /** 离开指定 session */
  leaveSession(sessionId: string): Promise<{ sessionId: string }> {
    return this.orchestrator.leaveSession(sessionId);
  }

  /** 从指定 session 发起 fork */
  forkSession(
    sessionId: string,
    options: EngineForkOptions,
  ) {
    return this.orchestrator.forkSession(sessionId, options);
  }

  /** 归档指定 session */
  archiveSession(sessionId: string) {
    return this.orchestrator.archiveSession(sessionId);
  }

  /** 显式附着一个 session runtime，常用于 WS 连接建立时 */
  attachSession(sessionId: string, holderId: RuntimeHolderId) {
    return this.runtimeManager.acquire(sessionId, holderId);
  }

  /** 释放一个 session runtime 持有者，常用于 WS 断开时 */
  detachSession(sessionId: string, holderId: RuntimeHolderId) {
    return this.runtimeManager.release(sessionId, holderId);
  }

  /** 当前是否已激活某个 session 的 engine */
  hasActiveEngine(sessionId: string): boolean {
    return this.runtimeManager.has(sessionId);
  }

  /** 当前某个 session 的 engine 引用计数 */
  getEngineRefCount(sessionId: string): number {
    return this.runtimeManager.getRefCount(sessionId);
  }

  /** 对指定 session 执行 consolidation */
  consolidateSession(sessionId: string): Promise<void> {
    return this.orchestrator.consolidateSession(sessionId);
  }

  /** 对 main session 执行 integration */
  async integrate(): Promise<unknown> {
    const mainSessionResolver = this.config.session?.mainSessionResolver;
    if (!mainSessionResolver) {
      throw new Error('No mainSessionResolver configured');
    }
    const mainSession = await mainSessionResolver();
    if (!mainSession) {
      throw new Error('MainSession not found');
    }
    return mainSession.integrate();
  }

  /** 热更新运行时配置（仅支持值类型字段） */
  updateConfig(patch: StelloAgentHotConfig): void {
    if (patch.runtime && 'updateRecyclePolicy' in this.runtimeManager) {
      (this.runtimeManager as DefaultEngineRuntimeManager).updateRecyclePolicy(patch.runtime);
    }
    if (patch.splitGuard) {
      this.config.orchestration?.splitGuard?.updateConfig?.(patch.splitGuard);
    }
  }

}

/**
 * 可热更新的配置子集。
 *
 * 仅包含运行时可安全修改的值类型字段，不包含函数/对象引用类配置。
 */
export interface StelloAgentHotConfig {
  runtime?: Partial<RuntimeRecyclePolicy>;
  splitGuard?: Partial<{ minTurns: number; cooldownTurns: number }>;
}

/** create 函数风格的便捷入口 */
export function createStelloAgent(config: StelloAgentConfig): StelloAgent {
  return new StelloAgent(config);
}
