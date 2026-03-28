import type { CreateSessionOptions, SessionMeta, TopologyNode, SessionTree } from '../types/session';
import type { BootstrapResult, IngestResult } from '../types/lifecycle';
import type { TurnRecord } from '../types/memory';
import type { StelloEngine } from '../types/engine';
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
  forkSession(options: Omit<CreateSessionOptions, 'parentId'>): Promise<TopologyNode>;
}

/** Engine 工厂 */
export interface EngineFactory {
  /** 为指定 sessionId 创建一个绑定该 session 的 engine */
  create(sessionId: string): Promise<OrchestratorEngine>;
}

/** Orchestrator 编排策略 */
export interface OrchestrationStrategy {
  /** 决定一次 fork 最终应该挂到哪个父节点下 */
  resolveForkParent(source: TopologyNode, sessions: SessionTree): Promise<string>;
}

/**
 * MainSession 平铺策略
 *
 * 规则：
 * - 根节点（MainSession）下直接创建子节点
 * - 任意子节点继续 fork 时，也默认挂回根节点
 * - 结果是 MainSession 的下一层保持平铺
 */
export class MainSessionFlatStrategy implements OrchestrationStrategy {
  async resolveForkParent(source: TopologyNode, sessions: SessionTree): Promise<string> {
    if (source.parentId === null) {
      return source.id;
    }

    const root = await sessions.getRoot();
    return root.id;
  }
}

/**
 * TODO: 树结构 - 层叠式 OKR 汇报策略
 *
 * 预期方向：
 * - 上层节点代表更抽象目标
 * - 下层节点代表更具体任务
 * - 子节点继续 fork 时，默认沿当前层级继续向下展开
 *
 * 当前先保留扩展点，不在这一版实现具体编排规则。
 */
export class HierarchicalOkrStrategy implements OrchestrationStrategy {
  async resolveForkParent(): Promise<string> {
    throw new Error('TODO: HierarchicalOkrStrategy 尚未实现');
  }
}

/**
 * SessionOrchestrator
 *
 * 无状态的多 Session 协调器。
 * 它不自己管理连接态，只负责：
 * - 校验 session 是否存在
 * - 为指定 sessionId 获取 engine
 * - 把 enter/turn/leave/fork/archive 分发给对应 engine
 */
export class SessionOrchestrator {
  private readonly sessionQueues = new Map<string, Promise<unknown>>();
  private readonly strategy: OrchestrationStrategy;
  private holderSequence = 0;

  constructor(
    private readonly sessions: SessionTree,
    private readonly runtimeManager: EngineRuntimeManager,
    strategy?: OrchestrationStrategy,
  ) {
    this.strategy = strategy ?? new MainSessionFlatStrategy();
  }

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

  /** 在指定 session 上做 skill ingest */
  async ingest(sessionId: string, message: TurnRecord): Promise<IngestResult> {
    return this.runSerial(sessionId, async () => {
      await this.requireSession(sessionId);
      return this.withRuntime(sessionId, (engine) => engine.ingest(message));
    });
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
    options: Omit<CreateSessionOptions, 'parentId'>,
  ): Promise<TopologyNode> {
    await this.requireSession(sessionId);
    const node = await this.sessions.getNode(sessionId);
    if (!node) throw new Error(`拓扑节点不存在: ${sessionId}`);
    const effectiveParentId = await this.strategy.resolveForkParent(node, this.sessions);

    return this.runSerial(effectiveParentId, async () => {
      return this.withRuntime(effectiveParentId, (engine) => engine.forkSession({
        ...options,
        metadata: {
          ...(options.metadata ?? {}),
          sourceSessionId: sessionId,
        },
      }));
    });
  }

  /** 归档指定 session */
  async archiveSession(sessionId: string): Promise<{ sessionId: string }> {
    return this.runSerial(sessionId, async () => {
      await this.requireSession(sessionId);
      return this.withRuntime(sessionId, (engine) => engine.archiveSession());
    });
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
