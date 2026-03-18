/**
 * Stello Session 分支演示
 *
 * 本示例演示如何：
 * 1. 基于根 Session 创建子 Session
 * 2. 验证父子关系和文件生成
 * 3. 测试记忆继承（bootstrap）
 * 4. 验证子 Session 独立的 memory.md
 */

import {
  NodeFileSystemAdapter,
  SessionTreeImpl,
  CoreMemory,
  SessionMemory,
  LifecycleManager,
  type CoreSchema,
  type StelloConfig,
} from '@stello-ai/core';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Right Codes API 配置
const RIGHT_CODES_API_KEY = 'sk-47dc51f41d22417da1a200801c072035';
const RIGHT_CODES_BASE_URL = 'https://www.right.codes/codex/v1/chat/completions';
const RIGHT_CODES_MODEL = 'gpt-5.4-high';

// 定义全局核心档案 schema
const coreSchema: CoreSchema = {
  userName: { type: 'string', default: '', bubbleable: true },
  projectGoal: { type: 'string', default: '', bubbleable: true },
  keyDecisions: { type: 'array', default: [], bubbleable: true },
};

// 实现 callLLM 函数
const callLLM = async (prompt: string): Promise<string> => {
  console.log('🤖 调用 LLM...');

  const response = await fetch(RIGHT_CODES_BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${RIGHT_CODES_API_KEY}`,
    },
    body: JSON.stringify({
      model: RIGHT_CODES_MODEL,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    throw new Error(`API 调用失败: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string } }>;
  };

  const content = data.choices[0]?.message.content ?? '';
  console.log(`✅ LLM 返回 ${content.length} 字符\n`);

  return content;
};

async function main() {
  console.log('🚀 Stello Session 分支演示\n');

  // 1. 初始化所有模块
  const dataDir = './stello-data';
  const fs = new NodeFileSystemAdapter(dataDir);
  const sessionTree = new SessionTreeImpl(fs);
  const coreMemory = new CoreMemory(fs, coreSchema);
  const sessionMemory = new SessionMemory(fs);

  await coreMemory.init();

  const config: StelloConfig = {
    dataDir,
    coreSchema,
    callLLM,
    inheritancePolicy: 'summary', // 继承父节点的 memory.md
  };

  const lifecycle = new LifecycleManager(coreMemory, sessionMemory, sessionTree, config);

  // 2. 获取根 Session
  const sessions = await sessionTree.listAll();
  const rootSession = sessions.find((s) => s.depth === 0);

  if (!rootSession) {
    console.error('❌ 找不到根 Session，请先运行 basic.ts 或 conversation.ts');
    process.exit(1);
  }

  console.log(`📌 使用根 Session: ${rootSession.id}`);
  console.log(`   Label: "${rootSession.label}"\n`);

  const rootDir = join(dataDir, 'sessions', rootSession.id);
  const rootMetaPath = join(rootDir, 'meta.json');
  const rootIndexPath = join(rootDir, 'index.md');
  const rootMemoryPath = join(rootDir, 'memory.md');

  // 显示根 Session 当前的 memory.md
  console.log('📄 根 Session 的 memory.md:');
  if (existsSync(rootMemoryPath)) {
    const rootMemory = readFileSync(rootMemoryPath, 'utf-8');
    console.log('─'.repeat(60));
    console.log(rootMemory || '(空)');
    console.log('─'.repeat(60));
    console.log();
  }

  // ==================== 步骤 1: 创建子 Session ====================
  console.log('━'.repeat(60));
  console.log('📝 步骤 1: 创建子 Session');
  console.log('━'.repeat(60));
  console.log();

  const childLabel = '批判性思维方法';
  const childScope = '专注讨论批判性思维的核心方法、应用场景和实践技巧。不涉及其他思维模式。';

  console.log(`🌟 创建子 Session: "${childLabel}"`);
  console.log(`📋 Scope: ${childScope}\n`);

  // 先更新 turnCount，确保满足拆分条件（默认需要 >= 3 轮）
  await sessionTree.updateMeta(rootSession.id, { turnCount: 5 });

  const childSession = await sessionTree.createChild({
    parentId: rootSession.id,
    label: childLabel,
    scope: childScope,
  });

  console.log(`✅ 子 Session 创建成功！`);
  console.log(`   ID: ${childSession.id}`);
  console.log(`   Parent ID: ${childSession.parentId}`);
  console.log(`   Depth: ${childSession.depth}`);
  console.log(`   Scope: ${childSession.scope}\n`);

  const childDir = join(dataDir, 'sessions', childSession.id);
  const childMetaPath = join(childDir, 'meta.json');
  const childScopePath = join(childDir, 'scope.md');
  const childMemoryPath = join(childDir, 'memory.md');

  // ==================== 步骤 2: 检查文件系统 ====================
  console.log('━'.repeat(60));
  console.log('🔍 步骤 2: 检查文件系统');
  console.log('━'.repeat(60));
  console.log();

  // 2.1 检查子 Session 的文件
  console.log('📂 子 Session 文件检查:\n');

  if (existsSync(childDir)) {
    console.log(`✅ 目录已创建: sessions/${childSession.id}`);
  } else {
    console.log(`❌ 目录不存在`);
  }

  if (existsSync(childMetaPath)) {
    const childMeta = JSON.parse(readFileSync(childMetaPath, 'utf-8'));
    console.log(`✅ meta.json 已创建`);
    console.log(`   parentId: ${childMeta.parentId}`);
    console.log(`   验证: ${childMeta.parentId === rootSession.id ? '✅ 正确' : '❌ 错误'}`);
  } else {
    console.log(`❌ meta.json 不存在`);
  }

  if (existsSync(childScopePath)) {
    const scopeContent = readFileSync(childScopePath, 'utf-8');
    console.log(`✅ scope.md 已创建`);
    console.log(`   内容: ${scopeContent.substring(0, 50)}...`);
  } else {
    console.log(`❌ scope.md 不存在`);
  }

  if (existsSync(childMemoryPath)) {
    console.log(`✅ memory.md 已创建（初始为空）`);
  } else {
    console.log(`⚠️  memory.md 不存在`);
  }

  // 2.2 检查根 Session 的更新
  console.log('\n📂 根 Session 更新检查:\n');

  const updatedRootMeta = JSON.parse(readFileSync(rootMetaPath, 'utf-8'));
  console.log(`✅ meta.json 已更新`);
  console.log(`   children: ${JSON.stringify(updatedRootMeta.children)}`);
  console.log(`   验证: ${updatedRootMeta.children.includes(childSession.id) ? '✅ 包含子 Session ID' : '❌ 未包含'}`);

  if (existsSync(rootIndexPath)) {
    const indexContent = readFileSync(rootIndexPath, 'utf-8');
    console.log(`\n✅ index.md 已更新`);
    console.log('\n📄 index.md 内容:');
    console.log('─'.repeat(60));
    console.log(indexContent || '(空)');
    console.log('─'.repeat(60));
  } else {
    console.log(`\n⚠️  index.md 不存在`);
  }

  // ==================== 步骤 3: Bootstrap 子 Session ====================
  console.log('\n\n');
  console.log('━'.repeat(60));
  console.log('🔄 步骤 3: Bootstrap 子 Session (测试记忆继承)');
  console.log('━'.repeat(60));
  console.log();

  console.log('🔄 调用 lifecycle.bootstrap()...\n');
  const { context } = await lifecycle.bootstrap(childSession.id);

  console.log('✅ Bootstrap 完成！\n');
  console.log('📋 组装的上下文:');
  console.log(`   - Core (L1): ${JSON.stringify(context.core)}`);
  console.log(`   - Memories (L2): ${context.memories.length} 条`);
  console.log(`   - Scope: ${context.scope ? '存在' : '无'}\n`);

  if (context.memories.length > 0) {
    console.log('📄 继承的 Memory (来自父 Session):');
    console.log('─'.repeat(60));
    context.memories.forEach((mem, idx) => {
      console.log(`${idx + 1}. ${mem.substring(0, 100)}...`);
    });
    console.log('─'.repeat(60));
  } else {
    console.log('⚠️  未继承任何 Memory');
  }

  if (context.scope) {
    console.log(`\n📄 Scope (对话边界):`);
    console.log('─'.repeat(60));
    console.log(context.scope);
    console.log('─'.repeat(60));
  }

  // ==================== 步骤 4: 在子 Session 中对话 ====================
  console.log('\n\n');
  console.log('━'.repeat(60));
  console.log('💬 步骤 4: 在子 Session 中进行对话');
  console.log('━'.repeat(60));
  console.log();

  const turn1User = {
    role: 'user' as const,
    content: '批判性思维的核心是什么？我应该如何培养这种能力？',
    timestamp: new Date().toISOString(),
  };

  const turn1Assistant = {
    role: 'assistant' as const,
    content: '批判性思维的核心是：\n1. 质疑假设 - 不盲目接受信息\n2. 逻辑分析 - 理性评估论证\n3. 多角度思考 - 考虑不同视角\n\n培养方法：\n- 多问"为什么"和"如何证明"\n- 练习识别逻辑谬误\n- 主动寻找反例和对立观点',
    timestamp: new Date().toISOString(),
  };

  console.log(`👤 User: ${turn1User.content}\n`);
  console.log(`🤖 Assistant: ${turn1Assistant.content}\n`);

  console.log('⚙️  触发 afterTurn...\n');
  const result = await lifecycle.afterTurn(childSession.id, turn1User, turn1Assistant);
  console.log(`✅ afterTurn 完成:`);
  console.log(`   - recordAppended: ${result.recordAppended}`);
  console.log(`   - memoryUpdated: ${result.memoryUpdated}`);
  console.log(`   - coreUpdated: ${result.coreUpdated}\n`);

  // 等待冒泡
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await lifecycle.flushBubbles();

  // ==================== 步骤 5: 验证独立性 ====================
  console.log('━'.repeat(60));
  console.log('🔍 步骤 5: 验证 memory.md 独立性');
  console.log('━'.repeat(60));
  console.log();

  // 5.1 检查子 Session 的 memory.md
  console.log('📄 子 Session 的 memory.md:');
  if (existsSync(childMemoryPath)) {
    const childMemory = readFileSync(childMemoryPath, 'utf-8');
    if (childMemory.trim()) {
      console.log(`✅ 已更新，长度: ${childMemory.length} 字符\n`);
      console.log('─'.repeat(60));
      console.log(childMemory);
      console.log('─'.repeat(60));
    } else {
      console.log(`⚠️  文件存在但为空`);
    }
  } else {
    console.log(`❌ 文件不存在`);
  }

  // 5.2 检查根 Session 的 memory.md（应该没变）
  console.log('\n📄 根 Session 的 memory.md (应该未改动):');
  if (existsSync(rootMemoryPath)) {
    const currentRootMemory = readFileSync(rootMemoryPath, 'utf-8');
    console.log(`✅ 文件存在，长度: ${currentRootMemory.length} 字符\n`);
    console.log('─'.repeat(60));
    console.log(currentRootMemory || '(空)');
    console.log('─'.repeat(60));
  } else {
    console.log(`❌ 文件不存在`);
  }

  // 5.3 检查子 Session 的 records.jsonl
  const childRecordsPath = join(childDir, 'records.jsonl');
  console.log('\n📄 子 Session 的 records.jsonl:');
  if (existsSync(childRecordsPath)) {
    const recordsContent = readFileSync(childRecordsPath, 'utf-8');
    const lines = recordsContent.trim().split('\n').filter(Boolean);
    console.log(`✅ 文件存在，包含 ${lines.length} 条记录\n`);
  } else {
    console.log(`❌ 文件不存在`);
  }

  console.log('\n🎉 演示完成！');
  console.log(`\n📁 文件位置:`);
  console.log(`   - 根 Session: ${rootDir}`);
  console.log(`   - 子 Session: ${childDir}`);
}

// 运行主函数
main().catch((error) => {
  console.error('\n❌ 错误:', error);
  process.exit(1);
});
