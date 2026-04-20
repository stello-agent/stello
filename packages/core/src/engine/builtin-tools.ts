import type { ToolDefinition } from '../types/lifecycle';

/** 内置 stello_create_session 工具名 */
export const CREATE_SESSION_TOOL_NAME = 'stello_create_session';

/** 生成 stello_create_session 的 tool 定义，可选注入已注册的 profile 名列表 */
export function createSessionToolDefinition(profileNames?: string[]): ToolDefinition {
  const properties: Record<string, unknown> = {
    label: {
      type: 'string',
      description: '子会话的显示名称，用于在会话树中标识该子会话。应简短且描述性强，例如"美国选校-MIT"。',
    },
    systemPrompt: {
      type: 'string',
      description: '子会话的系统提示词，定义子会话的角色和行为。不提供时继承父会话的 systemPrompt。如果同时指定了 profile，systemPrompt 会与 profile 的 systemPrompt 合成（具体方式由 profile 的 systemPromptMode 决定：prepend 模式下 profile 在前、本参数在后；append 模式下相反；preset 模式下本参数被忽略）。',
    },
    prompt: {
      type: 'string',
      description: '子会话的第一条 assistant 开场消息。写入后用户进入子会话时会首先看到这条消息。适合用于自我介绍或引导用户开始对话。',
    },
    context: {
      type: 'string',
      enum: ['none', 'inherit', 'compress'],
      description: "上下文继承策略。'none'（默认）：子会话以空对话历史启动，适合独立主题；'inherit'：完整拷贝父会话对话记录到子会话，适合需要完整上下文的深入探讨；'compress'：将父会话对话压缩为摘要注入子会话 system prompt（子 L3 保持空），适合子会话以独立角色专注新任务但需要父对话作为背景知识。如果 profile 定义了上下文策略，profile 的设置优先。",
    },
  };

  if (profileNames && profileNames.length > 0) {
    properties.profile = {
      type: 'string',
      enum: profileNames,
      description: '选择一个预注册的配置模板。profile 可预设 systemPrompt（及合成策略）、LLM 模型、工具集、上下文继承策略。选择 profile 后，其预设会与你提供的参数合并（profile 优先级更高）。',
    };
    properties.vars = {
      type: 'object',
      description: '传递给 profile systemPrompt 模板的变量。仅当 profile 的 systemPrompt 是模板函数时有效。例如 profile 定义了 "你是{region}留学专家"，则传入 { "region": "美国" }。',
      additionalProperties: { type: 'string' },
    };
  }

  return {
    name: CREATE_SESSION_TOOL_NAME,
    description: '创建一个新的子会话（fork）。子会话是独立的对话空间，拥有自己的对话历史和角色设定。可以通过 systemPrompt 定义子会话的专属角色，通过 context 决定是否继承当前对话的上下文，通过 profile 使用预注册的配置模板。',
    parameters: {
      type: 'object',
      properties,
      required: ['label'],
    },
  };
}
