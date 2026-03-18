/**
 * Stello 对话记录演示
 *
 * 本示例演示如何：
 * 1. 手动写入对话（user + assistant 消息）
 * 2. 触发 afterTurn 钩子
 * 3. 验证 records.jsonl 追加记录
 * 4. 验证 memory.md 自动更新
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
  console.log('\n🤖 调用 LLM 生成 memory.md...');

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
  console.log(`✅ LLM 返回内容长度: ${content.length} 字符\n`);

  return content;
};

async function main() {
  console.log('🚀 Stello 对话记录演示\n');

  // 1. 初始化所有模块
  const dataDir = './stello-data';
  console.log(`📁 数据目录: ${dataDir}\n`);

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

  // 2. 创建根 Session（如果不存在）或使用已有的
  let rootSession;
  const sessions = await sessionTree.listAll();

  if (sessions.length > 0) {
    rootSession = sessions.find((s) => s.depth === 0);
    if (!rootSession) {
      rootSession = await sessionTree.createRoot('Conversation Demo');
    }
    console.log(`📌 使用已有根 Session: ${rootSession.id}\n`);
  } else {
    rootSession = await sessionTree.createRoot('Conversation Demo');
    console.log(`🌟 创建新的根 Session: ${rootSession.id}\n`);
  }

  const sessionId = rootSession.id;
  const sessionDir = join(dataDir, 'sessions', sessionId);
  const recordsPath = join(sessionDir, 'records.jsonl');
  const memoryPath = join(sessionDir, 'memory.md');

  // 3. Bootstrap - 加载 Session 上下文
  console.log('🔄 Bootstrap Session...');
  const { context } = await lifecycle.bootstrap(sessionId);
  console.log(`✅ 上下文加载完成`);
  console.log(`   - Core: ${JSON.stringify(context.core)}`);
  console.log(`   - Memories: ${context.memories.length} 条\n`);

  // ==================== 第一轮对话 ====================
  console.log('━'.repeat(60));
  console.log('📝 第一轮对话');
  console.log('━'.repeat(60));

  const turn1User = {
    role: 'user' as const,
    content: '你好！我想用 Stello 做一个知识管理系统，能帮我规划一下吗？',
    timestamp: new Date().toISOString(),
  };

  const turn1Assistant = {
    role: 'assistant' as const,
    content: '当然可以！Stello 非常适合做知识管理系统。我建议：\n1. 用根 Session 管理整体项目规划\n2. 为不同领域（技术、产品、设计）创建子 Session\n3. 利用跨分支引用关联相关知识点\n4. 用记忆系统自动提取关键概念',
    timestamp: new Date().toISOString(),
  };

  console.log(`\n👤 User: ${turn1User.content}`);
  console.log(`\n🤖 Assistant: ${turn1Assistant.content}\n`);

  // 触发 afterTurn
  console.log('⚙️  触发 afterTurn...');
  const result1 = await lifecycle.afterTurn(sessionId, turn1User, turn1Assistant);
  console.log(`✅ afterTurn 完成:`);
  console.log(`   - recordAppended: ${result1.recordAppended}`);
  console.log(`   - memoryUpdated: ${result1.memoryUpdated}`);
  console.log(`   - coreUpdated: ${result1.coreUpdated}\n`);

  // 检查 records.jsonl
  console.log('🔍 检查 records.jsonl:');
  if (existsSync(recordsPath)) {
    const recordsContent = readFileSync(recordsPath, 'utf-8');
    const lines = recordsContent.trim().split('\n').filter(Boolean);
    console.log(`   ✅ 文件存在，包含 ${lines.length} 条记录`);
    console.log(`\n📄 最后一条记录:`);
    console.log(JSON.stringify(JSON.parse(lines[lines.length - 1]), null, 2));
  } else {
    console.log(`   ❌ 文件不存在`);
  }

  // 检查 memory.md
  console.log(`\n🔍 检查 memory.md:`);
  if (existsSync(memoryPath)) {
    const memoryContent = readFileSync(memoryPath, 'utf-8');
    if (memoryContent.trim()) {
      console.log(`   ✅ 文件已更新，内容长度: ${memoryContent.length} 字符\n`);
      console.log('📄 memory.md 内容:');
      console.log('─'.repeat(60));
      console.log(memoryContent);
      console.log('─'.repeat(60));
    } else {
      console.log(`   ⚠️  文件存在但为空`);
    }
  } else {
    console.log(`   ❌ 文件不存在`);
  }

  // 等待一下，让冒泡完成
  console.log('\n⏳ 等待记忆冒泡完成...');
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await lifecycle.flushBubbles();

  // ==================== 第二轮对话 ====================
  console.log('\n\n');
  console.log('━'.repeat(60));
  console.log('📝 第二轮对话');
  console.log('━'.repeat(60));

  const turn2User = {
    role: 'user' as const,
    content: '听起来不错！那我应该先从哪里开始？需要准备什么？',
    timestamp: new Date().toISOString(),
  };

  const turn2Assistant = {
    role: 'assistant' as const,
    content: '建议你先：\n1. 定义核心 Schema（决定要记录哪些关键信息）\n2. 创建根 Session 作为项目入口\n3. 准备 LLM API（用于自动提取记忆）\n4. 开始第一轮对话，Stello 会自动管理记忆和分支',
    timestamp: new Date().toISOString(),
  };

  console.log(`\n👤 User: ${turn2User.content}`);
  console.log(`\n🤖 Assistant: ${turn2Assistant.content}\n`);

  // 触发 afterTurn
  console.log('⚙️  触发 afterTurn...');
  const result2 = await lifecycle.afterTurn(sessionId, turn2User, turn2Assistant);
  console.log(`✅ afterTurn 完成:`);
  console.log(`   - recordAppended: ${result2.recordAppended}`);
  console.log(`   - memoryUpdated: ${result2.memoryUpdated}`);
  console.log(`   - coreUpdated: ${result2.coreUpdated}\n`);

  // 再次检查 records.jsonl
  console.log('🔍 检查 records.jsonl:');
  if (existsSync(recordsPath)) {
    const recordsContent = readFileSync(recordsPath, 'utf-8');
    const lines = recordsContent.trim().split('\n').filter(Boolean);
    console.log(`   ✅ 文件存在，包含 ${lines.length} 条记录`);

    console.log(`\n📄 所有记录:`);
    lines.forEach((line, index) => {
      const record = JSON.parse(line);
      console.log(`\n   记录 ${index + 1}:`);
      console.log(`   - role: ${record.role}`);
      console.log(`   - content: ${record.content.substring(0, 50)}...`);
      console.log(`   - timestamp: ${record.timestamp}`);
    });
  } else {
    console.log(`   ❌ 文件不存在`);
  }

  // 再次检查 memory.md
  console.log(`\n\n🔍 检查 memory.md (基于两轮对话):`);
  if (existsSync(memoryPath)) {
    const memoryContent = readFileSync(memoryPath, 'utf-8');
    if (memoryContent.trim()) {
      console.log(`   ✅ 文件已更新，内容长度: ${memoryContent.length} 字符\n`);
      console.log('📄 memory.md 最终内容:');
      console.log('─'.repeat(60));
      console.log(memoryContent);
      console.log('─'.repeat(60));
    } else {
      console.log(`   ⚠️  文件存在但为空`);
    }
  } else {
    console.log(`   ❌ 文件不存在`);
  }

  // 等待冒泡
  console.log('\n⏳ 等待记忆冒泡完成...');
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await lifecycle.flushBubbles();

  // 检查 core.json
  console.log('\n🔍 检查 core.json (L1 全局档案):');
  const coreData = await coreMemory.readCore();
  console.log(JSON.stringify(coreData, null, 2));

  console.log('\n\n🎉 演示完成！');
  console.log(`\n💡 提示: 查看 ${sessionDir} 目录下的文件以验证结果`);
}

// 运行主函数
main().catch((error) => {
  console.error('\n❌ 错误:', error);
  process.exit(1);
});
