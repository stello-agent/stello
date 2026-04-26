import type { ToolDefinition, ToolExecutionResult, SkillRouter } from '../types/lifecycle'
import type { EngineToolRuntime } from '../engine/stello-engine'
import type { ForkProfileRegistry } from '../engine/fork-profile'
import type { ToolExecutionContext } from '../types/tool'
import { createSessionToolDefinition } from '../engine/builtin-tools'
import { createSkillToolDefinition, executeSkillTool } from '../skill/skill-tool'

/**
 * 注册表条目 — 应用层工具的最小契约
 *
 * 应用层通过此接口注册自定义工具，Engine 自动管理定义和执行。
 * parameters 为 JSON Schema 格式。
 */
export interface ToolRegistryEntry {
  name: string
  description: string
  /** JSON Schema 格式的参数定义 */
  parameters: Record<string, unknown>
  /** 执行函数 — 接收 LLM 透传的 args 与 Engine 提供的运行时 ctx */
  execute: (
    args: Record<string, unknown>,
    ctx: ToolExecutionContext,
  ) => Promise<ToolExecutionResult>
}

/**
 * 工具注册表 — 管理应用层自定义工具的注册和执行
 *
 * 仿照 SkillRouter 模式：纯注册 + 查询 + 执行。
 * 实现 EngineToolRuntime，可直接传给 Engine。
 */
export interface ToolRegistry extends EngineToolRuntime {
  register(tool: ToolRegistryEntry): void
  get(name: string): ToolRegistryEntry | undefined
  getAll(): ToolRegistryEntry[]
}

/** ToolRegistry 默认实现 */
export class ToolRegistryImpl implements ToolRegistry {
  private readonly tools = new Map<string, ToolRegistryEntry>()

  constructor(initialEntries?: ToolRegistryEntry[]) {
    for (const entry of initialEntries ?? []) {
      this.tools.set(entry.name, entry)
    }
  }

  register(tool: ToolRegistryEntry): void {
    this.tools.set(tool.name, tool)
  }

  get(name: string): ToolRegistryEntry | undefined {
    return this.tools.get(name)
  }

  getAll(): ToolRegistryEntry[] {
    return [...this.tools.values()]
  }

  /** 转换为 ToolDefinition 数组（EngineToolRuntime 接口） */
  getToolDefinitions(): ToolDefinition[] {
    return this.getAll().map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }))
  }

  /** 按名称执行工具（EngineToolRuntime 接口） */
  async executeTool(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const tool = this.tools.get(name)
    if (!tool) {
      return { success: false, error: `Unknown tool: ${name}` }
    }
    return tool.execute(args, ctx)
  }
}

/** 创建内置 tool 条目（stello_create_session + activate_skill） */
export function createBuiltinToolEntries(
  skills: SkillRouter,
  profiles?: ForkProfileRegistry,
  executeCreateSession?: (args: Record<string, unknown>) => Promise<ToolExecutionResult>,
): ToolRegistryEntry[] {
  const entries: ToolRegistryEntry[] = []

  // stello_create_session
  const createSessionDef = createSessionToolDefinition(profiles?.listNames())
  entries.push({
    name: createSessionDef.name,
    description: createSessionDef.description,
    parameters: createSessionDef.parameters,
    execute: executeCreateSession ?? (async () => ({
      success: false,
      error: 'stello_create_session 不可用：未提供 executeCreateSession 实现',
    })),
  })

  // activate_skill（仅在有 skills 时注入）
  if (skills.getAll().length > 0) {
    const skillDef = createSkillToolDefinition(skills)
    entries.push({
      name: skillDef.name,
      description: skillDef.description,
      parameters: skillDef.parameters,
      execute: async (args) => executeSkillTool(skills, args as { name: string }),
    })
  }

  return entries
}

/**
 * 组合工具运行时 — 合并内置 tool 和用户 tool，内置优先
 *
 * 不修改用户的 ToolRegistry，适用于跨 Engine 共享同一 registry 的场景。
 */
export class CompositeToolRuntime implements EngineToolRuntime {
  private readonly builtinMap: Map<string, ToolRegistryEntry>
  private readonly builtinDefs: ToolDefinition[]

  constructor(
    private readonly builtinEntries: ToolRegistryEntry[],
    private readonly userTools: EngineToolRuntime,
  ) {
    this.builtinMap = new Map(builtinEntries.map(e => [e.name, e]))
    this.builtinDefs = builtinEntries.map(e => ({
      name: e.name,
      description: e.description,
      parameters: e.parameters,
    }))
  }

  /** 合并 tool 定义，内置优先，用户同名 tool 被过滤 */
  getToolDefinitions(): ToolDefinition[] {
    const userDefs = this.userTools.getToolDefinitions()
      .filter(d => !this.builtinMap.has(d.name))
    return [...this.builtinDefs, ...userDefs]
  }

  /** 执行 tool：内置优先，fallback 到用户 tool */
  async executeTool(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const builtin = this.builtinMap.get(name)
    if (builtin) {
      return builtin.execute(args)
    }
    return this.userTools.executeTool(name, args)
  }
}

/**
 * 生成完整的 session 兼容工具列表
 *
 * 接受 EngineToolRuntime（通常是 CompositeToolRuntime），输出 session 兼容格式。
 */
export function buildSessionToolList(
  runtime: EngineToolRuntime,
): Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> {
  return runtime.getToolDefinitions().map(d => ({
    name: d.name,
    description: d.description,
    inputSchema: d.parameters,
  }))
}
