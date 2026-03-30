// ─── 生命周期钩子 + Skill + 确认协议 + Agent Tools 类型定义 ───

import type { SessionMeta, TopologyNode, CreateSessionOptions } from './session';
import type { AssembledContext, TurnRecord } from './memory';

// ─── 生命周期钩子 ───

/** bootstrap 钩子返回值 */
export interface BootstrapResult {
	/** 组装好的上下文 */
	context: AssembledContext;
	/** 当前 Session 元数据 */
	session: SessionMeta;
}

/** afterTurn 钩子返回值 */
export interface AfterTurnResult {
	/** L1 核心档案是否有更新 */
	coreUpdated: boolean;
	/** memory.md 是否有更新 */
	memoryUpdated: boolean;
	/** L3 原始记录是否追加成功 */
	recordAppended: boolean;
}

/**
 * 生命周期钩子
 *
 * 串联 Session 系统、记忆系统、文件系统的执行时序。
 * 所有钩子有默认实现，开发者可选择性覆盖。失败不阻塞对话。
 */
export interface LifecycleHooks {
	/** 进入 Session 时：读 L1 + memory.md，按继承策略组装上下文 */
	bootstrap?(sessionId: string): Promise<BootstrapResult>;
/** 每轮结束：提取写 L1 + 更新 memory.md + 追加 records.jsonl + 触发父 index.md 更新 */
	afterTurn?(
		sessionId: string,
		userMsg: TurnRecord,
		assistantMsg: TurnRecord,
	): Promise<AfterTurnResult>;
	/** context 接近上限时：压缩旧内容存入 memory.md（v0.1 只留接口） */
	compact?(sessionId: string): Promise<void>;
	/** 切换 Session：旧 Session 更新 memory.md → 新 Session bootstrap */
	onSessionSwitch?(fromId: string, toId: string): Promise<BootstrapResult>;
	/** 创建子 Session 前：创建文件夹 + meta.json + 空 memory.md + 生成 scope.md + 更新父 index.md */
	prepareChildSpawn?(options: CreateSessionOptions): Promise<TopologyNode>;
}

// ─── Skill 插槽 ───

/**
 * Skill 定义 — 可被 LLM 发现和激活的 prompt 片段
 *
 * 对齐标准 Agent Skills 模式（lazy-loaded prompt injection）：
 * - Tier 1: name + description 始终对 LLM 可见
 * - Tier 2: content 在 LLM 主动激活时注入
 */
export interface Skill {
	/** 唯一名称 */
	name: string;
	/** 描述（LLM 据此判断是否激活） */
	description: string;
	/** 激活时注入的完整 prompt 内容 */
	content: string;
}

/**
 * Skill 注册表
 *
 * 纯注册 + 查询，不做意图匹配。匹配由 LLM 通过 Skill Tool 自行决定。
 */
export interface SkillRouter {
	/** 注册 Skill（同名覆盖） */
	register(skill: Skill): void;
	/** 按名称查找 Skill */
	get(name: string): Skill | undefined;
	/** 获取所有已注册的 Skill */
	getAll(): Skill[];
}

// ─── Agent Tools ───

/**
 * Agent Tool 定义
 *
 * 兼容 OpenAI function calling / Claude tool use 格式。
 * 通过 getToolDefinitions() 导出。
 */
export interface ToolDefinition {
	/** Tool 名称（如 stello_create_session） */
	name: string;
	/** Tool 描述 */
	description: string;
	/** JSON Schema 格式的参数定义 */
	parameters: Record<string, unknown>;
}

/** Tool 执行结果 */
export interface ToolExecutionResult {
	/** 是否执行成功 */
	success: boolean;
	/** 返回数据 */
	data?: unknown;
	/** 错误信息 */
	error?: string;
}

// ─── 确认协议 ───

/**
 * 拆分建议
 *
 * Agent 判断该拆分时触发，等待用户确认或拒绝。
 */
export interface SplitProposal {
	/** 提案唯一 ID */
	id: string;
	/** 父 Session ID */
	parentId: string;
	/** 建议的显示名称 */
	suggestedLabel: string;
	/** 建议的作用域 */
	suggestedScope?: string;
	/** 拆分原因 */
	reason: string;
}

/**
 * L1 更新建议
 *
 * schema 中标记 requireConfirm 的字段变更时触发。
 */
export interface UpdateProposal {
	/** 提案唯一 ID */
	id: string;
	/** 字段路径（如 'schools'） */
	path: string;
	/** 旧值 */
	oldValue: unknown;
	/** 新值 */
	newValue: unknown;
	/** 变更原因 */
	reason: string;
}

/**
 * 确认协议接口
 *
 * 框架只管事件 + API，不提供 UI 组件。
 * 开发者自己决定确认界面长什么样。
 */
export interface ConfirmProtocol {
	/** 确认拆分 → 创建子 Session */
	confirmSplit(proposal: SplitProposal): Promise<TopologyNode>;
	/** 拒绝拆分 → 不创建，继续当前 Session */
	dismissSplit(proposal: SplitProposal): Promise<void>;
	/** 确认 L1 更新 → 写入 core.json + 触发 onChange + 冒泡 */
	confirmUpdate(proposal: UpdateProposal): Promise<void>;
	/** 拒绝 L1 更新 → 不写入 */
	dismissUpdate(proposal: UpdateProposal): Promise<void>;
}
