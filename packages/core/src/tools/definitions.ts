// ─── Agent Tool 定义 ───

import type { ToolDefinition } from '../types/lifecycle';

/** 返回 8 个 Agent Tool 的定义（兼容 OpenAI function calling 格式） */
export function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: 'stello_read_core',
      description: '读取 L1 核心档案，支持点路径访问嵌套字段',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '字段路径（如 "name" 或 "profile.gpa"），不传则返回整个档案' },
        },
      },
    },
    {
      name: 'stello_update_core',
      description: '更新 L1 核心档案的某个字段',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '字段路径' },
          value: { description: '新值' },
        },
        required: ['path', 'value'],
      },
    },
    {
      name: 'stello_create_session',
      description: '创建子 Session（受拆分保护机制约束）',
      parameters: {
        type: 'object',
        properties: {
          parentId: { type: 'string', description: '父 Session ID' },
          label: { type: 'string', description: '显示名称' },
          scope: { type: 'string', description: '作用域标签' },
        },
        required: ['parentId', 'label'],
      },
    },
    {
      name: 'stello_list_sessions',
      description: '列出所有 Session',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'stello_read_summary',
      description: '读取某 Session 的 memory.md 记忆摘要',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Session ID' },
        },
        required: ['sessionId'],
      },
    },
    {
      name: 'stello_add_ref',
      description: '创建跨分支引用',
      parameters: {
        type: 'object',
        properties: {
          fromId: { type: 'string', description: '引用发起方 Session ID' },
          toId: { type: 'string', description: '引用目标 Session ID' },
        },
        required: ['fromId', 'toId'],
      },
    },
    {
      name: 'stello_archive',
      description: '归档 Session（不可逆，不连带子 Session）',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Session ID' },
        },
        required: ['sessionId'],
      },
    },
    {
      name: 'stello_update_meta',
      description: '更新 Session 元数据',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Session ID' },
          label: { type: 'string', description: '新的显示名称' },
          scope: { type: 'string', description: '新的作用域' },
          tags: { type: 'array', items: { type: 'string' }, description: '新的标签列表' },
        },
        required: ['sessionId'],
      },
    },
  ];
}
