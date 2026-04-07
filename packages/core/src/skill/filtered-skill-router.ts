// ─── 白名单过滤的 SkillRouter 视图 ───

import type { Skill, SkillRouter } from '../types/lifecycle'

/**
 * 白名单过滤的 SkillRouter 只读视图
 *
 * 只暴露 allowedNames 中的 skills，register 不可用。
 */
export class FilteredSkillRouter implements SkillRouter {
  constructor(
    private readonly source: SkillRouter,
    private readonly allowedNames: Set<string>,
  ) {}

  /** 只读视图，不允许注册 */
  register(_skill: Skill): void {
    throw new Error('Cannot register skills on a filtered view')
  }

  /** 按名称查找，仅白名单内可见 */
  get(name: string): Skill | undefined {
    if (!this.allowedNames.has(name)) return undefined
    return this.source.get(name)
  }

  /** 返回白名单内的所有 skills */
  getAll(): Skill[] {
    return this.source.getAll().filter(s => this.allowedNames.has(s.name))
  }
}
