import { describe, it, expect } from 'vitest'
import { CREATE_SESSION_TOOL_NAME, createSessionToolDefinition } from '../builtin-tools'

describe('createSessionToolDefinition', () => {
  it('tool 名称为 stello_create_session', () => {
    expect(CREATE_SESSION_TOOL_NAME).toBe('stello_create_session')
  })

  it('包含 label、systemPrompt、prompt、context 参数', () => {
    const def = createSessionToolDefinition()
    const props = def.parameters.properties as Record<string, unknown>
    expect(props).toHaveProperty('label')
    expect(props).toHaveProperty('systemPrompt')
    expect(props).toHaveProperty('prompt')
    expect(props).toHaveProperty('context')
  })

  it('label 为必填，其余可选', () => {
    const def = createSessionToolDefinition()
    expect(def.parameters.required).toEqual(['label'])
  })

  it('context 枚举包含 none / inherit / compress', () => {
    const def = createSessionToolDefinition()
    const props = def.parameters.properties as Record<string, any>
    expect(props.context.enum).toEqual(['none', 'inherit', 'compress'])
    expect(props.context.description).toContain('compress')
  })
})
