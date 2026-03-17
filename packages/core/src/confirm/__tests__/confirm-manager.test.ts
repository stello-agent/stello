import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NodeFileSystemAdapter } from '../../fs/file-system-adapter';
import { CoreMemory } from '../../memory/core-memory';
import { SessionMemory } from '../../memory/session-memory';
import { SessionTreeImpl } from '../../session/session-tree';
import { LifecycleManager } from '../../lifecycle/lifecycle-manager';
import { ConfirmManager } from '../confirm-manager';
import type { CoreSchema } from '../../types/memory';
import type { SplitProposal, UpdateProposal } from '../../types/lifecycle';
import type { StelloConfig } from '../../types/engine';

const testSchema: CoreSchema = {
  name: { type: 'string', default: '', bubbleable: true },
  schools: { type: 'array', default: [], bubbleable: true, requireConfirm: true },
};

const mockCallLLM = async (prompt: string): Promise<string> => {
  if (prompt.includes('记忆摘要') || prompt.includes('最终摘要'))
    return '# 更新后的记忆';
  if (prompt.includes('对话边界'))
    return '# Scope\n只讨论测试相关';
  return '';
};

describe('ConfirmManager — 确认协议', () => {
  let tmpDir: string;
  let coreMem: CoreMemory;
  let sessMem: SessionMemory;
  let tree: SessionTreeImpl;
  let lm: LifecycleManager;
  let cm: ConfirmManager;
  let rootId: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'stello-confirm-'));
    const fs = new NodeFileSystemAdapter(tmpDir);
    coreMem = new CoreMemory(fs, testSchema);
    sessMem = new SessionMemory(fs);
    tree = new SessionTreeImpl(fs);
    const config: StelloConfig = {
      dataDir: tmpDir,
      coreSchema: testSchema,
      callLLM: mockCallLLM,
    };
    lm = new LifecycleManager(coreMem, sessMem, tree, config);
    cm = new ConfirmManager(coreMem, lm);
    await coreMem.init();
    const root = await tree.createRoot('根');
    rootId = root.id;
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('confirmSplit 创建子 Session', async () => {
    const proposal: SplitProposal = {
      id: 'sp-1',
      parentId: rootId,
      suggestedLabel: '新话题',
      suggestedScope: '测试',
      reason: '话题漂移',
    };
    const child = await cm.confirmSplit(proposal);
    expect(child.parentId).toBe(rootId);
    expect(child.label).toBe('新话题');
    expect(child.scope).toBe('测试');
    // scope.md 已生成
    const scope = await sessMem.readScope(child.id);
    expect(scope).toBe('# Scope\n只讨论测试相关');
  });

  it('confirmSplit 更新父 index.md', async () => {
    const proposal: SplitProposal = {
      id: 'sp-2',
      parentId: rootId,
      suggestedLabel: '子话题',
      reason: '主动拆分',
    };
    await cm.confirmSplit(proposal);
    const index = await sessMem.readIndex(rootId);
    expect(index).toContain('子话题');
  });

  it('dismissSplit 不创建 Session', async () => {
    const before = await tree.listAll();
    const proposal: SplitProposal = {
      id: 'sp-3',
      parentId: rootId,
      suggestedLabel: '不创建',
      reason: '用户拒绝',
    };
    await cm.dismissSplit(proposal);
    const after = await tree.listAll();
    expect(after).toHaveLength(before.length);
  });

  it('confirmUpdate 写入 requireConfirm 字段', async () => {
    const proposal: UpdateProposal = {
      id: 'up-1',
      path: 'schools',
      oldValue: [],
      newValue: ['清华', '北大'],
      reason: '用户确认',
    };
    await cm.confirmUpdate(proposal);
    const schools = await coreMem.readCore('schools');
    expect(schools).toEqual(['清华', '北大']);
  });

  it('dismissUpdate 不写入', async () => {
    const proposal: UpdateProposal = {
      id: 'up-2',
      path: 'schools',
      oldValue: [],
      newValue: ['MIT'],
      reason: '用户拒绝',
    };
    await cm.dismissUpdate(proposal);
    const schools = await coreMem.readCore('schools');
    expect(schools).toEqual([]);
  });
});
