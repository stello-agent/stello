// ─── Skill Tool 工具函数 ───

import type { SkillRouter } from '../types/lifecycle';
import type { ToolDefinition, ToolExecutionResult } from '../types/lifecycle';

/** 根据已注册 skills 生成 Tool 定义（LLM 看到 name + description 列表） */
export function createSkillToolDefinition(router: SkillRouter): ToolDefinition {
  const skills = router.getAll();
  const listing = skills.length > 0
    ? skills.map((s) => `- **${s.name}**: ${s.description}`).join('\n')
    : '(no skills registered)';

  return {
    name: 'activate_skill',
    description: `Load a specialized skill that provides domain-specific instructions.\n\n## Available Skills\n${listing}`,
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'The name of the skill to activate',
        },
      },
      required: ['name'],
    },
  };
}

/** 执行 skill tool call：按 name 查找并返回 content */
export function executeSkillTool(
  router: SkillRouter,
  args: { name: string },
): ToolExecutionResult {
  const skill = router.get(args.name);
  if (!skill) {
    return { success: false, error: `Skill "${args.name}" not found` };
  }
  return { success: true, data: skill.content };
}
