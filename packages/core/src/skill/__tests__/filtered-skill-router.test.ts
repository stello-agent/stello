import { describe, it, expect } from 'vitest'
import { FilteredSkillRouter } from '../filtered-skill-router'
import { SkillRouterImpl } from '../skill-router'
import type { Skill } from '../../types/lifecycle'

function makeSkill(name: string): Skill {
  return { name, description: `${name} 描述`, content: `# ${name}\n使用指南` }
}

describe('FilteredSkillRouter', () => {
  it('getAll 只返回白名单内的 skills', () => {
    const source = new SkillRouterImpl()
    source.register(makeSkill('research'))
    source.register(makeSkill('coding'))
    source.register(makeSkill('translate'))
    const filtered = new FilteredSkillRouter(source, new Set(['research', 'coding']))
    const all = filtered.getAll()
    expect(all).toHaveLength(2)
    expect(all.map(s => s.name)).toEqual(expect.arrayContaining(['research', 'coding']))
  })

  it('get 返回白名单内的 skill', () => {
    const source = new SkillRouterImpl()
    source.register(makeSkill('research'))
    const filtered = new FilteredSkillRouter(source, new Set(['research']))
    expect(filtered.get('research')?.name).toBe('research')
  })

  it('get 对白名单外的 skill 返回 undefined', () => {
    const source = new SkillRouterImpl()
    source.register(makeSkill('research'))
    const filtered = new FilteredSkillRouter(source, new Set(['coding']))
    expect(filtered.get('research')).toBeUndefined()
  })

  it('get 对不存在的 skill 返回 undefined', () => {
    const source = new SkillRouterImpl()
    const filtered = new FilteredSkillRouter(source, new Set(['research']))
    expect(filtered.get('nonexistent')).toBeUndefined()
  })

  it('空白名单时 getAll 返回空数组', () => {
    const source = new SkillRouterImpl()
    source.register(makeSkill('research'))
    const filtered = new FilteredSkillRouter(source, new Set())
    expect(filtered.getAll()).toEqual([])
  })

  it('register 抛出错误（只读视图）', () => {
    const source = new SkillRouterImpl()
    const filtered = new FilteredSkillRouter(source, new Set())
    expect(() => filtered.register(makeSkill('x'))).toThrow('Cannot register skills on a filtered view')
  })
})
