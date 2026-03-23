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
import type { Scheduler, SchedulerMainSession, SchedulerSession } from '../engine/scheduler';
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
 * 当有 scheduler 时，构建闭包注入 hooks，Engine 本身不感知调度。
 */
export class DefaultEngineFactory implements EngineFactory {
  constructor(private readonly options: DefaultEngineFactoryOptions) {}

  async create(sessionId: string): Promise<OrchestratorEngine> {
    const session = await this.options.sessionRuntimeResolver.resolve(sessionId);
    const userHooks = this.resolveHooks(sessionId);
    const schedulerHooks = this.buildSchedulerHooks(session);
    const mergedHooks = this.mergeHooks(userHooks, schedulerHooks);

    return new StelloEngineImpl({
      session,
      sessions: this.options.sessions,
      memory: this.options.memory,
      skills: this.options.skills,
      confirm: this.options.confirm,
      lifecycle: this.options.lifecycle,
      tools: this.options.tools,
      splitGuard: this.options.splitGuard,
      turnRunner: this.options.turnRunner,
      hooks: mergedHooks,
    });
  }

  /** 构建 scheduler 闭包 hooks */
  private buildSchedulerHooks(session: SchedulerSession): Partial<EngineHooks> {
    const { scheduler, mainSession } = this.options;
    if (!scheduler) return {};
    return {
      onRoundEnd: () => {
        scheduler.afterTurn(session, mainSession, {
          observedTurnCount: session.turnCount + 1,
        }).catch(() => {});
      },
      onSessionLeave: () => {
        scheduler.onSessionLeave(session, mainSession).catch(() => {});
      },
      onSessionArchive: () => {
        scheduler.onSessionArchive(session, mainSession).catch(() => {});
      },
    };
  }

  /** 合并用户 hooks 和 scheduler hooks，同一 key 下两者都 fire */
  private mergeHooks(
    userHooks?: Partial<EngineHooks>,
    schedulerHooks?: Partial<EngineHooks>,
  ): Partial<EngineHooks> | undefined {
    if (!userHooks && !schedulerHooks) return undefined;
    if (!userHooks) return schedulerHooks;
    if (!schedulerHooks || Object.keys(schedulerHooks).length === 0) return userHooks;

    const merged: Partial<EngineHooks> = { ...userHooks };
    for (const key of Object.keys(schedulerHooks) as Array<keyof EngineHooks>) {
      const userFn = userHooks[key] as ((ctx: unknown) => Promise<void> | void) | undefined;
      const schedFn = schedulerHooks[key] as ((ctx: unknown) => Promise<void> | void) | undefined;
      if (!schedFn) continue;
      if (!userFn) {
        (merged as Record<string, unknown>)[key] = schedFn;
      } else {
        (merged as Record<string, unknown>)[key] = (ctx: unknown) => {
          userFn(ctx);
          schedFn(ctx);
        };
      }
    }
    return merged;
  }

  private resolveHooks(sessionId: string): Partial<EngineHooks> | undefined {
    const { hooks } = this.options;
    if (!hooks) return undefined;
    return typeof hooks === 'function' ? hooks(sessionId) : hooks;
  }
}
