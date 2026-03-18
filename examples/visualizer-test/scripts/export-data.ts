/**
 * 从 stello-data-fullflow 导出数据为 JSON
 * 供前端浏览器环境使用
 */

import { NodeFileSystemAdapter, SessionTreeImpl } from '@stello-ai/core';
import { writeFileSync } from 'fs';
import { join } from 'path';

async function exportData() {
  console.log('📦 开始导出数据...\n');

  const dataDir = join(process.cwd(), '../demo/stello-data-fullflow');
  const fs = new NodeFileSystemAdapter(dataDir);
  const sessionTree = new SessionTreeImpl(fs);

  // 读取所有 Session
  const allSessions = await sessionTree.listAll();
  console.log(`✅ 读取到 ${allSessions.length} 个 Session\n`);

  // 转换为可序列化格式（符合 visualizer 的 SessionData 接口）
  const sessions = allSessions.map((s, idx) => ({
    id: s.id,
    parentId: s.parentId ?? null,
    children: s.children || [],
    label: s.label,
    index: idx, // 添加索引字段
    status: s.status,
    turnCount: s.turnCount,
    lastActiveAt: s.lastActiveAt,
    refs: s.refs || [],
    depth: s.depth,
  }));

  // 读取每个 Session 的 memory.md
  const memories: Record<string, string> = {};
  for (const session of allSessions) {
    try {
      const memoryPath = `sessions/${session.id}/memory.md`;
      const content = await fs.readFile(memoryPath);
      memories[session.id] = content;
      console.log(`  - ${session.label}: ${content.length} 字符`);
    } catch (e) {
      // memory.md 可能不存在
      memories[session.id] = '';
    }
  }

  // 导出为 JSON
  const data = {
    sessions,
    memories,
    exportedAt: new Date().toISOString(),
  };

  const outputPath = join(process.cwd(), 'public/data.json');
  writeFileSync(outputPath, JSON.stringify(data, null, 2));

  console.log(`\n✅ 数据已导出到: public/data.json`);
  console.log(`📊 ${sessions.length} 个 Session, ${Object.keys(memories).length} 条记忆\n`);
}

exportData().catch((error) => {
  console.error('❌ 导出失败:', error);
  process.exit(1);
});
