import { readdirSync, statSync } from 'node:fs';
import { mkdtemp as mkdtempAsync, rm as rmAsync } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  AgentTools,
  ConfirmManager,
  CoreMemory,
  LifecycleManager,
  NodeFileSystemAdapter,
  SessionMemory,
  SessionTreeImpl,
  SkillRouterImpl,
  SplitGuard,
  TurnRunner,
  createStelloAgent,
  type CoreSchema,
  type EngineRuntimeSession,
  type MemoryEngine,
  type StelloConfig,
  type ToolCallParser,
  type TurnRecord,
} from '../packages/core/src/index';

const DIVIDER = '═'.repeat(72);

function step(n: number, title: string): void {
  console.log(`\n${DIVIDER}`);
  console.log(`步骤 ${n}：${title}`);
  console.log(DIVIDER);
}

function printJSON(label: string, value: unknown): void {
  console.log(`\n${label}:`);
  console.log(JSON.stringify(value, null, 2));
}

function printText(label: string, value: string | null): void {
  console.log(`\n${label}:`);
  console.log(value ?? '(空)');
}

function printTree(dir: string, prefix = ''): void {
  const entries = readdirSync(dir).sort();
  entries.forEach((entry, index) => {
    const fullPath = join(dir, entry);
    const isLast = index === entries.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      console.log(`${prefix}${connector}${entry}/`);
      printTree(fullPath, prefix + (isLast ? '    ' : '│   '));
    } else {
      console.log(`${prefix}${connector}${entry}`);
    }
  });
}

const schema: CoreSchema = {
  name: { type: 'string', default: '', bubbleable: true },
  goal: { type: 'string', default: '', bubbleable: true },
  topics: { type: 'array', default: [], bubbleable: true },
};

let llmCallCount = 0;

const mockCallLLM = async (prompt: string): Promise<string> => {
  llmCallCount += 1;
  console.log(`  [LLM#${llmCallCount}] ${prompt.slice(0, 40).replace(/\n/g, ' ')}...`);

  if (prompt.includes('记忆摘要')) {
    return `# 对话记忆

- 用户名：Alice
- 目标：构建智能聊天工作台
- 偏好：React + TypeScript`;
  }

  if (prompt.includes('核心档案')) {
    return '{"updates":[{"path":"name","value":"Alice"},{"path":"goal","value":"构建智能聊天工作台"}]}';
  }

  if (prompt.includes('对话边界')) {
    return `# Scope

- 聚焦当前分支主题
- 不扩展到无关实现细节`;
  }

  if (prompt.includes('最终摘要')) {
    return `# 最终记忆摘要

- 已完成当前分支讨论
- 结论已沉淀`;
  }

  return '';
};

class DemoMemoryEngine implements MemoryEngine {
  constructor(
    private readonly coreMemory: CoreMemory,
    private readonly sessionMemory: SessionMemory,
    private readonly lifecycle: LifecycleManager,
  ) {}

  readCore(path?: string): Promise<unknown> {
    return this.coreMemory.readCore(path);
  }

  writeCore(path: string, value: unknown): Promise<void> {
    return this.coreMemory.writeCore(path, value);
  }

  readMemory(sessionId: string): Promise<string | null> {
    return this.sessionMemory.readMemory(sessionId);
  }

  writeMemory(sessionId: string, content: string): Promise<void> {
    return this.sessionMemory.writeMemory(sessionId, content);
  }

  readScope(sessionId: string): Promise<string | null> {
    return this.sessionMemory.readScope(sessionId);
  }

  writeScope(sessionId: string, content: string): Promise<void> {
    return this.sessionMemory.writeScope(sessionId, content);
  }

  readIndex(sessionId: string): Promise<string | null> {
    return this.sessionMemory.readIndex(sessionId);
  }

  writeIndex(sessionId: string, content: string): Promise<void> {
    return this.sessionMemory.writeIndex(sessionId, content);
  }

  appendRecord(sessionId: string, record: TurnRecord): Promise<void> {
    return this.sessionMemory.appendRecord(sessionId, record);
  }

  readRecords(sessionId: string): Promise<TurnRecord[]> {
    return this.sessionMemory.readRecords(sessionId);
  }

  assembleContext(sessionId: string) {
    return this.lifecycle.assemble(sessionId);
  }
}

class DemoSessionRuntime implements EngineRuntimeSession {
  readonly meta: { id: string; turnCount: number; status: 'active' | 'archived' };
  turnCount: number;

  constructor(
    readonly id: string,
    initialTurnCount: number,
    private readonly label: string,
    private readonly sessions: SessionTreeImpl,
    private readonly sessionMemory: SessionMemory,
  ) {
    this.turnCount = initialTurnCount;
    this.meta = {
      id,
      turnCount: initialTurnCount,
      status: 'active',
    };
  }

  async send(input: string): Promise<string> {
    const isToolResult = input.includes('"toolResults"');

    if (!isToolResult) {
      this.turnCount += 1;
      this.meta.turnCount = this.turnCount;
      await this.sessions.updateMeta(this.id, { turnCount: this.turnCount });
    }

    if (isToolResult) {
      const parsed = JSON.parse(input) as {
        toolResults: Array<{ toolName: string; success: boolean; data: unknown }>;
      };
      const summary = parsed.toolResults
        .map((item) => `${item.toolName}:${item.success ? 'ok' : 'fail'}`)
        .join(', ');
      return JSON.stringify({
        content: `[${this.label}] 工具调用完成，结果为 ${summary}`,
        toolCalls: [],
      });
    }

    const userMsg: TurnRecord = {
      role: 'user',
      content: input,
      timestamp: new Date().toISOString(),
    };
    await this.sessionMemory.appendRecord(this.id, userMsg);

    if (this.label.includes('Root')) {
      return JSON.stringify({
        content: null,
        toolCalls: [
          { id: 'tool-1', name: 'stello_read_core', args: {} },
          { id: 'tool-2', name: 'stello_list_sessions', args: {} },
        ],
      });
    }

    return JSON.stringify({
      content: null,
      toolCalls: [{ id: 'tool-3', name: 'stello_read_summary', args: { sessionId: this.id } }],
    });
  }

  async consolidate(): Promise<void> {
    await this.sessionMemory.writeMemory(
      this.id,
      `# ${this.label} Summary\n\n- turnCount: ${this.turnCount}\n- 已完成一次 consolidate`,
    );
  }
}

const jsonToolParser: ToolCallParser = {
  parse(raw) {
    return JSON.parse(raw) as {
      content: string | null;
      toolCalls: Array<{ id?: string; name: string; args: Record<string, unknown> }>;
    };
  },
};

async function main(): Promise<void> {
  const tmpDir = await mkdtempAsync(join(tmpdir(), 'stello-smoke-'));
  console.log('\nStello Smoke Demo');
  console.log(`数据目录: ${tmpDir}`);

  try {
    step(1, '初始化基础模块');

    const fs = new NodeFileSystemAdapter(tmpDir);
    const coreMemory = new CoreMemory(fs, schema);
    const sessionMemory = new SessionMemory(fs);
    const sessions = new SessionTreeImpl(fs);
    const config: StelloConfig = {
      dataDir: tmpDir,
      coreSchema: schema,
      callLLM: mockCallLLM,
      inheritancePolicy: 'summary',
    };
    const lifecycle = new LifecycleManager(coreMemory, sessionMemory, sessions, config);
    const splitGuard = new SplitGuard(sessions, { minTurns: 1, cooldownTurns: 0 });
    const tools = new AgentTools(sessions, coreMemory, sessionMemory, lifecycle, splitGuard);
    const confirm = new ConfirmManager(coreMemory, lifecycle);
    const skills = new SkillRouterImpl();
    const memory = new DemoMemoryEngine(coreMemory, sessionMemory, lifecycle);
    const runtimeCache = new Map<string, DemoSessionRuntime>();

    await coreMemory.init();

    printJSON('初始化完成', {
      modules: [
        'CoreMemory',
        'SessionMemory',
        'SessionTreeImpl',
        'LifecycleManager',
        'SplitGuard',
        'AgentTools',
        'StelloAgent',
      ],
    });

    step(2, '创建根 Session 并装配 StelloAgent');

    const root = await sessions.createRoot('MainSession Root');
    const agent = createStelloAgent({
      sessions,
      memory,
      skills,
      confirm,
      lifecycle: {
        bootstrap: (sessionId) => lifecycle.bootstrap(sessionId),
        assemble: (sessionId) => lifecycle.assemble(sessionId),
        afterTurn: (sessionId, userMsg, assistantMsg) =>
          lifecycle.afterTurn(sessionId, userMsg, assistantMsg),
        prepareChildSpawn: (options) => lifecycle.prepareChildSpawn(options),
      },
      tools,
      turnRunner: new TurnRunner(jsonToolParser),
      splitGuard,
      sessionRuntimeResolver: {
        resolve: async (sessionId) => {
          const cached = runtimeCache.get(sessionId);
          if (cached) return cached;

          const meta = await sessions.get(sessionId);
          if (!meta) {
            throw new Error(`Session 不存在: ${sessionId}`);
          }

          const runtime = new DemoSessionRuntime(
            meta.id,
            meta.turnCount,
            meta.label,
            sessions,
            sessionMemory,
          );
          runtimeCache.set(sessionId, runtime);
          return runtime;
        },
      },
      hooks: (sessionId) => ({
        onSessionEnter: () => {
          console.log(`  [hook] onSessionEnter -> ${sessionId}`);
        },
        onSessionLeave: () => {
          console.log(`  [hook] onSessionLeave -> ${sessionId}`);
        },
        onToolCall: ({ toolCall }) => {
          console.log(`  [hook] onToolCall -> ${sessionId} uses ${toolCall.name}`);
        },
        onToolResult: ({ result }) => {
          console.log(`  [hook] onToolResult -> ${sessionId} got ${result.toolName}`);
        },
      }),
    });

    printJSON('根 Session', {
      id: root.id,
      label: root.label,
      depth: root.depth,
      status: root.status,
    });

    step(3, '进入根 Session 并运行一轮 turn');

    const bootstrap = await agent.enterSession(root.id);
    printJSON('bootstrap.context', bootstrap.context);

    const rootTurn = await agent.turn(root.id, '我想做一个 AI 工作台，先帮我梳理方向');
    printJSON('root turn result', rootTurn);

    await lifecycle.flushBubbles();
    printJSON('core.json', await coreMemory.readCore());

    step(4, '从 MainSession fork 第一个子节点');

    const childA = await agent.forkSession(root.id, {
      label: 'UI Exploration',
      scope: 'ui',
    });
    printJSON('childA', {
      id: childA.id,
      parentId: childA.parentId,
      label: childA.label,
      depth: childA.depth,
    });
    printText('childA scope.md', await sessionMemory.readScope(childA.id));

    step(5, '进入子节点并运行一轮 turn');

    await agent.enterSession(childA.id);
    const childTurn = await agent.turn(childA.id, '继续只讨论首页 UI 信息架构');
    printJSON('childA turn result', childTurn);

    step(6, '演示平铺策略：从子节点继续 fork，仍然挂回 MainSession');

    const childB = await agent.forkSession(childA.id, {
      label: 'Landing Page Exploration',
      scope: 'ui',
    });
    printJSON('childB', {
      id: childB.id,
      parentId: childB.parentId,
      label: childB.label,
      depth: childB.depth,
    });

    step(7, '打印 Session 树，验证主节点下一层保持平铺');

    const allSessions = await sessions.listAll();
    for (const session of allSessions) {
      const indent = '  '.repeat(session.depth);
      console.log(
        `${indent}- ${session.label} (id=${session.id}, parent=${session.parentId ?? 'null'}, depth=${session.depth})`,
      );
    }

    const rootMeta = await sessions.get(root.id);
    printJSON('root children', rootMeta?.children ?? []);

    step(8, '展示目录结构与总结');

    console.log('\n目录结构:');
    printTree(tmpDir);
    console.log(`\nLLM 调用次数: ${llmCallCount}`);
    console.log('\nSmoke demo 完成。');
  } finally {
    await rmAsync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('\nSmoke demo 失败:', error);
  process.exit(1);
});
