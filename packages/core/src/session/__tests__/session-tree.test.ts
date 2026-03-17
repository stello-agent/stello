import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NodeFileSystemAdapter } from '../../fs/file-system-adapter';
import { SessionTreeImpl } from '../session-tree';

describe('SessionTreeImpl', () => {
  let tmpDir: string;
  let tree: SessionTreeImpl;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'stello-test-'));
    const fs = new NodeFileSystemAdapter(tmpDir);
    tree = new SessionTreeImpl(fs);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('createRoot 创建根 Session', async () => {
    const root = await tree.createRoot('我的根');
    expect(root.parentId).toBeNull();
    expect(root.depth).toBe(0);
    expect(root.status).toBe('active');
    expect(root.label).toBe('我的根');
    // core.json 已初始化
    const fs = new NodeFileSystemAdapter(tmpDir);
    const core = await fs.readJSON('core.json');
    expect(core).toEqual({});
  });

  it('createChild 创建子 Session', async () => {
    const root = await tree.createRoot();
    const child = await tree.createChild({ parentId: root.id, label: '子节点' });
    expect(child.parentId).toBe(root.id);
    expect(child.depth).toBe(1);
    expect(child.index).toBe(0);
    // 父的 children 已更新
    const updatedRoot = await tree.get(root.id);
    expect(updatedRoot?.children).toContain(child.id);
  });

  it('createChild 父不存在抛错', async () => {
    await expect(tree.createChild({ parentId: 'fake-id', label: 'test' })).rejects.toThrow(
      'Session 不存在',
    );
  });

  it('get 返回正确 Session 或 null', async () => {
    const root = await tree.createRoot();
    const found = await tree.get(root.id);
    expect(found?.id).toBe(root.id);
    const notFound = await tree.get('not-exist');
    expect(notFound).toBeNull();
  });

  it('getRoot 返回根节点', async () => {
    const root = await tree.createRoot();
    await tree.createChild({ parentId: root.id, label: 'A' });
    const foundRoot = await tree.getRoot();
    expect(foundRoot.id).toBe(root.id);
    expect(foundRoot.parentId).toBeNull();
  });

  it('listAll 列出所有 Session', async () => {
    const root = await tree.createRoot();
    await tree.createChild({ parentId: root.id, label: 'A' });
    await tree.createChild({ parentId: root.id, label: 'B' });
    const all = await tree.listAll();
    expect(all).toHaveLength(3);
  });

  it('getAncestors 返回祖先链', async () => {
    const root = await tree.createRoot('根');
    const child = await tree.createChild({ parentId: root.id, label: '子' });
    const grandchild = await tree.createChild({ parentId: child.id, label: '孙' });
    const ancestors = await tree.getAncestors(grandchild.id);
    expect(ancestors).toHaveLength(2);
    expect(ancestors[0]?.id).toBe(child.id);
    expect(ancestors[1]?.id).toBe(root.id);
  });

  it('getSiblings 返回兄弟节点', async () => {
    const root = await tree.createRoot();
    const a = await tree.createChild({ parentId: root.id, label: 'A' });
    const b = await tree.createChild({ parentId: root.id, label: 'B' });
    const c = await tree.createChild({ parentId: root.id, label: 'C' });
    const siblings = await tree.getSiblings(b.id);
    const siblingIds = siblings.map((s) => s.id).sort();
    expect(siblingIds).toEqual([a.id, c.id].sort());
  });

  it('archive 归档不连带子节点', async () => {
    const root = await tree.createRoot();
    const child = await tree.createChild({ parentId: root.id, label: '子' });
    await tree.archive(root.id);
    const archivedRoot = await tree.get(root.id);
    expect(archivedRoot?.status).toBe('archived');
    const untouchedChild = await tree.get(child.id);
    expect(untouchedChild?.status).toBe('active');
  });

  it('addRef 正常创建引用', async () => {
    const root = await tree.createRoot();
    const a = await tree.createChild({ parentId: root.id, label: 'A' });
    const b = await tree.createChild({ parentId: root.id, label: 'B' });
    await tree.addRef(a.id, b.id);
    const updated = await tree.get(a.id);
    expect(updated?.refs).toContain(b.id);
  });

  it('addRef 不能引用自己', async () => {
    const root = await tree.createRoot();
    await expect(tree.addRef(root.id, root.id)).rejects.toThrow('不能引用自己');
  });

  it('addRef 不能引用直系祖先', async () => {
    const root = await tree.createRoot();
    const child = await tree.createChild({ parentId: root.id, label: '子' });
    await expect(tree.addRef(child.id, root.id)).rejects.toThrow('不能引用直系祖先');
  });

  it('addRef 不能引用直系后代', async () => {
    const root = await tree.createRoot();
    const child = await tree.createChild({ parentId: root.id, label: '子' });
    await expect(tree.addRef(root.id, child.id)).rejects.toThrow('不能引用直系后代');
  });

  it('addRef 重复引用幂等', async () => {
    const root = await tree.createRoot();
    const a = await tree.createChild({ parentId: root.id, label: 'A' });
    const b = await tree.createChild({ parentId: root.id, label: 'B' });
    await tree.addRef(a.id, b.id);
    await tree.addRef(a.id, b.id);
    const updated = await tree.get(a.id);
    expect(updated?.refs.filter((r) => r === b.id)).toHaveLength(1);
  });

  it('updateMeta 更新字段', async () => {
    const root = await tree.createRoot();
    const updated = await tree.updateMeta(root.id, {
      label: '新名称',
      tags: ['tag1', 'tag2'],
      scope: 'us-application',
    });
    expect(updated.label).toBe('新名称');
    expect(updated.tags).toEqual(['tag1', 'tag2']);
    expect(updated.scope).toBe('us-application');
    // 持久化验证
    const reread = await tree.get(root.id);
    expect(reread?.label).toBe('新名称');
  });
});
