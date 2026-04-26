import type { SessionTree } from '../types/session';
import { MAIN_SESSION_ID } from '../types/session';
import type { MemoryEngine, TurnRecord } from '../types/memory';
import type { LLMCompleteOptions } from '@stello-ai/session';
import type {
  BootstrapResult,
  AfterTurnResult,
  ConfirmProtocol,
  SkillRouter,
  ToolDefinition,
  ToolExecutionResult,
} from '../types/lifecycle';
import type { StelloEngine, StelloEventMap, EngineForkOptions } from '../types/engine';
import type { TopologyNode } from '../types/session';
import type { SplitGuard } from '../session/split-guard';
import type { ForkProfileRegistry } from './fork-profile';
import { createBuiltinToolEntries, CompositeToolRuntime } from '../tool/tool-registry';
import type { SessionCompatibleForkOptions } from '../adapters/session-runtime';
import type {
  SerializableSessionConfig,
  SessionConfig,
} from '../types/session-config';
import { mergeSessionConfig } from './merge-session-config';
import { applyCompressContext } from './fork-compress';
import { llmCallFnFromAdapter, type LLMCallFn } from '../llm/defaults';
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
export interface EngineRuntimeSession {
  /** 供日志和 hooks 使用的稳定标识 */
  id: string;
  /** Engine 侧可见的元信息，用于做调度和当前状态检查 */
  meta: {
    id: string;
    turnCount: number;
    status: 'active' | 'archived';
  };
  /** 当前已完成轮次 */
  turnCount: number;
  /** 运行一次单条对话 */
  send(input: string): Promise<string>;
  /** 可选：流式运行一次单条对话 */
  stream?(input: string): AsyncIterable<string> & { result: Promise<string> };
  /** fork 子 session，返回子 session 的 runtime */
  fork?(options: SessionCompatibleForkOptions): Promise<EngineRuntimeSession>;
  /** 由 Session 自己完成 L2/L3 -> memory 的整理 */
  consolidate(): Promise<void>;
  /** 读取当前 session 的 L3 消息（原始对话记录） */
  messages(): Promise<Array<{ role: string; content: string; timestamp?: string }>>;
  /** Current tool list visible to LLM (mirrors underlying Session.tools) */
  readonly tools?: LLMCompleteOptions['tools'];
  /** Replace tool list (forwards to underlying Session.setTools) */
  setTools(tools: LLMCompleteOptions['tools'] | undefined): void;
}

/** Engine 依赖的生命周期适配器 */
export interface EngineLifecycleAdapter {
  /** 进入 session 时做 bootstrap */
  bootstrap(sessionId: string): Promise<BootstrapResult>;
  /** 兼容旧的 afterTurn 流程 */
  afterTurn(sessionId: string, userMsg: TurnRecord, assistantMsg: TurnRecord): Promise<AfterTurnResult>;
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
  turnRunner?: TurnRunner;
  hooks?: Partial<EngineHooks>;
  /** Fork profile 注册表（可选） */
  profiles?: ForkProfileRegistry;
  /** Agent 级默认配置（fork 合成链最低优先级） */
  sessionDefaults?: SessionConfig;
}

/** turn 的聚合结果 */
export interface EngineTurnResult {
  turn: TurnRunnerResult;
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
  onSessionLeave(ctx: { sessionId: string }): Promise<void> | void;
  onRoundStart(ctx: EngineRoundContext): Promise<void> | void;
  onRoundEnd(ctx: EngineRoundResultContext): Promise<void> | void;
  onSessionArchive(ctx: { sessionId: string }): Promise<void> | void;
  onSessionFork(ctx: { parentId: string; child: TopologyNode }): Promise<void> | void;
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
  private readonly compositeTools: EngineToolRuntime;
  private readonly splitGuard?: SplitGuard;
  private readonly turnRunner: TurnRunner;
  private readonly hooks: Partial<EngineHooks>;
  private readonly profiles?: ForkProfileRegistry;
  private readonly sessionDefaults?: SessionConfig;
  private readonly handlers = new Map<keyof StelloEventMap, Set<(data: unknown) => void>>();

  constructor(options: StelloEngineOptions) {
    this.session = options.session;
    this.sessions = options.sessions;
    this.memory = options.memory;
    this.skills = options.skills;
    this.confirm = options.confirm;
    this.lifecycle = options.lifecycle;
    this.splitGuard = options.splitGuard;
    this.hooks = options.hooks ?? {};
    this.profiles = options.profiles;
    this.sessionDefaults = options.sessionDefaults;
    this.turnRunner =
      options.turnRunner ??
      new TurnRunner({
        parse(raw) {
          return { content: raw, toolCalls: [] };
        },
      } satisfies ToolCallParser);

    // 内置 tool 通过闭包捕获 Engine 实例，与用户 tool 统一走 CompositeToolRuntime
    const builtinEntries = createBuiltinToolEntries(
      options.skills,
      options.profiles,
      (args) => this.executeCreateSession(args),
    );
    this.compositeTools = new CompositeToolRuntime(builtinEntries, options.tools);
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
      turn = await this.turnRunner.run(this.session, input, this, {
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
    });
    return { turn };
  }

  /** 流式处理一轮编排：先输出增量文本，完成后再返回完整 turn */
  stream(input: string, options?: TurnRunnerOptions): EngineStreamResult {
    const source: TurnRunnerStreamResult = this.turnRunner.runStream(this.session, input, this, {
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
      });
      return { turn };
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

  /** 兼容旧的 afterTurn 流程 */
  async afterTurn(userMsg: TurnRecord, assistantMsg: TurnRecord): Promise<AfterTurnResult> {
    return this.lifecycle.afterTurn(this.session.id, userMsg, assistantMsg);
  }

  /** 显式离开一个 session，作为 round end 默认触发点 */
  async leaveSession(): Promise<{ sessionId: string }> {
    this.fireHook('onSessionLeave', { sessionId: this.session.id });
    return { sessionId: this.session.id };
  }

  /** 显式触发当前 session 的 consolidation */
  async consolidate(): Promise<void> {
    await this.session.consolidate();
  }

  /** 归档一个 session，并触发 onArchive 调度 */
  async archiveSession(): Promise<{ sessionId: string }> {
    await this.sessions.archive(this.session.id);
    this.fireHook('onSessionArchive', { sessionId: this.session.id });
    return { sessionId: this.session.id };
  }

  /** 从当前 session 发起 fork：合成配置、创建拓扑节点、调用 session.fork */
  async forkSession(options: EngineForkOptions): Promise<TopologyNode> {
    // sourceSessionId 始终是上下文来源（当前 session），与 topologyParentId（拓扑挂载点）分离；
    // flat 拓扑策略下两者可能不同。
    const topologyParentId = options.topologyParentId ?? this.session.id;
    const sourceSessionId = this.session.id;

    // 先解析 profile（user-level 参数校验，优先于基础设施检查）
    const profile = options.profile ? this.profiles?.get(options.profile) : undefined;
    if (options.profile && !profile) {
      throw new Error(`Fork profile "${options.profile}" 未注册`);
    }

    if (this.splitGuard) {
      const check = await this.splitGuard.checkCanSplit(topologyParentId);
      if (!check.canSplit) {
        throw new Error(check.reason ?? `Session ${topologyParentId} 当前不允许拆分`);
      }
    }

    if (!this.session.fork) {
      throw new Error('Fork 不可用：当前 session runtime 未实现 fork()');
    }

    // 从 main session fork 时不继承 main 的配置（invariant #6）：
    // main 的 SerializableMainSessionConfig 与 regular 的 SerializableSessionConfig 共用
    // 同一存储槽，需在读之前判断 source 角色、跳过读取。
    const parentFrozen = sourceSessionId === MAIN_SESSION_ID
      ? null
      : await this.sessions.getConfig(sourceSessionId);
    const parent: SessionConfig = parentFrozen ?? {};

    // 合成最终配置：defaults → parent → profile → forkOptions
    const merged = mergeSessionConfig({
      defaults: this.sessionDefaults,
      parent,
      profile,
      profileVars: options.profileVars,
      forkOptions: options,
    });

    // 解析有效 context 并按需执行压缩。必须在 createChild 之前运行：
    // 若 compress 缺少 compressFn/llm 而抛错，避免产生孤儿拓扑节点。
    const effectiveContext = options.context ?? profile?.context;
    const llmCallFn: LLMCallFn | undefined = merged.llm
      ? llmCallFnFromAdapter(merged.llm)
      : undefined;
    const { systemPrompt: finalSystemPrompt, forwardedContext } =
      await applyCompressContext({
        context: effectiveContext,
        systemPrompt: merged.systemPrompt,
        compressFn: merged.compressFn,
        llmCallFn,
        sourceMessages: () => this.session.messages(),
      });

    // Topology-first：创建拓扑节点，获取 ID（sourceSessionId 作为一等字段持久化）
    const child = await this.sessions.createChild({
      parentId: topologyParentId,
      label: options.label,
      sourceSessionId,
    });

    // 持久化可序列化的子集（systemPrompt / skills），供后续加载重放
    // finalSystemPrompt 已在 compress 路径下包含 <parent_context> 段
    // 空对象时跳过写入，避免对存储层产生 noise
    const serializable: SerializableSessionConfig = {};
    if (finalSystemPrompt !== undefined) serializable.systemPrompt = finalSystemPrompt;
    if (merged.skills !== undefined) serializable.skills = merged.skills;
    if (Object.keys(serializable).length > 0) {
      await this.sessions.putConfig(child.id, serializable);
    }

    // session.fork()：用拓扑 ID 创建 session 实例，透传合成后的运行时字段
    // compress 路径下 forwardedContext='none'，避免底层 session 重复处理
    await this.session.fork({
      id: child.id,
      label: options.label,
      systemPrompt: finalSystemPrompt,
      context: forwardedContext as SessionCompatibleForkOptions['context'],
      prompt: options.prompt ?? profile?.prompt,
      llm: merged.llm,
      tools: merged.tools,
      consolidateFn: merged.consolidateFn,
      compressFn: merged.compressFn,
    });

    if (this.splitGuard) {
      this.splitGuard.recordSplit(topologyParentId, this.session.meta.turnCount);
    }

    this.fireHook('onSessionFork', { parentId: topologyParentId, child });
    return child;
  }

  /** 导出 tool 定义，包含内置 tool + 用户 tool（内置优先，同名去重） */
  getToolDefinitions(): ToolDefinition[] {
    return this.compositeTools.getToolDefinitions();
  }

  /** 执行 tool call，内置 tool 优先，fallback 到用户 tool */
  async executeTool(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult> {
    return this.compositeTools.executeTool(name, args);
  }

  /** 执行内置 stello_create_session：把 LLM 透传参数转为 EngineForkOptions 后调 forkSession */
  private async executeCreateSession(
    args: Record<string, unknown>,
  ): Promise<ToolExecutionResult> {
    try {
      const forkOptions: EngineForkOptions = {
        label: args.label as string,
      };
      if (args.systemPrompt !== undefined) {
        forkOptions.systemPrompt = args.systemPrompt as string;
      }
      if (args.prompt !== undefined) {
        forkOptions.prompt = args.prompt as string;
      }
      if (args.context !== undefined) {
        forkOptions.context = args.context as 'none' | 'inherit' | 'compress';
      }
      if (args.profile !== undefined) {
        forkOptions.profile = args.profile as string;
      }
      if (args.vars !== undefined) {
        forkOptions.profileVars = args.vars as Record<string, string>;
      }

      const child = await this.forkSession(forkOptions);
      return { success: true, data: { sessionId: child.id, label: child.label } };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
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
