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

  it('execute calls ctx.agent.forkSession with mapped options', async () => {
    const forkSpy = vi.fn().mockResolvedValue({ id: 'child-1', label: 'Child' })
    const ctx: ToolExecutionContext = {
      agent: { forkSession: forkSpy, profiles: undefined } as never,
      sessionId: 'parent-1',
      toolName: 'stello_create_session',
    }
    const tool = createSessionTool()
    const result = await tool.execute(
      { label: 'Child', systemPrompt: 'sp', context: 'inherit' },
      ctx,
    )
    expect(forkSpy).toHaveBeenCalledWith('parent-1', expect.objectContaining({
      label: 'Child',
      systemPrompt: 'sp',
      context: 'inherit',
    }))
    expect(result).toEqual({ success: true, data: { sessionId: 'child-1', label: 'Child' } })
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
