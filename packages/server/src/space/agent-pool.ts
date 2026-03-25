import type pg from 'pg'
import {
  createStelloAgent,
  adaptSessionToEngineRuntime,
  adaptMainSessionToSchedulerMainSession,
  serializeSessionSendResult,
  type StelloAgent,
  type StelloAgentConfig,
} from '@stello-ai/core'
import { PgSessionTree } from '../storage/pg-session-tree.js'
import { PgMemoryEngine } from '../storage/pg-memory-engine.js'
import { PgSessionStorage } from '../storage/pg-session-storage.js'
import { PgMainStorage } from '../storage/pg-main-storage.js'
import { SpaceManager } from './space-manager.js'
import type { Space } from '../types.js'
import {
  createDefaultConsolidateFn,
  createDefaultIntegrateFn,
  type LLMCallFn,
} from '../llm/defaults.js'

/** AgentPool 创建 StelloAgent 所需的外部依赖工厂 */
export interface AgentPoolOptions {
  /** 为每个 space 构建 StelloAgentConfig（排除 sessions 和 memory，这两个由 pool 自动提供） */
  buildConfig: (ctx: AgentBuildContext) => Omit<StelloAgentConfig, 'sessions' | 'memory'>
  /** 内置 consolidation/integration 默认实现的 LLM 调用，不提供则无内置默认 */
  llm?: LLMCallFn
  /** 空闲驱逐时间（毫秒，默认 5 分钟） */
  idleTtlMs?: number
}

/** 传递给 buildConfig 的上下文 */
export interface AgentBuildContext {
  spaceId: string
  /** Space 完整数据（含 consolidatePrompt / integratePrompt） */
  space: Space
  pool: pg.Pool
  sessionStorage: PgSessionStorage
  mainStorage: PgMainStorage
  sessionTree: PgSessionTree
  memoryEngine: PgMemoryEngine
}

/**
 * AgentPool — 按 spaceId 懒创建并缓存 StelloAgent
 * 空闲超时后自动驱逐
 */
export class AgentPool {
  private readonly agents = new Map<string, StelloAgent>()
  private readonly lastAccess = new Map<string, number>()
  private readonly idleTtlMs: number
  private readonly spaceManager: SpaceManager
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly pool: pg.Pool,
    private readonly options: AgentPoolOptions,
  ) {
    this.idleTtlMs = options.idleTtlMs ?? 5 * 60 * 1000
    this.spaceManager = new SpaceManager(pool)
    this.startEvictionLoop()
  }

  /** 获取或创建 space 对应的 StelloAgent */
  async getAgent(spaceId: string): Promise<StelloAgent> {
    this.lastAccess.set(spaceId, Date.now())

    const existing = this.agents.get(spaceId)
    if (existing) return existing

    const agent = await this.createAgent(spaceId)
    this.agents.set(spaceId, agent)
    return agent
  }

  /** 主动驱逐 */
  evict(spaceId: string): void {
    this.agents.delete(spaceId)
    this.lastAccess.delete(spaceId)
  }

  /** 停止驱逐循环 */
  dispose(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.agents.clear()
    this.lastAccess.clear()
  }

  /** 当前缓存的 agent 数量 */
  get size(): number {
    return this.agents.size
  }

  /** 创建 space 对应的 StelloAgent */
  private async createAgent(spaceId: string): Promise<StelloAgent> {
    const space = await this.spaceManager.getSpace(spaceId)
    if (!space) throw new Error(`Space 不存在: ${spaceId}`)

    const sessionTree = new PgSessionTree(this.pool, spaceId)
    const memoryEngine = new PgMemoryEngine(this.pool, spaceId)
    const sessionStorage = new PgSessionStorage(this.pool, spaceId)
    const mainStorage = new PgMainStorage(this.pool, spaceId)

    const ctx: AgentBuildContext = {
      spaceId,
      space,
      pool: this.pool,
      sessionStorage,
      mainStorage,
      sessionTree,
      memoryEngine,
    }

    const partialConfig = this.options.buildConfig(ctx)
    const { llm } = this.options

    // 如果 buildConfig 未提供 runtime.resolver 且 llm 可用，自动生成带 per-session prompt 支持的 resolver
    if (!partialConfig.runtime?.resolver && partialConfig.session?.sessionResolver && llm) {
      const sessionResolver = partialConfig.session.sessionResolver
      const serializeResult = partialConfig.session?.serializeSendResult ?? serializeSessionSendResult

      partialConfig.runtime = {
        ...partialConfig.runtime,
        resolver: {
          resolve: async (sessionId: string) => {
            const session = await sessionResolver(sessionId)
            const consolidateFn = createDefaultConsolidateFn(
              sessionId, space.consolidatePrompt, llm, this.pool, spaceId,
            )
            return adaptSessionToEngineRuntime(session, { consolidateFn, serializeResult })
          },
        },
      }

      // integrateFn 的 per-session 支持：获取 root session ID 作为 main session
      if (partialConfig.session.mainSessionResolver) {
        const mainSessionResolver = partialConfig.session.mainSessionResolver
        const root = await sessionTree.getRoot()
        const mainSessionId = root.id

        partialConfig.orchestration = {
          ...partialConfig.orchestration,
          mainSession: {
            async integrate(): Promise<void> {
              const mainSession = await mainSessionResolver()
              if (!mainSession) return
              const integrateFn = createDefaultIntegrateFn(
                mainSessionId, space.integratePrompt, llm, ctx.pool, spaceId,
              )
              const adapted = adaptMainSessionToSchedulerMainSession(mainSession, { integrateFn })
              await adapted.integrate()
            },
          },
        }
      }
    } else if (!partialConfig.runtime?.resolver && partialConfig.session?.consolidateFn) {
      // fallback：buildConfig 提供了显式 consolidateFn 但无 llm — 保持原有 session 路径
      // 不注入 runtime.resolver，让 core 的 resolveRuntimeResolver 处理
    }

    return createStelloAgent({
      ...partialConfig,
      sessions: sessionTree,
      memory: memoryEngine,
    })
  }

  /** 定期检查空闲 agent 并驱逐 */
  private startEvictionLoop(): void {
    this.timer = setInterval(() => {
      const now = Date.now()
      for (const [spaceId, lastAccess] of this.lastAccess) {
        if (now - lastAccess > this.idleTtlMs) {
          this.evict(spaceId)
        }
      }
    }, Math.min(this.idleTtlMs, 60_000))
  }
}
