// ─── Agent Tools 执行器 ───

import type { ToolDefinition, ToolExecutionResult } from '../types/lifecycle';
import type { CoreMemory } from '../memory/core-memory';
import type { SessionMemory } from '../memory/session-memory';
import type { SessionTreeImpl } from '../session/session-tree';
import type { LifecycleManager } from '../lifecycle/lifecycle-manager';
import type { SplitGuard } from '../session/split-guard';
import { getToolDefinitions } from './definitions';

/**
 * Agent Tools 执行器
 *
 * 提供 8 个 tool 定义供 LLM function calling 使用，
 * 并统一执行 tool 调用。
 */
export class AgentTools {
  constructor(
    private readonly sessions: SessionTreeImpl,
    private readonly coreMemory: CoreMemory,
    private readonly sessionMemory: SessionMemory,
    private readonly lifecycle: LifecycleManager,
    private readonly splitGuard: SplitGuard,
  ) {}

  /** 返回所有 tool 定义 */
  getToolDefinitions(): ToolDefinition[] {
    return getToolDefinitions();
  }

  /** 执行指定 tool */
  async executeTool(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult> {
    try {
      switch (name) {
        case 'stello_read_core':
          return this.readCore(args);
        case 'stello_update_core':
          return this.updateCore(args);
        case 'stello_create_session':
          return this.createSession(args);
        case 'stello_list_sessions':
          return this.listSessions();
        case 'stello_read_summary':
          return this.readSummary(args);
        case 'stello_add_ref':
          return this.addRef(args);
        case 'stello_archive':
          return this.archive(args);
        case 'stello_update_meta':
          return this.updateMeta(args);
        default:
          return { success: false, error: `未知 tool: ${name}` };
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** 读取 L1 核心档案 */
  private async readCore(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const data = await this.coreMemory.readCore(args.path as string | undefined);
    return { success: true, data };
  }

  /** 更新 L1 核心档案 */
  private async updateCore(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    await this.coreMemory.writeCore(args.path as string, args.value);
    return { success: true };
  }

  /** 创建子 Session（受拆分保护约束） */
  private async createSession(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const parentId = args.parentId as string;
    const check = await this.splitGuard.checkCanSplit(parentId);
    if (!check.canSplit) {
      return { success: false, error: check.reason };
    }
    const parent = await this.sessions.get(parentId);
    const child = await this.lifecycle.prepareChildSpawn({
      parentId,
      label: args.label as string,
      scope: args.scope as string | undefined,
    });
    this.splitGuard.recordSplit(parentId, parent?.turnCount ?? 0);
    return { success: true, data: child };
  }

  /** 列出所有 Session */
  private async listSessions(): Promise<ToolExecutionResult> {
    const data = await this.sessions.listAll();
    return { success: true, data };
  }

  /** 读取 Session 的 memory.md */
  private async readSummary(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const data = await this.sessionMemory.readMemory(args.sessionId as string);
    return { success: true, data };
  }

  /** 添加跨分支引用 */
  private async addRef(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    await this.sessions.addRef(args.fromId as string, args.toId as string);
    return { success: true };
  }

  /** 归档 Session */
  private async archive(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    await this.sessions.archive(args.sessionId as string);
    return { success: true };
  }

  /** 更新 Session 元数据 */
  private async updateMeta(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const sessionId = args.sessionId as string;
    const updates: Record<string, unknown> = {};
    if (args.label !== undefined) updates.label = args.label;
    if (args.scope !== undefined) updates.scope = args.scope;
    if (args.tags !== undefined) updates.tags = args.tags;
    const data = await this.sessions.updateMeta(sessionId, updates);
    return { success: true, data };
  }
}
