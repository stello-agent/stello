import { randomUUID } from 'node:crypto';
import type { FileSystemAdapter } from '../types/fs';
import type {
  SessionMeta,
  TopologyNode,
  SessionTreeNode,
  SessionTree,
  CreateSessionOptions,
} from '../types/session';
import { MAIN_SESSION_ID } from '../types/session';
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
 * 管理对话的树状空间结构，用 FileSystemAdapter 做持久化。
 * 内部以 StoredMeta 统一存储，对外按 SessionMeta / TopologyNode 分离返回。
 */
export class SessionTreeImpl implements SessionTree {
  constructor(private readonly fs: FileSystemAdapter) {}

  /**
   * 创建根 Session（main），初始化配套 .md 与 core.json
   *
   * 幂等：若 `MAIN_SESSION_ID` 对应的 meta 已存在，直接返回现有 TopologyNode，不覆写任何数据。
   */
  async createRoot(label = 'Root'): Promise<TopologyNode> {
    const existing = await this.fs.readJSON<StoredMeta>(metaPath(MAIN_SESSION_ID));
    if (existing !== null) {
      return toTopologyNode(existing);
    }
    const ts = now();
    const stored: StoredMeta = {
      id: MAIN_SESSION_ID,
      parentId: null,
      children: [],
      refs: [],
      label,
      index: 0,
      status: 'active',
      depth: 0,
      turnCount: 0,
      createdAt: ts,
      updatedAt: ts,
      lastActiveAt: ts,
    };
    await this.fs.writeJSON(metaPath(stored.id), stored);
    // 初始化三个 .md 内容文件
    await this.fs.writeFile(`sessions/${stored.id}/memory.md`, '');
    await this.fs.writeFile(`sessions/${stored.id}/scope.md`, '');
    await this.fs.writeFile(`sessions/${stored.id}/index.md`, '');
    // 初始化 core.json（如果不存在）
    const coreExisting = await this.fs.readJSON('core.json');
    if (coreExisting === null) {
      await this.fs.writeJSON('core.json', {});
    }
    return toTopologyNode(stored);
  }

  /** 创建子 Session，写入 meta.json 并更新父节点 children 列表 */
  async createChild(options: CreateSessionOptions): Promise<TopologyNode> {
    const parent = await this.requireStored(options.parentId);
    const ts = now();
    const stored: StoredMeta = {
      id: randomUUID(),
      parentId: parent.id,
      children: [],
      refs: [],
      label: options.label,
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
    // 写子 Session meta.json
    await this.fs.writeJSON(metaPath(stored.id), stored);
    // 初始化三个 .md 内容文件
    await this.fs.writeFile(`sessions/${stored.id}/memory.md`, '');
    await this.fs.writeFile(`sessions/${stored.id}/scope.md`, '');
    await this.fs.writeFile(`sessions/${stored.id}/index.md`, '');
    // 更新父的 children 列表
    parent.children.push(stored.id);
    parent.updatedAt = now();
    await this.fs.writeJSON(metaPath(parent.id), parent);
    return toTopologyNode(stored);
  }

  async get(id: string): Promise<SessionMeta | null> {
    const stored = await this.fs.readJSON<StoredMeta>(metaPath(id));
    return stored ? toSessionMeta(stored) : null;
  }

  async getRoot(): Promise<SessionMeta> {
    const all = await this.listAllStored();
    const root = all.find((s) => s.parentId === null);
    if (!root) throw new Error('根 Session 不存在');
    return toSessionMeta(root);
  }

  async listAll(): Promise<SessionMeta[]> {
    const all = await this.listAllStored();
    return all.map(toSessionMeta);
  }

  async archive(id: string): Promise<void> {
    const stored = await this.requireStored(id);
    stored.status = 'archived';
    stored.updatedAt = now();
    await this.fs.writeJSON(metaPath(id), stored);
  }

  async addRef(fromId: string, toId: string): Promise<void> {
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

  async getTree(): Promise<SessionTreeNode> {
    const all = await this.listAllStored();
    const map = new Map(all.map((s) => [s.id, s]));
    const root = all.find((s) => s.parentId === null);
    if (!root) throw new Error('根 Session 不存在');

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

    return buildNode(root);
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
