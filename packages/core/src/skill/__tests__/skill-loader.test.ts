import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { parseFrontmatter, loadSkillsFromDirectory } from '../skill-loader';

describe('parseFrontmatter', () => {
  it('解析标准 SKILL.md 格式', () => {
    const raw = `---
name: translate
description: 翻译助手
---

# 翻译
请翻译以下内容。`;

    const skill = parseFrontmatter(raw);
    expect(skill).toEqual({
      name: 'translate',
      description: '翻译助手',
      content: '# 翻译\n请翻译以下内容。',
    });
  });

  it('缺少 name 返回 null', () => {
    const raw = `---
description: 没有名字
---
内容`;
    expect(parseFrontmatter(raw)).toBeNull();
  });

  it('缺少 content 返回 null', () => {
    const raw = `---
name: empty
description: 空内容
---
`;
    expect(parseFrontmatter(raw)).toBeNull();
  });

  it('没有 frontmatter 返回 null', () => {
    expect(parseFrontmatter('# 普通 markdown')).toBeNull();
  });

  it('description 可选', () => {
    const raw = `---
name: minimal
---
有内容`;
    const skill = parseFrontmatter(raw);
    expect(skill?.name).toBe('minimal');
    expect(skill?.description).toBe('');
  });
});

describe('loadSkillsFromDirectory', () => {
  let tmpDir: string;

  async function createSkill(name: string, content: string) {
    const dir = join(tmpDir, name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'SKILL.md'), content, 'utf-8');
  }

  it('从目录加载多个 skills', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'skill-test-'));
    try {
      await createSkill('alpha', `---\nname: alpha\ndescription: A skill\n---\n# Alpha`);
      await createSkill('beta', `---\nname: beta\ndescription: B skill\n---\n# Beta`);

      const skills = await loadSkillsFromDirectory(tmpDir);
      expect(skills).toHaveLength(2);
      expect(skills.map((s) => s.name).sort()).toEqual(['alpha', 'beta']);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  it('跳过没有 SKILL.md 的目录', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'skill-test-'));
    try {
      await createSkill('valid', `---\nname: valid\ndescription: ok\n---\n# Valid`);
      await mkdir(join(tmpDir, 'empty-dir'));

      const skills = await loadSkillsFromDirectory(tmpDir);
      expect(skills).toHaveLength(1);
      expect(skills[0]?.name).toBe('valid');
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  it('目录不存在返回空数组', async () => {
    const skills = await loadSkillsFromDirectory('/nonexistent/path');
    expect(skills).toEqual([]);
  });
});
