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

const DIVIDER = '-'.repeat(56);

function section(title: string): void {
  console.log(`\n${DIVIDER}`);
  console.log(title);
  console.log(DIVIDER);
}

function createMeta(id: string, label: string, parentId: string | null, turnCount: number): SessionMeta {
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
    turnCount,
    metadata: {},
    tags: [],
    createdAt: now,
    updatedAt: now,
    lastActiveAt: now,
  };
}

async function main(): Promise<void> {
  const rootMeta = createMeta('root', 'Root Session', null, 4);
  const childMeta = createMeta('child-ui', 'UI Session', 'root', 0);

  const rootSession: EngineRuntimeSession = {
    meta: { id: rootMeta.id, turnCount: rootMeta.turnCount, consolidatedTurn: 0 },
    async send(input: string) {
      if (input === 'Plan the feature') {
        return {
          content: null,
          toolCalls: [{ id: 'tool-1', name: 'stello_read_core', input: { path: 'goal' } }],
        };
      }
      return {
        content: `Assistant final reply for: ${input}`,
      };
    },
    async consolidate() {
      console.log('consolidate(root) called');
    },
  };

  const childSession: EngineRuntimeSession = {
    meta: { id: childMeta.id, turnCount: childMeta.turnCount, consolidatedTurn: 0 },
    async send(input: string) {
      return { content: `Child handled: ${input}` };
    },
    async consolidate() {
      console.log('consolidate(child-ui) called');
    },
  };

  const mainSession = {
    async integrate() {
      console.log('integrate(main) called');
      return { synthesis: 'ok', insights: [] };
    },
  };

  const toolDefinitions: ToolDefinition[] = [
    {
      name: 'stello_read_core',
      description: 'Read core field',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
        },
        required: ['path'],
      },
    },
  ];

  const tools: EngineTools = {
    getToolDefinitions() {
      return toolDefinitions;
    },
    async executeTool(name, args) {
      console.log(`executeTool(${name})`, args);
      if (name === 'stello_read_core') {
        return { success: true, data: 'Build an AI coding workspace' };
      }
      return { success: false, error: `unknown tool: ${name}` };
    },
  };

  const lifecycle: EngineLifecycle = {
    async bootstrap(sessionId) {
      return {
        context: { core: { goal: 'Build an AI coding workspace' }, memories: [], currentMemory: null, scope: null },
        session: sessionId === childMeta.id ? childMeta : rootMeta,
      };
    },
    async assemble(sessionId) {
      return {
        core: { goal: 'Build an AI coding workspace', activeSession: sessionId },
        memories: ['Parent summary'],
        currentMemory: null,
        scope: null,
      };
    },
    async afterTurn(sessionId, userMsg, assistantMsg) {
      console.log(`afterTurn(${sessionId})`, { userMsg: userMsg.content, assistantMsg: assistantMsg.content });
      return { coreUpdated: false, memoryUpdated: true, recordAppended: true };
    },
    async onSessionSwitch(fromId, toId) {
      console.log(`onSessionSwitch(${fromId} -> ${toId})`);
      return {
        context: { core: { switched: true }, memories: ['Inherited summary'], currentMemory: null, scope: null },
        session: toId === childMeta.id ? childMeta : rootMeta,
      };
    },
    async prepareChildSpawn(options) {
      console.log('prepareChildSpawn', options);
      return childMeta;
    },
  };

  const sessionResolver: EngineSessionResolver = {
    async getSession(sessionId) {
      return sessionId === childMeta.id ? childSession : rootSession;
    },
    async getMainSession() {
      return mainSession;
    },
  };

  const splitGuard: EngineSplitGuard = {
    async checkCanSplit(sessionId) {
      console.log(`checkCanSplit(${sessionId})`);
      return { canSplit: true };
    },
    recordSplit(sessionId, turnCount) {
      console.log(`recordSplit(${sessionId}, ${turnCount})`);
    },
  };

  const sessions = {
    async createChild() {
      return childMeta;
    },
    async get(id: string) {
      if (id === rootMeta.id) return rootMeta;
      if (id === childMeta.id) return childMeta;
      return null;
    },
    async getRoot() {
      return rootMeta;
    },
    async listAll() {
      return [rootMeta, childMeta];
    },
    async archive(id: string) {
      console.log(`archive(${id})`);
    },
    async addRef() {},
    async updateMeta(id: string) {
      return (id === childMeta.id ? childMeta : rootMeta);
    },
    async getAncestors() {
      return [];
    },
    async getSiblings() {
      return [];
    },
  };

  const memory = {
    async readCore() { return {}; },
    async writeCore() {},
    async readMemory() { return null; },
    async writeMemory() {},
    async readScope() { return null; },
    async writeScope() {},
    async readIndex() { return null; },
    async writeIndex() {},
    async appendRecord() {},
    async readRecords() { return []; },
    async assembleContext() {
      return { core: {}, memories: [], currentMemory: null, scope: null };
    },
  };

  const confirm = {
    async confirmSplit() { return childMeta; },
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
      consolidation: { mode: 'everyNTurns', everyNTurns: 2 },
      integration: { mode: 'afterConsolidate' },
    }),
  });

  section('1. Tool Loop Turn');
  const turnResult = await engine.turn('Plan the feature');
  console.log(turnResult);

  section('2. Skill Ingest');
  console.log(await engine.ingest({
    role: 'user',
    content: 'please translate this paragraph',
    timestamp: new Date().toISOString(),
  }));

  section('3. Fork Session');
  console.log(await engine.forkSession({ label: 'UI Session', scope: 'design' }));

  section('4. Switch Session');
  console.log(await engine.switchSessionWithSchedule(childMeta.id));
  console.log('currentSessionId =', engine.currentSessionId);

  section('5. Archive Session');
  console.log(await engine.archiveSession(childMeta.id));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
