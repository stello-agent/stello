import type { ToolDefinition, ToolExecutionResult, SkillRouter } from '../types/lifecycle'
import type { EngineToolRuntime } from '../engine/stello-engine'
import type { ForkProfileRegistry } from '../engine/fork-profile'
import { createSessionToolDefinition } from '../engine/builtin-tools'
import { createSkillToolDefinition } from '../skill/skill-tool'

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
  /** 执行函数 */
  execute: (args: Record<string, unknown>) => Promise<ToolExecutionResult>
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
  async executeTool(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const tool = this.tools.get(name)
    if (!tool) {
      return { success: false, error: `Unknown tool: ${name}` }
    }
    return tool.execute(args)
  }
}

/**
 * 生成完整的 session 兼容工具列表（内置 tool + 用户 tool）
 *
 * Session 创建时需要 tool schema 让 LLM 看到可用工具。
 * 此函数合并 Engine 内置 tool 和用户注册 tool，输出 session 兼容格式。
 */
export function buildSessionToolList(
  registry: ToolRegistry,
  skills: SkillRouter,
  profiles?: ForkProfileRegistry,
): Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> {
  const builtinDefs: ToolDefinition[] = [
    createSessionToolDefinition(profiles?.listNames()),
  ]
  if (skills.getAll().length > 0) {
    builtinDefs.push(createSkillToolDefinition(skills))
  }

  const allDefs = [...builtinDefs, ...registry.getToolDefinitions()]
  return allDefs.map(d => ({
    name: d.name,
    description: d.description,
    inputSchema: d.parameters,
  }))
}
