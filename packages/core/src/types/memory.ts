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

/**
 * 记忆系统接口
 *
 * 管理三层记忆的读写，以及按继承策略组装上下文。
 * L2 内容文件使用 markdown 格式（LLM 天然理解，用户可直接阅读）。
 */
export interface MemoryEngine {
  /** 读取 L1 核心档案（支持点路径，如 'profile.gpa'） */
  readCore(path?: string): Promise<unknown>;
  /** 写入 L1 核心档案的某个字段 */
  writeCore(path: string, value: unknown): Promise<void>;
  /** 读取某 Session 的 memory.md（记忆摘要） */
  readMemory(sessionId: string): Promise<string | null>;
  /** 写入某 Session 的 memory.md */
  writeMemory(sessionId: string, content: string): Promise<void>;
  /** 读取某 Session 的 scope.md（对话边界） */
  readScope(sessionId: string): Promise<string | null>;
  /** 写入某 Session 的 scope.md */
  writeScope(sessionId: string, content: string): Promise<void>;
  /** 读取某 Session 的 index.md（子节点目录） */
  readIndex(sessionId: string): Promise<string | null>;
  /** 写入某 Session 的 index.md */
  writeIndex(sessionId: string, content: string): Promise<void>;
  /** 追加一条 L3 对话记录 */
  appendRecord(sessionId: string, record: TurnRecord): Promise<void>;
  /** 读取某 Session 的所有 L3 对话记录 */
  readRecords(sessionId: string): Promise<TurnRecord[]>;
  /** 按继承策略组装上下文 */
  assembleContext(sessionId: string): Promise<AssembledContext>;
}
