import { randomUUID } from 'node:crypto';
import type { FileSystemAdapter } from '../types/fs';
import type {
  SessionMeta,
  TopologyNode,
  SessionTreeNode,
  SessionTree,
  CreateSessionOptions,
} from '../types/session';
import type { SerializableSessionConfig } from '../types/session-config';

/**
 * 内部存储格式（meta.json），包含 session + topology 全部字段。
 * `metadata` 保留用于读取存量 legacy 数据（例如历史上写入的 metadata.sourceSessionId），
 * 新写入不再依赖它承载框架字段。
 */
interface StoredMeta {
  id: string;
  parentId: string | null;
  children: string[];
  refs: string[];
  label: string;
  index: number;
  status: 'active' | 'archived';
  depth: number;
  turnCount: number;
  /** fork 上下文来源 session ID（一等字段，新写入的数据直接落这里） */
  sourceSessionId?: string;
  /** 历史 legacy 数据的 metadata 槽位；新数据不再写入，仅用于读取兼容 */
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  lastActiveAt: string;
}

/** meta.json 的存储路径 */
function metaPath(id: string): string {
  return `sessions/${id}/meta.json`;
}

/** config.json 的存储路径（持久化 SessionConfig 的可序列化子集） */
function configPath(id: string): string {
  return `sessions/${id}/config.json`;
}

/** 获取当前时间 ISO 字符串 */
function now(): string {
  return new Date().toISOString();
}

/** 从 StoredMeta 解析 sourceSessionId：优先读顶层，回退到 legacy metadata.sourceSessionId */
function resolveSourceSessionId(stored: StoredMeta): string | undefined {
  if (typeof stored.sourceSessionId === 'string') return stored.sourceSessionId;
  const legacy = stored.metadata?.['sourceSessionId'];
  return typeof legacy === 'string' ? legacy : undefined;
}

/** 从内部存储格式投影为 SessionMeta */
function toSessionMeta(stored: StoredMeta): SessionMeta {
  return {
    id: stored.id,
    label: stored.label,
    status: stored.status,
    turnCount: stored.turnCount,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
    lastActiveAt: stored.lastActiveAt,
  };
}

/** 从内部存储格式投影为 TopologyNode */
function toTopologyNode(stored: StoredMeta): TopologyNode {
  const node: TopologyNode = {
    id: stored.id,
    parentId: stored.parentId,
    children: stored.children,
    refs: stored.refs,
    depth: stored.depth,
    index: stored.index,
    label: stored.label,
  };
  const source = resolveSourceSessionId(stored);
  if (source !== undefined) node.sourceSessionId = source;
  return node;
}

/**
 * SessionTree 的默认实现
 *
 * 管理对话的树状空间结构（森林），用 FileSystemAdapter 做持久化。
 * 内部以 StoredMeta 统一存储，对外按 SessionMeta / TopologyNode 分离返回。
 */
export class SessionTreeImpl implements SessionTree {
  /**
   * 串行化父节点 RMW 的写锁。createSession（带 parentId） / addRef 都需要先读父节点
   * 的 children/refs 数组、追加新元素、再整体写回；并发执行（如同一轮内多个
   * stello_create_session 工具调用）会因 last-write-wins 丢失先到的修改。这里用一
   * 条 Promise 链强制单线执行。fork/ref 不是吞吐路径，串行代价可忽略。
   */
  private writeLock: Promise<unknown> = Promise.resolve();

  constructor(private readonly fs: FileSystemAdapter) {}

  /** 在写锁内执行；锁失败不中断后续任务 */
  private withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writeLock.then(fn, fn);
    this.writeLock = next.catch(() => undefined);
    return next;
  }

  /**
   * 创建 Session 拓扑节点。
   *
   * - `options.parentId` 为空：创建新 root（`parentId === null`，`depth === 0`），
   *   多 root 合法；同时初始化 core.json（如果尚未存在）
   * - 非空：挂在该节点下作为子节点，更新父的 children 列表
   * - 始终初始化 memory.md / scope.md / index.md
   */
  async createSession(options: CreateSessionOptions = {}): Promise<TopologyNode> {
    return this.withWriteLock(async () => {
      const ts = now();
      const id = randomUUID();

      if (!options.parentId) {
        const stored: StoredMeta = {
          id,
          parentId: null,
          children: [],
          refs: [],
          label: options.label ?? 'Root',
          index: 0,
          status: 'active',
          depth: 0,
          turnCount: 0,
          createdAt: ts,
          updatedAt: ts,
          lastActiveAt: ts,
        };
        if (options.sourceSessionId !== undefined) {
          stored.sourceSessionId = options.sourceSessionId;
        }
        await this.fs.writeJSON(metaPath(id), stored);
        await this.initSessionFiles(id);
        const coreExisting = await this.fs.readJSON('core.json');
        if (coreExisting === null) {
          await this.fs.writeJSON('core.json', {});
        }
        return toTopologyNode(stored);
      }

      const parent = await this.requireStored(options.parentId);
      const stored: StoredMeta = {
        id,
        parentId: parent.id,
        children: [],
        refs: [],
        label: options.label ?? 'Session',
        index: parent.children.length,
        status: 'active',
        depth: parent.depth + 1,
        turnCount: 0,
        createdAt: ts,
        updatedAt: ts,
        lastActiveAt: ts,
      };
      if (options.sourceSessionId !== undefined) {
        stored.sourceSessionId = options.sourceSessionId;
      }
      await this.fs.writeJSON(metaPath(id), stored);
      await this.initSessionFiles(id);
      parent.children.push(id);
      parent.updatedAt = now();
      await this.fs.writeJSON(metaPath(parent.id), parent);
      return toTopologyNode(stored);
    });
  }

  /** 初始化 Session 的三个 .md 内容文件 */
  private async initSessionFiles(id: string): Promise<void> {
    await this.fs.writeFile(`sessions/${id}/memory.md`, '');
    await this.fs.writeFile(`sessions/${id}/scope.md`, '');
    await this.fs.writeFile(`sessions/${id}/index.md`, '');
  }

  async get(id: string): Promise<SessionMeta | null> {
    const stored = await this.fs.readJSON<StoredMeta>(metaPath(id));
    return stored ? toSessionMeta(stored) : null;
  }

  async listAll(): Promise<SessionMeta[]> {
    const all = await this.listAllStored();
    return all.map(toSessionMeta);
  }

  /** 列出所有 root（parentId === null） */
  async listRoots(): Promise<TopologyNode[]> {
    const all = await this.listAllStored();
    return all.filter((s) => s.parentId === null).map(toTopologyNode);
  }

  async archive(id: string): Promise<void> {
    const stored = await this.requireStored(id);
    stored.status = 'archived';
    stored.updatedAt = now();
    await this.fs.writeJSON(metaPath(id), stored);
  }

  async addRef(fromId: string, toId: string): Promise<void> {
    return this.withWriteLock(async () => {
      if (fromId === toId) throw new Error('不能引用自己');
      const from = await this.requireStored(fromId);
      await this.requireStored(toId);
      // 校验：不能引用直系祖先
      const ancestors = await this.getAncestors(fromId);
      if (ancestors.some((a) => a.id === toId)) {
        throw new Error('不能引用直系祖先');
      }
      // 校验：不能引用直系后代
      const descendants = await this.getAllDescendants(fromId);
      if (descendants.has(toId)) {
        throw new Error('不能引用直系后代');
      }
      // 幂等：已存在则跳过
      if (from.refs.includes(toId)) return;
      from.refs.push(toId);
      from.updatedAt = now();
      await this.fs.writeJSON(metaPath(fromId), from);
    });
  }

  /** 更新 SessionMeta 可变字段（label / turnCount） */
  async updateMeta(
    id: string,
    updates: Partial<Pick<SessionMeta, 'label' | 'turnCount'>>,
  ): Promise<SessionMeta> {
    const stored = await this.requireStored(id);
    if (updates.label !== undefined) stored.label = updates.label;
    if (updates.turnCount !== undefined) stored.turnCount = updates.turnCount;
    stored.updatedAt = now();
    await this.fs.writeJSON(metaPath(id), stored);
    return toSessionMeta(stored);
  }

  async getNode(id: string): Promise<TopologyNode | null> {
    const stored = await this.fs.readJSON<StoredMeta>(metaPath(id));
    return stored ? toTopologyNode(stored) : null;
  }

  /**
   * 返回拓扑森林（多 root 数组）。
   * 没有任何 root 时返回空数组。
   */
  async getTree(): Promise<SessionTreeNode[]> {
    const all = await this.listAllStored();
    const map = new Map(all.map((s) => [s.id, s]));
    const roots = all.filter((s) => s.parentId === null);

    // 递归构建树节点，sourceSessionId 走统一解析（兼容 legacy metadata）
    const buildNode = (stored: StoredMeta): SessionTreeNode => {
      const source = resolveSourceSessionId(stored);
      const node: SessionTreeNode = {
        id: stored.id,
        label: stored.label,
        status: stored.status,
        turnCount: stored.turnCount,
        children: stored.children
          .map((childId) => map.get(childId))
          .filter((c): c is StoredMeta => c !== undefined)
          .map(buildNode),
      };
      if (source !== undefined) node.sourceSessionId = source;
      return node;
    };

    return roots.map(buildNode);
  }

  async getAncestors(id: string): Promise<TopologyNode[]> {
    const ancestors: TopologyNode[] = [];
    let current = await this.requireStored(id);
    while (current.parentId !== null) {
      const parent = await this.fs.readJSON<StoredMeta>(metaPath(current.parentId));
      if (!parent) break;
      ancestors.push(toTopologyNode(parent));
      current = parent;
    }
    return ancestors;
  }

  /** 读取 Session 固化配置，缺失/不可读时返回 null */
  async getConfig(id: string): Promise<SerializableSessionConfig | null> {
    return this.fs.readJSON<SerializableSessionConfig>(configPath(id));
  }

  /** 写入 Session 固化配置（覆盖） */
  async putConfig(id: string, config: SerializableSessionConfig): Promise<void> {
    await this.fs.writeJSON(configPath(id), config);
  }

  async getSiblings(id: string): Promise<TopologyNode[]> {
    const stored = await this.requireStored(id);
    if (stored.parentId === null) return [];
    const parent = await this.fs.readJSON<StoredMeta>(metaPath(stored.parentId));
    if (!parent) return [];
    const siblings: TopologyNode[] = [];
    for (const childId of parent.children) {
      if (childId === id) continue;
      const child = await this.fs.readJSON<StoredMeta>(metaPath(childId));
      if (child) siblings.push(toTopologyNode(child));
    }
    return siblings;
  }

  /** 读取内部存储，不存在则抛错 */
  private async requireStored(id: string): Promise<StoredMeta> {
    const stored = await this.fs.readJSON<StoredMeta>(metaPath(id));
    if (!stored) throw new Error(`Session 不存在: ${id}`);
    return stored;
  }

  /** 列出所有内部存储 */
  private async listAllStored(): Promise<StoredMeta[]> {
    const dirs = await this.fs.listDirs('sessions');
    const results: StoredMeta[] = [];
    for (const dir of dirs) {
      const stored = await this.fs.readJSON<StoredMeta>(metaPath(dir));
      if (stored) results.push(stored);
    }
    return results;
  }

  /** 递归获取所有后代 ID */
  private async getAllDescendants(id: string): Promise<Set<string>> {
    const result = new Set<string>();
    const stored = await this.fs.readJSON<StoredMeta>(metaPath(id));
    if (!stored) return result;
    for (const childId of stored.children) {
      result.add(childId);
      const childDescendants = await this.getAllDescendants(childId);
      for (const d of childDescendants) result.add(d);
    }
    return result;
  }
}
