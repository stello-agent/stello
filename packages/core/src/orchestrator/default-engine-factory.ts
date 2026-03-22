import type { SessionTree } from '../types/session';
import type { MemoryEngine } from '../types/memory';
import type { ConfirmProtocol, SkillRouter } from '../types/lifecycle';
import {
  StelloEngineImpl,
  type EngineHooks,
  type EngineLifecycleAdapter,
  type EngineRuntimeSession,
  type EngineToolRuntime,
} from '../engine/stello-engine';
import type { Scheduler, SchedulerMainSession } from '../engine/scheduler';
import type { TurnRunner } from '../engine/turn-runner';
import type { SplitGuard } from '../session/split-guard';
import type { EngineFactory, OrchestratorEngine } from './session-orchestrator';

/** Session runtime 解析器 */
export interface SessionRuntimeResolver {
  /** 根据 sessionId 解析出对应 runtime session */
  resolve(sessionId: string): Promise<EngineRuntimeSession>;
}

/** hooks 提供方式 */
export type EngineHookProvider =
  | Partial<EngineHooks>
  | ((sessionId: string) => Partial<EngineHooks>);

/** 默认 EngineFactory 的构造参数 */
export interface DefaultEngineFactoryOptions {
  sessions: SessionTree;
  memory: MemoryEngine;
  skills: SkillRouter;
  confirm: ConfirmProtocol;
  lifecycle: EngineLifecycleAdapter;
  tools: EngineToolRuntime;
  sessionRuntimeResolver: SessionRuntimeResolver;
  splitGuard?: SplitGuard;
  mainSession?: SchedulerMainSession | null;
  turnRunner?: TurnRunner;
  scheduler?: Scheduler;
  hooks?: EngineHookProvider;
}

/**
 * DefaultEngineFactory
 *
 * 负责把 `sessionId` 装配成一个单-session engine。
 */
export class DefaultEngineFactory implements EngineFactory {
  constructor(private readonly options: DefaultEngineFactoryOptions) {}

  async create(sessionId: string): Promise<OrchestratorEngine> {
    const session = await this.options.sessionRuntimeResolver.resolve(sessionId);
    return new StelloEngineImpl({
      session,
      sessions: this.options.sessions,
      memory: this.options.memory,
      skills: this.options.skills,
      confirm: this.options.confirm,
      lifecycle: this.options.lifecycle,
      tools: this.options.tools,
      splitGuard: this.options.splitGuard,
      mainSession: this.options.mainSession ?? null,
      turnRunner: this.options.turnRunner,
      scheduler: this.options.scheduler,
      hooks: this.resolveHooks(sessionId),
    });
  }

  private resolveHooks(sessionId: string): Partial<EngineHooks> | undefined {
    const { hooks } = this.options;
    if (!hooks) return undefined;
    return typeof hooks === 'function' ? hooks(sessionId) : hooks;
  }
}
