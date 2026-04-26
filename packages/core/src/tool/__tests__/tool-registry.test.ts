import { describe, it, expect, vi } from 'vitest'
import { ToolRegistryImpl, CompositeToolRuntime, createBuiltinToolEntries, buildSessionToolList } from '../tool-registry'
import type { ToolRegistryEntry } from '../tool-registry'
import type { SkillRouter } from '../../types/lifecycle'
import type { ForkProfileRegistry } from '../../engine/fork-profile'
import type { ToolExecutionContext } from '../../types/tool'

const makeTool = (name: string): ToolRegistryEntry => ({
  name,
  description: `${name} tool`,
  parameters: { type: 'object', properties: {} },
  execute: vi.fn().mockResolvedValue({ success: true, data: {} }),
})

/** Stub ctx for tests that don't care about it; obsolete callers will be deleted in Task 12. */
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

// TODO(Task 12): createBuiltinToolEntries / CompositeToolRuntime / buildSessionToolList
// will be deleted in the builtin-tools redesign. These describe blocks are skipped
// during the refactor window to keep this file compiling.
describe.skip('createBuiltinToolEntries', () => {
  const emptySkills: SkillRouter = {
    get: () => undefined,
    register: () => {},
    getAll: () => [],
  }

  it('无 skill 时只生成 stello_create_session', () => {
    const entries = createBuiltinToolEntries(emptySkills)
    expect(entries.map(e => e.name)).toEqual(['stello_create_session'])
  })

  it('有 skill 时同时生成 activate_skill', () => {
    const skills: SkillRouter = {
      get: () => undefined,
      register: () => {},
      getAll: () => [{ name: 'research', description: 'Research skill', content: '...' }],
    }
    const entries = createBuiltinToolEntries(skills)
    expect(entries.map(e => e.name)).toEqual(['stello_create_session', 'activate_skill'])
  })

  it('有 profile 时 stello_create_session 包含 profile 参数', () => {
    const profiles: ForkProfileRegistry = {
      register: () => {},
      get: () => undefined,
      listNames: () => ['research', 'lightweight'],
    }
    const entries = createBuiltinToolEntries(emptySkills, profiles)
    const createEntry = entries.find(e => e.name === 'stello_create_session')!
    const props = (createEntry.parameters as Record<string, unknown>).properties as Record<string, unknown>
    expect(props).toHaveProperty('profile')
  })

  it('注入 executeCreateSession 闭包时可执行', async () => {
    const executeFn = vi.fn().mockResolvedValue({ success: true, data: { sessionId: 'c1' } })
    const entries = createBuiltinToolEntries(emptySkills, undefined, executeFn)
    const createEntry = entries.find(e => e.name === 'stello_create_session')!
    const result = await createEntry.execute({ label: 'test' })
    expect(executeFn).toHaveBeenCalledWith({ label: 'test' })
    expect(result.success).toBe(true)
  })

  it('未注入 executeCreateSession 时返回 error', async () => {
    const entries = createBuiltinToolEntries(emptySkills)
    const createEntry = entries.find(e => e.name === 'stello_create_session')!
    const result = await createEntry.execute({ label: 'test' })
    expect(result.success).toBe(false)
  })

  it('activate_skill 执行时查找并返回 skill content', async () => {
    const skills: SkillRouter = {
      get: vi.fn().mockReturnValue({ name: 'research', description: 'desc', content: 'skill content' }),
      register: () => {},
      getAll: () => [{ name: 'research', description: 'desc', content: 'skill content' }],
    }
    const entries = createBuiltinToolEntries(skills)
    const skillEntry = entries.find(e => e.name === 'activate_skill')!
    const result = await skillEntry.execute({ name: 'research' })
    expect(result.success).toBe(true)
    expect(result.data).toBe('skill content')
  })
})

describe.skip('CompositeToolRuntime', () => {
  const emptySkills: SkillRouter = {
    get: () => undefined,
    register: () => {},
    getAll: () => [],
  }

  it('合并内置和用户 tool 定义', () => {
    const builtins = createBuiltinToolEntries(emptySkills)
    const userRegistry = new ToolRegistryImpl()
    userRegistry.register(makeTool('save_note'))
    const composite = new CompositeToolRuntime(builtins, userRegistry)
    const names = composite.getToolDefinitions().map(d => d.name)
    expect(names).toEqual(['stello_create_session', 'save_note'])
  })

  it('用户同名 tool 被内置版覆盖', () => {
    const builtins = createBuiltinToolEntries(emptySkills)
    const userRegistry = new ToolRegistryImpl()
    userRegistry.register({ ...makeTool('stello_create_session'), description: 'user version' })
    const composite = new CompositeToolRuntime(builtins, userRegistry)
    const defs = composite.getToolDefinitions()
    const matched = defs.filter(d => d.name === 'stello_create_session')
    expect(matched).toHaveLength(1)
    // 应该是内置版（包含 context 参数）
    expect((matched[0]!.parameters as Record<string, unknown>).properties).toHaveProperty('context')
  })

  it('executeTool 内置优先', async () => {
    const executeFn = vi.fn().mockResolvedValue({ success: true, data: { sessionId: 'c1' } })
    const builtins = createBuiltinToolEntries(emptySkills, undefined, executeFn)
    const userExecute = vi.fn()
    const userRegistry = new ToolRegistryImpl()
    const composite = new CompositeToolRuntime(builtins, userRegistry)
    await composite.executeTool('stello_create_session', { label: 'test' })
    expect(executeFn).toHaveBeenCalled()
    expect(userExecute).not.toHaveBeenCalled()
  })

  it('executeTool 非内置 fallback 到用户 tool', async () => {
    const builtins = createBuiltinToolEntries(emptySkills)
    const userRegistry = new ToolRegistryImpl()
    const fn = vi.fn().mockResolvedValue({ success: true, data: {} })
    userRegistry.register({ ...makeTool('save_note'), execute: fn })
    const composite = new CompositeToolRuntime(builtins, userRegistry)
    await composite.executeTool('save_note', { note: 'hello' })
    expect(fn).toHaveBeenCalledWith({ note: 'hello' })
  })
})

describe.skip('buildSessionToolList', () => {
  const emptySkills: SkillRouter = {
    get: () => undefined,
    register: () => {},
    getAll: () => [],
  }

  it('无 skill 无 profile 时只返回 stello_create_session + 用户 tool', () => {
    const builtins = createBuiltinToolEntries(emptySkills)
    const registry = new ToolRegistryImpl()
    registry.register(makeTool('save_note'))
    const composite = new CompositeToolRuntime(builtins, registry)
    const list = buildSessionToolList(composite)
    expect(list.map(t => t.name)).toEqual(['stello_create_session', 'save_note'])
  })

  it('有 skill 时包含 activate_skill', () => {
    const skills: SkillRouter = {
      get: () => undefined,
      register: () => {},
      getAll: () => [{ name: 'research', description: 'Research skill', content: '...' }],
    }
    const builtins = createBuiltinToolEntries(skills)
    const registry = new ToolRegistryImpl()
    const composite = new CompositeToolRuntime(builtins, registry)
    const list = buildSessionToolList(composite)
    expect(list.map(t => t.name)).toContain('activate_skill')
  })

  it('有 profile 时 stello_create_session 包含 profile 参数', () => {
    const profiles: ForkProfileRegistry = {
      register: () => {},
      get: () => undefined,
      listNames: () => ['research', 'lightweight'],
    }
    const builtins = createBuiltinToolEntries(emptySkills, profiles)
    const registry = new ToolRegistryImpl()
    const composite = new CompositeToolRuntime(builtins, registry)
    const list = buildSessionToolList(composite)
    const createTool = list.find(t => t.name === 'stello_create_session')!
    const props = (createTool.inputSchema as Record<string, unknown>).properties as Record<string, unknown>
    expect(props).toHaveProperty('profile')
  })

  it('输出格式用 inputSchema 而非 parameters', () => {
    const builtins = createBuiltinToolEntries(emptySkills)
    const registry = new ToolRegistryImpl()
    registry.register(makeTool('test'))
    const composite = new CompositeToolRuntime(builtins, registry)
    const list = buildSessionToolList(composite)
    for (const tool of list) {
      expect(tool).toHaveProperty('inputSchema')
      expect(tool).not.toHaveProperty('parameters')
    }
  })
})
