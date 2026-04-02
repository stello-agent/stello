// ─── 文件系统 Skill 加载器 ───

import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Skill } from '../types/lifecycle';

/** 解析 SKILL.md 的 YAML frontmatter，返回 name/description/content */
export function parseFrontmatter(raw: string): Skill | null {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith('---')) return null;

  const endIdx = trimmed.indexOf('\n---', 3);
  if (endIdx === -1) return null;

  const yamlBlock = trimmed.slice(3, endIdx).trim();
  const content = trimmed.slice(endIdx + 4).trim();

  let name = '';
  let description = '';
  for (const line of yamlBlock.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key === 'name') name = value;
    else if (key === 'description') description = value;
  }

  if (!name || !content) return null;
  return { name, description, content };
}

/** 从目录扫描并加载所有 SKILL.md，返回 Skill 数组 */
export async function loadSkillsFromDirectory(dir: string): Promise<Skill[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const skills: Skill[] = [];
  for (const entry of entries) {
    const entryPath = join(dir, entry);
    const entryStat = await stat(entryPath).catch(() => null);
    if (!entryStat?.isDirectory()) continue;

    const skillPath = join(entryPath, 'SKILL.md');
    const raw = await readFile(skillPath, 'utf-8').catch(() => null);
    if (!raw) continue;

    const skill = parseFrontmatter(raw);
    if (skill) skills.push(skill);
  }

  return skills;
}
