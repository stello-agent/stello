import type { ToolRegistryEntry } from '../tool/tool-registry'
import type { SkillRouter } from '../types/lifecycle'

function buildDescription(skills: SkillRouter): string {
  const list = skills.getAll()
  const enumeration = list.map(s => `- ${s.name}: ${s.description}`).join('\n')
  return `激活已注册的 skill，加载完整 skill content。

可用 skills:
${enumeration || '(无)'}

参数：
- name（必填）: 要激活的 skill 名`
}

function buildParameters(skills: SkillRouter): Record<string, unknown> {
  // Empty enum arrays are rejected by strict JSON-Schema validators (e.g.
  // Moonshot). Only include the enum field when at least one skill is
  // registered; execute() already validates unknown skill names at runtime.
  const skillNames = skills.getAll().map(s => s.name)
  const nameProperty: Record<string, unknown> = {
    type: 'string',
    description: '要激活的 skill 名',
  }
  if (skillNames.length > 0) {
    nameProperty.enum = skillNames
  }
  return {
    type: 'object',
    properties: { name: nameProperty },
    required: ['name'],
  }
}

export function activateSkillTool(skills: SkillRouter): ToolRegistryEntry {
  return {
    name: 'activate_skill',
    description: buildDescription(skills),
    parameters: buildParameters(skills),
    execute: async (args) => {
      const name = args.name as string
      const skill = skills.get(name)
      if (!skill) return { success: false, error: `Skill "${name}" 未注册` }
      return { success: true, data: { content: skill.content } }
    },
  }
}
