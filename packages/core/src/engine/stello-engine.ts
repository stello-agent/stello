import type { ConfirmProtocol, BootstrapResult, IngestResult, ToolDefinition, ToolExecutionResult } from '../types/lifecycle';
import type { MemoryEngine, TurnRecord, AssembledContext } from '../types/memory';
import type { SessionTree, SessionMeta, CreateSessionOptions } from '../types/session';
import type { StelloEngine, StelloEventMap } from '../types/engine';
import { Scheduler, type SchedulerMainSession, type SchedulerResult, type SchedulerSession } from './scheduler';
import { TurnRunner, type TurnRunnerResult, type TurnRunnerSession, type TurnRunnerToolExecutor, type TurnRunnerOptions } from './turn-runner';
import type { SkillRouter } from '../types/lifecycle';
import type { AfterTurnResult } from '../types/lifecycle';
import type { SplitCheckResult } from '../session/split-guard';

/** 编排层运行时的 Session 能力组合。 */
export interface EngineRuntimeSession extends TurnRunnerSession, SchedulerSession {}

/** 编排层对 lifecycle 的最小依赖接口。 */
export interface EngineLifecycle {
  /** 进入某个 session 时，返回 bootstrap 上下文。 */
  bootstrap(sessionId: string): Promise<BootstrapResult>;
  /** 组装某个 session 的上下文。 */
  assemble(sessionId: string): Promise<AssembledContext>;
  /** 执行旧版 afterTurn 生命周期。 */
  afterTurn(sessionId: string, userMsg: TurnRecord, assistantMsg: TurnRecord): Promise<AfterTurnResult>;
  /** 执行旧版切换 session 生命周期。 */
  onSessionSwitch(fromId: string, toId: string): Promise<BootstrapResult>;
  /** 创建子 session，并处理 scope/index 等副作用。 */
  prepareChildSpawn(options: CreateSessionOptions): Promise<SessionMeta>;
}

/** 编排层对 tools 的最小依赖接口。 */
export interface EngineTools extends TurnRunnerToolExecutor {
  /** 返回要暴露给模型的工具定义。 */
  getToolDefinitions(): ToolDefinition[];
}

/** Session / MainSession 的解析器。 */
export interface EngineSessionResolver {
  /** 解析某个 sessionId 对应的运行时 session。 */
  getSession(sessionId: string): Promise<EngineRuntimeSession>;
  /** 获取 main session；没有时可返回 undefined。 */
  getMainSession?(): Promise<SchedulerMainSession | undefined>;
}

/** turn() 的结果。 */
export interface EngineTurnResult {
  /** tool loop 的执行结果。 */
  turn: TurnRunnerResult;
  /** turn 结束后调度器的执行结果。 */
  schedule: SchedulerResult;
}

/** switchSession 的结果。 */
export interface EngineSwitchResult {
  /** 切换后 bootstrap 的返回结果。 */
  bootstrap: BootstrapResult;
  /** 切换阶段调度器的执行结果。 */
  schedule: SchedulerResult;
}

/** archive 的结果。 */
export interface EngineArchiveResult {
  /** 被归档的 session id。 */
  sessionId: string;
  /** 归档阶段调度器的执行结果。 */
  schedule: SchedulerResult;
}

/** fork 的结果。 */
export interface EngineForkResult {
  /** 新创建出来的子 session。 */
  child: SessionMeta;
}

/** 编排层对 split guard 的最小依赖接口。 */
export interface EngineSplitGuard {
  /** 检查某个 session 当前是否允许拆分。 */
  checkCanSplit(sessionId: string): Promise<SplitCheckResult>;
  /** 在成功拆分后记录本次 split。 */
  recordSplit(sessionId: string, turnCount: number): void;
}

/** StelloEngineImpl 的依赖。 */
export interface StelloEngineImplOptions {
  /** 初始活跃 session id。 */
  currentSessionId: string;
  /** session 树读写接口。 */
  sessions: SessionTree;
  /** 记忆系统接口。 */
  memory: MemoryEngine;
  /** skill 路由器。 */
  skills: SkillRouter;
  /** 确认协议。 */
  confirm: ConfirmProtocol;
  /** lifecycle 适配器。 */
  lifecycle: EngineLifecycle;
  /** tools 执行器和工具定义提供方。 */
  tools: EngineTools;
  /** session / mainSession 解析器。 */
  sessionResolver: EngineSessionResolver;
  /** fork 时用到的 split guard，可选。 */
  splitGuard?: EngineSplitGuard;
  /** 自定义 turn runner，可选。 */
  turnRunner?: TurnRunner;
  /** 自定义 scheduler，可选。 */
  scheduler?: Scheduler;
}

/** StelloEngineImpl 组装编排层主入口。 */
export class StelloEngineImpl implements StelloEngine {
  private currentId: string;
  private readonly turnRunner: TurnRunner;
  private readonly scheduler: Scheduler;
  private readonly listeners = new Map<keyof StelloEventMap, Set<(data: unknown) => void>>();

  constructor(
    public readonly sessions: SessionTree,
    public readonly memory: MemoryEngine,
    public readonly skills: SkillRouter,
    public readonly confirm: ConfirmProtocol,
    private readonly lifecycle: EngineLifecycle,
    private readonly tools: EngineTools,
    private readonly sessionResolver: EngineSessionResolver,
    private readonly splitGuard: EngineSplitGuard | undefined,
    options: { currentSessionId: string; turnRunner?: TurnRunner; scheduler?: Scheduler },
  ) {
    this.currentId = options.currentSessionId;
    this.turnRunner = options.turnRunner ?? new TurnRunner();
    this.scheduler = options.scheduler ?? new Scheduler({
      onError: (source, error) => {
        this.emit('error', { source, error });
      },
    });
  }

  /** 当前活跃 Session ID。 */
  get currentSessionId(): string {
    return this.currentId;
  }

  /** 驱动当前 Session 完成一次 tool loop turn。 */
  async turn(input: string, options?: TurnRunnerOptions): Promise<EngineTurnResult> {
    const session = await this.sessionResolver.getSession(this.currentId);
    const mainSession = this.sessionResolver.getMainSession
      ? await this.sessionResolver.getMainSession()
      : undefined;

    /** 先跑当前 session 的一轮 tool loop。 */
    const turn = await this.turnRunner.run(session, input, this.tools, options);
    /** 再在 turn 结束后执行 consolidate / integrate 调度。 */
    const schedule = await this.scheduler.afterTurn(session, mainSession);
    return { turn, schedule };
  }

  /** 根据当前消息做简单 skill 匹配。 */
  async ingest(message: TurnRecord): Promise<IngestResult> {
    const matched = this.skills.match(message);
    return { matchedSkill: matched?.name ?? null };
  }

  /** 组装当前 Session 的上下文。 */
  async assemble(): Promise<AssembledContext> {
    return this.lifecycle.assemble(this.currentId);
  }

  /** 对当前 Session 执行旧版 afterTurn 生命周期。 */
  async afterTurn(userMsg: TurnRecord, assistantMsg: TurnRecord): Promise<AfterTurnResult> {
    return this.lifecycle.afterTurn(this.currentId, userMsg, assistantMsg);
  }

  /** 切换当前 Session。 */
  async switchSession(targetId: string): Promise<BootstrapResult> {
    const currentSession = await this.sessionResolver.getSession(this.currentId);
    const mainSession = this.sessionResolver.getMainSession
      ? await this.sessionResolver.getMainSession()
      : undefined;
    /** 先执行旧 session 的切换生命周期，再触发调度。 */
    const result = await this.lifecycle.onSessionSwitch(this.currentId, targetId);
    await this.scheduler.onSessionSwitch(currentSession, mainSession);
    this.currentId = targetId;
    return result;
  }

  /** 切换当前 Session，并返回调度结果。 */
  async switchSessionWithSchedule(targetId: string): Promise<EngineSwitchResult> {
    const currentSession = await this.sessionResolver.getSession(this.currentId);
    const mainSession = this.sessionResolver.getMainSession
      ? await this.sessionResolver.getMainSession()
      : undefined;
    /** 这个入口显式返回 bootstrap 和 schedule 两部分结果。 */
    const bootstrap = await this.lifecycle.onSessionSwitch(this.currentId, targetId);
    const schedule = await this.scheduler.onSessionSwitch(currentSession, mainSession);
    this.currentId = targetId;
    return { bootstrap, schedule };
  }

  /** 归档指定 Session，并触发归档阶段调度。 */
  async archiveSession(sessionId: string = this.currentId): Promise<EngineArchiveResult> {
    const session = await this.sessionResolver.getSession(sessionId);
    const mainSession = this.sessionResolver.getMainSession
      ? await this.sessionResolver.getMainSession()
      : undefined;
    /** 先归档，再触发 onArchive 阶段的调度。 */
    await this.sessions.archive(sessionId);
    const schedule = await this.scheduler.onSessionArchive(session, mainSession);
    return { sessionId, schedule };
  }

  /** 通过编排层创建子 Session。 */
  async forkSession(options: Omit<CreateSessionOptions, 'parentId'> & { parentId?: string }): Promise<EngineForkResult> {
    const parentId = options.parentId ?? this.currentId;

    if (this.splitGuard) {
      /** 先走 split guard，防止过早或频繁拆分。 */
      const check = await this.splitGuard.checkCanSplit(parentId);
      if (!check.canSplit) {
        throw new Error(check.reason ?? `Session 不允许拆分: ${parentId}`);
      }
    }

    /** 真正的子 session 创建和副作用仍交给 lifecycle。 */
    const child = await this.lifecycle.prepareChildSpawn({
      parentId,
      label: options.label,
      ...(options.scope !== undefined && { scope: options.scope }),
      ...(options.metadata !== undefined && { metadata: options.metadata }),
      ...(options.tags !== undefined && { tags: options.tags }),
    });

    if (this.splitGuard) {
      /** 创建成功后再记录本次 split。 */
      const parent = await this.sessions.get(parentId);
      this.splitGuard.recordSplit(parentId, parent?.turnCount ?? 0);
    }

    return { child };
  }

  /** 导出 Agent Tool 定义。 */
  getToolDefinitions(): ToolDefinition[] {
    return this.tools.getToolDefinitions();
  }

  /** 执行 Agent Tool。 */
  async executeTool(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult> {
    return this.tools.executeTool(name, args);
  }

  /** 注册事件监听。 */
  on<K extends keyof StelloEventMap>(event: K, handler: (data: StelloEventMap[K]) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)?.add(handler as (data: unknown) => void);
  }

  /** 取消事件监听。 */
  off<K extends keyof StelloEventMap>(event: K, handler: (data: StelloEventMap[K]) => void): void {
    this.listeners.get(event)?.delete(handler as (data: unknown) => void);
  }

  /** 触发事件。 */
  private emit<K extends keyof StelloEventMap>(event: K, data: StelloEventMap[K]): void {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    for (const handler of handlers) {
      handler(data);
    }
  }
}

/** 创建 StelloEngineImpl 的便捷工厂。 */
export function createStelloEngine(options: StelloEngineImplOptions): StelloEngineImpl {
  return new StelloEngineImpl(
    options.sessions,
    options.memory,
    options.skills,
    options.confirm,
    options.lifecycle,
    options.tools,
    options.sessionResolver,
    options.splitGuard,
    {
      currentSessionId: options.currentSessionId,
      turnRunner: options.turnRunner,
      scheduler: options.scheduler,
    },
  );
}
