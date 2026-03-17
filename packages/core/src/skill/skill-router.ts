// ─── Skill 路由器 ───

import type { Skill, SkillRouter } from '../types/lifecycle';
import type { TurnRecord } from '../types/memory';

/**
 * Skill 路由器
 *
 * v0.1 简单关键词匹配，不做意图路由。
 * 开发者注册 Skill 后通过 match 查找匹配项。
 */
export class SkillRouterImpl implements SkillRouter {
  private skills = new Map<string, Skill>();

  /** 注册 Skill（同名覆盖） */
  register(skill: Skill): void {
    this.skills.set(skill.name, skill);
  }

  /** 根据消息内容匹配 Skill（不区分大小写） */
  match(message: TurnRecord): Skill | null {
    const content = message.content.toLowerCase();
    for (const skill of this.skills.values()) {
      if (skill.keywords.some((kw) => content.includes(kw.toLowerCase()))) {
        return skill;
      }
    }
    return null;
  }

  /** 获取所有已注册的 Skill */
  getAll(): Skill[] {
    return [...this.skills.values()];
  }
}
