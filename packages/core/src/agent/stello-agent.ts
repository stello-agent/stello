import type { BootstrapResult } from '../types/lifecycle';
import { TurnRunner, type ToolCallParser, type TurnRunnerOptions } from '../engine/turn-runner';
import type { EngineTurnResult } from '../engine/stello-engine';
import type { EngineStreamResult } from '../engine/stello-engine';
import {
  DefaultEngineFactory,
  type EngineHookProvider,
} from '../orchestrator/default-engine-factory';
import type { SessionRuntimeResolver, EngineForkOptions } from '../types/engine';
import {
  DefaultEngineRuntimeManager,
  type EngineRuntimeManager,
  type RuntimeRecyclePolicy,
  type RuntimeHolderId,
} from '../orchestrator/engine-runtime-manager';
import { SessionOrchestrator } from '../orchestrator/session-orchestrator';
import {
  adaptSessionToEngineRuntime,
  serializeSessionSendResult,
  sessionSendResultParser,
  type SessionCompatible,
  type SessionCompatibleSendResult,
} from '../adapters/session-runtime';
import type { SessionMeta, SessionTree, SessionTreeNode, TopologyNode } from '../types/session';
import type { ConfirmProtocol, SkillRouter } from '../types/lifecycle';
import type { EngineLifecycleAdapter, EngineToolRuntime } from '../engine/stello-engine';
import type { ForkProfileRegistry } from '../engine/fork-profile';
import type { SplitGuard } from '../session/split-guard';
import type {
  SerializableSessionConfig,
  SessionConfig,
} from '../types/session-config';
import type {
  SessionStorage, ListRecordsOptions, Message,
} from '@stello-ai/session';
import type { SharedMemoryEntry, SharedMemoryStore } from '../shared-memory/types';
import { renderSharedMemoryContext } from '../shared-memory/render-shared-memory';
import { renderTopologyMarkdown } from '../engine/topology-render';

/** Session 能力相关配置 */
export interface StelloAgentCapabilitiesConfig {
  lifecycle: EngineLifecycleAdapter;
  tools: EngineToolRuntime;
  skills: SkillRouter;
  confirm: ConfirmProtocol;
  /** Fork profile 注册表（可选） */
  profiles?: ForkProfileRegistry;
}

/**
 * Session I/O 接入层。
 *
 * 按 sessionId 加载 Session 实例与其固化配置（SerializableSessionConfig）。
 * Engine 构造 runtime 时消费这些数据；不再在此承担 `compressFn` 等运行时行为配置
 * （迁移至 `sessionDefaults`）。
 */
export interface StelloAgentSessionConfig {
  /** 按 sessionId 加载固化配置 + meta（纯 I/O），返回 Session 实例与其序列化配置 */
  sessionLoader?: (sessionId: string) => Promise<{
    session: SessionCompatible;
    config: SerializableSessionConfig | null;
  }>;
  /** send() 结果序列化方式，默认 JSON 序列化 */
  serializeSendResult?: (result: SessionCompatibleSendResult) => string;
  /** TurnRunner 用的 tool call parser，默认 sessionSendResultParser */
  toolCallParser?: ToolCallParser;
  /** 预留给 Session 组件的透传配置 */
  options?: Record<string, unknown>;
}

/** Session runtime 相关配置 */
export interface StelloAgentRuntimeConfig {
  resolver: SessionRuntimeResolver;
  recyclePolicy?: RuntimeRecyclePolicy;
}

/** Engine / Orchestrator 编排相关配置 */
export interface StelloAgentOrchestrationConfig {
  splitGuard?: SplitGuard;
  turnRunner?: TurnRunner;
  hooks?: EngineHookProvider;
  /** 每 N 轮自动触发 consolidation（0 或不传则禁用） */
  consolidateEveryNTurns?: number;
}

/**
 * StelloAgent 新版顶层配置。
 *
 * 这是面向使用者的推荐配置形状：
 * - `capabilities` 放能力注入
 * - `runtime` 放 session runtime 与回收策略
 * - `orchestration` 放编排层策略
 */
export interface StelloAgentConfig {
  sessions: SessionTree;
  /**
   * Session 数据存储（L3 / system prompt / insight / memory）。
   *
   * 用于 orchestrator-facing SDK（getSessionMetadata / listMessages / putMemory / ...）。
   * 应用层应保证 sessions（拓扑）与 storage（内容）指向同一份持久化后端。
   */
  storage?: SessionStorage;
  /**
   * Agent 级共享 memory 存储。注入后:
   * - SDK 方法 (listSharedMemory / getSharedMemoryEntry / upsertSharedMemoryEntry /
   *   removeSharedMemoryEntry) 可用
   * - 内置 tool `stello_memory_edit` 可用
   * - 当 agent 走默认 session.sessionLoader 路径时,<shared_memory> 全量段每次
   *   send 前由内置 adapter 自动渲染并注入到上下文。
   *
   * 未注入：SDK 方法和内置 tool 抛 "sharedMemory not configured";<shared_memory>
   * 段不进入上下文。
   *
   * 注意：如果调用方提供自定义 runtime.resolver 而非 session.sessionLoader,
   * 自动注入不会发生 —— 调用方需要自行把 renderSharedMemoryContext(agent.sharedMemory)
   * 接入到自己构造的 EngineRuntimeSession 的 send/stream 调用上。
   */
  sharedMemory?: SharedMemoryStore;
  /** Regular session 的 agent 级默认配置，fork 合成链的最低优先级 */
  sessionDefaults?: SessionConfig;
  session?: StelloAgentSessionConfig;
  capabilities: StelloAgentCapabilitiesConfig;
  runtime?: StelloAgentRuntimeConfig;
  orchestration?: StelloAgentOrchestrationConfig;
  /**
   * Optional decorator applied to the rendered topology context string before
   * it's passed to session.send. Receives `(raw, ctx)` where `raw` is the
   * `<topology>...</topology>` block and `ctx = { sessionId }`. If the
   * decorator throws, the raw rendered topology is used and a warning is
   * logged. Intended for product layers (e.g. KitKit) to prepend their own
   * concepts (like `<space>`) without stello knowing about them.
   *
   * Only effective when the agent is constructed via `session.sessionLoader`
   * (default adapter path). Callers that provide their own `runtime.resolver`
   * must wire `topologyContextProvider` themselves on their adapter.
   */
  topologyContextDecorator?: (raw: string, ctx: { sessionId: string }) => string;
}

/** 单 Session 的外部数据视图（memory + insight 聚合） */
export interface SessionMetadataView {
  memory: string | null;
  insight: string | null;
}

/** Session digest：批量视图条目（取代旧 getAllSessionL2s） */
export interface SessionDigest {
  id: string;
  label: string;
  status: 'active' | 'archived';
  memory: string | null;
  insight: string | null;
}


function resolveRuntimeResolver(config: StelloAgentConfig, agent: StelloAgent): SessionRuntimeResolver {
  if (config.runtime?.resolver) {
    return config.runtime.resolver;
  }

  if (config.session?.sessionLoader) {
    const adaptOptions = {
      // TODO(unified-session-config): 接入 fork 合成链后，compressFn 应来自合成配置而非 sessionDefaults
      compressFn: config.sessionDefaults?.compressFn,
      serializeResult: config.session!.serializeSendResult ?? serializeSessionSendResult,
      sharedMemoryContextProvider: () => renderSharedMemoryContext(agent.sharedMemory),
      topologyContextProvider: async (sessionId: string): Promise<string | undefined> => {
        let rootNode: SessionTreeNode | undefined;
        try {
          // Walk parentId chain to find the root id this session belongs to.
          let cursor = await config.sessions.getNode(sessionId);
          if (!cursor) return undefined;
          while (cursor.parentId) {
            const parent = await config.sessions.getNode(cursor.parentId);
            if (!parent) break;
            cursor = parent;
          }
          const rootId = cursor.id;
          // Fetch the full forest and pick the matching root subtree.
          const forest = await config.sessions.getTree();
          rootNode = forest.find((n) => n.id === rootId);
          if (!rootNode) return undefined;
        } catch (err) {
          console.warn(
            `[stello] topologyContextProvider: failed to load tree for ${sessionId}; skipping`,
            err,
          );
          return undefined;
        }
        const markdown = renderTopologyMarkdown(rootNode, sessionId);
        const raw = `<topology>\n${markdown}\n</topology>`;
        if (!config.topologyContextDecorator) return raw;
        try {
          return config.topologyContextDecorator(raw, { sessionId });
        } catch (err) {
          console.warn(
            `[stello] topologyContextDecorator threw; falling back to raw topology`,
            err,
          );
          return raw;
        }
      },
    };
    return {
      resolve: async (sessionId: string) => {
        const { session } = await config.session!.sessionLoader!(sessionId);
        return adaptSessionToEngineRuntime(session, adaptOptions);
      },
    };
  }

  throw new Error(
    'StelloAgentConfig 缺少 runtime.resolver；若使用 session 配置接入，请提供 session.sessionLoader',
  );
}

function resolveTurnRunner(config: StelloAgentConfig): TurnRunner | undefined {
  if (config.orchestration?.turnRunner) {
    return config.orchestration.turnRunner;
  }

  if (config.session?.toolCallParser || config.session?.serializeSendResult) {
    return new TurnRunner(config.session.toolCallParser ?? sessionSendResultParser);
  }

  if (config.session?.sessionLoader) {
    return new TurnRunner(sessionSendResultParser);
  }

  return undefined;
}

/**
 * StelloAgent
 *
 * 这是当前 core 层推荐的最高层对象。
 * 使用者不需要手动装配 orchestrator / engine factory，
 * 只需要提供依赖配置即可完成初始化。
 */
export class StelloAgent {
  /** 归一化后的顶层配置 */
  readonly config: StelloAgentConfig;

  /** 暴露 SessionTree，方便调用方做拓扑查询 */
  readonly sessions: StelloAgentConfig['sessions'];

  /** 注入的数据存储；data-IO SDK 方法依赖该字段 */
  readonly storage?: SessionStorage;

  /** 暴露 SharedMemoryStore，供 builtin tool / adapter / SDK 使用 */
  readonly sharedMemory?: SharedMemoryStore;

  /** 暴露 ForkProfileRegistry，供 tool 在运行时校验 profile 名称 */
  get profiles(): ForkProfileRegistry | undefined {
    return this.config.capabilities.profiles;
  }

  private readonly orchestrator: SessionOrchestrator;
  private readonly runtimeManager: EngineRuntimeManager;

  constructor(config: StelloAgentConfig) {
    this.config = config;
    this.sessions = config.sessions;
    this.storage = config.storage;
    this.sharedMemory = config.sharedMemory;
    const engineFactory = new DefaultEngineFactory({
      sessions: config.sessions,
      lifecycle: config.capabilities.lifecycle,
      tools: config.capabilities.tools,
      skills: config.capabilities.skills,
      confirm: config.capabilities.confirm,
      sessionRuntimeResolver: resolveRuntimeResolver(config, this),
      profiles: config.capabilities.profiles,
      splitGuard: config.orchestration?.splitGuard,
      turnRunner: resolveTurnRunner(config),
      hooks: config.orchestration?.hooks,
      consolidateEveryNTurns: config.orchestration?.consolidateEveryNTurns,
      sessionDefaults: config.sessionDefaults,
      agent: this,
    });
    this.runtimeManager = new DefaultEngineRuntimeManager(
      engineFactory,
      config.runtime?.recyclePolicy,
    );
    this.orchestrator = new SessionOrchestrator(
      config.sessions,
      this.runtimeManager,
    );
  }

  /**
   * 创建一个新的 Session 拓扑节点。
   *
   * - `parentId` 为空：建 root（parentId === null）
   * - 非空：挂在该节点下作为子节点（**不**继承父 Session 上下文 / 配置）
   *
   * 需要继承上下文（systemPrompt / L3 / 合成配置）应走 `forkSession`。
   */
  async createSession(options?: {
    parentId?: string;
    label?: string;
  }): Promise<TopologyNode> {
    const treeOptions: { parentId?: string; label?: string } = {};
    if (options?.parentId !== undefined) treeOptions.parentId = options.parentId;
    if (options?.label !== undefined) treeOptions.label = options.label;
    return this.sessions.createSession(treeOptions);
  }

  /**
   * 列出所有 Session（可按状态过滤）。
   *
   * 这是 orchestrator-facing SDK 的拓扑入口之一，代理给 SessionTree.listAll。
   */
  async listSessions(filter?: { status?: 'active' | 'archived' }): Promise<SessionMeta[]> {
    const all = await this.sessions.listAll();
    if (!filter || filter.status === undefined) return all;
    return all.filter((s) => s.status === filter.status);
  }

  /** 列出所有 root（parentId === null） */
  listRoots(): Promise<TopologyNode[]> {
    return this.sessions.listRoots();
  }

  /** 获取完整拓扑（森林） */
  getTopology(): Promise<SessionTreeNode[]> {
    return this.sessions.getTree();
  }

  /** 获取单个拓扑节点 */
  getTopologyNode(id: string): Promise<TopologyNode | null> {
    return this.sessions.getNode(id);
  }

  /** 读取单个 Session 的 memory / insight 视图 */
  async getSessionMetadata(id: string): Promise<SessionMetadataView> {
    const storage = this.requireStorage('getSessionMetadata');
    const [memory, insight] = await Promise.all([
      storage.getMemory(id),
      storage.getInsight(id),
    ]);
    return { memory, insight };
  }

  /**
   * 列出所有 Session 的 digest（id / label / status / memory / insight）。
   *
   * 取代旧 `MainStorage.getAllSessionL2s()`：调用方自行根据 memory 字段做 reflection。
   */
  async listSessionDigests(filter?: { status?: 'active' | 'archived' }): Promise<SessionDigest[]> {
    const storage = this.requireStorage('listSessionDigests');
    const metas = await this.sessions.listAll();
    const filtered = filter?.status
      ? metas.filter((m) => m.status === filter.status)
      : metas;
    return Promise.all(
      filtered.map(async (m) => {
        const [memory, insight] = await Promise.all([
          storage.getMemory(m.id),
          storage.getInsight(m.id),
        ]);
        return { id: m.id, label: m.label, status: m.status, memory, insight };
      }),
    );
  }

  /** 读取单个 Session 的 digest（id / label / status / memory / insight）。返回 null 表示不存在。 */
  async getSessionDigest(id: string): Promise<SessionDigest | null> {
    const meta = await this.sessions.get(id);
    if (!meta) return null;
    const storage = this.requireStorage('getSessionDigest');
    const [memory, insight] = await Promise.all([
      storage.getMemory(id),
      storage.getInsight(id),
    ]);
    return { id: meta.id, label: meta.label, status: meta.status, memory, insight };
  }

  /** 读取指定 Session 的 L3 消息 */
  listMessages(id: string, options?: ListRecordsOptions): Promise<Message[]> {
    const storage = this.requireStorage('listMessages');
    return storage.listRecords(id, options);
  }

  /** 写入指定 Session 的 memory（持久；每次 send 注入） */
  putMemory(id: string, content: string): Promise<void> {
    const storage = this.requireStorage('putMemory');
    return storage.putMemory(id, content);
  }

  /** 写入指定 Session 的 insight（一次性；被 send 消费后清除） */
  putInsight(id: string, content: string): Promise<void> {
    const storage = this.requireStorage('putInsight');
    return storage.putInsight(id, content);
  }

  /** 清除指定 Session 的 insight */
  clearInsight(id: string): Promise<void> {
    const storage = this.requireStorage('clearInsight');
    return storage.clearInsight(id);
  }

  private requireStorage(method: string): SessionStorage {
    if (!this.storage) {
      throw new Error(
        `StelloAgent.${method} 需要 StelloAgentConfig.storage；请在创建 agent 时注入 SessionStorage`,
      );
    }
    return this.storage;
  }

  // 校验 sharedMemory 已注入，否则抛出 "sharedMemory not configured" 错误
  private requireSharedMemory(method: string): SharedMemoryStore {
    if (!this.sharedMemory) {
      throw new Error(
        `StelloAgent.${method} 需要 StelloAgentConfig.sharedMemory；请在创建 agent 时注入 SharedMemoryStore (sharedMemory not configured)`,
      );
    }
    return this.sharedMemory;
  }

  /** 列举全部共享 memory entries（按插入顺序） */
  async listSharedMemory(): Promise<SharedMemoryEntry[]> {
    return this.requireSharedMemory('listSharedMemory').list();
  }

  /** 读取一条共享 memory entry；不存在返回 null */
  async getSharedMemoryEntry(slug: string): Promise<SharedMemoryEntry | null> {
    return this.requireSharedMemory('getSharedMemoryEntry').get(slug);
  }

  /** 写入或覆盖一条共享 memory entry */
  async upsertSharedMemoryEntry(slug: string, body: string): Promise<void> {
    return this.requireSharedMemory('upsertSharedMemoryEntry').upsert(slug, body);
  }

  /** 删除一条共享 memory entry；slug 不存在为 no-op */
  async removeSharedMemoryEntry(slug: string): Promise<void> {
    return this.requireSharedMemory('removeSharedMemoryEntry').remove(slug);
  }

  /** 进入指定 session 的整轮对话 */
  enterSession(sessionId: string): Promise<BootstrapResult> {
    return this.orchestrator.enterSession(sessionId);
  }

  /** 在指定 session 上运行一轮对话 */
  turn(
    sessionId: string,
    input: string,
    options?: TurnRunnerOptions,
  ): Promise<EngineTurnResult> {
    return this.orchestrator.turn(sessionId, input, options);
  }

  /** 在指定 session 上流式运行一轮对话 */
  stream(
    sessionId: string,
    input: string,
    options?: TurnRunnerOptions,
  ): Promise<EngineStreamResult> {
    return this.orchestrator.stream(sessionId, input, options);
  }

  /** 离开指定 session */
  leaveSession(sessionId: string): Promise<{ sessionId: string }> {
    return this.orchestrator.leaveSession(sessionId);
  }

  /** 从指定 session 发起 fork */
  forkSession(
    sessionId: string,
    options: EngineForkOptions,
  ) {
    return this.orchestrator.forkSession(sessionId, options);
  }

  /** 归档指定 session */
  archiveSession(sessionId: string) {
    return this.orchestrator.archiveSession(sessionId);
  }

  /** 显式附着一个 session runtime，常用于 WS 连接建立时 */
  attachSession(sessionId: string, holderId: RuntimeHolderId) {
    return this.runtimeManager.acquire(sessionId, holderId);
  }

  /** 释放一个 session runtime 持有者，常用于 WS 断开时 */
  detachSession(sessionId: string, holderId: RuntimeHolderId) {
    return this.runtimeManager.release(sessionId, holderId);
  }

  /** 当前是否已激活某个 session 的 engine */
  hasActiveEngine(sessionId: string): boolean {
    return this.runtimeManager.has(sessionId);
  }

  /** 当前某个 session 的 engine 引用计数 */
  getEngineRefCount(sessionId: string): number {
    return this.runtimeManager.getRefCount(sessionId);
  }

  /** 对指定 session 执行 consolidation */
  consolidateSession(sessionId: string): Promise<void> {
    return this.orchestrator.consolidateSession(sessionId);
  }

  /** 热更新运行时配置（仅支持值类型字段） */
  updateConfig(patch: StelloAgentHotConfig): void {
    if (patch.runtime && 'updateRecyclePolicy' in this.runtimeManager) {
      (this.runtimeManager as DefaultEngineRuntimeManager).updateRecyclePolicy(patch.runtime);
    }
    if (patch.splitGuard) {
      this.config.orchestration?.splitGuard?.updateConfig?.(patch.splitGuard);
    }
  }

}

/**
 * 可热更新的配置子集。
 *
 * 仅包含运行时可安全修改的值类型字段，不包含函数/对象引用类配置。
 */
export interface StelloAgentHotConfig {
  runtime?: Partial<RuntimeRecyclePolicy>;
  splitGuard?: Partial<{ minTurns: number; cooldownTurns: number }>;
}

/** create 函数风格的便捷入口 */
export function createStelloAgent(config: StelloAgentConfig): StelloAgent {
  return new StelloAgent(config);
}
