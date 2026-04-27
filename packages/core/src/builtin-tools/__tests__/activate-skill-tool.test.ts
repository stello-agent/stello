import { describe, it, expect } from 'vitest'
import { activateSkillTool } from '../activate-skill-tool'
import { SkillRouterImpl } from '../../skill/skill-router'
import type { ToolExecutionContext } from '../../types/tool'

describe('activateSkillTool factory', () => {
  it('returns ToolRegistryEntry named "activate_skill"', () => {
    const router = new SkillRouterImpl()
    const tool = activateSkillTool(router)
    expect(tool.name).toBe('activate_skill')
  })

  it('execute returns content for known skill', async () => {
    const router = new SkillRouterImpl()
    router.register({ name: 'analyzer', description: 'd', content: 'YOU ARE AN ANALYZER' })
    const tool = activateSkillTool(router)
    const ctx: ToolExecutionContext = { agent: {} as never, sessionId: 's', toolName: 'activate_skill' }
    const result = await tool.execute({ name: 'analyzer' }, ctx)
    expect(result).toEqual({ success: true, data: { content: 'YOU ARE AN ANALYZER' } })
  })

  it('execute returns error for unknown skill', async () => {
    const router = new SkillRouterImpl()
    const tool = activateSkillTool(router)
    const ctx: ToolExecutionContext = { agent: {} as never, sessionId: 's', toolName: 'activate_skill' }
    const result = await tool.execute({ name: 'nope' }, ctx)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/skill.*nope/i)
  })

  it('description enumerates registered skill names', () => {
    const router = new SkillRouterImpl()
    router.register({ name: 's1', description: 'd1', content: 'x' })
    router.register({ name: 's2', description: 'd2', content: 'y' })
    const tool = activateSkillTool(router)
    expect(tool.description).toMatch(/s1/)
    expect(tool.description).toMatch(/s2/)
  })
})
