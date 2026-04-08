import type { FileSystemAdapter } from '../types/fs';
import type { SessionTree } from '../types/session';
import type { MemoryEngine, TurnRecord, AssembledContext } from '../types/memory';

/**
 * FileSystemMemoryEngine — 基于文件系统的 MemoryEngine 实现
 *
 * 数据布局：
 *   basePath/core.json                        — L1 全局核心档案
 *   basePath/sessions/{id}/memory.md          — L2 记忆摘要
 *   basePath/sessions/{id}/scope.md           — L2 对话边界
 *   basePath/sessions/{id}/index.md           — L2 子节点目录
 *   basePath/sessions/{id}/records.jsonl      — L3 原始对话记录
 */
export class FileSystemMemoryEngine implements MemoryEngine {
  constructor(
    private readonly fs: FileSystemAdapter,
    private readonly sessions: SessionTree,
  ) {}

  /** 生成 session 文件路径（相对于 basePath） */
  private sessionPath(id: string, file: string): string {
    return `sessions/${id}/${file}`;
  }

  /** 确保 session 目录存在 */
  private async ensureSessionDir(id: string): Promise<void> {
    await this.fs.mkdir(`sessions/${id}`);
  }

  /** 读取 L1 核心档案，支持点路径导航；路径不存在时返回 null */
  async readCore(path?: string): Promise<unknown> {
    const raw = await this.fs.readJSON<Record<string, unknown>>('core.json');
    if (raw === null) return null;
    if (!path) return raw;
    // 按点路径逐层访问，找不到时返回 null
    const result = path.split('.').reduce<unknown>((obj, key) => {
      if (obj !== null && typeof obj === 'object') {
        return (obj as Record<string, unknown>)[key];
      }
      return undefined;
    }, raw);
    return result === undefined ? null : result;
  }

  /** 写入 L1 核心档案的某个字段，支持点路径嵌套写入 */
  async writeCore(path: string, value: unknown): Promise<void> {
    const raw = (await this.fs.readJSON<Record<string, unknown>>('core.json')) ?? {};
    const keys = path.split('.');
    let current: Record<string, unknown> = raw;
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i]!;
      if (typeof current[key] !== 'object' || current[key] === null) {
        current[key] = {};
      }
      current = current[key] as Record<string, unknown>;
    }
    current[keys[keys.length - 1]!] = value;
    await this.fs.writeJSON('core.json', raw);
  }

  /** 读取某 Session 的 memory.md，空文件视为 null */
  async readMemory(sessionId: string): Promise<string | null> {
    const content = await this.fs.readFile(this.sessionPath(sessionId, 'memory.md'));
    return content === null || content === '' ? null : content;
  }

  /** 写入某 Session 的 memory.md */
  async writeMemory(sessionId: string, content: string): Promise<void> {
    await this.ensureSessionDir(sessionId);
    await this.fs.writeFile(this.sessionPath(sessionId, 'memory.md'), content);
  }

  /** 读取某 Session 的 scope.md，空文件视为 null */
  async readScope(sessionId: string): Promise<string | null> {
    const content = await this.fs.readFile(this.sessionPath(sessionId, 'scope.md'));
    return content === null || content === '' ? null : content;
  }

  /** 写入某 Session 的 scope.md */
  async writeScope(sessionId: string, content: string): Promise<void> {
    await this.ensureSessionDir(sessionId);
    await this.fs.writeFile(this.sessionPath(sessionId, 'scope.md'), content);
  }

  /** 读取某 Session 的 index.md，空文件视为 null */
  async readIndex(sessionId: string): Promise<string | null> {
    const content = await this.fs.readFile(this.sessionPath(sessionId, 'index.md'));
    return content === null || content === '' ? null : content;
  }

  /** 写入某 Session 的 index.md */
  async writeIndex(sessionId: string, content: string): Promise<void> {
    await this.ensureSessionDir(sessionId);
    await this.fs.writeFile(this.sessionPath(sessionId, 'index.md'), content);
  }

  /** 追加一条 L3 对话记录到 records.jsonl */
  async appendRecord(sessionId: string, record: TurnRecord): Promise<void> {
    await this.ensureSessionDir(sessionId);
    await this.fs.appendLine(this.sessionPath(sessionId, 'records.jsonl'), JSON.stringify(record));
  }

  /** 覆盖某 Session 的全部 L3 对话记录 */
  async replaceRecords(sessionId: string, records: TurnRecord[]): Promise<void> {
    await this.ensureSessionDir(sessionId);
    const content = records.map((r) => JSON.stringify(r)).join('\n');
    await this.fs.writeFile(this.sessionPath(sessionId, 'records.jsonl'), content ? content + '\n' : '');
  }

  /** 读取某 Session 的所有 L3 对话记录，跳过损坏的行 */
  async readRecords(sessionId: string): Promise<TurnRecord[]> {
    const lines = await this.fs.readLines(this.sessionPath(sessionId, 'records.jsonl'));
    const records: TurnRecord[] = [];
    for (const line of lines) {
      if (line.trim().length === 0) continue;
      try {
        records.push(JSON.parse(line) as TurnRecord);
      } catch {
        console.warn(`[FileSystemMemoryEngine] Skipping corrupt JSONL line in session ${sessionId}: ${line}`);
      }
    }
    return records;
  }

  /** 按祖先链组装上下文（从父到根收集 memory） */
  async assembleContext(sessionId: string): Promise<AssembledContext> {
    // 读取 L1 核心档案，复用 readCore() 避免重复路径
    const core: Record<string, unknown> = (await this.readCore() as Record<string, unknown>) ?? {};

    // 获取祖先节点（从直接父到根），收集各自的 memory
    const ancestors = await this.sessions.getAncestors(sessionId);
    const memories: string[] = [];
    for (const ancestor of ancestors) {
      const mem = await this.readMemory(ancestor.id);
      if (mem) memories.push(mem);
    }

    // 当前 Session 的 memory 和 scope
    const currentMemory = await this.readMemory(sessionId);
    const scope = await this.readScope(sessionId);

    return { core, memories, currentMemory, scope };
  }
}
