/** consolidate 的触发时机 */
export type ConsolidationTrigger =
  | 'manual'
  | 'everyNTurns'
  | 'onSwitch'
  | 'onArchive'
  | 'onLeave';

/** integrate 的触发时机 */
export type IntegrationTrigger =
  | 'manual'
  | 'afterConsolidate'
  | 'everyNTurns'
  | 'onSwitch'
  | 'onArchive'
  | 'onLeave';

/** 支持调度的 Session 最小契约 */
export interface SchedulerSession {
  /** 供日志和 hooks 使用的稳定标识 */
  id: string;
  /** 当前已完成轮次 */
  turnCount: number;
  /** 由 Session 自己完成 L2/L3 -> memory 的整理 */
  consolidate(): Promise<void>;
}

/** 支持调度的 MainSession 最小契约 */
export interface SchedulerMainSession {
  /** 由上层会话负责做全局整合 */
  integrate(): Promise<void>;
}

/** consolidate 配置 */
export interface ConsolidationPolicy {
  trigger: ConsolidationTrigger;
  everyNTurns?: number;
}

/** integrate 配置 */
export interface IntegrationPolicy {
  trigger: IntegrationTrigger;
  everyNTurns?: number;
}

/** 调度器配置 */
export interface SchedulerConfig {
  consolidation?: ConsolidationPolicy;
  integration?: IntegrationPolicy;
}

/** 调度结果 */
export interface SchedulerResult {
  consolidated: boolean;
  integrated: boolean;
  errors: Array<{
    stage: 'consolidate' | 'integrate';
    error: Error;
  }>;
}

/** 可选的调度上下文 */
export interface SchedulerContext {
  /** 当前要评估的轮次。默认读取 session.turnCount */
  observedTurnCount?: number;
}

/**
 * Scheduler
 *
 * 只关心何时触发 consolidate / integrate，不关心它们的内部实现。
 */
export class Scheduler {
  private readonly consolidation: ConsolidationPolicy;
  private readonly integration: IntegrationPolicy;

  constructor(config: SchedulerConfig = {}) {
    this.consolidation = config.consolidation ?? { trigger: 'manual' };
    this.integration = config.integration ?? { trigger: 'manual' };
  }

  /** turn 结束后的调度 */
  async afterTurn(
    session: SchedulerSession,
    mainSession?: SchedulerMainSession | null,
    context: SchedulerContext = {},
  ): Promise<SchedulerResult> {
    const turnCount = context.observedTurnCount ?? session.turnCount;
    const shouldConsolidate =
      this.consolidation.trigger === 'everyNTurns' &&
      this.hitEveryNTurns(turnCount, this.consolidation.everyNTurns);

    const shouldIntegrateByTurns =
      this.integration.trigger === 'everyNTurns' &&
      this.hitEveryNTurns(turnCount, this.integration.everyNTurns);

    return this.run(session, mainSession, shouldConsolidate, shouldIntegrateByTurns);
  }

  /** session 切换时的调度 */
  async onSessionSwitch(
    session: SchedulerSession,
    mainSession?: SchedulerMainSession | null,
  ): Promise<SchedulerResult> {
    return this.run(
      session,
      mainSession,
      this.consolidation.trigger === 'onSwitch',
      this.integration.trigger === 'onSwitch',
    );
  }

  /** session 归档时的调度 */
  async onSessionArchive(
    session: SchedulerSession,
    mainSession?: SchedulerMainSession | null,
  ): Promise<SchedulerResult> {
    return this.run(
      session,
      mainSession,
      this.consolidation.trigger === 'onArchive',
      this.integration.trigger === 'onArchive',
    );
  }

  /** session leave / round end 时的调度 */
  async onSessionLeave(
    session: SchedulerSession,
    mainSession?: SchedulerMainSession | null,
  ): Promise<SchedulerResult> {
    return this.run(
      session,
      mainSession,
      this.consolidation.trigger === 'onLeave',
      this.integration.trigger === 'onLeave',
    );
  }

  private async run(
    session: SchedulerSession,
    mainSession: SchedulerMainSession | null | undefined,
    shouldConsolidate: boolean,
    shouldIntegrateByTrigger: boolean,
  ): Promise<SchedulerResult> {
    const result: SchedulerResult = {
      consolidated: false,
      integrated: false,
      errors: [],
    };

    if (shouldConsolidate) {
      try {
        await session.consolidate();
        result.consolidated = true;
      } catch (error) {
        result.errors.push({
          stage: 'consolidate',
          error: this.toError(error),
        });
      }
    }

    const shouldIntegrate =
      shouldIntegrateByTrigger ||
      (this.integration.trigger === 'afterConsolidate' && result.consolidated);

    if (shouldIntegrate && mainSession) {
      try {
        await mainSession.integrate();
        result.integrated = true;
      } catch (error) {
        result.errors.push({
          stage: 'integrate',
          error: this.toError(error),
        });
      }
    }

    return result;
  }

  private hitEveryNTurns(turnCount: number, everyNTurns: number | undefined): boolean {
    const threshold = everyNTurns ?? 0;
    return threshold > 0 && turnCount > 0 && turnCount % threshold === 0;
  }

  private toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
  }
}
