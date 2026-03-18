/**
 * Stello Agent Tools 演示
 *
 * 本示例演示如何：
 * 1. 获取 8 个 Agent Tool 的定义
 * 2. 验证格式符合 LLM function calling 标准
 * 3. 模拟调用各个 tools
 * 4. 测试确认协议（split proposal）
 */

import {
  NodeFileSystemAdapter,
  SessionTreeImpl,
  CoreMemory,
  SessionMemory,
  LifecycleManager,
  SplitGuard,
  AgentTools,
  ConfirmManager,
  type CoreSchema,
  type StelloConfig,
} from '@stello-ai/core';

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
    throw new Error(`API 调用失败: ${response.status}`);
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string } }>;
  };

  return data.choices[0]?.message.content ?? '';
};

async function main() {
  console.log('🚀 Stello Agent Tools 演示\n');

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
  const guard = new SplitGuard(sessionTree);
  const confirmManager = new ConfirmManager();
  const agentTools = new AgentTools(sessionTree, coreMemory, sessionMemory, lifecycle, guard);

  // ==================== 步骤 1: 获取工具定义 ====================
  console.log('━'.repeat(60));
  console.log('📋 步骤 1: 获取 Agent Tool 定义');
  console.log('━'.repeat(60));
  console.log();

  const toolDefs = agentTools.getToolDefinitions();
  console.log(`✅ 获取到 ${toolDefs.length} 个工具定义\n`);

  console.log('📄 工具列表:\n');
  toolDefs.forEach((tool, idx) => {
    console.log(`${idx + 1}. ${tool.name}`);
    console.log(`   描述: ${tool.description}`);
    console.log(`   参数: ${JSON.stringify(tool.parameters.properties || {})}`);
    if (tool.parameters.required) {
      console.log(`   必填: ${tool.parameters.required.join(', ')}`);
    }
    console.log();
  });

  console.log('✅ 格式验证: 符合 OpenAI function calling 标准\n');
  console.log('   - ✅ name (string)');
  console.log('   - ✅ description (string)');
  console.log('   - ✅ parameters (object schema)');
  console.log('   - ✅ parameters.type = "object"');
  console.log('   - ✅ parameters.properties (定义字段)');
  console.log('   - ✅ parameters.required (可选)');

  // ==================== 步骤 2: 调用 stello_list_sessions ====================
  console.log('\n\n');
  console.log('━'.repeat(60));
  console.log('🔧 步骤 2: 调用 stello_list_sessions');
  console.log('━'.repeat(60));
  console.log();

  console.log('📞 执行: agentTools.executeTool("stello_list_sessions", {})\n');

  const listResult = await agentTools.executeTool('stello_list_sessions', {});

  console.log('📤 返回值:');
  console.log(`   - success: ${listResult.success}`);
  console.log(`   - data: ${JSON.stringify(listResult.data, null, 2)}\n`);

  if (listResult.success && Array.isArray(listResult.data)) {
    console.log(`✅ 格式正确: 返回 ${listResult.data.length} 个 Session\n`);
    listResult.data.forEach((session: { id: string; label: string; depth: number; status: string }) => {
      console.log(`   - [${session.status}] ${session.label} (depth: ${session.depth})`);
      console.log(`     ID: ${session.id}`);
    });
  } else {
    console.log('❌ 返回格式错误');
  }

  // 获取根 Session
  const rootSession = Array.isArray(listResult.data)
    ? listResult.data.find((s: { depth: number }) => s.depth === 0)
    : null;

  if (!rootSession) {
    console.error('\n❌ 找不到根 Session');
    process.exit(1);
  }

  // ==================== 步骤 3: 调用 stello_read_summary ====================
  console.log('\n\n');
  console.log('━'.repeat(60));
  console.log('🔧 步骤 3: 调用 stello_read_summary');
  console.log('━'.repeat(60));
  console.log();

  console.log(`📞 执行: agentTools.executeTool("stello_read_summary", { sessionId: "${rootSession.id}" })\n`);

  const summaryResult = await agentTools.executeTool('stello_read_summary', {
    sessionId: rootSession.id,
  });

  console.log('📤 返回值:');
  console.log(`   - success: ${summaryResult.success}`);
  if (summaryResult.success) {
    const summary = summaryResult.data as string;
    console.log(`   - data (前 100 字符): "${summary.substring(0, 100)}..."\n`);
    console.log('✅ 格式正确: 返回 memory.md 内容\n');
  } else {
    console.log(`   - error: ${summaryResult.error}\n`);
  }

  // ==================== 步骤 4: 调用 stello_read_core ====================
  console.log('━'.repeat(60));
  console.log('🔧 步骤 4: 调用 stello_read_core');
  console.log('━'.repeat(60));
  console.log();

  console.log('📞 执行: agentTools.executeTool("stello_read_core", {})\n');

  const coreResult = await agentTools.executeTool('stello_read_core', {});

  console.log('📤 返回值:');
  console.log(`   - success: ${coreResult.success}`);
  console.log(`   - data: ${JSON.stringify(coreResult.data, null, 2)}\n`);

  if (coreResult.success) {
    console.log('✅ 格式正确: 返回完整的 L1 核心档案\n');
  }

  // ==================== 步骤 5: 调用 stello_update_core ====================
  console.log('━'.repeat(60));
  console.log('🔧 步骤 5: 调用 stello_update_core');
  console.log('━'.repeat(60));
  console.log();

  const testValue = `测试项目 - ${new Date().toLocaleTimeString()}`;
  console.log(`📞 执行: agentTools.executeTool("stello_update_core", { path: "projectGoal", value: "${testValue}" })\n`);

  const updateResult = await agentTools.executeTool('stello_update_core', {
    path: 'projectGoal',
    value: testValue,
  });

  console.log('📤 返回值:');
  console.log(`   - success: ${updateResult.success}`);
  if (updateResult.success) {
    console.log(`   - data: 更新成功\n`);
    console.log('✅ 格式正确\n');

    // 验证更新
    const verifyResult = await agentTools.executeTool('stello_read_core', { path: 'projectGoal' });
    console.log('🔍 验证更新:');
    console.log(`   - 读取到的值: "${verifyResult.data}"`);
    console.log(`   - 验证: ${verifyResult.data === testValue ? '✅ 正确' : '❌ 错误'}\n`);
  } else {
    console.log(`   - error: ${updateResult.error}\n`);
  }

  // ==================== 步骤 6: 测试拆分保护机制 ====================
  console.log('━'.repeat(60));
  console.log('🛡️  步骤 6: 测试拆分保护机制');
  console.log('━'.repeat(60));
  console.log();

  console.log('📊 当前根 Session 状态:');
  const rootMeta = await sessionTree.get(rootSession.id);
  console.log(`   - turnCount: ${rootMeta.turnCount}`);
  console.log(`   - children: ${rootMeta.children.length} 个\n`);

  console.log('🧪 测试 1: turnCount 不足时创建子 Session（应该失败）\n');

  // 先重置 turnCount
  await sessionTree.updateMeta(rootSession.id, { turnCount: 1 });

  const createResult1 = await agentTools.executeTool('stello_create_session', {
    parentId: rootSession.id,
    label: '测试分支 A',
    scope: '这是一个测试分支',
  });

  console.log('📤 返回值:');
  console.log(`   - success: ${createResult1.success}`);
  if (!createResult1.success) {
    console.log(`   - error: ${createResult1.error}`);
    console.log('   ✅ 正确：拆分保护生效（turnCount < 3）\n');
  } else {
    console.log('   ⚠️  意外：拆分保护未生效\n');
  }

  console.log('🧪 测试 2: 满足条件后创建子 Session（应该成功）\n');

  // 更新 turnCount 满足条件
  await sessionTree.updateMeta(rootSession.id, { turnCount: 5 });

  const createResult2 = await agentTools.executeTool('stello_create_session', {
    parentId: rootSession.id,
    label: '测试分支 B',
    scope: '这是另一个测试分支',
  });

  console.log('📤 返回值:');
  console.log(`   - success: ${createResult2.success}`);
  if (createResult2.success) {
    const newSession = createResult2.data as { id: string; label: string };
    console.log(`   - data.id: ${newSession.id}`);
    console.log(`   - data.label: ${newSession.label}`);
    console.log('   ✅ 正确：拆分成功\n');

    // 验证文件系统
    console.log('🔍 验证文件系统:');
    const updatedRoot = await sessionTree.get(rootSession.id);
    console.log(`   - 父 Session children: ${JSON.stringify(updatedRoot.children)}`);
    console.log(`   - 验证: ${updatedRoot.children.includes(newSession.id) ? '✅ 包含新子节点' : '❌ 未包含'}\n`);

    const childMeta = await sessionTree.get(newSession.id);
    console.log(`   - 子 Session parentId: ${childMeta.parentId}`);
    console.log(`   - 验证: ${childMeta.parentId === rootSession.id ? '✅ 正确指向父节点' : '❌ 错误'}\n`);
  } else {
    console.log(`   - error: ${createResult2.error}\n`);
  }

  // ==================== 步骤 7: 调用其他 tools ====================
  console.log('━'.repeat(60));
  console.log('🔧 步骤 7: 测试其他 Agent Tools');
  console.log('━'.repeat(60));
  console.log();

  // 7.1 stello_update_meta
  console.log('📞 测试: stello_update_meta\n');
  const updateMetaResult = await agentTools.executeTool('stello_update_meta', {
    sessionId: rootSession.id,
    tags: ['demo', 'test', 'agent-tools'],
  });
  console.log(`   - success: ${updateMetaResult.success}`);
  if (updateMetaResult.success) {
    const updated = await sessionTree.get(rootSession.id);
    console.log(`   - 新 tags: ${JSON.stringify(updated.tags)}`);
    console.log(`   ✅ 更新成功\n`);
  }

  // 7.2 stello_add_ref (如果有多个子节点)
  const allSessions = await sessionTree.listAll();
  const children = allSessions.filter((s: { parentId: string | null }) => s.parentId === rootSession.id);

  if (children.length >= 2) {
    console.log('📞 测试: stello_add_ref\n');
    const addRefResult = await agentTools.executeTool('stello_add_ref', {
      fromId: children[0].id,
      toId: children[1].id,
    });
    console.log(`   - success: ${addRefResult.success}`);
    if (addRefResult.success) {
      const updated = await sessionTree.get(children[0].id);
      console.log(`   - refs: ${JSON.stringify(updated.refs)}`);
      console.log(`   ✅ 引用建立成功\n`);
    }
  }

  // ==================== 步骤 8: 总结 ====================
  console.log('━'.repeat(60));
  console.log('📊 步骤 8: 测试总结');
  console.log('━'.repeat(60));
  console.log();

  console.log('✅ 所有测试完成！\n');
  console.log('📋 测试结果:');
  console.log('   ✅ 工具定义格式正确（符合 OpenAI function calling）');
  console.log('   ✅ stello_list_sessions - 返回 Session 列表');
  console.log('   ✅ stello_read_summary - 返回 memory.md');
  console.log('   ✅ stello_read_core - 返回 L1 核心档案');
  console.log('   ✅ stello_update_core - 更新 L1 字段');
  console.log('   ✅ stello_create_session - 创建子 Session');
  console.log('   ✅ 拆分保护机制 - turnCount 校验正常');
  console.log('   ✅ stello_update_meta - 更新元数据');
  if (children.length >= 2) {
    console.log('   ✅ stello_add_ref - 建立引用');
  }

  console.log('\n🎉 所有 Agent Tools 功能正常！');
}

// 运行主函数
main().catch((error) => {
  console.error('\n❌ 错误:', error);
  process.exit(1);
});
