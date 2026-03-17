import { describe, it, expect } from 'vitest';
import { SkillRouterImpl } from '../skill-router';
import type { Skill } from '../../types/lifecycle';
import type { TurnRecord } from '../../types/memory';

/** 创建测试用 Skill */
function makeSkill(name: string, keywords: string[]): Skill {
  return {
    name,
    description: `${name} 描述`,
    keywords,
    guidancePrompt: `使用 ${name}`,
    handler: async () => ({ reply: 'ok' }),
  };
}

/** 创建测试用消息 */
function makeMsg(content: string): TurnRecord {
  return { role: 'user', content, timestamp: '2026-01-01T00:00:00Z' };
}

describe('SkillRouterImpl', () => {
  it('register + getAll 返回所有已注册 Skill', () => {
    const router = new SkillRouterImpl();
    router.register(makeSkill('a', ['关键词a']));
    router.register(makeSkill('b', ['关键词b']));
    expect(router.getAll()).toHaveLength(2);
  });

  it('重复注册同名 Skill 覆盖', () => {
    const router = new SkillRouterImpl();
    router.register(makeSkill('a', ['旧']));
    router.register(makeSkill('a', ['新']));
    const all = router.getAll();
    expect(all).toHaveLength(1);
    expect(all[0]?.keywords).toEqual(['新']);
  });

  it('match 命中关键词返回对应 Skill', () => {
    const router = new SkillRouterImpl();
    router.register(makeSkill('翻译', ['翻译', 'translate']));
    router.register(makeSkill('总结', ['总结', 'summarize']));
    const result = router.match(makeMsg('请帮我翻译这段话'));
    expect(result?.name).toBe('翻译');
  });

  it('match 不区分大小写', () => {
    const router = new SkillRouterImpl();
    router.register(makeSkill('translate', ['Translate']));
    const result = router.match(makeMsg('please translate this'));
    expect(result?.name).toBe('translate');
  });

  it('match 无命中返回 null', () => {
    const router = new SkillRouterImpl();
    router.register(makeSkill('翻译', ['翻译']));
    const result = router.match(makeMsg('今天天气怎么样'));
    expect(result).toBeNull();
  });
});
