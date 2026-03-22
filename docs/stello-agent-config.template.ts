import type {
  ConfirmProtocol,
  MemoryEngine,
  Scheduler,
  SchedulerMainSession,
  SessionTree,
  SkillRouter,
  SplitGuard,
  StelloAgentConfig,
  EngineHookProvider,
  EngineLifecycleAdapter,
  EngineToolRuntime,
  OrchestrationStrategy,
  SessionRuntimeResolver,
  TurnRunner,
} from '../packages/core/src/index'

/**
 * StelloAgentConfig 模版
 *
 * 用法：
 * 1. 把这里的依赖替换成你的真实实现
 * 2. 不确定的部分先删掉可选项，保留最小可运行配置
 * 3. Session 同学后续给出字段后，再收敛 `session.options`
 */
export interface AppDependencies {
  sessions: SessionTree
  memory: MemoryEngine
  lifecycle: EngineLifecycleAdapter
  tools: EngineToolRuntime
  skills: SkillRouter
  confirm: ConfirmProtocol
  sessionRuntimeResolver: SessionRuntimeResolver
  strategy?: OrchestrationStrategy
  splitGuard?: SplitGuard
  mainSession?: SchedulerMainSession | null
  turnRunner?: TurnRunner
  scheduler?: Scheduler
  hooks?: EngineHookProvider
}

export function createStelloAgentConfig(deps: AppDependencies): StelloAgentConfig {
  return {
    sessions: deps.sessions,
    memory: deps.memory,

    // 预留给 Session 组件配置。
    // 等 Session 同学提供正式字段后，再把这里从 options 收成强类型。
    session: {
      options: {
        provider: 'replace-with-session-provider',
      },
    },

    capabilities: {
      lifecycle: deps.lifecycle,
      tools: deps.tools,
      skills: deps.skills,
      confirm: deps.confirm,
    },

    runtime: {
      resolver: deps.sessionRuntimeResolver,
      recyclePolicy: {
        // 0 或不传：引用归零立即回收
        // > 0：空闲 TTL 后回收，适合 WS
        idleTtlMs: 30_000,
      },
    },

    orchestration: {
      // 不传时默认 MainSessionFlatStrategy
      strategy: deps.strategy,

      // 以下都是可选高级配置，不需要就删掉
      splitGuard: deps.splitGuard,
      mainSession: deps.mainSession,
      turnRunner: deps.turnRunner,
      scheduler: deps.scheduler,
      hooks: deps.hooks,
    },
  }
}

/**
 * 最小版参考：
 *
 * const config: StelloAgentConfig = {
 *   sessions,
 *   memory,
 *   capabilities: {
 *     lifecycle,
 *     tools,
 *     skills,
 *     confirm,
 *   },
 *   runtime: {
 *     resolver: sessionRuntimeResolver,
 *   },
 * }
 */
