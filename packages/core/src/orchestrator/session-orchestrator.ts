import type { SessionMeta, TopologyNode, SessionTree } from '../types/session';
import type { BootstrapResult } from '../types/lifecycle';
import type { StelloEngine, EngineForkOptions } from '../types/engine';
import type { EngineTurnResult } from '../engine/stello-engine';
import type { EngineStreamResult } from '../engine/stello-engine';
import type { TurnRunnerOptions } from '../engine/turn-runner';
import type { EngineRuntimeManager } from './engine-runtime-manager';

/** Orchestrator 对 Engine 的最小依赖 */
export interface OrchestratorEngine extends StelloEngine {
  /** 运行当前 session 的一轮对话 */
  turn(input: string, options?: TurnRunnerOptions): Promise<EngineTurnResult>;
  /** 流式运行当前 session 的一轮对话 */
  stream(input: string, options?: TurnRunnerOptions): EngineStreamResult;
  /** 归档当前绑定 session */
  archiveSession(): Promise<{ sessionId: string }>;
  /** 从当前绑定 session 发起 fork */
  forkSession(options: EngineForkOptions): Promise<TopologyNode>;
  /** 显式触发当前绑定 session 的 consolidation */
  consolidate(): Promise<void>;
}

/** Engine 工厂 */
export interface EngineFactory {
  /** 为指定 sessionId 创建一个绑定该 session 的 engine */
  create(sessionId: string): Promise<OrchestratorEngine>;
}

/**
 * SessionOrchestrator
 *
 * 多 Session 协调器。
 * 负责：
 * - 校验 session 是否存在
 * - 为指定 sessionId 获取 engine
 * - 把 enter/turn/leave/fork/archive 分发给对应 engine
 *
 * 拓扑：SessionTree 就是轻量 topology 管理器，默认 fork 直接挂在 source 节点下
 * （engine 用 `options.topologyParentId ?? this.session.id` 兜底），orchestrator
 * 不再做显示拓扑的路由改写。
 */
export class SessionOrchestrator {
  private readonly sessionQueues = new Map<string, Promise<unknown>>();
  private holderSequence = 0;

  constructor(
    private readonly sessions: SessionTree,
    private readonly runtimeManager: EngineRuntimeManager,
  ) {}

  /** 进入指定 session */
  async enterSession(sessionId: string): Promise<BootstrapResult> {
    return this.runSerial(sessionId, async () => {
      await this.requireSession(sessionId);
      return this.withRuntime(sessionId, (engine) => engine.enterSession());
    });
  }

  /** 在指定 session 上运行一轮对话 */
  async turn(
    sessionId: string,
    input: string,
    options?: TurnRunnerOptions,
  ): Promise<EngineTurnResult> {
    return this.runSerial(sessionId, async () => {
      await this.requireSession(sessionId);
      return this.withRuntime(sessionId, (engine) => engine.turn(input, options));
    });
  }

  /** 在指定 session 上流式运行一轮对话 */
  async stream(
    sessionId: string,
    input: string,
    options?: TurnRunnerOptions,
  ): Promise<EngineStreamResult> {
    await this.requireSession(sessionId)
    return this.acquirePinnedRuntime(sessionId, `stream:${sessionId}:${++this.holderSequence}`, (engine, holderId) => {
      const source = engine.stream(input, options)
      const result = (async () => {
        try {
          return await source.result
        } finally {
          await this.runtimeManager.release(sessionId, holderId)
        }
      })()

      return {
        result,
        async *[Symbol.asyncIterator]() {
          for await (const chunk of source) {
            yield chunk
          }
        },
      }
    })
  }

  /** 离开指定 session */
  async leaveSession(sessionId: string): Promise<{ sessionId: string }> {
    return this.runSerial(sessionId, async () => {
      await this.requireSession(sessionId);
      return this.withRuntime(sessionId, (engine) => engine.leaveSession());
    });
  }

  /** 从指定 session 发起 fork */
  async forkSession(
    sessionId: string,
    options: EngineForkOptions,
  ): Promise<TopologyNode> {
    await this.requireSession(sessionId);
    // fork 在 source session 上执行（继承 source 的 context/systemPrompt）。
    // 显示拓扑的默认值由 engine 决定：`options.topologyParentId ?? this.session.id`，
    // 即默认挂在 source 节点下；若调用方显式传入 topologyParentId 则以调用方为准。
    return this.runSerial(sessionId, async () => {
      return this.withRuntime(sessionId, (engine) => engine.forkSession(options));
    });
  }

  /** 归档指定 session */
  async archiveSession(sessionId: string): Promise<{ sessionId: string }> {
    return this.runSerial(sessionId, async () => {
      await this.requireSession(sessionId);
      return this.withRuntime(sessionId, (engine) => engine.archiveSession());
    });
  }

  /** 对指定 session 执行 consolidation */
  async consolidateSession(sessionId: string): Promise<void> {
    await this.requireSession(sessionId);
    return this.withRuntime(sessionId, (engine) => engine.consolidate());
  }

  /** 只负责校验 session 是否存在，不负责管理 engine 生命周期 */
  private async requireSession(sessionId: string): Promise<SessionMeta> {
    const session = await this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session 不存在: ${sessionId}`);
    }
    return session;
  }

  /**
   * 同一个 session 串行，不同 session 并行。
   *
   * 实现方式：
   * - 每个 sessionId 持有一条 promise 链
   * - 新任务接在该 session 的尾部
   * - 其他 session 使用各自独立的链，因此天然并行
   */
  private async runSerial<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.sessionQueues.get(sessionId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    this.sessionQueues.set(sessionId, current);

    try {
      return await current;
    } finally {
      if (this.sessionQueues.get(sessionId) === current) {
        this.sessionQueues.delete(sessionId);
      }
    }
  }

  /** 用一次性 holder 获取 engine，任务结束后自动释放 */
  private async withRuntime<T>(
    sessionId: string,
    task: (engine: OrchestratorEngine) => Promise<T>,
  ): Promise<T> {
    const holderId = `orchestrator:${sessionId}:${++this.holderSequence}`;
    const engine = await this.runtimeManager.acquire(sessionId, holderId);

    try {
      return await task(engine);
    } finally {
      await this.runtimeManager.release(sessionId, holderId);
    }
  }

  private async acquirePinnedRuntime<T>(
    sessionId: string,
    holderId: string,
    task: (engine: OrchestratorEngine, holderId: string) => Promise<T> | T,
  ): Promise<T> {
    const engine = await this.runtimeManager.acquire(sessionId, holderId)
    try {
      return await task(engine, holderId)
    } catch (error) {
      await this.runtimeManager.release(sessionId, holderId)
      throw error
    }
  }
}
