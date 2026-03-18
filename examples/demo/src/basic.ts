/**
 * Stello 基础功能演示
 *
 * 本示例演示如何：
 * 1. 初始化文件系统适配器
 * 2. 创建 Session 树
 * 3. 创建根 Session
 * 4. 查看生成的文件
 */

import { NodeFileSystemAdapter, SessionTreeImpl } from '@stello-ai/core';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

async function main() {
  console.log('🚀 Stello 基础功能演示\n');

  // 1. 初始化文件系统适配器
  const dataDir = './stello-data';
  console.log(`📁 数据目录: ${dataDir}`);

  const fs = new NodeFileSystemAdapter(dataDir);
  const sessionTree = new SessionTreeImpl(fs);

  // 2. 创建根 Session
  console.log('\n🌟 创建根 Session...');
  const rootSession = await sessionTree.createRoot('My First Project');

  // 3. 打印 Session 对象
  console.log('\n✅ 根 Session 创建成功！');
  console.log('\n📋 Session 详细信息:');
  console.log(JSON.stringify(rootSession, null, 2));

  // 4. 验证文件系统
  console.log('\n\n📂 检查生成的文件:\n');

  const sessionDir = join(dataDir, 'sessions', rootSession.id);
  const metaPath = join(sessionDir, 'meta.json');
  const memoryPath = join(sessionDir, 'memory.md');
  const recordsPath = join(sessionDir, 'records.jsonl');

  // 检查 Session 目录
  if (existsSync(sessionDir)) {
    console.log(`✅ Session 目录已创建: ${sessionDir}`);
  } else {
    console.log(`❌ Session 目录不存在: ${sessionDir}`);
    return;
  }

  // 检查 meta.json
  if (existsSync(metaPath)) {
    console.log(`✅ meta.json 已创建`);
    const metaContent = readFileSync(metaPath, 'utf-8');
    console.log('\n📄 meta.json 内容:');
    console.log(JSON.stringify(JSON.parse(metaContent), null, 2));
  } else {
    console.log(`❌ meta.json 不存在`);
  }

  // 检查 memory.md
  if (existsSync(memoryPath)) {
    console.log(`\n✅ memory.md 已创建`);
    const memoryContent = readFileSync(memoryPath, 'utf-8');
    console.log('\n📄 memory.md 内容:');
    console.log(memoryContent || '(空文件)');
  } else {
    console.log(`\n⚠️  memory.md 不存在 (这是正常的，因为还没有对话)`);
  }

  // 检查 records.jsonl
  if (existsSync(recordsPath)) {
    console.log(`\n✅ records.jsonl 已创建`);
  } else {
    console.log(`\n⚠️  records.jsonl 不存在 (这是正常的，因为还没有对话记录)`);
  }

  console.log('\n\n🎉 演示完成！');
  console.log(`\n💡 提示: 你可以查看 ${sessionDir} 目录下的所有文件`);
}

// 运行主函数
main().catch(console.error);
