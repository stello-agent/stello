import { describe, it, expect } from 'vitest'
import { createSessionTool } from '../tools/create-session-tool.js'
import { makeSession } from './helpers.js'

describe('createSessionTool', () => {
  it('创建子 Session 并返回 id 和 label', async () => {
    const { session } = await makeSession({ systemPrompt: '父提示词' })
    const tool = createSessionTool(() => session)
    const result = await tool.execute({ label: '新子会话' })
    expect(result.isError).toBeFalsy()
    const output = result.output as { sessionId: string; label: string }
    expect(output.label).toBe('新子会话')
    expect(output.sessionId).toBeDefined()
  })

  it('传 systemPrompt 覆盖父 Session', async () => {
    const { session, storage } = await makeSession({ systemPrompt: '父提示词' })
    const tool = createSessionTool(() => session)
    const result = await tool.execute({ label: 'Child', systemPrompt: '自定义提示词' })
    const output = result.output as { sessionId: string }
    const sp = await storage.getSystemPrompt(output.sessionId)
    expect(sp).toBe('自定义提示词')
  })

  it('不传 systemPrompt 时继承父 Session', async () => {
    const { session, storage } = await makeSession({ systemPrompt: '父提示词' })
    const tool = createSessionTool(() => session)
    const result = await tool.execute({ label: 'Child' })
    const output = result.output as { sessionId: string }
    const sp = await storage.getSystemPrompt(output.sessionId)
    expect(sp).toBe('父提示词')
  })

  it('传 prompt 写入子 Session 第一条消息', async () => {
    const { session, storage } = await makeSession()
    const tool = createSessionTool(() => session)
    const result = await tool.execute({ label: 'Child', prompt: '开始工作' })
    const output = result.output as { sessionId: string }
    const records = await storage.listRecords(output.sessionId)
    expect(records).toHaveLength(1)
    expect(records[0]!.role).toBe('user')
    expect(records[0]!.content).toBe('开始工作')
  })

  it('tool schema 包含正确的字段', () => {
    const { session } = { session: null as never }
    const tool = createSessionTool(() => session)
    expect(tool.name).toBe('stello_create_session')
    expect(tool.description).toBeTruthy()
    expect(tool.annotations?.readOnlyHint).toBe(false)
  })
})
