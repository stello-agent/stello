import type { SessionTree } from '../types/session';
import type { MemoryEngine, TurnRecord, AssembledContext } from '../types/memory';
import type {
  BootstrapResult,
  IngestResult,
  AfterTurnResult,
  ConfirmProtocol,
  SkillRouter,
  ToolDefinition,
  ToolExecutionResult,
} from '../types/lifecycle';
import type { StelloEngine, StelloEventMap } from '../types/engine';
import type { CreateSessionOptions, SessionMeta } from '../types/session';
import type { SplitGuard } from '../session/split-guard';
import { Scheduler, type SchedulerMainSession, type SchedulerResult, type SchedulerSession } from './scheduler';
import {
  TurnRunner,
  type ToolCallParser,
  type ToolCall,
  type ToolCallResult,
  type TurnRunnerOptions,
  type TurnRunnerResult,
  type TurnRunnerStreamResult,
} from './turn-runner';

/** 供 Engine 使用的运行时 Session 契约 */
export interface EngineRuntimeSession extends SchedulerSession {
  /** Engine 侧可见的元信息，用于做调度和当前状态检查 */
  meta: {
    id: string;
    turnCount: number;
    status: 'active' | 'archived';
  };
  /** 运行一次单条对话 */
  send(input: string): Promise<string>;
  /** 可选：流式运行一次单条对话 */
  stream?(input: string): AsyncIterable<string> & { result: Promise<string> };
}

/** Engine 依赖的生命周期适配器 */
export interface EngineLifecycleAdapter {
  /** 进入 session 时做 bootstrap */
  bootstrap(sessionId: string): Promise<BootstrapResult>;
  /** 读取当前 Session 的上下文 */
  assemble(sessionId: string): Promise<AssembledContext>;
  /** 兼容旧的 afterTurn 流程 */
  afterTurn(sessionId: string, userMsg: TurnRecord, assistantMsg: TurnRecord): Promise<AfterTurnResult>;
  /** fork 子 Session */
  prepareChildSpawn(options: CreateSessionOptions): Promise<SessionMeta>;
}

/** tool 执行器最小契约 */
export interface EngineToolRuntime {
  getToolDefinitions(): ToolDefinition[];
  executeTool(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult>;
}

/** Engine 构造参数 */
export interface StelloEngineOptions {
  session: EngineRuntimeSession;
  sessions: SessionTree;
  memory: MemoryEngine;
  skills: SkillRouter;
  confirm: ConfirmProtocol;
  lifecycle: EngineLifecycleAdapter;
  tools: EngineToolRuntime;
  splitGuard?: SplitGuard;
  mainSession?: SchedulerMainSession | null;
  turnRunner?: TurnRunner;
  scheduler?: Scheduler;
  hooks?: Partial<EngineHooks>;
}

/** turn 的聚合结果 */
export interface EngineTurnResult {
  turn: TurnRunnerResult;
  schedule: SchedulerResult;
}

/** 流式 turn 的聚合结果 */
export interface EngineStreamResult extends AsyncIterable<string> {
  result: Promise<EngineTurnResult>;
}

/** 当前轮次上下文 */
export interface EngineRoundContext {
  sessionId: string;
  input: string;
}

/** round 结束上下文 */
export interface EngineRoundResultContext extends EngineRoundContext {
  turn: TurnRunnerResult;
  schedule: SchedulerResult;
}

/** engine hooks */
export interface EngineHooks {
  onMessageReceived(ctx: { sessionId: string; input: string }): Promise<void> | void;
  onAssistantReply(ctx: {
    sessionId: string;
    input: string;
    content: string | null;
    rawResponse: string;
  }): Promise<void> | void;
  onToolCall(ctx: { sessionId: string; toolCall: ToolCall }): Promise<void> | void;
  onToolResult(ctx: { sessionId: string; result: ToolCallResult }): Promise<void> | void;
  onSessionEnter(ctx: { sessionId: string }): Promise<void> | void;
  onSessionLeave(ctx: { sessionId: string; schedule: SchedulerResult }): Promise<void> | void;
  onRoundStart(ctx: EngineRoundContext): Promise<void> | void;
  onRoundEnd(ctx: EngineRoundResultContext): Promise<void> | void;
  onSessionArchive(ctx: { sessionId: string; schedule: SchedulerResult }): Promise<void> | void;
  onSessionFork(ctx: { parentId: string; child: SessionMeta }): Promise<void> | void;
  onError(ctx: { source: string; error: Error }): Promise<void> | void;
}

/**
 * StelloEngineImpl
 *
 * 这是编排层 façade：
 * - 绑定单个 session runtime
 * - 管 tool loop
 * - 管 enter / leave / fork / archive
 * - 管 consolidate / integrate 调度
 */
export class StelloEngineImpl implements StelloEngine {
  readonly sessions: SessionTree;
  readonly memory: MemoryEngine;
  readonly skills: SkillRouter;
  readonly confirm: ConfirmProtocol;

  private readonly session: EngineRuntimeSession;
  private readonly lifecycle: EngineLifecycleAdapter;
  private readonly tools: EngineToolRuntime;
  private readonly splitGuard?: SplitGuard;
  private readonly mainSession?: SchedulerMainSession | null;
  private readonly turnRunner: TurnRunner;
  private readonly scheduler: Scheduler;
  private readonly hooks: Partial<EngineHooks>;
  private readonly handlers = new Map<keyof StelloEventMap, Set<(data: unknown) => void>>();

  constructor(options: StelloEngineOptions) {
    this.session = options.session;
    this.sessions = options.sessions;
    this.memory = options.memory;
    this.skills = options.skills;
    this.confirm = options.confirm;
    this.lifecycle = options.lifecycle;
    this.tools = options.tools;
    this.splitGuard = options.splitGuard;
    this.mainSession = options.mainSession ?? null;
    this.hooks = options.hooks ?? {};
    this.turnRunner =
      options.turnRunner ??
      new TurnRunner({
        parse(raw) {
          return { content: raw, toolCalls: [] };
        },
      } satisfies ToolCallParser);
    this.scheduler = options.scheduler ?? new Scheduler();
  }

  get sessionId(): string {
    return this.session.id;
  }

  /** 处理一轮编排：当前 session send + tool loop + 调度 */
  async turn(input: string, options?: TurnRunnerOptions): Promise<EngineTurnResult> {
    this.fireHook('onMessageReceived', { sessionId: this.session.id, input });
    this.fireHook('onRoundStart', { sessionId: this.session.id, input });
    let turn: TurnRunnerResult;
    try {
      turn = await this.turnRunner.run(this.session, input, this.tools, {
        ...options,
        onToolCall: (toolCall) => {
          this.fireCallback(options?.onToolCall, toolCall);
          this.fireHook('onToolCall', { sessionId: this.session.id, toolCall });
        },
        onToolResult: (result) => {
          this.fireCallback(options?.onToolResult, result);
          this.fireHook('onToolResult', { sessionId: this.session.id, result });
        },
      });
    } catch (error) {
      this.handleEngineError('engine.turn', error);
      throw error;
    }
    const schedule = await this.scheduler.afterTurn(this.session, this.mainSession, {
      observedTurnCount: this.session.meta.turnCount + 1,
    });
    this.fireHook('onAssistantReply', {
      sessionId: this.session.id,
      input,
      content: turn.finalContent,
      rawResponse: turn.rawResponse,
    });
    this.fireHook('onRoundEnd', {
      sessionId: this.session.id,
      input,
      turn,
      schedule,
    });
    return { turn, schedule };
  }

  /** 流式处理一轮编排：先输出增量文本，完成后再返回完整 turn + schedule */
  stream(input: string, options?: TurnRunnerOptions): EngineStreamResult {
    const source: TurnRunnerStreamResult = this.turnRunner.runStream(this.session, input, this.tools, {
      ...options,
      onToolCall: (toolCall) => {
        this.fireCallback(options?.onToolCall, toolCall);
        this.fireHook('onToolCall', { sessionId: this.session.id, toolCall });
      },
      onToolResult: (result) => {
        this.fireCallback(options?.onToolResult, result);
        this.fireHook('onToolResult', { sessionId: this.session.id, result });
      },
    });

    const result = (async () => {
      this.fireHook('onMessageReceived', { sessionId: this.session.id, input });
      this.fireHook('onRoundStart', { sessionId: this.session.id, input });

      let turn: TurnRunnerResult;
      try {
        turn = await source.result;
      } catch (error) {
        this.handleEngineError('engine.stream', error);
        throw error;
      }

      const schedule = await this.scheduler.afterTurn(this.session, this.mainSession, {
        observedTurnCount: this.session.meta.turnCount + 1,
      });
      this.fireHook('onAssistantReply', {
        sessionId: this.session.id,
        input,
        content: turn.finalContent,
        rawResponse: turn.rawResponse,
      });
      this.fireHook('onRoundEnd', {
        sessionId: this.session.id,
        input,
        turn,
        schedule,
      });
      return { turn, schedule };
    })();

    return {
      result,
      async *[Symbol.asyncIterator]() {
        for await (const chunk of source) {
          yield chunk
        }
      },
    }
  }

  /** 显式进入一个 session，作为整轮开始入口 */
  async enterSession(): Promise<BootstrapResult> {
    const bootstrap = await this.lifecycle.bootstrap(this.session.id);
    this.fireHook('onSessionEnter', { sessionId: this.session.id });
    return bootstrap;
  }

  /** skill 匹配入口 */
  async ingest(message: TurnRecord): Promise<IngestResult> {
    const skill = this.skills.match(message);
    return { matchedSkill: skill?.name ?? null };
  }

  /** 组装当前 session 上下文 */
  async assemble(): Promise<AssembledContext> {
    return this.lifecycle.assemble(this.session.id);
  }

  /** 兼容旧的 afterTurn 流程 */
  async afterTurn(userMsg: TurnRecord, assistantMsg: TurnRecord): Promise<AfterTurnResult> {
    return this.lifecycle.afterTurn(this.session.id, userMsg, assistantMsg);
  }

  /** 显式离开一个 session，作为 round end 默认触发点 */
  async leaveSession(): Promise<{
    sessionId: string;
    schedule: SchedulerResult;
  }> {
    const schedule = await this.scheduler.onSessionLeave(this.session, this.mainSession);
    this.fireHook('onSessionLeave', { sessionId: this.session.id, schedule });
    return { sessionId: this.session.id, schedule };
  }

  /** 归档一个 session，并触发 onArchive 调度 */
  async archiveSession(): Promise<{
    sessionId: string;
    schedule: SchedulerResult;
  }> {
    await this.sessions.archive(this.session.id);
    const schedule = await this.scheduler.onSessionArchive(this.session, this.mainSession);
    this.fireHook('onSessionArchive', { sessionId: this.session.id, schedule });
    return { sessionId: this.session.id, schedule };
  }

  /** 从当前 session 发起 fork，请求创建子 session */
  async forkSession(options: Omit<CreateSessionOptions, 'parentId'>): Promise<SessionMeta> {
    const parentId = this.session.id;
    if (this.splitGuard) {
      const check = await this.splitGuard.checkCanSplit(parentId);
      if (!check.canSplit) {
        throw new Error(check.reason ?? `Session ${parentId} 当前不允许拆分`);
      }
    }

    const child = await this.lifecycle.prepareChildSpawn({
      ...options,
      parentId,
    });

    if (this.splitGuard) {
      this.splitGuard.recordSplit(parentId, this.session.meta.turnCount);
    }

    this.fireHook('onSessionFork', { parentId, child });
    return child;
  }

  getToolDefinitions(): ToolDefinition[] {
    return this.tools.getToolDefinitions();
  }

  executeTool(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult> {
    return this.tools.executeTool(name, args);
  }

  on<K extends keyof StelloEventMap>(event: K, handler: (data: StelloEventMap[K]) => void): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler as (data: unknown) => void);
  }

  off<K extends keyof StelloEventMap>(event: K, handler: (data: StelloEventMap[K]) => void): void {
    this.handlers.get(event)?.delete(handler as (data: unknown) => void);
  }

  private emit<K extends keyof StelloEventMap>(event: K, data: StelloEventMap[K]): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(data);
    }
  }

  /** fire-and-forget 触发外部回调，不阻塞调用方 */
  private fireCallback<T>(fn: ((arg: T) => Promise<void> | void) | undefined, arg: T): void {
    if (!fn) return;
    try {
      const result = fn(arg);
      if (result && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch((error) => {
          this.handleEngineError('engine.callback', error);
        });
      }
    } catch (error) {
      this.handleEngineError('engine.callback', error);
    }
  }

  /** fire-and-forget 触发 hook，不阻塞调用方 */
  private fireHook(key: keyof EngineHooks, payload: unknown): void {
    const hook = this.hooks[key];
    if (!hook) return;
    try {
      const result = (hook as (ctx: unknown) => Promise<void> | void)(payload);
      if (result && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch((error) => {
          this.handleEngineError(`engine.${String(key)}`, error);
        });
      }
    } catch (error) {
      this.handleEngineError(`engine.${String(key)}`, error);
    }
  }

  /** 错误处理：emit error 事件 + 调用 onError hook */
  private handleEngineError(source: string, error: unknown): void {
    const normalized = error instanceof Error ? error : new Error(String(error));
    this.emit('error', { source, error: normalized });
    const onError = this.hooks.onError;
    if (!onError) return;
    try {
      const result = onError({ source, error: normalized });
      if (result && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch(() => {
          // 避免 onError 自身异常再次递归触发错误回调
        });
      }
    } catch {
      // 同步 onError 抛错，静默吞掉
    }
  }
}
