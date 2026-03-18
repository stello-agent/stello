// ─── Stello 联调脚本：模拟完整用户使用流程 ───

import { mkdtemp, rm, readdirSync, statSync } from 'node:fs';
import { mkdtemp as mkdtempAsync, rm as rmAsync } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  NodeFileSystemAdapter,
  CoreMemory,
  SessionMemory,
  SessionTreeImpl,
  LifecycleManager,
  SplitGuard,
  AgentTools,
} from '../packages/core/src/index';
import type { CoreSchema, StelloConfig } from '../packages/core/src/index';

// ─── 工具函数 ───

const DIVIDER = '═'.repeat(60);

function step(n: number, title: string): void {
  console.log(`\n${DIVIDER}`);
  console.log(`  步骤 ${n}：${title}`);
  console.log(DIVIDER);
}

function printJSON(label: string, data: unknown): void {
  console.log(`\n📋 ${label}：`);
  console.log(JSON.stringify(data, null, 2));
}

function printText(label: string, text: string | null): void {
  console.log(`\n📝 ${label}：`);
  console.log(text ?? '(空)');
}

/** 递归打印目录树 */
function printTree(dir: string, prefix: string = ''): void {
  const entries = readdirSync(dir).sort();
  entries.forEach((entry, i) => {
    const fullPath = join(dir, entry);
    const isLast = i === entries.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      console.log(`${prefix}${connector}${entry}/`);
      printTree(fullPath, prefix + (isLast ? '    ' : '│   '));
    } else {
      const size = stat.size;
      console.log(`${prefix}${connector}${entry}  (${size} bytes)`);
    }
  });
}

// ─── Schema 定义 ───

const schema: CoreSchema = {
  name: { type: 'string', default: '', bubbleable: true },
  goal: { type: 'string', default: '', bubbleable: true },
  topics: { type: 'array', default: [], bubbleable: true },
};

// ─── Mock LLM ───

let llmCallCount = 0;

const mockCallLLM = async (prompt: string): Promise<string> => {
  llmCallCount++;
  console.log(`  🤖 LLM 调用 #${llmCallCount}（${prompt.slice(0, 30).replace(/\n/g, ' ')}...）`);

  if (prompt.includes('记忆摘要')) {
    return `# 对话记忆

## 用户信息
- 用户名：Alice
- 目标：构建一个智能聊天机器人

## 关键结论
- 用户有 TypeScript 开发经验
- 偏好使用 React 构建前端`;
  }

  if (prompt.includes('核心档案')) {
    return '{"updates":[{"path":"name","value":"Alice"},{"path":"goal","value":"构建智能聊天机器人"}]}';
  }

  if (prompt.includes('对话边界')) {
    return `# 对话边界

## 允许讨论
- UI 设计方案和组件选型
- 用户交互流程
- 视觉风格和主题

## 不允许讨论
- 后端 API 实现细节
- 数据库设计
- 部署运维`;
  }

  if (prompt.includes('最终摘要')) {
    return `# 最终记忆摘要

- 用户 Alice 想构建智能聊天机器人
- 有 TypeScript + React 经验
- 已完成初步需求讨论，准备进入 UI 设计阶段`;
  }

  return '';
};

// ─── 主流程 ───

async function main(): Promise<void> {
  const tmpDir = await mkdtempAsync(join(tmpdir(), 'stello-smoke-'));
  console.log(`\n🚀 Stello Smoke Test 开始`);
  console.log(`📁 数据目录：${tmpDir}\n`);

  try {
    // ═══ 步骤 1：初始化所有模块 ═══
    step(1, '初始化所有模块');

    const fs = new NodeFileSystemAdapter(tmpDir);
    const coreMem = new CoreMemory(fs, schema);
    const sessMem = new SessionMemory(fs);
    const tree = new SessionTreeImpl(fs);
    const config: StelloConfig = {
      dataDir: tmpDir,
      coreSchema: schema,
      callLLM: mockCallLLM,
      inheritancePolicy: 'summary',
    };
    const lifecycle = new LifecycleManager(coreMem, sessMem, tree, config);
    const guard = new SplitGuard(tree, { minTurns: 3, cooldownTurns: 5 });
    const tools = new AgentTools(tree, coreMem, sessMem, lifecycle, guard);

    await coreMem.init();

    console.log('\n✅ 模块初始化完成：');
    console.log('   - NodeFileSystemAdapter');
    console.log('   - CoreMemory（schema: name, goal, topics）');
    console.log('   - SessionMemory');
    console.log('   - SessionTreeImpl');
    console.log('   - LifecycleManager（继承策略: summary）');
    console.log('   - SplitGuard（minTurns: 3, cooldown: 5）');
    console.log('   - AgentTools（8 个 tool）');

    const toolDefs = tools.getToolDefinitions();
    console.log(`\n🔧 Agent Tools（共 ${toolDefs.length} 个）：`);
    for (const t of toolDefs) {
      console.log(`   - ${t.name}: ${t.description}`);
    }

    // ═══ 步骤 2：创建根 Session + bootstrap ═══
    step(2, '创建根 Session + bootstrap');

    const root = await tree.createRoot('智能聊天机器人项目');
    console.log(`\n✅ 根 Session 创建成功：${root.id}`);
    printJSON('根 Session 元数据', {
      id: root.id,
      label: root.label,
      depth: root.depth,
      status: root.status,
      turnCount: root.turnCount,
      parentId: root.parentId,
    });

    const bootstrap = await lifecycle.bootstrap(root.id);
    printJSON('Bootstrap 上下文 — core', bootstrap.context.core);
    printText('Bootstrap 上下文 — currentMemory', bootstrap.context.currentMemory);
    printText('Bootstrap 上下文 — scope', bootstrap.context.scope);
    console.log(`\n📚 继承的记忆数量：${bootstrap.context.memories.length}`);

    // ═══ 步骤 3：模拟第一轮对话 ═══
    step(3, '模拟第一轮对话（afterTurn）');

    const userMsg1 = {
      role: 'user' as const,
      content: '你好！我叫 Alice，我想构建一个智能聊天机器人。我有 TypeScript 和 React 经验。',
      timestamp: new Date().toISOString(),
    };
    const assistantMsg1 = {
      role: 'assistant' as const,
      content: '你好 Alice！很高兴认识你。构建聊天机器人是个很棒的项目，有 TS + React 经验会很有帮助。让我们先讨论一下需求吧。',
      timestamp: new Date().toISOString(),
    };

    console.log(`\n💬 用户：${userMsg1.content}`);
    console.log(`💬 助手：${assistantMsg1.content}`);

    const afterTurnResult = await lifecycle.afterTurn(root.id, userMsg1, assistantMsg1);
    await lifecycle.flushBubbles();

    printJSON('afterTurn 结果', afterTurnResult);

    const memoryAfterTurn = await sessMem.readMemory(root.id);
    printText('更新后的 memory.md', memoryAfterTurn);

    const coreAfterTurn = await coreMem.readCore();
    printJSON('冒泡后的 core.json', coreAfterTurn);

    const records = await sessMem.readRecords(root.id);
    console.log(`\n📜 L3 对话记录：共 ${records.length} 条`);

    // ═══ 步骤 4：通过 AgentTools 创建子 Session ═══
    step(4, '通过 AgentTools 创建子 Session');

    // 先满足拆分保护要求
    await tree.updateMeta(root.id, { turnCount: 5 });
    console.log('\n⚙️  已将 turnCount 更新为 5（满足拆分保护 minTurns: 3）');

    const createResult = await tools.executeTool('stello_create_session', {
      parentId: root.id,
      label: 'UI 设计讨论',
    });

    printJSON('创建子 Session 结果', createResult);

    const childMeta = createResult.data as { id: string; parentId: string };
    const childScope = await sessMem.readScope(childMeta.id);
    printText('子 Session 的 scope.md', childScope);

    const parentIndex = await sessMem.readIndex(root.id);
    printText('父 Session 的 index.md', parentIndex);

    // ═══ 步骤 5：切换到子 Session ═══
    step(5, '切换到子 Session（onSessionSwitch）');

    console.log(`\n🔄 从根 Session → 子 Session（UI 设计讨论）`);
    const switchResult = await lifecycle.onSessionSwitch(root.id, childMeta.id);

    printJSON('子 Session Bootstrap — core', switchResult.context.core);
    printText('子 Session Bootstrap — currentMemory', switchResult.context.currentMemory);
    printText('子 Session Bootstrap — scope', switchResult.context.scope);
    console.log(`\n📚 继承的记忆数量：${switchResult.context.memories.length}`);
    if (switchResult.context.memories.length > 0) {
      printText('继承的父 Session 记忆', switchResult.context.memories[0]);
    }

    // 检查根 Session 的记忆是否已整理
    const rootFinalMemory = await sessMem.readMemory(root.id);
    printText('根 Session 整理后的最终记忆', rootFinalMemory);

    // ═══ 步骤 6：子 Session 聊一轮 + 验证冒泡 ═══
    step(6, '在子 Session 聊一轮 + 验证冒泡');

    const userMsg2 = {
      role: 'user' as const,
      content: '我想用一个简洁现代的 UI 风格，主色调用蓝色系。',
      timestamp: new Date().toISOString(),
    };
    const assistantMsg2 = {
      role: 'assistant' as const,
      content: '好的！蓝色系简洁风格是不错的选择。我建议用 Tailwind CSS 来快速搭建，组件库可以选 Shadcn/UI。',
      timestamp: new Date().toISOString(),
    };

    console.log(`\n💬 用户：${userMsg2.content}`);
    console.log(`💬 助手：${assistantMsg2.content}`);

    const afterTurn2 = await lifecycle.afterTurn(childMeta.id, userMsg2, assistantMsg2);
    await lifecycle.flushBubbles();

    printJSON('afterTurn 结果', afterTurn2);

    const coreAfterBubble = await coreMem.readCore();
    printJSON('冒泡后的 core.json（应有 name + goal）', coreAfterBubble);

    // ═══ 步骤 7：打印 Session 树 + 目录结构 ═══
    step(7, '打印 Session 树 + 目录结构');

    const allSessions = await tree.listAll();
    console.log(`\n🌳 Session 树（共 ${allSessions.length} 个）：\n`);
    for (const s of allSessions) {
      const indent = '  '.repeat(s.depth);
      const icon = s.depth === 0 ? '🌟' : '⭐';
      console.log(`${indent}${icon} ${s.label}`);
      console.log(`${indent}   id: ${s.id}`);
      console.log(`${indent}   depth: ${s.depth} | turns: ${s.turnCount} | status: ${s.status}`);
      console.log(`${indent}   children: [${s.children.join(', ')}]`);
    }

    console.log(`\n📂 数据目录结构：\n`);
    printTree(tmpDir);

    // ─── 完成 ───
    console.log(`\n${DIVIDER}`);
    console.log(`  ✅ Smoke Test 全部完成！共调用 LLM ${llmCallCount} 次`);
    console.log(DIVIDER);
    console.log();
  } finally {
    await rmAsync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('\n❌ Smoke Test 失败：', err);
  process.exit(1);
});
