import type { ToolRegistryEntry } from '../tool/tool-registry'
import type { EngineForkOptions } from '../types/engine'

const DESCRIPTION = `创建一个新的子会话，从当前会话派生。子会话会成为当前会话的拓扑子节点。

参数：
- label（必填）: 子会话显示名
- systemPrompt（可选）: 子会话的系统提示词
- prompt（可选）: 子会话开场消息（assistant 首条消息）
- context（可选）: 'none' | 'inherit' — 是否继承父会话对话历史
- profile（可选）: 引用预注册的 ForkProfile 名（运行时由 agent 动态校验）
- vars（可选）: 提供给 profile.systemPromptFn 的模板变量`

const PARAMETERS = {
  type: 'object',
  properties: {
    label: { type: 'string', description: '子会话显示名' },
    systemPrompt: { type: 'string', description: '子会话系统提示词' },
    prompt: { type: 'string', description: '子会话开场消息' },
    context: {
      type: 'string',
      enum: ['none', 'inherit'],
      description: '是否继承父会话对话历史',
    },
    profile: { type: 'string', description: '预注册 ForkProfile 名（运行时校验）' },
    vars: {
      type: 'object',
      description: 'profile.systemPromptFn 的模板变量',
      additionalProperties: { type: 'string' },
    },
  },
  required: ['label'],
}

function mapArgsToForkOptions(args: Record<string, unknown>): EngineForkOptions {
  const options: EngineForkOptions = { label: args.label as string }
  if (args.systemPrompt !== undefined) options.systemPrompt = args.systemPrompt as string
  if (args.prompt !== undefined) options.prompt = args.prompt as string
  if (args.context !== undefined) options.context = args.context as 'none' | 'inherit'
  if (args.profile !== undefined) options.profile = args.profile as string
  if (args.vars !== undefined) options.profileVars = args.vars as Record<string, string>
  return options
}

export function createSessionTool(): ToolRegistryEntry {
  return {
    name: 'stello_create_session',
    description: DESCRIPTION,
    parameters: PARAMETERS,
    execute: async (args, ctx) => {
      const profileName = args.profile as string | undefined
      if (profileName && !ctx.agent.profiles?.has(profileName)) {
        return { success: false, error: `Profile "${profileName}" 未注册` }
      }
      try {
        const child = await ctx.agent.forkSession(ctx.sessionId, mapArgsToForkOptions(args))
        return { success: true, data: { sessionId: child.id, label: child.label } }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    },
  }
}
