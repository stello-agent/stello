// ─── Skill 注册表 ───

import type { Skill, SkillRouter } from '../types/lifecycle';

/**
 * Skill 注册表
 *
 * 纯注册 + 查询，不做意图匹配。匹配由 LLM 通过 Skill Tool 自行决定。
 */
export class SkillRouterImpl implements SkillRouter {
  private skills = new Map<string, Skill>();

  /** 注册 Skill（同名覆盖） */
  register(skill: Skill): void {
    this.skills.set(skill.name, skill);
  }

  /** 按名称查找 Skill */
  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /** 获取所有已注册的 Skill */
  getAll(): Skill[] {
    return [...this.skills.values()];
  }
}
