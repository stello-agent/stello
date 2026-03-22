import {
  Scheduler,
  TurnRunner,
  createStelloEngine,
  type EngineRuntimeSession,
  type EngineTools,
  type EngineLifecycle,
  type EngineSessionResolver,
  type EngineSplitGuard,
  type SessionMeta,
  type ToolDefinition,
  type TurnRecord,
} from '../packages/core/src/index';

interface OpenAIChatToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAIChatResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: OpenAIChatToolCall[];
    };
  }>;
}

interface ToolResultPayload {
  toolResults: Array<{
    toolCallId: string;
    name: string;
    success: boolean;
    data?: unknown;
    error?: string;
  }>;
}

const DIVIDER = '='.repeat(64);

function section(title: string): void {
  console.log(`\n${DIVIDER}`);
  console.log(title);
  console.log(DIVIDER);
}

function createMeta(id: string, label: string, parentId: string | null): SessionMeta {
  const now = new Date().toISOString();
  return {
    id,
    parentId,
    children: [],
    refs: [],
    label,
    index: 0,
    scope: null,
    status: 'active',
    depth: parentId ? 1 : 0,
    turnCount: 0,
    metadata: {},
    tags: [],
    createdAt: now,
    updatedAt: now,
    lastActiveAt: now,
  };
}

function isToolResultPayload(input: string): ToolResultPayload | null {
  try {
    const parsed = JSON.parse(input) as ToolResultPayload;
    if (!Array.isArray(parsed.toolResults)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function toOpenAITools(definitions: ToolDefinition[]): Array<Record<string, unknown>> {
  return definitions.map((definition) => ({
    type: 'function',
    function: {
      name: definition.name,
      description: definition.description,
      parameters: definition.parameters,
    },
  }));
}

async function callOpenAI(
  apiKey: string,
  model: string,
  baseUrl: string,
  body: Record<string, unknown>,
): Promise<OpenAIChatResponse> {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`OpenAI 请求失败: ${response.status} ${await response.text()}`);
  }

  return response.json() as Promise<OpenAIChatResponse>;
}

class OpenAIRuntimeSession implements EngineRuntimeSession {
  private lastUserRequest: string | null = null;

  constructor(
    public readonly meta: { id: string; turnCount: number; consolidatedTurn?: number },
    private readonly label: string,
    private readonly apiKey: string,
    private readonly model: string,
    private readonly baseUrl: string,
    private readonly getToolDefinitions: () => ToolDefinition[],
    private readonly syncTurnCount: (turnCount: number, consolidatedTurn?: number) => void,
  ) {}

  /** 发送一次真实的 OpenAI Chat Completions 请求。 */
  async send(input: string): Promise<{ content: string | null; toolCalls?: Array<{ id: string; name: string; input: Record<string, unknown> }> }> {
    const toolPayload = isToolResultPayload(input);

    if (!toolPayload) {
      this.lastUserRequest = input;
      this.meta.turnCount += 1;
      this.syncTurnCount(this.meta.turnCount, this.meta.consolidatedTurn);
    }

    const systemPrompt = toolPayload
      ? [
          `你是 session "${this.label}" 的助手。`,
          '你现在已经拿到了工具执行结果，请基于这些结果直接回答用户。',
          '不要再请求工具；优先给出清晰、具体、可执行的回答。',
        ].join('\n')
      : [
          `你是 session "${this.label}" 的助手。`,
          '当需要读取全局信息或列出已有 session 时，优先使用工具。',
          '如果现有信息足够，请直接回答。',
        ].join('\n');

    const userContent = toolPayload
      ? [
          `原始用户问题：${this.lastUserRequest ?? '(未知)'}`,
          '',
          '工具执行结果：',
          JSON.stringify(toolPayload.toolResults, null, 2),
          '',
          '请综合这些结果，给出最终回答。',
        ].join('\n')
      : input;

    const body: Record<string, unknown> = {
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      temperature: 0.2,
    };

    if (!toolPayload) {
      body.tools = toOpenAITools(this.getToolDefinitions());
      body.tool_choice = 'auto';
    }

    const json = await callOpenAI(this.apiKey, this.model, this.baseUrl, body);
    const message = json.choices?.[0]?.message;

    const toolCalls = message?.tool_calls?.map((toolCall) => ({
      id: toolCall.id,
      name: toolCall.function.name,
      input: JSON.parse(toolCall.function.arguments || '{}') as Record<string, unknown>,
    }));

    return {
      content: message?.content ?? null,
      ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
    };
  }

  /** demo 中的 consolidate 先只做日志和元信息更新。 */
  async consolidate(): Promise<void> {
    this.meta.consolidatedTurn = this.meta.turnCount;
    this.syncTurnCount(this.meta.turnCount, this.meta.consolidatedTurn);
    console.log(`[consolidate] ${this.label} -> consolidatedTurn=${this.meta.consolidatedTurn}`);
  }
}

async function main(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL ?? 'MiniMax-M2.7';
  const baseUrl = process.env.OPENAI_BASE_URL ?? 'https://api.minimaxi.com/v1';

  if (!apiKey) {
    throw new Error('缺少 OPENAI_API_KEY 环境变量');
  }

  const rootPrompt = process.argv[2] ?? '我想做一个 AI 编程工作台，先帮我梳理方向。';
  const childPrompt = process.argv[3] ?? '继续只讨论 UI 方向，给我一个首页信息架构。';

  const coreState: Record<string, unknown> = {
    project_name: 'Stello Engine Demo',
    goal: 'Build an AI coding workspace',
    stack: ['TypeScript', 'React', 'Node.js'],
  };

  const sessionMetas = new Map<string, SessionMeta>();
  const runtimeSessions = new Map<string, OpenAIRuntimeSession>();

  const rootMeta = createMeta('root', 'Root Session', null);
  sessionMetas.set(rootMeta.id, rootMeta);

  const toolDefinitions: ToolDefinition[] = [
    {
      name: 'stello_read_core',
      description: '读取全局 core 信息中的某个字段，不传 path 时返回整个 core。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'core 字段名，例如 goal 或 project_name' },
        },
      },
    },
    {
      name: 'stello_list_sessions',
      description: '列出当前已有的 session，方便了解已经存在的分支。',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  ];

  const tools: EngineTools = {
    getToolDefinitions() {
      return toolDefinitions;
    },
    async executeTool(name, args) {
      if (name === 'stello_read_core') {
        const path = typeof args.path === 'string' ? args.path : undefined;
        return {
          success: true,
          data: path ? coreState[path] ?? null : coreState,
        };
      }

      if (name === 'stello_list_sessions') {
        return {
          success: true,
          data: Array.from(sessionMetas.values()).map((session) => ({
            id: session.id,
            label: session.label,
            parentId: session.parentId,
            turnCount: session.turnCount,
            status: session.status,
          })),
        };
      }

      return { success: false, error: `unknown tool: ${name}` };
    },
  };

  const getOrCreateRuntimeSession = (meta: SessionMeta): OpenAIRuntimeSession => {
    const existing = runtimeSessions.get(meta.id);
    if (existing) return existing;

    const runtime = new OpenAIRuntimeSession(
      {
        id: meta.id,
        turnCount: meta.turnCount,
        consolidatedTurn: 0,
      },
      meta.label,
      apiKey,
      model,
      baseUrl,
      () => tools.getToolDefinitions(),
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      (turnCount, _consolidatedTurn) => {
        meta.turnCount = turnCount;
      },
    );

    runtimeSessions.set(meta.id, runtime);
    return runtime;
  };

  getOrCreateRuntimeSession(rootMeta);

  const lifecycle: EngineLifecycle = {
    async bootstrap(sessionId) {
      const session = sessionMetas.get(sessionId);
      if (!session) throw new Error(`Session 不存在: ${sessionId}`);
      return {
        context: {
          core: coreState,
          memories: session.parentId ? ['继承自父 session 的摘要（demo mock）'] : [],
          currentMemory: null,
          scope: session.scope,
        },
        session,
      };
    },
    async assemble(sessionId) {
      const session = sessionMetas.get(sessionId);
      return {
        core: coreState,
        memories: session?.parentId ? ['继承自父 session 的摘要（demo mock）'] : [],
        currentMemory: null,
        scope: session?.scope ?? null,
      };
    },
    async afterTurn(sessionId, userMsg, assistantMsg) {
      console.log(`[afterTurn] ${sessionId}`, {
        user: userMsg.content,
        assistant: assistantMsg.content.slice(0, 120),
      });
      return { coreUpdated: false, memoryUpdated: true, recordAppended: true };
    },
    async onSessionSwitch(fromId, toId) {
      console.log(`[switch] ${fromId} -> ${toId}`);
      const session = sessionMetas.get(toId);
      if (!session) throw new Error(`Session 不存在: ${toId}`);
      return {
        context: {
          core: coreState,
          memories: session.parentId ? ['继承自父 session 的摘要（demo mock）'] : [],
          currentMemory: null,
          scope: session.scope,
        },
        session,
      };
    },
    async prepareChildSpawn(options) {
      const child = createMeta(`child-${sessionMetas.size}`, options.label, options.parentId);
      child.scope = options.scope ?? null;
      child.metadata = options.metadata ?? {};
      child.tags = options.tags ?? [];
      child.index = Array.from(sessionMetas.values()).filter((session) => session.parentId === options.parentId).length;
      child.depth = (sessionMetas.get(options.parentId)?.depth ?? 0) + 1;

      sessionMetas.set(child.id, child);
      getOrCreateRuntimeSession(child);

      const parent = sessionMetas.get(options.parentId);
      if (parent) {
        parent.children.push(child.id);
      }

      console.log('[fork] created child session', {
        id: child.id,
        label: child.label,
        parentId: child.parentId,
        scope: child.scope,
      });

      return child;
    },
  };

  const sessionResolver: EngineSessionResolver = {
    async getSession(sessionId) {
      const session = sessionMetas.get(sessionId);
      if (!session) throw new Error(`Session 不存在: ${sessionId}`);
      return getOrCreateRuntimeSession(session);
    },
  };

  const splitGuard: EngineSplitGuard = {
    async checkCanSplit(sessionId) {
      const session = sessionMetas.get(sessionId);
      if (!session) return { canSplit: false, reason: `Session 不存在: ${sessionId}` };
      if (session.turnCount < 1) {
        return { canSplit: false, reason: '至少先完成 1 轮真实对话，再创建子 session' };
      }
      return { canSplit: true };
    },
    recordSplit(sessionId, turnCount) {
      console.log(`[splitGuard] recordSplit(${sessionId}, ${turnCount})`);
    },
  };

  const sessions = {
    async createChild() {
      throw new Error('demo 不直接调用 sessions.createChild，请通过 lifecycle.prepareChildSpawn');
    },
    async get(id: string) {
      return sessionMetas.get(id) ?? null;
    },
    async getRoot() {
      return rootMeta;
    },
    async listAll() {
      return Array.from(sessionMetas.values());
    },
    async archive(id: string) {
      const session = sessionMetas.get(id);
      if (session) {
        session.status = 'archived';
      }
      console.log(`[archive] ${id}`);
    },
    async addRef() {},
    async updateMeta(id: string, updates: Partial<Pick<SessionMeta, 'label' | 'scope' | 'tags' | 'metadata'>>) {
      const session = sessionMetas.get(id);
      if (!session) throw new Error(`Session 不存在: ${id}`);
      if (updates.label !== undefined) session.label = updates.label;
      if (updates.scope !== undefined) session.scope = updates.scope;
      if (updates.tags !== undefined) session.tags = updates.tags;
      if (updates.metadata !== undefined) session.metadata = updates.metadata;
      return session;
    },
    async getAncestors() {
      return [];
    },
    async getSiblings() {
      return [];
    },
  };

  const memory = {
    async readCore() { return coreState; },
    async writeCore(path: string, value: unknown) { coreState[path] = value; },
    async readMemory() { return null; },
    async writeMemory() {},
    async readScope() { return null; },
    async writeScope() {},
    async readIndex() { return null; },
    async writeIndex() {},
    async appendRecord() {},
    async readRecords() { return []; },
    async assembleContext() {
      return { core: coreState, memories: [], currentMemory: null, scope: null };
    },
  };

  const confirm = {
    async confirmSplit() {
      throw new Error('demo 未实现 confirmSplit');
    },
    async dismissSplit() {},
    async confirmUpdate() {},
    async dismissUpdate() {},
  };

  const engine = createStelloEngine({
    currentSessionId: rootMeta.id,
    sessions,
    memory,
    skills: {
      register() {},
      match(message: TurnRecord) {
        return message.content.includes('translate')
          ? {
              name: 'translate',
              description: 'translate text',
              keywords: ['translate'],
              guidancePrompt: 'translate',
              async handler() {
                return { reply: 'translated' };
              },
            }
          : null;
      },
      getAll() {
        return [];
      },
    },
    confirm,
    lifecycle,
    tools,
    sessionResolver,
    splitGuard,
    turnRunner: new TurnRunner(),
    scheduler: new Scheduler({
      consolidation: { mode: 'manual' },
      integration: { mode: 'manual' },
    }),
  });

  section('1. Root Session Real LLM Turn');
  console.log(`model = ${model}`);
  console.log(`root prompt = ${rootPrompt}`);
  const rootTurn = await engine.turn(rootPrompt);
  console.log(rootTurn);

  section('2. Fork Child Session');
  const forkResult = await engine.forkSession({
    label: 'UI Exploration',
    scope: 'ui',
  });
  console.log(forkResult);

  section('3. Switch To Child Session');
  const switchResult = await engine.switchSessionWithSchedule(forkResult.child.id);
  console.log(switchResult);

  section('4. Child Session Real LLM Turn');
  console.log(`child prompt = ${childPrompt}`);
  const childTurn = await engine.turn(childPrompt);
  console.log(childTurn);

  section('5. Archive Child Session');
  const archiveResult = await engine.archiveSession(forkResult.child.id);
  console.log(archiveResult);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
