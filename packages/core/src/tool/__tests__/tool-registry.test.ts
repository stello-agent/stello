import { describe, it, expect, vi } from 'vitest'
import { ToolRegistryImpl, buildSessionToolList } from '../tool-registry'
import type { ToolRegistryEntry } from '../tool-registry'
import type { ToolExecutionContext } from '../../types/tool'

const makeTool = (name: string): ToolRegistryEntry => ({
  name,
  description: `${name} tool`,
  parameters: { type: 'object', properties: {} },
  execute: vi.fn().mockResolvedValue({ success: true, data: {} }),
})

/** Stub ctx for tests that don't care about it. */
const stubCtx = (toolName = 'tool'): ToolExecutionContext => ({
  agent: {} as never,
  sessionId: 's-test',
  toolName,
})

describe('ToolRegistryImpl', () => {
  it('注册并获取 tool', () => {
    const registry = new ToolRegistryImpl()
    const tool = makeTool('search')
    registry.register(tool)
    expect(registry.get('search')).toBe(tool)
  })

  it('获取不存在的 tool 返回 undefined', () => {
    const registry = new ToolRegistryImpl()
    expect(registry.get('nonexistent')).toBeUndefined()
  })

  it('getAll 返回所有已注册 tool', () => {
    const registry = new ToolRegistryImpl()
    registry.register(makeTool('a'))
    registry.register(makeTool('b'))
    expect(registry.getAll().map(t => t.name)).toEqual(['a', 'b'])
  })

  it('重复注册同名 tool 覆盖旧值', () => {
    const registry = new ToolRegistryImpl()
    registry.register({ ...makeTool('x'), description: 'old' })
    registry.register({ ...makeTool('x'), description: 'new' })
    expect(registry.get('x')!.description).toBe('new')
  })

  it('getToolDefinitions 返回 ToolDefinition 数组', () => {
    const registry = new ToolRegistryImpl()
    registry.register(makeTool('search'))
    const defs = registry.getToolDefinitions()
    expect(defs).toEqual([{
      name: 'search',
      description: 'search tool',
      parameters: { type: 'object', properties: {} },
    }])
  })

  it('executeTool 调用对应 tool 的 execute', async () => {
    const registry = new ToolRegistryImpl()
    const fn = vi.fn().mockResolvedValue({ success: true, data: { found: true } })
    registry.register({ ...makeTool('search'), execute: fn })
    const ctx = stubCtx('search')
    const result = await registry.executeTool('search', { query: 'test' }, ctx)
    expect(fn).toHaveBeenCalledWith({ query: 'test' }, ctx)
    expect(result).toEqual({ success: true, data: { found: true } })
  })

  it('executeTool 调用不存在的 tool 返回 error', async () => {
    const registry = new ToolRegistryImpl()
    const result = await registry.executeTool('missing', {}, stubCtx('missing'))
    expect(result.success).toBe(false)
    expect(result.error).toContain('missing')
  })
})

describe('ToolRegistryImpl constructor', () => {
  it('accepts initial entries array', () => {
    const t1: ToolRegistryEntry = { name: 't1', description: 'd', parameters: {}, execute: async () => ({ success: true }) }
    const t2: ToolRegistryEntry = { name: 't2', description: 'd', parameters: {}, execute: async () => ({ success: true }) }
    const registry = new ToolRegistryImpl([t1, t2])
    expect(registry.getToolDefinitions()).toHaveLength(2)
  })

  it('still supports register() after construction', () => {
    const registry = new ToolRegistryImpl()
    registry.register({ name: 't', description: 'd', parameters: {}, execute: async () => ({ success: true }) })
    expect(registry.getToolDefinitions()).toHaveLength(1)
  })
})

describe('ToolRegistryImpl.executeTool forwards ctx', () => {
  it('passes ctx to entry execute', async () => {
    const executeSpy = vi.fn(async (_args: Record<string, unknown>, ctx: ToolExecutionContext) => ({
      success: true,
      data: { gotCtx: ctx.toolName },
    }))
    const registry = new ToolRegistryImpl([
      { name: 'mytool', description: 'd', parameters: {}, execute: executeSpy },
    ])
    const ctx: ToolExecutionContext = { agent: {} as never, sessionId: 's1', toolName: 'mytool' }
    const result = await registry.executeTool('mytool', { x: 1 }, ctx)
    expect(executeSpy).toHaveBeenCalledWith({ x: 1 }, ctx)
    expect(result).toEqual({ success: true, data: { gotCtx: 'mytool' } })
  })
})

describe('buildSessionToolList', () => {
  it('把 EngineToolRuntime 输出的 ToolDefinition 转成 session 兼容格式 (inputSchema)', () => {
    const registry = new ToolRegistryImpl()
    registry.register(makeTool('save_note'))
    registry.register(makeTool('search'))

    const list = buildSessionToolList(registry)

    expect(list).toEqual([
      { name: 'save_note', description: 'save_note tool', inputSchema: { type: 'object', properties: {} } },
      { name: 'search', description: 'search tool', inputSchema: { type: 'object', properties: {} } },
    ])
  })

  it('空 runtime 返回空数组', () => {
    const registry = new ToolRegistryImpl()
    expect(buildSessionToolList(registry)).toEqual([])
  })

  it('输出格式用 inputSchema 而非 parameters', () => {
    const registry = new ToolRegistryImpl()
    registry.register(makeTool('test'))
    const list = buildSessionToolList(registry)
    for (const tool of list) {
      expect(tool).toHaveProperty('inputSchema')
      expect(tool).not.toHaveProperty('parameters')
    }
  })
})
