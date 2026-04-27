import { describe, it, expect, vi } from 'vitest'
import { createSessionTool } from '../create-session-tool'
import type { ToolExecutionContext } from '../../types/tool'

describe('createSessionTool factory', () => {
  it('returns a ToolRegistryEntry with name "stello_create_session"', () => {
    const tool = createSessionTool()
    expect(tool.name).toBe('stello_create_session')
    expect(tool.description).toBeTruthy()
    expect(tool.parameters).toBeTypeOf('object')
  })

  it('schema exposes context: compress, profileVars, and skills', () => {
    const tool = createSessionTool()
    const props = (tool.parameters as { properties: Record<string, { enum?: string[]; type?: string }> }).properties
    expect(props.context.enum).toEqual(['none', 'inherit', 'compress'])
    expect(props.profileVars).toBeDefined()
    expect(props.skills).toBeDefined()
    expect(props.skills.type).toBe('array')
    expect(props.vars).toBeUndefined()
  })

  it('execute forwards all new fields to forkSession', async () => {
    const forkSpy = vi.fn().mockResolvedValue({ id: 'child-1', label: 'Child' })
    const ctx: ToolExecutionContext = {
      agent: { forkSession: forkSpy, profiles: undefined } as never,
      sessionId: 'parent-1',
      toolName: 'stello_create_session',
    }
    const tool = createSessionTool()
    const result = await tool.execute(
      {
        label: 'Child',
        systemPrompt: 'sp',
        context: 'compress',
        profileVars: { region: 'NA' },
        skills: ['a', 'b'],
      },
      ctx,
    )
    expect(forkSpy).toHaveBeenCalledWith('parent-1', {
      label: 'Child',
      systemPrompt: 'sp',
      context: 'compress',
      profileVars: { region: 'NA' },
      skills: ['a', 'b'],
    })
    expect(result).toEqual({ success: true, data: { sessionId: 'child-1', label: 'Child' } })
  })

  it('execute preserves three-state skills semantics', async () => {
    const forkSpy = vi.fn().mockResolvedValue({ id: 'c', label: 'L' })
    const ctx: ToolExecutionContext = {
      agent: { forkSession: forkSpy, profiles: undefined } as never,
      sessionId: 'p',
      toolName: 'stello_create_session',
    }
    const tool = createSessionTool()

    await tool.execute({ label: 'L' }, ctx)
    expect(forkSpy.mock.calls[0][1]).not.toHaveProperty('skills')

    await tool.execute({ label: 'L', skills: [] }, ctx)
    expect(forkSpy.mock.calls[1][1].skills).toEqual([])

    await tool.execute({ label: 'L', skills: ['a'] }, ctx)
    expect(forkSpy.mock.calls[2][1].skills).toEqual(['a'])
  })

  it('returns error for unknown profile', async () => {
    const profilesStub = { has: (n: string) => n === 'known' }
    const ctx: ToolExecutionContext = {
      agent: { forkSession: vi.fn(), profiles: profilesStub } as never,
      sessionId: 's',
      toolName: 'stello_create_session',
    }
    const tool = createSessionTool()
    const result = await tool.execute({ label: 'L', profile: 'unknown' }, ctx)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/profile.*unknown/i)
  })

  it('returns error when forkSession throws', async () => {
    const ctx: ToolExecutionContext = {
      agent: { forkSession: vi.fn().mockRejectedValue(new Error('split blocked')), profiles: undefined } as never,
      sessionId: 's',
      toolName: 'stello_create_session',
    }
    const tool = createSessionTool()
    const result = await tool.execute({ label: 'L' }, ctx)
    expect(result).toEqual({ success: false, error: 'split blocked' })
  })
})
