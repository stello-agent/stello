import 'dotenv/config'
import { rm } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import {
  NodeFileSystemAdapter,
  SessionTreeImpl,
  SkillRouterImpl,
  Scheduler,
  createStelloAgent,
  type ConfirmProtocol,
  type CoreSchema,
  type EngineLifecycleAdapter,
  type EngineToolRuntime,
  type MemoryEngine,
  type SessionMeta,
  type Skill,
  type SkillRouter,
  type TopologyNode,
  type SessionTree,
  type StelloAgentConfig,
  type TurnRecord,
  createDefaultConsolidateFn,
  createDefaultIntegrateFn,
  createSkillToolDefinition,
  executeSkillTool,
  loadSkillsFromDirectory,
  type LLMCallFn,
} from '../../packages/core/src/index'
import { startDevtools, type DevtoolsPersistedState, type DevtoolsStateStore } from '../../packages/devtools/src/index'
import {
  createOpenAICompatibleAdapter,
} from '../../packages/session/src/adapters/openai-compatible'
import { createSessionTool } from '../../packages/session/src/tools/create-session-tool'
import { loadMainSession } from '../../packages/session/src/create-main-session'
import { loadSession } from '../../packages/session/src/create-session'
import { InMemoryStorageAdapter } from '../../packages/session/src/mocks/in-memory-storage'
import type { MainSession } from '../../packages/session/src/types/main-session-api.ts'
import type { Session } from '../../packages/session/src/types/session-api.ts'
import type { SessionMeta as SessionComponentMeta } from '../../packages/session/src/types/session.ts'

const dataDir = './tmp/stello-agent-chat'
const dataDirAbs = resolve(process.cwd(), dataDir)
const host = process.env.DEMO_HOST ?? '127.0.0.1'

const openaiApiKey = process.env.OPENAI_API_KEY
const openaiBaseURL = process.env.OPENAI_BASE_URL ?? 'https://api.minimaxi.com/v1'
const openaiModel = process.env.OPENAI_MODEL ?? 'MiniMax-M2.7'
const openaiMaxContextTokens = Number(process.env.OPENAI_MAX_CONTEXT_TOKENS ?? 1_000_000)

if (!openaiApiKey) {
  console.error('Missing OPENAI_API_KEY')
  console.error('  export OPENAI_BASE_URL=https://api.minimaxi.com/v1')
  console.error('  export OPENAI_API_KEY=your_key')
  console.error('  export OPENAI_MODEL=MiniMax-M2.7')
  process.exit(1)
}

// ─── 留学选校提示词 ───

const MAIN_SYSTEM_PROMPT = `你是一位资深留学咨询顾问「Stello」。你帮助学生做全球选校规划。

## 你的工作方式
- 先了解学生背景（GPA、标化成绩、专业方向、预算、偏好）
- 当学生提到一个新的留学目标地区（如美国、英国、欧洲、亚洲、加拿大等），**主动调用 stello_create_session 工具**为该地区创建专门的子会话
- 你是总顾问，负责跨地区对比和最终推荐，不需要深入每个地区的细节——细节由各地区子会话的专家负责

## 工具使用规则
- 当对话中出现新的目标地区，**必须立即调用** stello_create_session
- 调用时必须提供：
  - label：子会话名称，如"美国选校"
  - systemPrompt：该地区专家的系统提示词，明确限定只负责该地区
- 如有必要，可以提供 prompt 作为子会话的第一条用户消息，帮助它立即进入工作状态
- 不要等用户明确要求，根据对话上下文主动判断

## 回答风格
- 中文为主，专业术语可附英文
- 简洁清晰，用列表和对比表格
- 在了解学生背景后，给出跨地区的综合建议`

function makeRegionPrompt(scope: string, label: string): string {
  return `你是「Stello」团队的${label}留学专家。你只负责 ${scope} 地区的选校咨询。

## 你的职责
- 根据学生背景推荐 ${scope} 地区的院校和项目
- 分析录取难度、学费、奖学金机会、就业前景
- 给出针对 ${scope} 的选校梯度建议（冲刺 / 稳妥 / 保底）

## 你能使用的工具
- stello_create_session：如果用户提到 ${scope} 内的更细分话题（如特定专业方向），可以创建子话题
- save_note：保存重要的调研结论供其他区域参考

## 回答风格
- 中文为主，院校名和专业名附英文原名
- 给出具体的学校列表和理由，不要泛泛而谈
- 主动询问学生偏好以缩小范围`
}

const CONSOLIDATE_PROMPT = `你是留学咨询记忆整理助手。请将以下对话提炼为一段简洁的选校调研摘要。

要求：
- 100-150 字，不要超过 150 字
- 聚焦本次对话的核心目标和关键成果
- 只保留已确认的结论，省略讨论过程和未决事项
- 格式：一段连贯的文字，不用列表或 Markdown 标记
- 语言风格：客观、精炼，像一条工作备忘`

const INTEGRATE_PROMPT = `你是留学咨询跨区域分析师。你收到了各个地区专家的选校调研摘要。

请：
1. 生成综合分析 (synthesis)：跨地区对比学生的选择，找出共性和差异，给出整体建议
2. 为每个子会话生成定向建议 (insights)：告诉各地区专家其他地区的发现，帮助他们调整推荐

输出 JSON 格式：
{
  "synthesis": "跨区域综合分析...",
  "insights": [
    { "sessionId": "xxx", "content": "来自其他区域的参考信息..." }
  ]
}`

// ─── 类型 ───

const schema: CoreSchema = {
  name: { type: 'string', default: '', bubbleable: true },
  goal: { type: 'string', default: '', bubbleable: true },
  topics: { type: 'array', default: [], bubbleable: true },
}

type DemoToolDef = Array<{
  name: string
  description: string
  inputSchema: Record<string, unknown>
}>

interface ChildSessionBootstrapOptions {
  parentId: string
  label: string
  scope?: string
  systemPrompt?: string
  prompt?: string
  metadata?: Record<string, unknown>
}

type WrappedSession = { session: Session; main?: never }
type WrappedMainSession = { main: MainSession; session?: never }

/** 判断当前是否为普通子会话。 */
function isStandardSession(session: Session | MainSession): session is Session {
  return 'insight' in session
}

/** 支持运行时启停的 SkillRouter 包装 */
class ToggleableSkillRouter implements SkillRouter {
  constructor(
    private readonly base: SkillRouter,
    private readonly disabledSkills: Set<string>,
  ) {}

  /** 注册 skill 到底层 router */
  register(skill: Skill): void {
    this.base.register(skill)
  }

  /** 按名称查找 skill，被禁用时返回 undefined */
  get(name: string): Skill | undefined {
    if (this.disabledSkills.has(name)) return undefined
    return this.base.get(name)
  }

  /** 列举时过滤掉被禁用项 */
  getAll(): Skill[] {
    return this.base.getAll().filter((skill) => !this.disabledSkills.has(skill.name))
  }
}

/** 同步子会话的 insight 到文件层镜像，避免 UI 和真实上下文状态分裂 */
async function syncSessionScopeMirror(
  coreSessionId: string,
  session: Session | MainSession,
  memoryEngine?: MemoryEngine,
): Promise<void> {
  if (!memoryEngine) return
  if (!isStandardSession(session)) return
  const insight = await session.insight()
  await memoryEngine.writeScope(coreSessionId, insight ?? '')
}

/** 读取持久化的 session system prompt */
async function readPersistedSystemPrompt(
  fs: NodeFileSystemAdapter,
  sessionId: string,
): Promise<string | null> {
  return fs.readJSON<string>(`memory/sessions/${sessionId}/system-prompt.json`).catch(() => null)
}

/** 写入持久化的 session system prompt */
async function writePersistedSystemPrompt(
  fs: NodeFileSystemAdapter,
  sessionId: string,
  content: string,
): Promise<void> {
  await fs.writeJSON(`memory/sessions/${sessionId}/system-prompt.json`, content)
}

/** 创建文件型 DevTools state store */
function createFileDevtoolsStateStore(fs: NodeFileSystemAdapter): DevtoolsStateStore {
  const path = 'memory/devtools-state.json'
  return {
    async load(): Promise<DevtoolsPersistedState | null> {
      return fs.readJSON<DevtoolsPersistedState>(path).catch(() => null)
    },
    async save(state: DevtoolsPersistedState): Promise<void> {
      await fs.writeJSON(path, state)
    },
    async reset(): Promise<void> {
      await fs.writeJSON(path, {})
    },
  }
}

/** 把 core session 元数据注册到 session storage，并按 core id 加载真实 Session */
async function registerStandardSession(
  fs: NodeFileSystemAdapter,
  storage: InMemoryStorageAdapter,
  sessionId: string,
  label: string,
  systemPrompt: string,
  llm: ReturnType<typeof createOpenAICompatibleAdapter>,
  tools: DemoToolDef,
): Promise<Session> {
  const now = new Date().toISOString()
  const meta: SessionComponentMeta = {
    id: sessionId,
    label,
    role: 'standard',
    status: 'active',
    tags: [],
    metadata: {},
    createdAt: now,
    updatedAt: now,
  }
  const effectiveSystemPrompt = (await readPersistedSystemPrompt(fs, sessionId)) ?? systemPrompt
  await storage.putSession(meta)
  await storage.putSystemPrompt(sessionId, effectiveSystemPrompt)
  const session = await loadSession(sessionId, { storage, llm, tools: [...tools] })
  if (!session) throw new Error(`Failed to load standard session: ${sessionId}`)
  return session
}

/** 把 core root 元数据注册到 session storage，并按 core id 加载真实 MainSession */
async function registerMainSession(
  fs: NodeFileSystemAdapter,
  storage: InMemoryStorageAdapter,
  sessionId: string,
  label: string,
  systemPrompt: string,
  llm: ReturnType<typeof createOpenAICompatibleAdapter>,
  tools: DemoToolDef,
): Promise<MainSession> {
  const now = new Date().toISOString()
  const meta: SessionComponentMeta = {
    id: sessionId,
    label,
    role: 'main',
    status: 'active',
    tags: [],
    metadata: {},
    createdAt: now,
    updatedAt: now,
  }
  const effectiveSystemPrompt = (await readPersistedSystemPrompt(fs, sessionId)) ?? systemPrompt
  await storage.putSession(meta)
  await storage.putSystemPrompt(sessionId, effectiveSystemPrompt)
  const session = await loadMainSession(sessionId, { storage, llm, tools: [...tools] })
  if (!session) throw new Error(`Failed to load main session: ${sessionId}`)
  return session
}

/** 把文件层镜像状态恢复到运行态 session storage */
async function hydrateRuntimeState(
  storage: InMemoryStorageAdapter,
  memory: MemoryEngine,
  sessionId: string,
): Promise<void> {
  const [records, l2, scope] = await Promise.all([
    memory.readRecords(sessionId).catch(() => []),
    memory.readMemory(sessionId).catch(() => null),
    memory.readScope(sessionId).catch(() => null),
  ])

  for (const record of records) {
    await storage.appendRecord(sessionId, {
      role: record.role,
      content: record.content,
      ...(record.metadata?.toolCallId && typeof record.metadata.toolCallId === 'string'
        ? { toolCallId: record.metadata.toolCallId }
        : {}),
      ...(Array.isArray(record.metadata?.toolCalls)
        ? { toolCalls: record.metadata.toolCalls as Array<{ id: string; name: string; input: Record<string, unknown> }> }
        : {}),
      timestamp: record.timestamp,
    })
  }
  if (l2) {
    await storage.putMemory(sessionId, l2)
  }
  if (scope) {
    await storage.putInsight(sessionId, scope)
  }
}

/** 创建子会话并同步拓扑、真实 Session 和初始上下文。 */
async function createDemoChildSession(
  fs: NodeFileSystemAdapter,
  sessions: SessionTreeImpl,
  storage: InMemoryStorageAdapter,
  llm: ReturnType<typeof createOpenAICompatibleAdapter>,
  tools: DemoToolDef,
  sessionMap: Map<string, WrappedSession | WrappedMainSession>,
  memory: MemoryEngine,
  options: ChildSessionBootstrapOptions,
): Promise<TopologyNode> {
  const child = await sessions.createChild({
    parentId: options.parentId,
    label: options.label,
    scope: options.scope,
    metadata: options.metadata,
  })
  const childSession = await registerStandardSession(
    fs,
    storage,
    child.id,
    child.label,
    options.systemPrompt ?? makeRegionPrompt(options.scope ?? child.label, child.label),
    llm,
    [...tools],
  )
  if (options.prompt) {
    const record = { role: 'assistant' as const, content: options.prompt, timestamp: new Date().toISOString() }
    await storage.appendRecord(child.id, record)
    await memory.appendRecord(child.id, record)
  }
  sessionMap.set(child.id, { session: childSession })
  return child
}

/** 把普通 Session 适配成 core 兼容接口。 */
function wrapStandardSession(coreSessionId: string, session: Session, memoryEngine?: MemoryEngine) {
  return {
    get meta() {
      return { id: coreSessionId, status: session.meta.status } as const
    },
    async send(content: string) {
      const result = await session.send(content)
      await syncSessionScopeMirror(coreSessionId, session, memoryEngine)
      return result
    },
    stream(content: string) {
      const source = session.stream(content)
      return {
        result: (async () => {
          const result = await source.result
          await syncSessionScopeMirror(coreSessionId, session, memoryEngine)
          return result
        })(),
        async *[Symbol.asyncIterator]() {
          for await (const chunk of source) {
            yield chunk
          }
        },
      }
    },
    async messages() { return session.messages() },
    async consolidate(fn: (currentMemory: string | null, messages: Array<{ role: string; content: string; timestamp?: string }>) => Promise<string>) {
      await session.consolidate(fn)
      /* 同步 L2 到文件持久化层（session 内部只写 InMemoryStorage） */
      if (memoryEngine) {
        const l2 = await session.memory()
        if (l2) await memoryEngine.writeMemory(coreSessionId, l2)
      }
    },
  }
}

/** 把 MainSession 适配成 core 兼容接口。 */
function wrapMainSession(coreSessionId: string, session: MainSession) {
  return {
    get meta() {
      return { id: coreSessionId, status: session.meta.status } as const
    },
    async send(content: string) {
      return session.send(content)
    },
    stream(content: string) {
      return session.stream(content)
    },
    async messages() { return session.messages() },
    async consolidate() {
      // MainSession 没有 L2 consolidation，调度到 root 时直接跳过。
    },
  }
}

// ─── MemoryEngine ───

function createFileMemoryEngine(fs: NodeFileSystemAdapter, sessions: SessionTreeImpl): MemoryEngine {
  const corePath = 'memory/core.json'
  const memPath = (id: string) => `memory/sessions/${id}/memory.json`
  const scopePath = (id: string) => `memory/sessions/${id}/scope.json`
  const indexPath = (id: string) => `memory/sessions/${id}/index.json`
  const recordsPath = (id: string) => `memory/sessions/${id}/records.json`

  return {
    async readCore(path?: string) {
      const data = (await fs.readJSON<Record<string, unknown>>(corePath)) ?? {
        name: schema.name?.default ?? '',

        goal: schema.goal?.default ?? '',

        topics: schema.topics?.default ?? [],
      }
      if (!path) return data
      return data?.[path]
    },
    async writeCore(path: string, value: unknown) {
      const data = await this.readCore() as Record<string, unknown>
      data[path] = value
      await fs.writeJSON(corePath, data)
    },
    async readMemory(sessionId: string) { return fs.readJSON<string>(memPath(sessionId)).catch(() => null) },
    async writeMemory(sessionId: string, content: string) { await fs.writeJSON(memPath(sessionId), content) },
    async readScope(sessionId: string) { return fs.readJSON<string>(scopePath(sessionId)).catch(() => null) },
    async writeScope(sessionId: string, content: string) { await fs.writeJSON(scopePath(sessionId), content) },
    async readIndex(sessionId: string) { return fs.readJSON<string>(indexPath(sessionId)).catch(() => null) },
    async writeIndex(sessionId: string, content: string) { await fs.writeJSON(indexPath(sessionId), content) },
    async appendRecord(sessionId: string, record: TurnRecord) {
      const list = (await fs.readJSON<TurnRecord[]>(recordsPath(sessionId))) ?? []
      list.push(record)
      await fs.writeJSON(recordsPath(sessionId), list)
    },
    async replaceRecords(sessionId: string, records: TurnRecord[]) {
      await fs.writeJSON(recordsPath(sessionId), records)
    },
    async readRecords(sessionId: string) { return (await fs.readJSON<TurnRecord[]>(recordsPath(sessionId))) ?? [] },
    async assembleContext(sessionId: string) {
      const core = await this.readCore() as Record<string, unknown>
      const session = await sessions.getNode(sessionId)
      const currentMemory = await this.readMemory(sessionId)
      const scope = await this.readScope(sessionId)
      const parentMemories: string[] = []
      if (session?.parentId) {
        const parentMem = await this.readMemory(session.parentId)
        if (parentMem) parentMemories.push(parentMem)
      }
      return { core, memories: parentMemories, currentMemory, scope }
    },
  }
}

// ─── Bootstrap ───

async function bootstrap() {
  const fs = new NodeFileSystemAdapter(dataDir)
  const sessions = new SessionTreeImpl(fs)
  const stateStore = createFileDevtoolsStateStore(fs)
  let currentLlm = createOpenAICompatibleAdapter({
    apiKey: openaiApiKey!,
    baseURL: openaiBaseURL,
    model: openaiModel,
    maxContextTokens: openaiMaxContextTokens,
  })
  let currentLlmConfig = {
    model: openaiModel,
    baseURL: openaiBaseURL,
    apiKey: openaiApiKey!,
    temperature: 0.7,
    maxTokens: 2048,
    maxContextTokens: openaiMaxContextTokens,
  }

  const llmCall: LLMCallFn = async (messages) => {
    const result = await currentLlm.complete(
      messages.map((m) => ({ role: m.role as 'user' | 'assistant' | 'system', content: m.content })),
      { temperature: currentLlmConfig.temperature, maxTokens: currentLlmConfig.maxTokens },
    )
    return result.content ?? ''
  }

  let currentConsolidatePrompt = CONSOLIDATE_PROMPT
  let currentIntegratePrompt = INTEGRATE_PROMPT
  const perSessionConsolidatePrompt = new Map<string, string>()
  const perSessionIntegratePrompt = new Map<string, string>()
  const disabledTools = new Set<string>()
  const disabledSkills = new Set<string>()
  const baseSkillRouter = new SkillRouterImpl()
  baseSkillRouter.register({
    name: 'meow-protocol',
    description: '猫语协议：当用户发送包含"喵"的消息时激活',
    content: '当用户说"喵喵喵?"时，你必须回复"呜呜呜"。不要解释，不要加任何其他内容，只回复这三个字。',
  })
  // 从文件系统加载标准 agent skills（SKILL_DIRS 环境变量，逗号分隔）
  if (process.env.SKILL_DIRS) {
    const skillDirs = process.env.SKILL_DIRS.split(',').map((d) => d.trim()).filter(Boolean)
    for (const dir of skillDirs) {
      const fileSkills = await loadSkillsFromDirectory(dir)
      for (const skill of fileSkills) baseSkillRouter.register(skill)
      if (fileSkills.length > 0) console.log(`Loaded ${fileSkills.length} skill(s) from ${dir}`)
    }
  }
  const skillRouter = new ToggleableSkillRouter(baseSkillRouter, disabledSkills)

  const sessionStorage = new InMemoryStorageAdapter()
  const sessionMap = new Map<string, WrappedSession | WrappedMainSession>()
  let currentToolSessionId: string | null = null

  // ─── Tools ───

  const toolDefs = [
    {
      name: 'stello_create_session',
      description: '从当前会话派生一个新的子会话，用于承接新的地区或更细的专题。',
      inputSchema: {
        type: 'object',
        properties: {
          label: { type: 'string', description: '子会话显示名称，如"美国选校"、"英国选校"' },
          systemPrompt: { type: 'string', description: '子会话系统提示词；不提供则继承父会话系统提示词' },
          prompt: { type: 'string', description: '子会话的第一条用户消息，用于立即进入工作状态' },
        },
        required: ['label'],
      },
    },
    {
      name: 'save_note',
      description: '保存重要的调研结论到当前会话的笔记中，供跨区域整合时参考。',
      inputSchema: {
        type: 'object',
        properties: {
          note: { type: 'string', description: '要保存的结论或笔记内容' },
        },
        required: ['note'],
      },
    },
  ] as const

  // 将 skill tool 转换为 demo toolDef 格式，加入 session 的 tool 列表
  const skillToolDef = createSkillToolDefinition(skillRouter)
  const skillToolEntry = {
    name: skillToolDef.name,
    description: skillToolDef.description,
    inputSchema: skillToolDef.parameters,
  }

  const memory = createFileMemoryEngine(fs, sessions)

  /* 复用已有 root 或创建 */
  let rootId: string
  let rootLabel: string
  try {
    const root = await sessions.getRoot()
    rootId = root.id
    rootLabel = root.label
  } catch {
    const root = await sessions.createRoot('留学总顾问')
    rootId = root.id
    rootLabel = root.label
  }

  const mainSession = await registerMainSession(
    fs,
    sessionStorage,
    rootId,
    rootLabel,
    MAIN_SYSTEM_PROMPT,
    currentLlm,
    [...toolDefs, skillToolEntry],
  )
  await hydrateRuntimeState(sessionStorage, memory, rootId)
  sessionMap.set(rootId, { main: mainSession })

  /* 恢复子 session */
  const allSessions = await sessions.listAll()
  for (const meta of allSessions) {
    if (meta.id === rootId || sessionMap.has(meta.id)) continue
    const childSession = await registerStandardSession(
      fs,
      sessionStorage,
      meta.id,
      meta.label,
      makeRegionPrompt(meta.scope ?? meta.label, meta.label),
      currentLlm,
      [...toolDefs, skillToolEntry],
    )
    await hydrateRuntimeState(sessionStorage, memory, meta.id)
    sessionMap.set(meta.id, { session: childSession })
  }
  if (allSessions.length > 1) console.log(`Restored ${allSessions.length - 1} region session(s)`)

  // ─── Lifecycle ───

  const lifecycle: EngineLifecycleAdapter = {
    bootstrap: async (sessionId) => ({
      context: await memory.assembleContext(sessionId),
      session: await requireSession(sessions, sessionId),
    }),
    afterTurn: async (sessionId, userMsg, assistantMsg) => {
      const entry = sessionMap.get(sessionId)
      const runtimeSession = entry
        ? ('main' in entry && entry.main ? entry.main : entry.session)
        : null
      if (runtimeSession && memory.replaceRecords) {
        const records = await runtimeSession.messages()
        await memory.replaceRecords(sessionId, records.map((record) => ({
          role: record.role,
          content: record.content,
          timestamp: record.timestamp ?? new Date().toISOString(),
          ...(record.toolCallId || record.toolCalls
            ? {
                metadata: {
                  ...(record.toolCallId ? { toolCallId: record.toolCallId } : {}),
                  ...(record.toolCalls ? { toolCalls: record.toolCalls } : {}),
                },
              }
            : {}),
        })))
      } else {
        await memory.appendRecord(sessionId, userMsg)
        await memory.appendRecord(sessionId, assistantMsg)
      }
      const current = await requireSession(sessions, sessionId)
      await sessions.updateMeta(sessionId, { turnCount: current.turnCount + 1 })
      return { coreUpdated: false, memoryUpdated: false, recordAppended: true }
    },
    prepareChildSpawn: async (options) => {
      return createDemoChildSession(
        fs,
        sessions,
        sessionStorage,
        currentLlm,
        [...toolDefs, skillToolEntry],
        sessionMap,
        memory,
        {
          parentId: options.parentId,
          label: options.label,
          scope: options.scope,
          metadata: options.metadata,
        },
      )
    },
  }

  // ─── Tool Runtime ───

  const allToolDefs = [
    ...toolDefs.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.inputSchema as Record<string, unknown>,
    })),
    skillToolDef,
  ]

  const tools: EngineToolRuntime = {
    getToolDefinitions: () => allToolDefs.filter((t) => !disabledTools.has(t.name)),
    async executeTool(name, args) {
      if (name === 'activate_skill') {
        return executeSkillTool(skillRouter, args as { name: string })
      }
      if (name === 'stello_create_session') {
        if (!currentToolSessionId) return { success: false, error: 'No active session context' }
        const source = await requireNode(sessions, currentToolSessionId)
        const effectiveParentId = source.parentId === null ? source.id : (await sessions.getRoot()).id
        const parentEntry = sessionMap.get(currentToolSessionId)
        if (!parentEntry) return { success: false, error: `Unknown session: ${currentToolSessionId}` }
        const parentSession = 'main' in parentEntry && parentEntry.main ? parentEntry.main : parentEntry.session
        const createTool = createSessionTool(() => ({
          fork: async (forkOptions) => {
            const child = await createDemoChildSession(
              fs,
              sessions,
              sessionStorage,
              currentLlm,
              [...toolDefs, skillToolEntry],
              sessionMap,
              memory,
              {
                parentId: effectiveParentId,
                label: forkOptions.label,
                systemPrompt: forkOptions.systemPrompt ?? await parentSession.systemPrompt() ?? undefined,
                prompt: forkOptions.prompt,
                metadata: { sourceSessionId: currentToolSessionId },
              },
            )
            const childEntry = sessionMap.get(child.id)
            if (!childEntry || !('session' in childEntry) || !childEntry.session) {
              throw new Error(`Failed to load child session: ${child.id}`)
            }
            return childEntry.session
          },
        } as Session))
        const result = await createTool.execute({
          label: String(args.label ?? '新会话'),
          ...(args.systemPrompt ? { systemPrompt: String(args.systemPrompt) } : {}),
          ...(args.prompt ? { prompt: String(args.prompt) } : {}),
        })
        const output = result.output as { sessionId: string; label: string }
        const child = await requireNode(sessions, output.sessionId)
        return {
          success: true,
          data: {
            sessionId: output.sessionId,
            label: output.label,
            parentId: child.parentId,
          },
        }
      }
      if (name === 'save_note') {
        if (!currentToolSessionId) return { success: false, error: 'No active session context' }
        const existingScope = await memory.readScope(currentToolSessionId).catch(() => null)
        const note = String(args.note ?? '')
        const updated = existingScope ? `${existingScope}\n\n---\n${note}` : note
        await memory.writeScope(currentToolSessionId, updated)
        return { success: true, data: { saved: true, sessionId: currentToolSessionId } }
      }
      return { success: false, error: `Unknown tool: ${name}` }
    },
  }

  // ─── Scheduler ───

  const scheduler = new Scheduler({
    consolidation: { trigger: 'everyNTurns', everyNTurns: 3 },
    integration: { trigger: 'afterConsolidate' },
  })

  // ─── Agent Config ───

  const confirm: ConfirmProtocol = {
    async confirmSplit(proposal) {
      return lifecycle.prepareChildSpawn({
        parentId: proposal.parentId,
        label: proposal.suggestedLabel,
        scope: proposal.suggestedScope,
      })
    },
    async dismissSplit() {},
    async confirmUpdate() {},
    async dismissUpdate() {},
  }

  const config: StelloAgentConfig = {
    sessions: sessions as SessionTree,
    memory,
    session: {
      sessionResolver: async (sessionId) => {
        const entry = sessionMap.get(sessionId)
        if (!entry) throw new Error(`Unknown session: ${sessionId}`)
        if ('main' in entry && entry.main) {
          return wrapMainSession(sessionId, entry.main)
        }
        return wrapStandardSession(sessionId, entry.session, memory)
      },
      mainSessionResolver: async () => ({
        async integrate(fn: Parameters<typeof mainSession.integrate>[0]) {
          const result = await mainSession.integrate(fn)
          /* 同步 synthesis + insights 到文件持久化层 */
          if (result) {
            await memory.writeMemory(rootId, result.synthesis)
            for (const { sessionId, content } of result.insights) {
              await memory.writeScope(sessionId, content)
            }
          }
          return result
        },
      }),
      consolidateFn: (currentMemory, messages) => {
        const fn = createDefaultConsolidateFn(currentConsolidatePrompt, llmCall)
        return fn(currentMemory, messages)
      },
      integrateFn: (children, currentSynthesis) => {
        const fn = createDefaultIntegrateFn(currentIntegratePrompt, llmCall)
        return fn(children, currentSynthesis)
      },
    },
    capabilities: {
      lifecycle,
      tools,
      skills: skillRouter,
      confirm,
    },
    orchestration: {
      scheduler,
      hooks: {
        onRoundStart({ sessionId }) { currentToolSessionId = sessionId },
        onRoundEnd({ sessionId, input, turn }) {
          currentToolSessionId = null
          const userRecord = { role: 'user' as const, content: input, timestamp: new Date().toISOString() }
          const assistantRecord = { role: 'assistant' as const, content: turn.finalContent ?? turn.rawResponse, timestamp: new Date().toISOString() }
          lifecycle.afterTurn(sessionId, userRecord, assistantRecord).catch(() => {})
        },
      },
    },
  }

  const agent = createStelloAgent(config)

  // ─── DevTools Providers ───

  return {
    agent, sessions, sessionMap,
    sessionAccess: {
      async getSystemPrompt(sessionId: string) {
        const entry = sessionMap.get(sessionId)
        if (!entry) return null
        const s = 'main' in entry && entry.main ? entry.main : entry.session
        return s.systemPrompt()
      },
      async setSystemPrompt(sessionId: string, content: string) {
        const entry = sessionMap.get(sessionId)
        if (!entry) return
        const s = 'main' in entry && entry.main ? entry.main : entry.session
        await s.setSystemPrompt(content)
        await writePersistedSystemPrompt(fs, sessionId, content)
      },
      async getConsolidatePrompt(sessionId: string) {
        return perSessionConsolidatePrompt.get(sessionId) ?? null
      },
      async setConsolidatePrompt(sessionId: string, content: string) {
        perSessionConsolidatePrompt.set(sessionId, content)
      },
      async getIntegratePrompt(sessionId: string) {
        return perSessionIntegratePrompt.get(sessionId) ?? null
      },
      async setIntegratePrompt(sessionId: string, content: string) {
        perSessionIntegratePrompt.set(sessionId, content)
      },
      async getScope(sessionId: string) {
        const entry = sessionMap.get(sessionId)
        if (!entry || ('main' in entry && entry.main)) return null
        return entry.session.insight()
      },
      async setScope(sessionId: string, content: string) {
        const entry = sessionMap.get(sessionId)
        if (!entry || ('main' in entry && entry.main)) return
        await entry.session.setInsight(content)
        await syncSessionScopeMirror(sessionId, entry.session, memory)
      },
      async injectRecord(sessionId: string, record: { role: string; content: string }) {
        await memory.appendRecord(sessionId, { role: record.role as 'user' | 'assistant', content: record.content, timestamp: new Date().toISOString() })
      },
    },
    prompts: {
      getPrompts: () => ({ consolidate: currentConsolidatePrompt, integrate: currentIntegratePrompt }),
      setPrompts: (p: { consolidate?: string; integrate?: string }) => {
        if (p.consolidate) currentConsolidatePrompt = p.consolidate
        if (p.integrate) currentIntegratePrompt = p.integrate
      },
    },
    llm: {
      getConfig: () => ({ ...currentLlmConfig }),
      setConfig: (cfg: { model: string; baseURL: string; apiKey?: string; temperature?: number; maxTokens?: number; maxContextTokens?: number }) => {
        const newLlm = createOpenAICompatibleAdapter({
          apiKey: cfg.apiKey ?? currentLlmConfig.apiKey,
          baseURL: cfg.baseURL,
          model: cfg.model,
          maxContextTokens: cfg.maxContextTokens ?? currentLlmConfig.maxContextTokens,
        })
        currentLlmConfig = {
          model: cfg.model,
          baseURL: cfg.baseURL,
          apiKey: cfg.apiKey ?? currentLlmConfig.apiKey,
          temperature: cfg.temperature ?? currentLlmConfig.temperature,
          maxTokens: cfg.maxTokens ?? currentLlmConfig.maxTokens,
          maxContextTokens: cfg.maxContextTokens ?? currentLlmConfig.maxContextTokens,
        }
        currentLlm = newLlm
        for (const entry of Array.from(sessionMap.values())) {
          const s = 'main' in entry && entry.main ? entry.main : entry.session
          s.setLLM(newLlm)
        }
        console.log(`[LLM] Switched to ${cfg.model} @ ${cfg.baseURL}`)
      },
    },
    tools: {
      getTools: () => allToolDefs.map((t) => ({ ...t, enabled: !disabledTools.has(t.name) })),
      setEnabled: (name: string, enabled: boolean) => { if (enabled) disabledTools.delete(name); else disabledTools.add(name) },
    },
    skills: {
      getSkills: () => baseSkillRouter.getAll().map((s) => ({ name: s.name, description: s.description, enabled: !disabledSkills.has(s.name) })),
      setEnabled: (name: string, enabled: boolean) => { if (enabled) disabledSkills.delete(name); else disabledSkills.add(name) },
    },
    integration: {
      async trigger() {
        const resolvedMain = await config.session!.mainSessionResolver?.()
        if (!resolvedMain) throw new Error('MainSession is not configured')
        const result = await resolvedMain.integrate(config.session!.integrateFn!) as {
          synthesis: string
          insights: Array<{ sessionId: string; content: string }>
        }
        console.log('[Integration] insights:', JSON.stringify(result.insights.map(i => ({ sessionId: i.sessionId, contentLen: i.content.length }))))
        console.log('[Integration] known sessionIds:', Array.from(sessionMap.keys()))
        return { synthesis: result.synthesis, insightCount: result.insights.length }
      },
    },
    stateStore,
  }
}

async function requireSession(sessions: SessionTreeImpl, sessionId: string): Promise<SessionMeta> {
  const session = await sessions.get(sessionId)
  if (!session) throw new Error(`Session not found: ${sessionId}`)
  return session
}

/** 读取拓扑节点，供需要 parentId 的场景使用 */
async function requireNode(sessions: SessionTreeImpl, sessionId: string): Promise<TopologyNode> {
  const session = await sessions.getNode(sessionId)
  if (!session) throw new Error(`Session node not found: ${sessionId}`)
  return session
}

async function main() {
  type DemoApp = Awaited<ReturnType<typeof bootstrap>>
  let currentApp: DemoApp = await bootstrap()

  if (process.env.DEMO_DRY_RUN === '1') {
    console.log('Bootstrap succeeded.')
    return
  }

  const agentProxy = new Proxy({}, {
    get(_target, prop) {
      const value = currentApp.agent[prop as keyof typeof currentApp.agent]
      return typeof value === 'function' ? value.bind(currentApp.agent) : value
    },
  })

  const llmProxy = {
    getConfig: () => currentApp.llm.getConfig(),
    setConfig: (config: Parameters<typeof currentApp.llm.setConfig>[0]) => currentApp.llm.setConfig(config),
  }

  const promptsProxy = {
    getPrompts: () => currentApp.prompts.getPrompts(),
    setPrompts: (prompts: Parameters<typeof currentApp.prompts.setPrompts>[0]) => currentApp.prompts.setPrompts(prompts),
  }

  const sessionAccessProxy = {
    getSystemPrompt: (sessionId: string) => currentApp.sessionAccess.getSystemPrompt(sessionId),
    setSystemPrompt: (sessionId: string, content: string) => currentApp.sessionAccess.setSystemPrompt(sessionId, content),
    getConsolidatePrompt: (sessionId: string) => currentApp.sessionAccess.getConsolidatePrompt?.(sessionId) ?? Promise.resolve(null),
    setConsolidatePrompt: (sessionId: string, content: string) => currentApp.sessionAccess.setConsolidatePrompt?.(sessionId, content) ?? Promise.resolve(),
    getIntegratePrompt: (sessionId: string) => currentApp.sessionAccess.getIntegratePrompt?.(sessionId) ?? Promise.resolve(null),
    setIntegratePrompt: (sessionId: string, content: string) => currentApp.sessionAccess.setIntegratePrompt?.(sessionId, content) ?? Promise.resolve(),
    getScope: (sessionId: string) => currentApp.sessionAccess.getScope?.(sessionId) ?? Promise.resolve(null),
    setScope: (sessionId: string, content: string) => currentApp.sessionAccess.setScope?.(sessionId, content) ?? Promise.resolve(),
    injectRecord: (sessionId: string, record: { role: string; content: string }) => currentApp.sessionAccess.injectRecord?.(sessionId, record) ?? Promise.resolve(),
  }

  const toolsProxy = {
    getTools: () => currentApp.tools.getTools(),
    setEnabled: (name: string, enabled: boolean) => currentApp.tools.setEnabled(name, enabled),
  }

  const skillsProxy = {
    getSkills: () => currentApp.skills.getSkills(),
    setEnabled: (name: string, enabled: boolean) => currentApp.skills.setEnabled(name, enabled),
  }

  const integrationProxy = {
    trigger: () => currentApp.integration.trigger(),
  }

  const stateStoreProxy = {
    load: () => currentApp.stateStore.load(),
    save: (state: DevtoolsPersistedState) => currentApp.stateStore.save(state),
    reset: () => currentApp.stateStore.reset?.() ?? Promise.resolve(),
  }

  const resetProxy = {
    async reset() {
      console.log('[Reset] clearing demo data and reinitializing...')
      if (basename(dataDirAbs) !== 'stello-agent-chat') {
        throw new Error(`Refusing to reset unexpected path: ${dataDirAbs}`)
      }
      await rm(dataDirAbs, { recursive: true, force: true })
      currentApp = await bootstrap()
      console.log('[Reset] demo reinitialized')
    },
    getDataDir() {
      return dataDirAbs
    },
  }

  const devtoolsPort = Number(process.env.DEVTOOLS_PORT ?? 4800)
  const dt = await startDevtools(agentProxy as never, {
    port: devtoolsPort,
    open: false,
    llm: llmProxy,
    prompts: promptsProxy,
    sessionAccess: sessionAccessProxy,
    tools: toolsProxy,
    skills: skillsProxy,
    integration: integrationProxy,
    reset: resetProxy,
    stateStore: stateStoreProxy,
  })

  console.log(`\nStello 留学选校顾问 Demo`)
  console.log(`  Model:    ${openaiModel}`)
  console.log(`  Base URL: ${openaiBaseURL}`)
  console.log(`  DevTools: http://${host}:${dt.port}`)
  console.log(`\n  试试说：「我想申请 CS 硕士，考虑美国和英国」\n`)
}

main().catch((error) => { console.error(error); process.exit(1) })
