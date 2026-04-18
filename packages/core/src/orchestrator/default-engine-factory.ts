import type { SessionTree } from '../types/session';
import type { MemoryEngine } from '../types/memory';
import type { ConfirmProtocol, SkillRouter } from '../types/lifecycle';
import { FilteredSkillRouter } from '../skill/filtered-skill-router';
import {
  StelloEngineImpl,
  type EngineHooks,
  type EngineLifecycleAdapter,
  type EngineRuntimeSession,
  type EngineToolRuntime,
} from '../engine/stello-engine';
import type { TurnRunner } from '../engine/turn-runner';
import type { SplitGuard } from '../session/split-guard';
import type { ForkProfileRegistry } from '../engine/fork-profile';
import type { EngineFactory, OrchestratorEngine } from './session-orchestrator';
import type { SessionRuntimeResolver } from '../types/engine';
import type { SessionConfig } from '../types/session-config';

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
  profiles?: ForkProfileRegistry;
  turnRunner?: TurnRunner;
  hooks?: EngineHookProvider;
  /** 每 N 轮自动触发 consolidation（0 或不传则禁用） */
  consolidateEveryNTurns?: number;
  /** Agent 级默认配置（fork 合成链最低优先级） */
  sessionDefaults?: SessionConfig;
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
    const userHooks = this.resolveHooks(sessionId);
    const autoHooks = this.buildAutoConsolidateHook(session);
    const mergedHooks = this.mergeHooks(userHooks, autoHooks);
    const skills = await this.resolveSkillRouter(sessionId);

    return new StelloEngineImpl({
      session,
      sessions: this.options.sessions,
      memory: this.options.memory,
      skills,
      confirm: this.options.confirm,
      lifecycle: this.options.lifecycle,
      tools: this.options.tools,
      splitGuard: this.options.splitGuard,
      profiles: this.options.profiles,
      turnRunner: this.options.turnRunner,
      hooks: mergedHooks,
      sessionDefaults: this.options.sessionDefaults,
    });
  }

  /** 按固化 SessionConfig.skills 创建过滤后的 SkillRouter：undefined=继承，[]=禁用，['a']=白名单 */
  private async resolveSkillRouter(sessionId: string): Promise<SkillRouter> {
    const frozen = typeof this.options.sessions.getConfig === 'function'
      ? await this.options.sessions.getConfig(sessionId)
      : null;

    if (!frozen || frozen.skills === undefined) {
      return this.options.skills;
    }

    return new FilteredSkillRouter(
      this.options.skills,
      new Set(frozen.skills),
    );
  }

  private resolveHooks(sessionId: string): Partial<EngineHooks> | undefined {
    const { hooks } = this.options;
    if (!hooks) return undefined;
    return typeof hooks === 'function' ? hooks(sessionId) : hooks;
  }

  /** 构建自动 consolidation hook */
  private buildAutoConsolidateHook(session: EngineRuntimeSession): Partial<EngineHooks> {
    const n = this.options.consolidateEveryNTurns;
    if (!n || n <= 0) return {};
    return {
      onRoundEnd: () => {
        const next = session.turnCount + 1;
        this.options.sessions.updateMeta(session.id, { turnCount: next }).catch(() => {});
        if (next % n === 0) {
          session.consolidate().catch(() => {});
        }
      },
    };
  }

  /** 合并用户 hooks 和自动 hooks，同一 key 下两者都 fire */
  private mergeHooks(
    userHooks?: Partial<EngineHooks>,
    autoHooks?: Partial<EngineHooks>,
  ): Partial<EngineHooks> | undefined {
    if (!userHooks && !autoHooks) return undefined;
    if (!userHooks) return autoHooks;
    if (!autoHooks || Object.keys(autoHooks).length === 0) return userHooks;

    const merged: Partial<EngineHooks> = { ...userHooks };
    for (const key of Object.keys(autoHooks) as Array<keyof EngineHooks>) {
      const userFn = userHooks[key] as ((ctx: unknown) => Promise<void> | void) | undefined;
      const autoFn = autoHooks[key] as ((ctx: unknown) => Promise<void> | void) | undefined;
      if (!autoFn) continue;
      if (!userFn) {
        (merged as Record<string, unknown>)[key] = autoFn;
      } else {
        (merged as Record<string, unknown>)[key] = (ctx: unknown) => {
          userFn(ctx);
          autoFn(ctx);
        };
      }
    }
    return merged;
  }
}
