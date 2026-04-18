import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NodeFileSystemAdapter } from '../../fs/file-system-adapter';
import { SessionTreeImpl } from '../session-tree';
import { MAIN_SESSION_ID } from '../../types/session';

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

  it('createRoot 返回固定的 MAIN_SESSION_ID 作为 id', async () => {
    const root = await tree.createRoot('Any');
    expect(root.id).toBe(MAIN_SESSION_ID);
  });

  it('createRoot 幂等：第二次调用返回现有节点，不覆写 label 与已写入的内容', async () => {
    const fs = new NodeFileSystemAdapter(tmpDir);
    const first = await tree.createRoot('Original');
    // 模拟用户在 memory.md 写入内容，确认后续 createRoot 不覆写
    await fs.writeFile(`sessions/${first.id}/memory.md`, 'user content');

    const second = await tree.createRoot('Ignored');
    expect(second.id).toBe(first.id);
    expect(second.label).toBe('Original');
    expect(await fs.readFile(`sessions/${first.id}/memory.md`)).toBe('user content');
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
    // SessionMeta 不含拓扑字段
    expect(found).not.toHaveProperty('parentId');
    expect(found).not.toHaveProperty('children');
    expect(found).not.toHaveProperty('depth');
    expect(found).not.toHaveProperty('index');
    expect(found).not.toHaveProperty('refs');
    // SessionMeta 不再暴露 scope/tags/metadata
    expect(found).not.toHaveProperty('scope');
    expect(found).not.toHaveProperty('tags');
    expect(found).not.toHaveProperty('metadata');

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

    const childNode = await tree.getNode(child.id);
    expect(childNode?.parentId).toBe(root.id);
    expect(childNode?.depth).toBe(1);

    const notFound = await tree.getNode('not-exist');
    expect(notFound).toBeNull();
  });

  // ─── getNode.sourceSessionId（一等字段） ───

  it('createChild 写入 sourceSessionId 后 getNode 暴露该字段', async () => {
    const root = await tree.createRoot();
    const a = await tree.createChild({ parentId: root.id, label: 'A' });
    const b = await tree.createChild({
      parentId: root.id,
      label: 'B',
      sourceSessionId: a.id,
    });

    // createChild 返回值直接带 sourceSessionId
    expect(b.sourceSessionId).toBe(a.id);

    // 持久化后 getNode 仍能读到
    const node = await tree.getNode(b.id);
    expect(node?.sourceSessionId).toBe(a.id);
  });

  it('createChild 未传 sourceSessionId 时拓扑节点该字段为 undefined', async () => {
    const root = await tree.createRoot();
    const child = await tree.createChild({ parentId: root.id, label: 'C' });
    expect(child.sourceSessionId).toBeUndefined();
    const node = await tree.getNode(child.id);
    expect(node?.sourceSessionId).toBeUndefined();
  });

  it('回填读取：顶层 sourceSessionId 缺失时从 legacy metadata.sourceSessionId 取', async () => {
    // 直接写一份 legacy 格式的 meta.json（仅含 metadata.sourceSessionId）
    const fs = new NodeFileSystemAdapter(tmpDir);
    const ts = new Date().toISOString();
    const rootId = 'legacy-root';
    const childId = 'legacy-child';
    await fs.writeJSON(`sessions/${rootId}/meta.json`, {
      id: rootId,
      parentId: null,
      children: [childId],
      refs: [],
      label: 'root',
      index: 0,
      status: 'active',
      depth: 0,
      turnCount: 0,
      metadata: {},
      createdAt: ts,
      updatedAt: ts,
      lastActiveAt: ts,
    });
    await fs.writeJSON(`sessions/${childId}/meta.json`, {
      id: childId,
      parentId: rootId,
      children: [],
      refs: [],
      label: 'child',
      index: 0,
      status: 'active',
      depth: 1,
      turnCount: 0,
      metadata: { sourceSessionId: rootId },
      createdAt: ts,
      updatedAt: ts,
      lastActiveAt: ts,
    });

    const node = await tree.getNode(childId);
    expect(node?.sourceSessionId).toBe(rootId);

    const treeData = await tree.getTree();
    expect(treeData.children[0]?.sourceSessionId).toBe(rootId);
  });

  // ─── getTree ───

  it('getTree 返回递归树结构', async () => {
    const root = await tree.createRoot('根');
    const a = await tree.createChild({ parentId: root.id, label: 'A' });
    const b = await tree.createChild({ parentId: root.id, label: 'B' });
    await tree.createChild({ parentId: a.id, label: 'A1', sourceSessionId: a.id });

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

  it('updateMeta 更新 label/turnCount 并返回 SessionMeta', async () => {
    const root = await tree.createRoot();
    const updated = await tree.updateMeta(root.id, {
      label: '新名称',
      turnCount: 3,
    });
    expect(updated.label).toBe('新名称');
    expect(updated.turnCount).toBe(3);
    // updateMeta 返回 SessionMeta，不含拓扑字段
    expect(updated).not.toHaveProperty('parentId');
    expect(updated).not.toHaveProperty('depth');
    // 也不再暴露 scope/tags/metadata
    expect(updated).not.toHaveProperty('scope');
    expect(updated).not.toHaveProperty('tags');
    expect(updated).not.toHaveProperty('metadata');
    // 持久化验证
    const reread = await tree.get(root.id);
    expect(reread?.label).toBe('新名称');
    expect(reread?.turnCount).toBe(3);
  });

  // ─── getConfig / putConfig（固化 SessionConfig 可序列化子集） ───

  it('putConfig → getConfig 往返读取相同内容', async () => {
    const root = await tree.createRoot();
    const config = { systemPrompt: '你是一个助手', skills: ['math', 'code'] };
    await tree.putConfig(root.id, config);
    const read = await tree.getConfig(root.id);
    expect(read).toEqual(config);
  });

  it('getConfig 在未写入配置时返回 null', async () => {
    const root = await tree.createRoot();
    const read = await tree.getConfig(root.id);
    expect(read).toBeNull();
  });

  it('putConfig 覆盖已有配置', async () => {
    const root = await tree.createRoot();
    await tree.putConfig(root.id, { systemPrompt: 'A', skills: ['a'] });
    await tree.putConfig(root.id, { systemPrompt: 'B', skills: ['b', 'c'] });
    const read = await tree.getConfig(root.id);
    expect(read).toEqual({ systemPrompt: 'B', skills: ['b', 'c'] });
  });

  it('putConfig 仅含 systemPrompt 的部分配置', async () => {
    const root = await tree.createRoot();
    await tree.putConfig(root.id, { systemPrompt: '只有 prompt' });
    const read = await tree.getConfig(root.id);
    expect(read).toEqual({ systemPrompt: '只有 prompt' });
    expect(read).not.toHaveProperty('skills');
  });

  it('putConfig 仅含 skills 的部分配置', async () => {
    const root = await tree.createRoot();
    await tree.putConfig(root.id, { skills: ['only-skills'] });
    const read = await tree.getConfig(root.id);
    expect(read).toEqual({ skills: ['only-skills'] });
    expect(read).not.toHaveProperty('systemPrompt');
  });

  it('putConfig 空对象也能存读', async () => {
    const root = await tree.createRoot();
    await tree.putConfig(root.id, {});
    const read = await tree.getConfig(root.id);
    expect(read).toEqual({});
  });

  it('putConfig 与 updateMeta 互不干扰', async () => {
    const root = await tree.createRoot('初始');
    await tree.putConfig(root.id, { systemPrompt: '固化 prompt', skills: ['s'] });
    // 更新 meta 不应影响 config
    await tree.updateMeta(root.id, { label: '新名称', turnCount: 5 });
    const config = await tree.getConfig(root.id);
    expect(config).toEqual({ systemPrompt: '固化 prompt', skills: ['s'] });
    // 反向：更新 config 不应影响 meta
    await tree.putConfig(root.id, { systemPrompt: '再改', skills: ['t'] });
    const meta = await tree.get(root.id);
    expect(meta?.label).toBe('新名称');
    expect(meta?.turnCount).toBe(5);
  });
});
