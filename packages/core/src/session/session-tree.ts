import { randomUUID } from 'node:crypto';
import type { FileSystemAdapter } from '../types/fs';
import type { SessionMeta, SessionTree, CreateSessionOptions } from '../types/session';

/** meta.json 的存储路径 */
function metaPath(id: string): string {
  return `sessions/${id}/meta.json`;
}

/** 获取当前时间 ISO 字符串 */
function now(): string {
  return new Date().toISOString();
}

/**
 * SessionTree 的默认实现
 *
 * 管理对话的树状空间结构，用 FileSystemAdapter 做持久化。
 * 所有树关系靠 meta.json 的 parentId 维护，Session 目录平铺存放。
 */
export class SessionTreeImpl implements SessionTree {
  constructor(private readonly fs: FileSystemAdapter) {}

  /** 创建根 Session（不在接口中，初始化时调用） */
  async createRoot(label = 'Root'): Promise<SessionMeta> {
    const ts = now();
    const meta: SessionMeta = {
      id: randomUUID(),
      parentId: null,
      children: [],
      refs: [],
      label,
      index: 0,
      scope: null,
      status: 'active',
      depth: 0,
      turnCount: 0,
      metadata: {},
      tags: [],
      createdAt: ts,
      updatedAt: ts,
      lastActiveAt: ts,
    };
    await this.fs.writeJSON(metaPath(meta.id), meta);
    // 初始化 core.json（如果不存在）
    const existing = await this.fs.readJSON('core.json');
    if (existing === null) {
      await this.fs.writeJSON('core.json', {});
    }
    return meta;
  }

  async createChild(options: CreateSessionOptions): Promise<SessionMeta> {
    const parent = await this.requireSession(options.parentId);
    const ts = now();
    const meta: SessionMeta = {
      id: randomUUID(),
      parentId: parent.id,
      children: [],
      refs: [],
      label: options.label,
      index: parent.children.length,
      scope: options.scope ?? null,
      status: 'active',
      depth: parent.depth + 1,
      turnCount: 0,
      metadata: options.metadata ?? {},
      tags: options.tags ?? [],
      createdAt: ts,
      updatedAt: ts,
      lastActiveAt: ts,
    };
    // 写子 Session meta.json
    await this.fs.writeJSON(metaPath(meta.id), meta);
    // 更新父的 children 列表
    parent.children.push(meta.id);
    parent.updatedAt = now();
    await this.fs.writeJSON(metaPath(parent.id), parent);
    return meta;
  }

  async get(id: string): Promise<SessionMeta | null> {
    return this.fs.readJSON<SessionMeta>(metaPath(id));
  }

  async getRoot(): Promise<SessionMeta> {
    const all = await this.listAll();
    const root = all.find((s) => s.parentId === null);
    if (!root) throw new Error('根 Session 不存在');
    return root;
  }

  async listAll(): Promise<SessionMeta[]> {
    const dirs = await this.fs.listDirs('sessions');
    const results: SessionMeta[] = [];
    for (const dir of dirs) {
      const meta = await this.fs.readJSON<SessionMeta>(metaPath(dir));
      if (meta) results.push(meta);
    }
    return results;
  }

  async archive(id: string): Promise<void> {
    const meta = await this.requireSession(id);
    meta.status = 'archived';
    meta.updatedAt = now();
    await this.fs.writeJSON(metaPath(id), meta);
  }

  async addRef(fromId: string, toId: string): Promise<void> {
    if (fromId === toId) throw new Error('不能引用自己');
    const from = await this.requireSession(fromId);
    await this.requireSession(toId);
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

  async updateMeta(
    id: string,
    updates: Partial<Pick<SessionMeta, 'label' | 'scope' | 'tags' | 'metadata'>>,
  ): Promise<SessionMeta> {
    const meta = await this.requireSession(id);
    if (updates.label !== undefined) meta.label = updates.label;
    if (updates.scope !== undefined) meta.scope = updates.scope;
    if (updates.tags !== undefined) meta.tags = updates.tags;
    if (updates.metadata !== undefined) meta.metadata = updates.metadata;
    meta.updatedAt = now();
    await this.fs.writeJSON(metaPath(id), meta);
    return meta;
  }

  async getAncestors(id: string): Promise<SessionMeta[]> {
    const ancestors: SessionMeta[] = [];
    let current = await this.requireSession(id);
    while (current.parentId !== null) {
      const parent = await this.fs.readJSON<SessionMeta>(metaPath(current.parentId));
      if (!parent) break;
      ancestors.push(parent);
      current = parent;
    }
    return ancestors;
  }

  async getSiblings(id: string): Promise<SessionMeta[]> {
    const meta = await this.requireSession(id);
    if (meta.parentId === null) return [];
    const parent = await this.fs.readJSON<SessionMeta>(metaPath(meta.parentId));
    if (!parent) return [];
    const siblings: SessionMeta[] = [];
    for (const childId of parent.children) {
      if (childId === id) continue;
      const child = await this.fs.readJSON<SessionMeta>(metaPath(childId));
      if (child) siblings.push(child);
    }
    return siblings;
  }

  /** 读取 Session，不存在则抛错 */
  private async requireSession(id: string): Promise<SessionMeta> {
    const meta = await this.fs.readJSON<SessionMeta>(metaPath(id));
    if (!meta) throw new Error(`Session 不存在: ${id}`);
    return meta;
  }

  /** 递归获取所有后代 ID */
  private async getAllDescendants(id: string): Promise<Set<string>> {
    const result = new Set<string>();
    const meta = await this.fs.readJSON<SessionMeta>(metaPath(id));
    if (!meta) return result;
    for (const childId of meta.children) {
      result.add(childId);
      const childDescendants = await this.getAllDescendants(childId);
      for (const d of childDescendants) result.add(d);
    }
    return result;
  }
}
