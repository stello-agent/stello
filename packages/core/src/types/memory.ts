// ─── 对话记录 / 上下文类型定义 ───

/**
 * L3 单条对话记录
 *
 * JSONL 格式存储，每行一条 turn。
 */
export interface TurnRecord {
  /** 角色 */
  role: 'user' | 'assistant' | 'system' | 'tool';
  /** 内容 */
  content: string;
  /** 时间戳（ISO 8601） */
  timestamp: string;
  /** 附加数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 组装后的上下文
 *
 * bootstrap 的产物，包含按继承策略筛选的记忆。
 */
export interface AssembledContext {
  /** L1 核心档案 */
  core: Record<string, unknown>;
  /** 按继承策略收集的 memory.md 内容列表 */
  memories: string[];
  /** 当前 Session 的 memory.md 内容 */
  currentMemory: string | null;
  /** 当前 Session 的 scope.md 内容 */
  scope: string | null;
}

