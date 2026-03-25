import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NodeFileSystemAdapter } from '../../fs/file-system-adapter';
import { SessionTreeImpl } from '../session-tree';
import { SplitGuard } from '../split-guard';

describe('SplitGuard — 拆分保护机制', () => {
  let tmpDir: string;
  let tree: SessionTreeImpl;
  let guard: SplitGuard;
  let rootId: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'stello-split-'));
    const fs = new NodeFileSystemAdapter(tmpDir);
    tree = new SessionTreeImpl(fs);
    guard = new SplitGuard(tree, { minTurns: 3, cooldownTurns: 5 });
    const root = await tree.createRoot('根');
    rootId = root.id;
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('轮次不足时不允许拆分', async () => {
    await tree.updateMeta(rootId, { turnCount: 2 });
    const result = await guard.checkCanSplit(rootId);
    expect(result.canSplit).toBe(false);
    expect(result.reason).toContain('轮次不足');
  });

  it('轮次足够时允许拆分', async () => {
    await tree.updateMeta(rootId, { turnCount: 3 });
    const result = await guard.checkCanSplit(rootId);
    expect(result.canSplit).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('冷却期内不允许拆分', async () => {
    await tree.updateMeta(rootId, { turnCount: 5 });
    guard.recordSplit(rootId, 5);
    await tree.updateMeta(rootId, { turnCount: 7 });
    const result = await guard.checkCanSplit(rootId);
    expect(result.canSplit).toBe(false);
    expect(result.reason).toContain('冷却期');
  });

  it('冷却期满后允许拆分', async () => {
    await tree.updateMeta(rootId, { turnCount: 5 });
    guard.recordSplit(rootId, 5);
    await tree.updateMeta(rootId, { turnCount: 10 });
    const result = await guard.checkCanSplit(rootId);
    expect(result.canSplit).toBe(true);
  });

  it('Session 不存在返回不可拆分', async () => {
    const result = await guard.checkCanSplit('not-exist');
    expect(result.canSplit).toBe(false);
    expect(result.reason).toContain('不存在');
  });

  it('testMode 跳过轮次检查', async () => {
    const testGuard = new SplitGuard(tree, { minTurns: 3, cooldownTurns: 5, testMode: true });
    // turnCount 默认 0，远低于 minTurns
    const result = await testGuard.checkCanSplit(rootId);
    expect(result.canSplit).toBe(true);
  });

  it('testMode 跳过冷却期检查', async () => {
    const testGuard = new SplitGuard(tree, { minTurns: 3, cooldownTurns: 5, testMode: true });
    await tree.updateMeta(rootId, { turnCount: 5 });
    testGuard.recordSplit(rootId, 5);
    const result = await testGuard.checkCanSplit(rootId);
    expect(result.canSplit).toBe(true);
  });

  it('updateConfig 后 getConfig 返回新值', () => {
    guard.updateConfig({ minTurns: 10, cooldownTurns: 20 });
    expect(guard.getConfig()).toEqual({ minTurns: 10, cooldownTurns: 20 });
  });

  it('updateConfig 部分更新只影响指定字段', () => {
    guard.updateConfig({ minTurns: 1 });
    const config = guard.getConfig();
    expect(config.minTurns).toBe(1);
    expect(config.cooldownTurns).toBe(5); // 原值不变
  });

  it('updateConfig 后 checkCanSplit 按新规则判断', async () => {
    await tree.updateMeta(rootId, { turnCount: 2 });
    // 原配置 minTurns=3，不允许拆分
    let result = await guard.checkCanSplit(rootId);
    expect(result.canSplit).toBe(false);

    // 降低门槛
    guard.updateConfig({ minTurns: 1 });
    result = await guard.checkCanSplit(rootId);
    expect(result.canSplit).toBe(true);
  });

  it('不同 Session 的冷却期独立', async () => {
    const child = await tree.createChild({ parentId: rootId, label: '子' });
    await tree.updateMeta(rootId, { turnCount: 5 });
    guard.recordSplit(rootId, 5);
    await tree.updateMeta(child.id, { turnCount: 5 });
    // root 在冷却期内
    const rootResult = await guard.checkCanSplit(rootId);
    expect(rootResult.canSplit).toBe(false);
    // child 不受影响
    const childResult = await guard.checkCanSplit(child.id);
    expect(childResult.canSplit).toBe(true);
  });
});
