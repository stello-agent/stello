/**
 * Stello 跨分支引用演示
 *
 * 本示例演示如何：
 * 1. 创建平级的子 Session
 * 2. 使用 addRef 建立跨分支引用
 * 3. 测试引用校验（自引用、父子引用）
 * 4. 验证 assemble 时引用 Session 的记忆注入
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
  console.log('🚀 Stello 跨分支引用演示\n');

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
    inheritancePolicy: 'summary',
  };

  const lifecycle = new LifecycleManager(coreMemory, sessionMemory, sessionTree, config);

  // 2. 获取已有的 Session
  const sessions = await sessionTree.listAll();
  const rootSession = sessions.find((s) => s.depth === 0);
  const thinkingSession = sessions.find((s) => s.label === '批判性思维方法');

  if (!rootSession || !thinkingSession) {
    console.error('❌ 找不到必要的 Session，请先运行 branching.ts');
    process.exit(1);
  }

  console.log(`📌 根 Session: ${rootSession.label} (${rootSession.id})`);
  console.log(`📌 已有子 Session: ${thinkingSession.label} (${thinkingSession.id})\n`);

  // ==================== 步骤 1: 创建第二个子 Session ====================
  console.log('━'.repeat(60));
  console.log('📝 步骤 1: 创建平级子 Session');
  console.log('━'.repeat(60));
  console.log();

  const fallacyLabel = '逻辑谬误识别';
  const fallacyScope = '专注于识别和分析常见的逻辑谬误，提升论证质量。不涉及其他逻辑学主题。';

  console.log(`🌟 创建子 Session: "${fallacyLabel}"`);
  console.log(`📋 Scope: ${fallacyScope}\n`);

  const fallacySession = await sessionTree.createChild({
    parentId: rootSession.id,
    label: fallacyLabel,
    scope: fallacyScope,
  });

  console.log(`✅ 子 Session 创建成功！`);
  console.log(`   ID: ${fallacySession.id}`);
  console.log(`   Parent ID: ${fallacySession.parentId}`);
  console.log(`   Depth: ${fallacySession.depth}`);
  console.log(`   验证: 与 "${thinkingSession.label}" 平级 ✅\n`);

  // ==================== 步骤 2: 在新子 Session 中对话 ====================
  console.log('━'.repeat(60));
  console.log('💬 步骤 2: 在 "逻辑谬误识别" 中对话');
  console.log('━'.repeat(60));
  console.log();

  const turn1User = {
    role: 'user' as const,
    content: '什么是稻草人谬误？能举个例子吗？',
    timestamp: new Date().toISOString(),
  };

  const turn1Assistant = {
    role: 'assistant' as const,
    content: '稻草人谬误是指：歪曲、夸大或简化对方的观点，然后攻击这个被扭曲的版本，而不是真实论点。\n\n例子：\n- 原观点："我们应该控制碳排放"\n- 稻草人版本："他们想让所有工厂关门，让大家失业"\n- 然后攻击这个扭曲的版本\n\n识别方法：对方是否准确引述了你的观点？',
    timestamp: new Date().toISOString(),
  };

  console.log(`👤 User: ${turn1User.content}\n`);
  console.log(`🤖 Assistant: ${turn1Assistant.content}\n`);

  console.log('⚙️  触发 afterTurn...\n');
  const result = await lifecycle.afterTurn(fallacySession.id, turn1User, turn1Assistant);
  console.log(`✅ afterTurn 完成:`);
  console.log(`   - recordAppended: ${result.recordAppended}`);
  console.log(`   - memoryUpdated: ${result.memoryUpdated}\n`);

  await new Promise((resolve) => setTimeout(resolve, 1000));
  await lifecycle.flushBubbles();

  // ==================== 步骤 3: 建立跨分支引用 ====================
  console.log('━'.repeat(60));
  console.log('🔗 步骤 3: 建立跨分支引用');
  console.log('━'.repeat(60));
  console.log();

  console.log(`🔗 让 "${fallacyLabel}" 引用 "${thinkingSession.label}"...\n`);

  try {
    await sessionTree.addRef(fallacySession.id, thinkingSession.id);
    console.log(`✅ 引用建立成功！\n`);
  } catch (error) {
    console.error(`❌ 引用失败:`, error);
  }

  // 检查 refs
  const updatedFallacy = await sessionTree.get(fallacySession.id);
  console.log(`📋 "${fallacyLabel}" 的 refs:`);
  console.log(`   ${JSON.stringify(updatedFallacy.refs)}`);
  console.log(`   验证: ${updatedFallacy.refs.includes(thinkingSession.id) ? '✅ 包含目标 Session ID' : '❌ 未包含'}\n`);

  // ==================== 步骤 4: 测试引用校验 ====================
  console.log('━'.repeat(60));
  console.log('🧪 步骤 4: 测试引用校验逻辑');
  console.log('━'.repeat(60));
  console.log();

  // 4.1 测试自引用
  console.log('🧪 测试 1: Session 引用自己（应该失败）\n');
  try {
    await sessionTree.addRef(fallacySession.id, fallacySession.id);
    console.log('❌ 意外：自引用成功了（不应该）\n');
  } catch (error) {
    console.log(`✅ 正确：自引用被拒绝`);
    console.log(`   错误信息: ${(error as Error).message}\n`);
  }

  // 4.2 测试父引用子
  console.log('🧪 测试 2: 父 Session 引用子 Session\n');
  try {
    await sessionTree.addRef(rootSession.id, fallacySession.id);
    console.log('✅ 父引用子成功（如果允许的话）\n');
  } catch (error) {
    console.log(`⚠️  父引用子被拒绝`);
    console.log(`   错误信息: ${(error as Error).message}\n`);
  }

  // 4.3 测试子引用父
  console.log('🧪 测试 3: 子 Session 引用父 Session\n');
  try {
    await sessionTree.addRef(fallacySession.id, rootSession.id);
    console.log('✅ 子引用父成功（如果允许的话）\n');
  } catch (error) {
    console.log(`⚠️  子引用父被拒绝`);
    console.log(`   错误信息: ${(error as Error).message}\n`);
  }

  // 4.4 测试重复引用
  console.log('🧪 测试 4: 重复引用同一个 Session\n');
  try {
    await sessionTree.addRef(fallacySession.id, thinkingSession.id);
    console.log('⚠️  重复引用成功（可能允许幂等操作）\n');
  } catch (error) {
    console.log(`✅ 正确：重复引用被拒绝`);
    console.log(`   错误信息: ${(error as Error).message}\n`);
  }

  // ==================== 步骤 5: Assemble 验证引用记忆注入 ====================
  console.log('━'.repeat(60));
  console.log('🔄 步骤 5: Assemble 验证引用记忆注入');
  console.log('━'.repeat(60));
  console.log();

  console.log(`🔄 调用 lifecycle.bootstrap("${fallacyLabel}")...\n`);
  const { context } = await lifecycle.bootstrap(fallacySession.id);

  console.log('✅ Bootstrap 完成！\n');
  console.log('📋 组装的上下文:');
  console.log(`   - Core (L1): ${JSON.stringify(context.core)}`);
  console.log(`   - Memories (L2): ${context.memories.length} 条`);
  console.log(`   - Scope: ${context.scope ? '"' + context.scope.substring(0, 50) + '..."' : '无'}\n`);

  if (context.memories.length > 0) {
    console.log('📄 继承/引用的 Memories:');
    console.log('─'.repeat(60));
    context.memories.forEach((mem, idx) => {
      const preview = mem.substring(0, 100).replace(/\n/g, ' ');
      console.log(`${idx + 1}. ${preview}...`);
    });
    console.log('─'.repeat(60));
    console.log();

    // 分析记忆来源
    console.log('🔍 记忆来源分析:\n');

    const hasRootMemory = context.memories.some((m) =>
      m.includes('知识管理系统') || m.includes('Stello')
    );
    const hasThinkingMemory = context.memories.some((m) =>
      m.includes('批判性思维') || m.includes('质疑假设')
    );

    console.log(`   - 来自父 Session (根): ${hasRootMemory ? '✅ 是' : '❌ 否'}`);
    console.log(`   - 来自引用 Session (批判性思维): ${hasThinkingMemory ? '✅ 是' : '❌ 否'}\n`);

    if (hasRootMemory && hasThinkingMemory) {
      console.log('✅ 验证通过：上下文同时包含父节点记忆和被引用节点记忆！\n');
    } else if (hasRootMemory && !hasThinkingMemory) {
      console.log('⚠️  只有父节点记忆，引用记忆可能未注入\n');
    } else {
      console.log('❓ 记忆来源待确认\n');
    }
  } else {
    console.log('⚠️  未继承任何 Memory\n');
  }

  // ==================== 步骤 6: 查看最终状态 ====================
  console.log('━'.repeat(60));
  console.log('📊 步骤 6: 查看最终状态');
  console.log('━'.repeat(60));
  console.log();

  // 查看两个子 Session 的 memory.md
  const thinkingMemoryPath = join(dataDir, 'sessions', thinkingSession.id, 'memory.md');
  const fallacyMemoryPath = join(dataDir, 'sessions', fallacySession.id, 'memory.md');

  console.log('📄 "批判性思维方法" 的 memory.md:');
  if (existsSync(thinkingMemoryPath)) {
    const content = readFileSync(thinkingMemoryPath, 'utf-8');
    console.log('─'.repeat(60));
    console.log(content);
    console.log('─'.repeat(60));
  }

  console.log('\n📄 "逻辑谬误识别" 的 memory.md:');
  if (existsSync(fallacyMemoryPath)) {
    const content = readFileSync(fallacyMemoryPath, 'utf-8');
    console.log('─'.repeat(60));
    console.log(content);
    console.log('─'.repeat(60));
  }

  // 查看引用关系
  console.log('\n🔗 引用关系总结:\n');
  const finalFallacy = await sessionTree.get(fallacySession.id);
  const finalThinking = await sessionTree.get(thinkingSession.id);

  console.log(`   "${fallacyLabel}" → refs: ${JSON.stringify(finalFallacy.refs)}`);
  console.log(`   "${thinkingSession.label}" → refs: ${JSON.stringify(finalThinking.refs)}\n`);

  console.log('🎉 演示完成！');
  console.log(`\n📁 文件位置:`);
  console.log(`   - 批判性思维: sessions/${thinkingSession.id}`);
  console.log(`   - 逻辑谬误识别: sessions/${fallacySession.id}`);
}

// 运行主函数
main().catch((error) => {
  console.error('\n❌ 错误:', error);
  process.exit(1);
});
