import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { tool } from '../tool.js'

describe('tool() 工厂函数', () => {
  it('返回正确的 name 和 description', () => {
    const t = tool('my_tool', 'Does something', {}, async () => ({ output: 'ok' }))
    expect(t.name).toBe('my_tool')
    expect(t.description).toBe('Does something')
  })

  it('inputSchema 是 ZodObject', () => {
    const t = tool('test', 'desc', { x: z.string() }, async () => ({ output: null }))
    expect(t.inputSchema).toBeInstanceOf(z.ZodObject)
  })

  it('inputSchema 能正确解析输入', () => {
    const t = tool(
      'add',
      'Add two numbers',
      { a: z.number(), b: z.number() },
      async ({ a, b }) => ({ output: a + b })
    )
    const parsed = t.inputSchema.parse({ a: 1, b: 2 })
    expect(parsed).toEqual({ a: 1, b: 2 })
  })

  it('execute 调用后返回 CallToolResult', async () => {
    const t = tool(
      'echo',
      'Echo input',
      { msg: z.string() },
      async ({ msg }) => ({ output: msg })
    )
    const result = await t.execute({ msg: 'hello' })
    expect(result.output).toBe('hello')
    expect(result.isError).toBeUndefined()
  })

  it('execute 支持 isError: true', async () => {
    const t = tool(
      'fail',
      'Always fails',
      {},
      async () => ({ output: 'error message', isError: true })
    )
    const result = await t.execute({})
    expect(result.isError).toBe(true)
    expect(result.output).toBe('error message')
  })

  it('annotations 透传到 Tool 对象', () => {
    const t = tool(
      'readonly',
      'Read only tool',
      {},
      async () => ({ output: null }),
      { annotations: { readOnlyHint: true, title: 'Read Tool' } }
    )
    expect(t.annotations?.readOnlyHint).toBe(true)
    expect(t.annotations?.title).toBe('Read Tool')
  })

  it('无 annotations 时 annotations 为 undefined', () => {
    const t = tool('no-ann', 'no annotations', {}, async () => ({ output: null }))
    expect(t.annotations).toBeUndefined()
  })

  it('inputSchema 校验不通过时抛出', () => {
    const t = tool('strict', 'strict input', { n: z.number() }, async () => ({ output: null }))
    expect(() => t.inputSchema.parse({ n: 'not-a-number' })).toThrow()
  })
})
