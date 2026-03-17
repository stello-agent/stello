import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NodeFileSystemAdapter } from '../../fs/file-system-adapter';
import { CoreMemory } from '../../memory/core-memory';
import { SessionMemory } from '../../memory/session-memory';
import { SessionTreeImpl } from '../../session/session-tree';
import { SplitGuard } from '../../session/split-guard';
import { LifecycleManager } from '../../lifecycle/lifecycle-manager';
import { AgentTools } from '../agent-tools';
import type { CoreSchema } from '../../types/memory';
import type { StelloConfig } from '../../types/engine';

const testSchema: CoreSchema = {
  name: { type: 'string', default: '', bubbleable: true },
  gpa: { type: 'number', default: 0, bubbleable: true },
};

const mockCallLLM = async (prompt: string): Promise<string> => {
  if (prompt.includes('对话边界')) return '# Scope\n测试范围';
  return '';
};

describe('AgentTools', () => {
  let tmpDir: string;
  let coreMem: CoreMemory;
  let sessMem: SessionMemory;
  let tree: SessionTreeImpl;
  let tools: AgentTools;
  let rootId: string;
  let childId: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'stello-tools-'));
    const fs = new NodeFileSystemAdapter(tmpDir);
    coreMem = new CoreMemory(fs, testSchema);
    sessMem = new SessionMemory(fs);
    tree = new SessionTreeImpl(fs);
    const config: StelloConfig = { dataDir: tmpDir, coreSchema: testSchema, callLLM: mockCallLLM };
    const lm = new LifecycleManager(coreMem, sessMem, tree, config);
    const guard = new SplitGuard(tree, { minTurns: 3, cooldownTurns: 5 });
    tools = new AgentTools(tree, coreMem, sessMem, lm, guard);
    await coreMem.init();
    const root = await tree.createRoot('根');
    rootId = root.id;
    const child = await tree.createChild({ parentId: rootId, label: '子' });
    childId = child.id;
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('getToolDefinitions 返回 8 个 tool', () => {
    const defs = tools.getToolDefinitions();
    expect(defs).toHaveLength(8);
    for (const d of defs) {
      expect(d.name).toBeTruthy();
      expect(d.description).toBeTruthy();
      expect(d.parameters).toBeDefined();
    }
  });

  it('stello_read_core 读取字段', async () => {
    const result = await tools.executeTool('stello_read_core', { path: 'name' });
    expect(result.success).toBe(true);
    expect(result.data).toBe('');
  });

  it('stello_update_core 写入字段', async () => {
    const result = await tools.executeTool('stello_update_core', { path: 'name', value: '测试' });
    expect(result.success).toBe(true);
    const name = await coreMem.readCore('name');
    expect(name).toBe('测试');
  });

  it('stello_create_session 正常创建', async () => {
    await tree.updateMeta(rootId, { turnCount: 5 });
    const result = await tools.executeTool('stello_create_session', {
      parentId: rootId,
      label: '新话题',
    });
    expect(result.success).toBe(true);
    expect((result.data as { parentId: string }).parentId).toBe(rootId);
  });

  it('stello_create_session 拆分保护拒绝', async () => {
    // turnCount=0 < minTurns=3
    const result = await tools.executeTool('stello_create_session', {
      parentId: rootId,
      label: '不允许',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('轮次不足');
  });

  it('stello_list_sessions 列出所有', async () => {
    const result = await tools.executeTool('stello_list_sessions', {});
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(2); // root + child
  });

  it('stello_read_summary 读取 memory.md', async () => {
    await sessMem.writeMemory(childId, '# 测试记忆');
    const result = await tools.executeTool('stello_read_summary', { sessionId: childId });
    expect(result.success).toBe(true);
    expect(result.data).toBe('# 测试记忆');
  });

  it('stello_add_ref 添加跨分支引用', async () => {
    const child2 = await tree.createChild({ parentId: rootId, label: '子2' });
    const result = await tools.executeTool('stello_add_ref', {
      fromId: childId,
      toId: child2.id,
    });
    expect(result.success).toBe(true);
    const updated = await tree.get(childId);
    expect(updated?.refs).toContain(child2.id);
  });

  it('stello_archive 归档 Session', async () => {
    const result = await tools.executeTool('stello_archive', { sessionId: childId });
    expect(result.success).toBe(true);
    const archived = await tree.get(childId);
    expect(archived?.status).toBe('archived');
  });

  it('stello_update_meta 更新元数据', async () => {
    const result = await tools.executeTool('stello_update_meta', {
      sessionId: childId,
      label: '新名字',
    });
    expect(result.success).toBe(true);
    const updated = await tree.get(childId);
    expect(updated?.label).toBe('新名字');
  });

  it('executeTool 未知 tool 返回错误', async () => {
    const result = await tools.executeTool('stello_unknown', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('未知');
  });
});
