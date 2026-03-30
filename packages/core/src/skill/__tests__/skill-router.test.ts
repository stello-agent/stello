import { describe, it, expect } from 'vitest';
import { SkillRouterImpl } from '../skill-router';
import type { Skill } from '../../types/lifecycle';

/** 创建测试用 Skill */
function makeSkill(name: string): Skill {
  return {
    name,
    description: `${name} 描述`,
    content: `# ${name}\n使用指南`,
  };
}

describe('SkillRouterImpl', () => {
  it('register + getAll 返回所有已注册 Skill', () => {
    const router = new SkillRouterImpl();
    router.register(makeSkill('a'));
    router.register(makeSkill('b'));
    expect(router.getAll()).toHaveLength(2);
  });

  it('重复注册同名 Skill 覆盖', () => {
    const router = new SkillRouterImpl();
    router.register(makeSkill('a'));
    router.register({ name: 'a', description: '新描述', content: '新内容' });
    const all = router.getAll();
    expect(all).toHaveLength(1);
    expect(all[0]?.description).toBe('新描述');
  });

  it('get 按名称返回对应 Skill', () => {
    const router = new SkillRouterImpl();
    router.register(makeSkill('翻译'));
    router.register(makeSkill('总结'));
    expect(router.get('翻译')?.name).toBe('翻译');
  });

  it('get 查找不存在的 Skill 返回 undefined', () => {
    const router = new SkillRouterImpl();
    router.register(makeSkill('翻译'));
    expect(router.get('不存在')).toBeUndefined();
  });

  it('空路由器 getAll 返回空数组', () => {
    const router = new SkillRouterImpl();
    expect(router.getAll()).toEqual([]);
  });
});
