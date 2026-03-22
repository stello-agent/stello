/** consolidate 调度策略。 */
export interface ConsolidationPolicy {
  /** 触发 consolidate 的时机。 */
  mode: 'manual' | 'everyNTurns' | 'onSwitch' | 'onArchive';
  /** mode=everyNTurns 时的轮次阈值。 */
  everyNTurns?: number;
}

/** integrate 调度策略。 */
export interface IntegrationPolicy {
  /** 触发 integrate 的时机。 */
  mode: 'manual' | 'afterConsolidate' | 'everyNTurns' | 'onSwitch';
  /** mode=everyNTurns 时的轮次阈值。 */
  everyNTurns?: number;
}

/** 编排层消费的 Session 最小接口。 */
export interface SchedulerSession {
  /** 当前 session 的最小元信息，足够支持调度决策。 */
  meta: {
    /** session id，仅用于日志或后续扩展。 */
    id: string;
    /** 当前 turn 次数，用于 everyNTurns 判断。 */
    turnCount: number;
    /** 最近一次 consolidate 时对应的轮次。 */
    consolidatedTurn?: number;
  };
  /** 对当前 session 执行一次 consolidate。 */
  consolidate(fn: unknown): Promise<void>;
}

/** 编排层消费的 MainSession 最小接口。 */
export interface SchedulerMainSession {
  /** 对 main session 执行一次 integrate。 */
  integrate(fn: unknown): Promise<unknown>;
}

/** scheduler 的依赖。 */
export interface SchedulerOptions {
  /** consolidate 的触发策略。 */
  consolidation?: ConsolidationPolicy;
  /** integrate 的触发策略。 */
  integration?: IntegrationPolicy;
  /** 传给 session.consolidate() 的函数或配置对象。 */
  consolidateFn?: unknown;
  /** 传给 mainSession.integrate() 的函数或配置对象。 */
  integrateFn?: unknown;
  /** 调度异常的统一上报出口。 */
  onError?: (source: string, error: Error) => void;
}

/** 单次调度的执行结果。 */
export interface SchedulerResult {
  /** 本次调度是否执行了 consolidate。 */
  consolidated: boolean;
  /** 本次调度是否执行了 integrate。 */
  integrated: boolean;
}

/** Scheduler 负责在 turn 结束后决定是否触发 consolidate / integrate。 */
export class Scheduler {
  private readonly consolidation: ConsolidationPolicy;
  private readonly integration: IntegrationPolicy;
  private readonly consolidateFn: unknown;
  private readonly integrateFn: unknown;
  private readonly onError?: (source: string, error: Error) => void;

  constructor(options: SchedulerOptions = {}) {
    this.consolidation = options.consolidation ?? { mode: 'manual' };
    this.integration = options.integration ?? { mode: 'manual' };
    this.consolidateFn = options.consolidateFn;
    this.integrateFn = options.integrateFn;
    this.onError = options.onError;
  }

  /** 在一次 turn 结束后调度 consolidate / integrate。 */
  async afterTurn(session: SchedulerSession, mainSession?: SchedulerMainSession): Promise<SchedulerResult> {
    return this.runPhase('turn', session, mainSession);
  }

  /** 在 session switch 时调度 consolidate / integrate。 */
  async onSessionSwitch(session: SchedulerSession, mainSession?: SchedulerMainSession): Promise<SchedulerResult> {
    return this.runPhase('switch', session, mainSession);
  }

  /** 在 session archive 时调度 consolidate / integrate。 */
  async onSessionArchive(session: SchedulerSession, mainSession?: SchedulerMainSession): Promise<SchedulerResult> {
    return this.runPhase('archive', session, mainSession);
  }

  /** 在指定阶段执行调度。 */
  private async runPhase(
    phase: 'turn' | 'switch' | 'archive',
    session: SchedulerSession,
    mainSession?: SchedulerMainSession,
  ): Promise<SchedulerResult> {
    let consolidated = false;
    let integrated = false;

    /** 先判断当前阶段是否需要 consolidate。 */
    if (this.shouldConsolidate(session, phase)) {
      try {
        await session.consolidate(this.consolidateFn);
        consolidated = true;
      } catch (err) {
        this.emitError('scheduler.consolidate', err);
      }
    }

    /** 再判断当前阶段是否需要 integrate。 */
    if (mainSession && this.shouldIntegrate(session, consolidated, phase)) {
      try {
        await mainSession.integrate(this.integrateFn);
        integrated = true;
      } catch (err) {
        this.emitError('scheduler.integrate', err);
      }
    }

    return { consolidated, integrated };
  }

  /** 判断当前 turn 后是否要 consolidate。 */
  private shouldConsolidate(session: SchedulerSession, phase: 'turn' | 'switch' | 'archive'): boolean {
    if (this.consolidation.mode === 'onSwitch') return phase === 'switch';
    if (this.consolidation.mode === 'onArchive') return phase === 'archive';
    if (this.consolidation.mode !== 'everyNTurns') return false;
    if (phase !== 'turn') return false;
    const everyNTurns = this.consolidation.everyNTurns;
    if (!everyNTurns || everyNTurns <= 0) return false;
    return session.meta.turnCount > 0 && session.meta.turnCount % everyNTurns === 0;
  }

  /** 判断当前 turn 后是否要 integrate。 */
  private shouldIntegrate(
    session: SchedulerSession,
    consolidated: boolean,
    phase: 'turn' | 'switch' | 'archive',
  ): boolean {
    if (this.integration.mode === 'afterConsolidate') {
      return consolidated;
    }
    if (this.integration.mode === 'onSwitch') {
      return phase === 'switch';
    }
    if (this.integration.mode === 'everyNTurns') {
      if (phase !== 'turn') return false;
      const everyNTurns = this.integration.everyNTurns;
      if (!everyNTurns || everyNTurns <= 0) return false;
      return session.meta.turnCount > 0 && session.meta.turnCount % everyNTurns === 0;
    }
    return false;
  }

  /** 上报调度异常，但不阻断主路径。 */
  private emitError(source: string, err: unknown): void {
    if (!this.onError) return;
    const error = err instanceof Error ? err : new Error(String(err));
    this.onError(source, error);
  }
}
