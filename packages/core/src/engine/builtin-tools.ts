import type { ToolDefinition } from '../types/lifecycle';

/** 内置 stello_create_session 工具名 */
export const CREATE_SESSION_TOOL_NAME = 'stello_create_session';

/** 生成 stello_create_session 的 tool 定义 */
export function createSessionToolDefinition(): ToolDefinition {
  return {
    name: CREATE_SESSION_TOOL_NAME,
    description: '创建一个新的子会话，从当前会话派生',
    parameters: {
      type: 'object',
      properties: {
        label: {
          type: 'string',
          description: '子会话的显示名称',
        },
        systemPrompt: {
          type: 'string',
          description: '子会话的系统提示词，不提供则继承父会话',
        },
        prompt: {
          type: 'string',
          description: '子会话的第一条 assistant 开场消息',
        },
        context: {
          type: 'string',
          enum: ['none', 'inherit'],
          description: "上下文继承策略：'none'(默认) 空 L3；'inherit' 拷贝父 L3",
        },
      },
      required: ['label'],
    },
  };
}
