import { describe, it, expect } from 'vitest';
import { SkillRouterImpl } from '../skill-router';
import { createSkillToolDefinition, executeSkillTool } from '../skill-tool';

describe('createSkillToolDefinition', () => {
  it('生成包含所有 skill 描述的 tool 定义', () => {
    const router = new SkillRouterImpl();
    router.register({ name: 'translate', description: '翻译助手', content: '# 翻译\n...' });
    router.register({ name: 'summarize', description: '摘要生成', content: '# 摘要\n...' });

    const def = createSkillToolDefinition(router);
    expect(def.name).toBe('activate_skill');
    expect(def.description).toContain('translate');
    expect(def.description).toContain('翻译助手');
    expect(def.description).toContain('summarize');
    expect(def.description).toContain('摘要生成');
  });

  it('空路由器生成无 skill 的 tool 定义', () => {
    const router = new SkillRouterImpl();
    const def = createSkillToolDefinition(router);
    expect(def.description).toContain('no skills registered');
  });

  it('参数 schema 要求 name 字段', () => {
    const router = new SkillRouterImpl();
    const def = createSkillToolDefinition(router);
    const params = def.parameters as Record<string, unknown>;
    expect(params.required).toEqual(['name']);
  });
});

describe('executeSkillTool', () => {
  it('按 name 返回 skill content', () => {
    const router = new SkillRouterImpl();
    router.register({ name: 'translate', description: '翻译', content: '# 翻译指南\n请按以下步骤...' });

    const result = executeSkillTool(router, { name: 'translate' });
    expect(result.success).toBe(true);
    expect(result.data).toBe('# 翻译指南\n请按以下步骤...');
  });

  it('查找不存在的 skill 返回错误', () => {
    const router = new SkillRouterImpl();
    const result = executeSkillTool(router, { name: 'ghost' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('ghost');
  });
});
