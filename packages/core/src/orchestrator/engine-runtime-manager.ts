import type { EngineFactory, OrchestratorEngine } from './session-orchestrator';

/** Runtime 持有者标识，一般可用连接 ID / 请求 ID */
export type RuntimeHolderId = string;

/** 多 Session engine 运行时管理器 */
export interface EngineRuntimeManager {
  /** 获取或创建一个 session 对应的 engine，并登记持有者 */
  acquire(sessionId: string, holderId: RuntimeHolderId): Promise<OrchestratorEngine>;
  /** 释放一个持有者；当引用归零时回收运行时 engine */
  release(sessionId: string, holderId: RuntimeHolderId): Promise<void>;
  /** 读取当前激活的 engine */
  get(sessionId: string): OrchestratorEngine | null;
  /** 当前是否已激活该 session 的 engine */
  has(sessionId: string): boolean;
  /** 当前引用计数 */
  getRefCount(sessionId: string): number;
}

/** Runtime 回收策略 */
export interface RuntimeRecyclePolicy {
  /**
   * 空闲回收延迟毫秒数。
   *
   * - `0` 或不传：引用归零立即回收
   * - `> 0`：引用归零后延迟回收；若期间再次 acquire，则取消回收
   */
  idleTtlMs?: number;
}

interface RuntimeEntry {
  engine: OrchestratorEngine;
  holders: Set<RuntimeHolderId>;
}

/**
 * 默认内存版运行时管理器。
 *
 * 语义：
 * - session 数据始终由 SessionTree / Memory 持久化管理
 * - 这里只管理运行时 engine 的创建、复用和回收
 */
export class DefaultEngineRuntimeManager implements EngineRuntimeManager {
  private readonly entries = new Map<string, RuntimeEntry>();
  private readonly pending = new Map<string, Promise<OrchestratorEngine>>();
  private readonly disposeTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly engineFactory: EngineFactory,
    private readonly policy: RuntimeRecyclePolicy = {},
  ) {}

  async acquire(sessionId: string, holderId: RuntimeHolderId): Promise<OrchestratorEngine> {
    this.clearDisposeTimer(sessionId);

    const existing = this.entries.get(sessionId);
    if (existing) {
      existing.holders.add(holderId);
      return existing.engine;
    }

    const pending = this.pending.get(sessionId) ?? this.createRuntime(sessionId);
    this.pending.set(sessionId, pending);

    const engine = await pending;
    const entry = this.entries.get(sessionId);
    if (!entry) {
      throw new Error(`Session ${sessionId} 的 engine 创建失败`);
    }

    entry.holders.add(holderId);
    return engine;
  }

  async release(sessionId: string, holderId: RuntimeHolderId): Promise<void> {
    const entry = this.entries.get(sessionId);
    if (!entry) return;

    entry.holders.delete(holderId);
    if (entry.holders.size === 0) {
      const idleTtlMs = this.policy.idleTtlMs ?? 0;
      if (idleTtlMs > 0) {
        const timer = setTimeout(() => {
          const current = this.entries.get(sessionId);
          if (current && current.holders.size === 0) {
            this.entries.delete(sessionId);
          }
          this.disposeTimers.delete(sessionId);
        }, idleTtlMs);
        this.disposeTimers.set(sessionId, timer);
      } else {
        this.entries.delete(sessionId);
      }
    }
  }

  get(sessionId: string): OrchestratorEngine | null {
    return this.entries.get(sessionId)?.engine ?? null;
  }

  has(sessionId: string): boolean {
    return this.entries.has(sessionId);
  }

  getRefCount(sessionId: string): number {
    return this.entries.get(sessionId)?.holders.size ?? 0;
  }

  private async createRuntime(sessionId: string): Promise<OrchestratorEngine> {
    try {
      const engine = await this.engineFactory.create(sessionId);
      this.entries.set(sessionId, { engine, holders: new Set() });
      return engine;
    } finally {
      this.pending.delete(sessionId);
    }
  }

  private clearDisposeTimer(sessionId: string): void {
    const timer = this.disposeTimers.get(sessionId);
    if (!timer) return;
    clearTimeout(timer);
    this.disposeTimers.delete(sessionId);
  }
}
