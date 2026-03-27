import { z } from 'zod'
import { tool } from '../tool.js'
import type { Session } from '../types/session-api.js'

/** 创建内置的 stello_create_session 工具，调用 session.fork() 派生子 Session */
export function createSessionTool(getParent: () => Session) {
  return tool(
    'stello_create_session',
    '创建一个新的子会话，从当前会话派生',
    {
      label: z.string().describe('子会话的显示名称'),
      systemPrompt: z.string().optional().describe('子会话的系统提示词，不提供则继承父会话'),
      prompt: z.string().optional().describe('子会话的第一条用户消息'),
    },
    async (input) => {
      const parent = getParent()
      const child = await parent.fork({
        label: input.label,
        systemPrompt: input.systemPrompt,
        prompt: input.prompt,
      })
      return {
        output: {
          sessionId: child.meta.id,
          label: child.meta.label,
        },
      }
    },
    { annotations: { readOnlyHint: false } },
  )
}
