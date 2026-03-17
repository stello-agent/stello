// ─── 记忆系统类型定义 ───

/** 记忆继承策略 */
export type InheritancePolicy = 'full' | 'summary' | 'minimal' | 'scoped';

/**
 * L1 schema 字段描述
 *
 * 定义核心档案中每个字段的类型、默认值及行为标记。
 */
export interface CoreSchemaField {
  /** 字段值类型 */
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  /** 默认值 */
  default?: unknown;
  /** 是否允许从子 Session 冒泡到全局 core.json */
  bubbleable?: boolean;
  /** 变更是否需要用户确认 */
  requireConfirm?: boolean;
}

/**
 * L1 完整 schema
 *
 * 由开发者定义，描述核心档案的结构。
 */
export type CoreSchema = Record<string, CoreSchemaField>;

/**
 * L2 Session 摘要
 *
 * 每个 Session 一份，afterTurn 自动提炼更新。
 * 包含关键结论、用户意图、待跟进事项。
 */
export interface SessionSummary {
  /** 所属 Session ID */
  sessionId: string;
  /** 关键结论 */
  conclusions: string[];
  /** 用户意图 */
  intents: string[];
  /** 待跟进事项 */
  pendingItems: string[];
  /** 最后更新时间（ISO 8601） */
  updatedAt: string;
  /** 过期天数，超过后不主动注入（默认 90） */
  ttl?: number;
}

/**
 * L3 单条对话记录
 *
 * JSONL 格式存储，每行一条 turn。
 */
export interface TurnRecord {
  /** 角色 */
  role: 'user' | 'assistant' | 'system';
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
 * bootstrap / assemble 的产物，包含按继承策略筛选的记忆。
 */
export interface AssembledContext {
  /** L1 核心档案 */
  core: Record<string, unknown>;
  /** 按继承策略收集的 L2 摘要列表 */
  summaries: SessionSummary[];
  /** 当前 Session 的 L2 摘要 */
  currentSummary: SessionSummary | null;
}

/**
 * 记忆系统接口
 *
 * 管理三层记忆的读写，以及按继承策略组装上下文。
 */
export interface MemoryEngine {
  /** 读取 L1 核心档案（支持点路径，如 'profile.gpa'） */
  readCore(path?: string): Promise<unknown>;
  /** 写入 L1 核心档案的某个字段 */
  writeCore(path: string, value: unknown): Promise<void>;
  /** 读取某 Session 的 L2 摘要 */
  readSummary(sessionId: string): Promise<SessionSummary | null>;
  /** 写入某 Session 的 L2 摘要 */
  writeSummary(sessionId: string, summary: SessionSummary): Promise<void>;
  /** 追加一条 L3 对话记录 */
  appendRecord(sessionId: string, record: TurnRecord): Promise<void>;
  /** 读取某 Session 的所有 L3 对话记录 */
  readRecords(sessionId: string): Promise<TurnRecord[]>;
  /** 按继承策略组装上下文 */
  assembleContext(sessionId: string): Promise<AssembledContext>;
}
