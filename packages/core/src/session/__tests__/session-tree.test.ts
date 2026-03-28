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

  // ─── createRoot ───

  it('createRoot 返回 TopologyNode', async () => {
    const root = await tree.createRoot('我的根');
    expect(root.parentId).toBeNull();
    expect(root.depth).toBe(0);
    expect(root.index).toBe(0);
    expect(root.label).toBe('我的根');
    expect(root.children).toEqual([]);
    expect(root.refs).toEqual([]);
    // core.json 已初始化
    const fs = new NodeFileSystemAdapter(tmpDir);
    const core = await fs.readJSON('core.json');
    expect(core).toEqual({});
  });

  it('createRoot 后 memory.md / scope.md / index.md 存在', async () => {
    const fs = new NodeFileSystemAdapter(tmpDir);
    const root = await tree.createRoot();
    expect(await fs.exists(`sessions/${root.id}/memory.md`)).toBe(true);
    expect(await fs.exists(`sessions/${root.id}/scope.md`)).toBe(true);
    expect(await fs.exists(`sessions/${root.id}/index.md`)).toBe(true);
  });

  // ─── createChild ───

  it('createChild 返回 TopologyNode', async () => {
    const root = await tree.createRoot();
    const child = await tree.createChild({ parentId: root.id, label: '子节点' });
    expect(child.parentId).toBe(root.id);
    expect(child.depth).toBe(1);
    expect(child.index).toBe(0);
    expect(child.children).toEqual([]);
    expect(child.refs).toEqual([]);
    // 父的 children 已更新（通过 getNode 验证）
    const updatedRoot = await tree.getNode(root.id);
    expect(updatedRoot?.children).toContain(child.id);
  });

  it('createChild 后 memory.md / scope.md / index.md 存在', async () => {
    const fs = new NodeFileSystemAdapter(tmpDir);
    const root = await tree.createRoot();
    const child = await tree.createChild({ parentId: root.id, label: '子' });
    expect(await fs.exists(`sessions/${child.id}/memory.md`)).toBe(true);
    expect(await fs.exists(`sessions/${child.id}/scope.md`)).toBe(true);
    expect(await fs.exists(`sessions/${child.id}/index.md`)).toBe(true);
  });

  it('createChild 父不存在抛错', async () => {
    await expect(tree.createChild({ parentId: 'fake-id', label: 'test' })).rejects.toThrow(
      'Session 不存在',
    );
  });

  it('createChild 多个子节点 index 递增', async () => {
    const root = await tree.createRoot();
    const a = await tree.createChild({ parentId: root.id, label: 'A' });
    const b = await tree.createChild({ parentId: root.id, label: 'B' });
    expect(a.index).toBe(0);
    expect(b.index).toBe(1);
  });

  // ─── get（返回 SessionMeta，不含拓扑字段） ───

  it('get 返回 SessionMeta 或 null', async () => {
    const root = await tree.createRoot('测试');
    const found = await tree.get(root.id);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(root.id);
    expect(found?.label).toBe('测试');
    expect(found?.status).toBe('active');
    expect(found?.turnCount).toBe(0);
    expect(found?.tags).toEqual([]);
    expect(found?.metadata).toEqual({});
    // SessionMeta 不含拓扑字段
    expect(found).not.toHaveProperty('parentId');
    expect(found).not.toHaveProperty('children');
    expect(found).not.toHaveProperty('depth');
    expect(found).not.toHaveProperty('index');
    expect(found).not.toHaveProperty('refs');

    const notFound = await tree.get('not-exist');
    expect(notFound).toBeNull();
  });

  // ─── getRoot（返回 SessionMeta） ───

  it('getRoot 返回根节点的 SessionMeta', async () => {
    const root = await tree.createRoot('根');
    await tree.createChild({ parentId: root.id, label: 'A' });
    const foundRoot = await tree.getRoot();
    expect(foundRoot.id).toBe(root.id);
    expect(foundRoot.label).toBe('根');
    // SessionMeta 不含 parentId
    expect(foundRoot).not.toHaveProperty('parentId');
  });

  // ─── listAll（返回 SessionMeta[]） ───

  it('listAll 列出所有 Session 的 SessionMeta', async () => {
    const root = await tree.createRoot();
    await tree.createChild({ parentId: root.id, label: 'A' });
    await tree.createChild({ parentId: root.id, label: 'B' });
    const all = await tree.listAll();
    expect(all).toHaveLength(3);
    // 每个元素都是 SessionMeta，不含拓扑字段
    for (const meta of all) {
      expect(meta).not.toHaveProperty('parentId');
      expect(meta).not.toHaveProperty('children');
      expect(meta).not.toHaveProperty('depth');
    }
  });

  // ─── getNode ───

  it('getNode 返回 TopologyNode 或 null', async () => {
    const root = await tree.createRoot('根');
    const child = await tree.createChild({ parentId: root.id, label: '子' });

    const rootNode = await tree.getNode(root.id);
    expect(rootNode).not.toBeNull();
    expect(rootNode?.id).toBe(root.id);
    expect(rootNode?.parentId).toBeNull();
    expect(rootNode?.depth).toBe(0);
    expect(rootNode?.children).toContain(child.id);
    expect(rootNode?.label).toBe('根');
    // TopologyNode 不含 SessionMeta 专有字段
    expect(rootNode).not.toHaveProperty('status');
    expect(rootNode).not.toHaveProperty('turnCount');
    expect(rootNode).not.toHaveProperty('tags');

    const childNode = await tree.getNode(child.id);
    expect(childNode?.parentId).toBe(root.id);
    expect(childNode?.depth).toBe(1);

    const notFound = await tree.getNode('not-exist');
    expect(notFound).toBeNull();
  });

  // ─── getTree ───

  it('getTree 返回递归树结构', async () => {
    const root = await tree.createRoot('根');
    const a = await tree.createChild({ parentId: root.id, label: 'A' });
    const b = await tree.createChild({ parentId: root.id, label: 'B' });
    await tree.createChild({ parentId: a.id, label: 'A1', metadata: { sourceSessionId: a.id } });

    const treeData = await tree.getTree();
    expect(treeData.id).toBe(root.id);
    expect(treeData.label).toBe('根');
    expect(treeData.status).toBe('active');
    expect(treeData.children).toHaveLength(2);

    const childA = treeData.children.find((c) => c.id === a.id);
    expect(childA?.label).toBe('A');
    expect(childA?.children).toHaveLength(1);
    expect(childA?.children[0]?.label).toBe('A1');
    expect(childA?.children[0]?.sourceSessionId).toBe(a.id);

    const childB = treeData.children.find((c) => c.id === b.id);
    expect(childB?.label).toBe('B');
    expect(childB?.children).toHaveLength(0);
  });

  it('getTree 根不存在时抛错', async () => {
    await expect(tree.getTree()).rejects.toThrow('根 Session 不存在');
  });

  // ─── getAncestors（返回 TopologyNode[]） ───

  it('getAncestors 返回祖先拓扑节点链', async () => {
    const root = await tree.createRoot('根');
    const child = await tree.createChild({ parentId: root.id, label: '子' });
    const grandchild = await tree.createChild({ parentId: child.id, label: '孙' });
    const ancestors = await tree.getAncestors(grandchild.id);
    expect(ancestors).toHaveLength(2);
    expect(ancestors[0]?.id).toBe(child.id);
    expect(ancestors[0]?.parentId).toBe(root.id);
    expect(ancestors[1]?.id).toBe(root.id);
    expect(ancestors[1]?.parentId).toBeNull();
    // TopologyNode 有 depth
    expect(ancestors[0]?.depth).toBe(1);
    expect(ancestors[1]?.depth).toBe(0);
  });

  it('getAncestors 根节点无祖先', async () => {
    const root = await tree.createRoot();
    const ancestors = await tree.getAncestors(root.id);
    expect(ancestors).toHaveLength(0);
  });

  // ─── getSiblings（返回 TopologyNode[]） ───

  it('getSiblings 返回兄弟拓扑节点', async () => {
    const root = await tree.createRoot();
    const a = await tree.createChild({ parentId: root.id, label: 'A' });
    const b = await tree.createChild({ parentId: root.id, label: 'B' });
    const c = await tree.createChild({ parentId: root.id, label: 'C' });
    const siblings = await tree.getSiblings(b.id);
    const siblingIds = siblings.map((s) => s.id).sort();
    expect(siblingIds).toEqual([a.id, c.id].sort());
    // 每个兄弟是 TopologyNode
    for (const sib of siblings) {
      expect(sib).toHaveProperty('parentId');
      expect(sib).toHaveProperty('depth');
      expect(sib).toHaveProperty('index');
      expect(sib.parentId).toBe(root.id);
    }
  });

  it('getSiblings 根节点无兄弟', async () => {
    const root = await tree.createRoot();
    const siblings = await tree.getSiblings(root.id);
    expect(siblings).toHaveLength(0);
  });

  // ─── archive ───

  it('archive 归档不连带子节点', async () => {
    const root = await tree.createRoot();
    const child = await tree.createChild({ parentId: root.id, label: '子' });
    await tree.archive(root.id);
    const archivedRoot = await tree.get(root.id);
    expect(archivedRoot?.status).toBe('archived');
    const untouchedChild = await tree.get(child.id);
    expect(untouchedChild?.status).toBe('active');
  });

  // ─── addRef ───

  it('addRef 正常创建引用', async () => {
    const root = await tree.createRoot();
    const a = await tree.createChild({ parentId: root.id, label: 'A' });
    const b = await tree.createChild({ parentId: root.id, label: 'B' });
    await tree.addRef(a.id, b.id);
    // 通过 getNode 验证 refs（TopologyNode 包含 refs）
    const node = await tree.getNode(a.id);
    expect(node?.refs).toContain(b.id);
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
    const node = await tree.getNode(a.id);
    expect(node?.refs.filter((r) => r === b.id)).toHaveLength(1);
  });

  // ─── updateMeta（返回 SessionMeta） ───

  it('updateMeta 更新字段并返回 SessionMeta', async () => {
    const root = await tree.createRoot();
    const updated = await tree.updateMeta(root.id, {
      label: '新名称',
      tags: ['tag1', 'tag2'],
      scope: 'us-application',
    });
    expect(updated.label).toBe('新名称');
    expect(updated.tags).toEqual(['tag1', 'tag2']);
    expect(updated.scope).toBe('us-application');
    // updateMeta 返回 SessionMeta，不含拓扑字段
    expect(updated).not.toHaveProperty('parentId');
    expect(updated).not.toHaveProperty('depth');
    // 持久化验证
    const reread = await tree.get(root.id);
    expect(reread?.label).toBe('新名称');
  });
});
