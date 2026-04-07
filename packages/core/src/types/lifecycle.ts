// ─── 生命周期钩子 + Skill + 确认协议 + Agent Tools 类型定义 ───

import type { SessionMeta, TopologyNode } from './session';
import type { AssembledContext } from './memory';

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
