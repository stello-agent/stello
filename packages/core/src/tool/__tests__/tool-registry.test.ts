import { describe, it, expect, vi } from 'vitest'
import { ToolRegistryImpl, buildSessionToolList } from '../tool-registry'
import type { ToolRegistryEntry } from '../tool-registry'
import type { SkillRouter } from '../../types/lifecycle'
import type { ForkProfileRegistry } from '../../engine/fork-profile'

const makeTool = (name: string): ToolRegistryEntry => ({
  name,
  description: `${name} tool`,
  parameters: { type: 'object', properties: {} },
  execute: vi.fn().mockResolvedValue({ success: true, data: {} }),
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
    const result = await registry.executeTool('search', { query: 'test' })
    expect(fn).toHaveBeenCalledWith({ query: 'test' })
    expect(result).toEqual({ success: true, data: { found: true } })
  })

  it('executeTool 调用不存在的 tool 返回 error', async () => {
    const registry = new ToolRegistryImpl()
    const result = await registry.executeTool('missing', {})
    expect(result.success).toBe(false)
    expect(result.error).toContain('missing')
  })
})

describe('buildSessionToolList', () => {
  const emptySkills: SkillRouter = {
    get: () => undefined,
    register: () => {},
    getAll: () => [],
  }

  it('无 skill 无 profile 时只返回 stello_create_session + 用户 tool', () => {
    const registry = new ToolRegistryImpl()
    registry.register(makeTool('save_note'))
    const list = buildSessionToolList(registry, emptySkills)
    expect(list.map(t => t.name)).toEqual(['stello_create_session', 'save_note'])
  })

  it('有 skill 时包含 activate_skill', () => {
    const skills: SkillRouter = {
      get: () => undefined,
      register: () => {},
      getAll: () => [{ name: 'research', description: 'Research skill', content: '...' }],
    }
    const registry = new ToolRegistryImpl()
    const list = buildSessionToolList(registry, skills)
    expect(list.map(t => t.name)).toContain('activate_skill')
  })

  it('有 profile 时 stello_create_session 包含 profile 参数', () => {
    const profiles: ForkProfileRegistry = {
      register: () => {},
      get: () => undefined,
      listNames: () => ['research', 'lightweight'],
    }
    const registry = new ToolRegistryImpl()
    const list = buildSessionToolList(registry, emptySkills, profiles)
    const createTool = list.find(t => t.name === 'stello_create_session')!
    const props = (createTool.inputSchema as Record<string, unknown>).properties as Record<string, unknown>
    expect(props).toHaveProperty('profile')
  })

  it('输出格式用 inputSchema 而非 parameters', () => {
    const registry = new ToolRegistryImpl()
    registry.register(makeTool('test'))
    const list = buildSessionToolList(registry, emptySkills)
    for (const tool of list) {
      expect(tool).toHaveProperty('inputSchema')
      expect(tool).not.toHaveProperty('parameters')
    }
  })
})
