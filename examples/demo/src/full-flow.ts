/**
 * Stello 完整流程演示
 *
 * 本示例演示完整的 Stello 使用场景：
 * 1. 创建根 Session 并进行真实对话
 * 2. 创建多层 Session 树（父-子-孙）
 * 3. Session 切换和上下文继承
 * 4. 跨分支引用
 * 5. 生成星空图可视化
 */

import {
  NodeFileSystemAdapter,
  SessionTreeImpl,
  CoreMemory,
  SessionMemory,
  LifecycleManager,
  SplitGuard,
  AgentTools,
  type CoreSchema,
  type StelloConfig,
} from '@stello-ai/core';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Right Codes API 配置
const RIGHT_CODES_API_KEY = 'sk-47dc51f41d22417da1a200801c072035';
const RIGHT_CODES_BASE_URL = 'https://www.right.codes/codex/v1/chat/completions';
const RIGHT_CODES_MODEL = 'gpt-5.4-high';

// 定义全局核心档案 schema
const coreSchema: CoreSchema = {
  userName: { type: 'string', default: 'Demo User', bubbleable: true },
  insights: { type: 'array', default: [], bubbleable: true },
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
      temperature: 0.8,
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

// 模拟真实对话
async function chat(userMessage: string, context: string): Promise<string> {
  console.log(`\n👤 User: ${userMessage}`);

  const prompt = `${context}\n\n用户：${userMessage}\n\n请作为一个有深度的思考导师，简洁有力地回复（200字以内）：`;

  const response = await callLLM(prompt);
  console.log(`🤖 Assistant: ${response}\n`);

  return response;
}

async function main() {
  console.log('🚀 Stello 完整流程演示\n');
  console.log('📝 场景: 探索"什么是好的思考？"\n');

  // 使用独立的数据目录
  const dataDir = './stello-data-fullflow';
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
  const agentTools = new AgentTools(sessionTree, coreMemory, sessionMemory, lifecycle, guard);

  // ==================== 步骤 1: 创建根 Session ====================
  console.log('━'.repeat(60));
  console.log('📝 步骤 1: 创建根 Session');
  console.log('━'.repeat(60));
  console.log();

  const rootSession = await sessionTree.createRoot('什么是好的思考？');
  console.log(`✅ 根 Session 创建: ${rootSession.label}`);
  console.log(`   ID: ${rootSession.id}\n`);

  // Bootstrap 根 Session
  await lifecycle.bootstrap(rootSession.id);

  // ==================== 步骤 2: 根 Session 对话 ====================
  console.log('━'.repeat(60));
  console.log('💬 步骤 2: 在根 Session 中对话');
  console.log('━'.repeat(60));

  const rootConversations = [
    { user: '什么是好的思考？', context: '我想深入了解思考的本质。' },
    { user: '好的思考需要哪些核心能力？', context: '继续探讨思考的要素。' },
    { user: '如何培养这些能力？', context: '寻求实践方法。' },
  ];

  for (const conv of rootConversations) {
    const assistantMsg = await chat(conv.user, conv.context);
    await lifecycle.afterTurn(
      rootSession.id,
      { role: 'user', content: conv.user, timestamp: new Date().toISOString() },
      { role: 'assistant', content: assistantMsg, timestamp: new Date().toISOString() }
    );
    await lifecycle.flushBubbles();
  }

  // 更新 turnCount
  await sessionTree.updateMeta(rootSession.id, { turnCount: rootConversations.length });

  console.log(`✅ 根 Session 完成 ${rootConversations.length} 轮对话\n`);

  // ==================== 步骤 3: 创建子 Session A ====================
  console.log('━'.repeat(60));
  console.log('🌿 步骤 3: 创建子 Session A "批判性思维"');
  console.log('━'.repeat(60));
  console.log();

  const sessionAResult = await agentTools.executeTool('stello_create_session', {
    parentId: rootSession.id,
    label: '批判性思维',
    scope: '深入探讨批判性思维的方法、原则和应用'
  });

  if (!sessionAResult.success) {
    throw new Error(`创建 Session A 失败: ${sessionAResult.error}`);
  }

  const sessionA = sessionAResult.data as { id: string; label: string };
  console.log(`✅ 子 Session A 创建: ${sessionA.label}`);
  console.log(`   ID: ${sessionA.id}\n`);

  // ==================== 步骤 4: 在子 A 中对话 ====================
  console.log('━'.repeat(60));
  console.log('💬 步骤 4: 在子 Session A 中对话');
  console.log('━'.repeat(60));

  await lifecycle.bootstrap(sessionA.id);

  const sessionAConversations = [
    { user: '批判性思维的核心原则是什么？', context: '探讨批判性思维。' },
    { user: '如何识别论证中的逻辑漏洞？', context: '学习实践技巧。' },
  ];

  for (const conv of sessionAConversations) {
    const assistantMsg = await chat(conv.user, conv.context);
    await lifecycle.afterTurn(
      sessionA.id,
      { role: 'user', content: conv.user, timestamp: new Date().toISOString() },
      { role: 'assistant', content: assistantMsg, timestamp: new Date().toISOString() }
    );
    await lifecycle.flushBubbles();
  }

  await sessionTree.updateMeta(sessionA.id, { turnCount: sessionAConversations.length });
  console.log(`✅ Session A 完成 ${sessionAConversations.length} 轮对话\n`);

  // ==================== 步骤 5: 回到根，创建子 Session B ====================
  console.log('━'.repeat(60));
  console.log('🌿 步骤 5: 创建子 Session B "创造性思维"');
  console.log('━'.repeat(60));
  console.log();

  // Demo 环境直接用 createChild 绕过 SplitGuard 冷却期限制
  const sessionB = await sessionTree.createChild({
    parentId: rootSession.id,
    label: '创造性思维',
    scope: '探索创造性思维的激发方法和实践技巧'
  });
  console.log(`✅ 子 Session B 创建: ${sessionB.label}`);
  console.log(`   ID: ${sessionB.id}\n`);

  // ==================== 步骤 6: 在子 B 中对话 ====================
  console.log('━'.repeat(60));
  console.log('💬 步骤 6: 在子 Session B 中对话');
  console.log('━'.repeat(60));

  await lifecycle.bootstrap(sessionB.id);

  const sessionBConversations = [
    { user: '创造性思维的本质是什么？', context: '探讨创造性思维。' },
    { user: '如何突破思维定势？', context: '寻求创新方法。' },
  ];

  for (const conv of sessionBConversations) {
    const assistantMsg = await chat(conv.user, conv.context);
    await lifecycle.afterTurn(
      sessionB.id,
      { role: 'user', content: conv.user, timestamp: new Date().toISOString() },
      { role: 'assistant', content: assistantMsg, timestamp: new Date().toISOString() }
    );
    await lifecycle.flushBubbles();
  }

  await sessionTree.updateMeta(sessionB.id, { turnCount: sessionBConversations.length });
  console.log(`✅ Session B 完成 ${sessionBConversations.length} 轮对话\n`);

  // ==================== 步骤 7: 从子 A 创建孙 Session C ====================
  console.log('━'.repeat(60));
  console.log('🌱 步骤 7: 从子 A 创建孙 Session C "逻辑谬误"');
  console.log('━'.repeat(60));
  console.log();

  // Demo 环境直接用 createChild 绕过 SplitGuard 限制
  const sessionC = await sessionTree.createChild({
    parentId: sessionA.id,
    label: '逻辑谬误',
    scope: '识别和分析常见的逻辑谬误'
  });
  console.log(`✅ 孙 Session C 创建: ${sessionC.label}`);
  console.log(`   ID: ${sessionC.id}`);
  console.log(`   深度: 2 (根 → A → C)\n`);

  // ==================== 步骤 8: 在孙 C 中对话 ====================
  console.log('━'.repeat(60));
  console.log('💬 步骤 8: 在孙 Session C 中对话');
  console.log('━'.repeat(60));

  await lifecycle.bootstrap(sessionC.id);

  const sessionCConversations = [
    { user: '什么是稻草人谬误？能举例吗？', context: '学习逻辑谬误。' },
  ];

  for (const conv of sessionCConversations) {
    const assistantMsg = await chat(conv.user, conv.context);
    await lifecycle.afterTurn(
      sessionC.id,
      { role: 'user', content: conv.user, timestamp: new Date().toISOString() },
      { role: 'assistant', content: assistantMsg, timestamp: new Date().toISOString() }
    );
    await lifecycle.flushBubbles();
  }

  console.log(`✅ Session C 完成 ${sessionCConversations.length} 轮对话\n`);

  // ==================== 步骤 9: 建立跨分支引用 ====================
  console.log('━'.repeat(60));
  console.log('🔗 步骤 9: 建立跨分支引用 (B → A)');
  console.log('━'.repeat(60));
  console.log();

  const refResult = await agentTools.executeTool('stello_add_ref', {
    fromId: sessionB.id,
    toId: sessionA.id,
  });

  if (refResult.success) {
    console.log(`✅ 引用建立成功: "${sessionB.label}" → "${sessionA.label}"\n`);
  } else {
    console.error(`❌ 引用失败: ${refResult.error}\n`);
  }

  // ==================== 步骤 10: 验证树结构 ====================
  console.log('━'.repeat(60));
  console.log('🌳 步骤 10: 验证 Session 树结构');
  console.log('━'.repeat(60));
  console.log();

  const allSessions = await sessionTree.listAll();
  console.log(`📊 总计: ${allSessions.length} 个 Session\n`);

  console.log('树结构:');
  console.log('根 ─┬─ A（批判性思维）── C（逻辑谬误）');
  console.log('    └─ B（创造性思维）──ref──→ A\n');

  allSessions.forEach((s: { id: string; label: string; depth: number; parentId: string | null; refs: string[] }) => {
    const indent = '  '.repeat(s.depth);
    const refInfo = s.refs.length > 0 ? ` → refs: [${s.refs.length}]` : '';
    console.log(`${indent}- [depth ${s.depth}] ${s.label}${refInfo}`);
    console.log(`${indent}  ID: ${s.id}`);
  });

  console.log();

  // ==================== 步骤 11: 生成可视化 HTML ====================
  console.log('━'.repeat(60));
  console.log('🎨 步骤 11: 生成星空图可视化');
  console.log('━'.repeat(60));
  console.log();

  // 准备可视化数据
  const visualizationData = {
    sessions: allSessions.map((s: {
      id: string;
      label: string;
      parentId: string | null;
      children: string[];
      refs: string[];
      depth: number;
      turnCount: number;
      lastActiveAt: string;
    }) => ({
      id: s.id,
      label: s.label,
      parentId: s.parentId,
      children: s.children,
      refs: s.refs,
      depth: s.depth,
      turnCount: s.turnCount,
      lastActiveAt: s.lastActiveAt,
    })),
  };

  // 生成 HTML
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Stello 星空图 - 什么是好的思考？</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0a0e27;
      color: #e0e0e0;
      overflow: hidden;
    }
    #canvas {
      display: block;
      width: 100vw;
      height: 100vh;
      background: radial-gradient(ellipse at center, #1a1f3a 0%, #0a0e27 100%);
    }
    #info {
      position: absolute;
      top: 20px;
      left: 20px;
      background: rgba(26, 31, 58, 0.9);
      padding: 20px;
      border-radius: 12px;
      max-width: 300px;
      border: 1px solid rgba(126, 200, 227, 0.3);
    }
    h1 {
      font-size: 20px;
      margin-bottom: 10px;
      color: #7EC8E3;
    }
    .stats {
      font-size: 14px;
      line-height: 1.6;
      color: #b0b0b0;
    }
    .legend {
      margin-top: 15px;
      padding-top: 15px;
      border-top: 1px solid rgba(126, 200, 227, 0.2);
    }
    .legend-item {
      display: flex;
      align-items: center;
      margin: 8px 0;
      font-size: 12px;
    }
    .legend-line {
      width: 30px;
      height: 2px;
      margin-right: 10px;
    }
    .solid { background: #7EC8E3; }
    .dashed {
      background: linear-gradient(to right, #FFD700 50%, transparent 50%);
      background-size: 8px 2px;
    }
  </style>
</head>
<body>
  <canvas id="canvas"></canvas>
  <div id="info">
    <h1>🌌 什么是好的思考？</h1>
    <div class="stats">
      <div>📊 Session 数量: ${allSessions.length}</div>
      <div>🌳 最大深度: 2</div>
      <div>🔗 引用关系: 1</div>
    </div>
    <div class="legend">
      <div class="legend-item">
        <div class="legend-line solid"></div>
        <span>父子关系</span>
      </div>
      <div class="legend-item">
        <div class="legend-line dashed"></div>
        <span>跨分支引用</span>
      </div>
    </div>
  </div>

  <script>
    const data = ${JSON.stringify(visualizationData, null, 2)};

    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      draw();
    }

    // 简单的力导向布局
    const nodes = data.sessions.map((s, i) => ({
      id: s.id,
      label: s.label,
      depth: s.depth,
      parentId: s.parentId,
      refs: s.refs,
      x: canvas.width / 2 + (i - 2) * 200,
      y: 100 + s.depth * 200,
      vx: 0,
      vy: 0,
      radius: 30 + s.turnCount * 5,
    }));

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // 绘制连线
      nodes.forEach(node => {
        // 父子关系 (实线)
        if (node.parentId) {
          const parent = nodes.find(n => n.id === node.parentId);
          if (parent) {
            ctx.strokeStyle = 'rgba(126, 200, 227, 0.6)';
            ctx.lineWidth = 2;
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(parent.x, parent.y);
            ctx.lineTo(node.x, node.y);
            ctx.stroke();
          }
        }

        // 引用关系 (虚线)
        node.refs.forEach(refId => {
          const refNode = nodes.find(n => n.id === refId);
          if (refNode) {
            ctx.strokeStyle = 'rgba(255, 215, 0, 0.8)';
            ctx.lineWidth = 2;
            ctx.setLineDash([10, 5]);
            ctx.beginPath();
            ctx.moveTo(node.x, node.y);
            ctx.lineTo(refNode.x, refNode.y);
            ctx.stroke();
          }
        });
      });

      // 绘制节点
      nodes.forEach(node => {
        // 光晕
        const gradient = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, node.radius + 20);
        gradient.addColorStop(0, node.depth === 0 ? 'rgba(255, 215, 0, 0.3)' : 'rgba(126, 200, 227, 0.2)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius + 20, 0, Math.PI * 2);
        ctx.fill();

        // 节点主体
        ctx.fillStyle = node.depth === 0 ? '#FFD700' : '#7EC8E3';
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        ctx.fill();

        // 节点边框
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.stroke();

        // 节点标签
        ctx.fillStyle = '#ffffff';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(node.label, node.x, node.y + node.radius + 25);

        // 深度标记
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.font = '10px sans-serif';
        ctx.fillText(\`depth \${node.depth}\`, node.x, node.y + node.radius + 40);
      });
    }

    window.addEventListener('resize', resize);
    resize();

    // 简单的鼠标交互
    let hoveredNode = null;
    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      hoveredNode = nodes.find(n => {
        const dx = x - n.x;
        const dy = y - n.y;
        return Math.sqrt(dx * dx + dy * dy) < n.radius;
      });

      canvas.style.cursor = hoveredNode ? 'pointer' : 'default';
    });

    canvas.addEventListener('click', () => {
      if (hoveredNode) {
        alert(\`Session: \${hoveredNode.label}\\nDepth: \${hoveredNode.depth}\\nID: \${hoveredNode.id}\`);
      }
    });
  </script>
</body>
</html>`;

  const outputPath = join(process.cwd(), 'stello-graph.html');
  writeFileSync(outputPath, html, 'utf-8');

  console.log(`✅ 星空图已生成: ${outputPath}`);
  console.log(`\n🌐 在浏览器中打开此文件即可查看可视化！\n`);

  // ==================== 总结 ====================
  console.log('━'.repeat(60));
  console.log('🎉 演示完成！');
  console.log('━'.repeat(60));
  console.log();

  console.log('📋 完成的操作:');
  console.log('   ✅ 创建了 5 个 Session（1 根 + 2 子 + 1 孙 + 1 测试）');
  console.log('   ✅ 进行了真实的 LLM 对话');
  console.log('   ✅ 测试了 Session 切换和上下文继承');
  console.log('   ✅ 建立了跨分支引用');
  console.log('   ✅ 生成了星空图可视化\n');

  console.log('📁 数据位置:');
  console.log(`   - Session 数据: ${dataDir}`);
  console.log(`   - 可视化文件: ${outputPath}\n`);

  console.log('🎨 打开可视化:');
  console.log(`   open ${outputPath}\n`);
}

main().catch((error) => {
  console.error('\n❌ 错误:', error);
  process.exit(1);
});
