import 'dotenv/config'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  NodeFileSystemAdapter,
  SessionTreeImpl,
  SkillRouterImpl,
  Scheduler,
  SplitGuard,
  createStelloAgent,
  type ConfirmProtocol,
  type CoreSchema,
  type EngineLifecycleAdapter,
  type EngineToolRuntime,
  type MemoryEngine,
  type SessionMeta,
  type SessionTree,
  type StelloAgentConfig,
  type TurnRecord,
  createDefaultConsolidateFn,
  createDefaultIntegrateFn,
  type LLMCallFn,
} from '../../packages/core/src/index'
import { startDevtools } from '../../packages/devtools/src/index'
import {
  createOpenAICompatibleAdapter,
} from '../../packages/session/src/adapters/openai-compatible.ts'
import { createMainSession } from '../../packages/session/src/create-main-session.ts'
import { createSession } from '../../packages/session/src/create-session.ts'
import { InMemoryStorageAdapter } from '../../packages/session/src/mocks/in-memory-storage.ts'
import type { MainSession } from '../../packages/session/src/types/main-session-api.ts'
import type { Session } from '../../packages/session/src/types/session-api.ts'

const dataDir = './tmp/stello-agent-chat'
const host = process.env.DEMO_HOST ?? '127.0.0.1'

const openaiApiKey = process.env.OPENAI_API_KEY
const openaiBaseURL = process.env.OPENAI_BASE_URL ?? 'https://api.minimaxi.com/v1'
const openaiModel = process.env.OPENAI_MODEL ?? 'MiniMax-M1'

if (!openaiApiKey) {
  console.error('Missing OPENAI_API_KEY')
  console.error('  export OPENAI_BASE_URL=https://api.minimaxi.com/v1')
  console.error('  export OPENAI_API_KEY=your_key')
  console.error('  export OPENAI_MODEL=MiniMax-M1')
  process.exit(1)
}

// ─── 留学选校提示词 ───

const MAIN_SYSTEM_PROMPT = `你是一位资深留学咨询顾问「Stello」。你帮助学生做全球选校规划。

## 你的工作方式
- 先了解学生背景（GPA、标化成绩、专业方向、预算、偏好）
- 当学生提到一个新的留学目标地区（如美国、英国、欧洲、亚洲、加拿大等），**主动调用 stello_create_session 工具**为该地区创建专门的子会话
- 你是总顾问，负责跨地区对比和最终推荐，不需要深入每个地区的细节——细节由各地区子会话的专家负责

## 工具使用规则
- 当对话中出现新的目标地区，**必须立即调用** stello_create_session，label 为地区名（如"美国选校"），scope 为地区关键词（如"美国"）
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

type WrappedSession = { session: Session; main?: never }
type WrappedMainSession = { main: MainSession; session?: never }

function wrapSession(coreSessionId: string, session: Session, memoryEngine?: MemoryEngine) {
  return {
    get meta() {
      return { id: coreSessionId, status: session.meta.status } as const
    },
    async send(content: string) { return session.send(content) },
    stream(content: string) { return session.stream(content) },
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
        name: schema.name.default, goal: schema.goal.default, topics: schema.topics.default,
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
    async readRecords(sessionId: string) { return (await fs.readJSON<TurnRecord[]>(recordsPath(sessionId))) ?? [] },
    async assembleContext(sessionId: string) {
      const core = await this.readCore() as Record<string, unknown>
      const session = await sessions.get(sessionId)
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
  let currentLlm = createOpenAICompatibleAdapter({ apiKey: openaiApiKey!, baseURL: openaiBaseURL, model: openaiModel, extraBody: { reasoning_split: true } })
  let currentLlmConfig = { model: openaiModel, baseURL: openaiBaseURL, apiKey: openaiApiKey!, temperature: 0.7, maxTokens: 2048 }

  const llmCall: LLMCallFn = async (messages) => {
    const result = await currentLlm.complete(
      messages.map((m) => ({ role: m.role as 'user' | 'assistant' | 'system', content: m.content })),
      { temperature: currentLlmConfig.temperature, maxTokens: currentLlmConfig.maxTokens },
    )
    return result.content
  }

  let currentConsolidatePrompt = CONSOLIDATE_PROMPT
  let currentIntegratePrompt = INTEGRATE_PROMPT
  const disabledTools = new Set<string>()
  const disabledSkills = new Set<string>()

  const sessionStorage = new InMemoryStorageAdapter()
  const sessionMap = new Map<string, WrappedSession | WrappedMainSession>()
  let currentToolSessionId: string | null = null

  // ─── Tools ───

  const toolDefs = [
    {
      name: 'stello_create_session',
      description: '为新的留学目标地区创建专门的调研子会话。当对话中出现新地区时必须调用。',
      inputSchema: {
        type: 'object',
        properties: {
          label: { type: 'string', description: '子会话显示名称，如"美国选校"、"英国选校"' },
          scope: { type: 'string', description: '地区关键词，如"美国"、"英国"、"欧洲"' },
        },
        required: ['label', 'scope'],
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

  const memory = createFileMemoryEngine(fs, sessions)

  /* 复用已有 root 或创建 */
  let root: SessionMeta
  try {
    root = await sessions.getRoot()
  } catch {
    root = await sessions.createRoot('留学总顾问')
  }

  const mainSession = await createMainSession({
    storage: sessionStorage,
    llm: currentLlm,
    label: root.label,
    systemPrompt: MAIN_SYSTEM_PROMPT,
    tools: [...toolDefs],
  })
  sessionMap.set(root.id, { main: mainSession })

  /* 恢复子 session */
  const allSessions = await sessions.listAll()
  for (const meta of allSessions) {
    if (meta.id === root.id || sessionMap.has(meta.id)) continue
    const childSession = await createSession({
      storage: sessionStorage,
      llm: currentLlm,
      label: meta.label,
      systemPrompt: makeRegionPrompt(meta.scope ?? meta.label, meta.label),
      tools: [...toolDefs],
    })
    sessionMap.set(meta.id, { session: childSession })
  }
  if (allSessions.length > 1) console.log(`Restored ${allSessions.length - 1} region session(s)`)

  // ─── Lifecycle ───

  const lifecycle: EngineLifecycleAdapter = {
    bootstrap: async (sessionId) => ({
      context: await memory.assembleContext(sessionId),
      session: await requireSession(sessions, sessionId),
    }),
    assemble: (sessionId) => memory.assembleContext(sessionId),
    afterTurn: async (sessionId, userMsg, assistantMsg) => {
      await memory.appendRecord(sessionId, userMsg)
      await memory.appendRecord(sessionId, assistantMsg)
      const current = await requireSession(sessions, sessionId)
      await sessions.updateMeta(sessionId, { turnCount: current.turnCount + 1 })
      return { coreUpdated: false, memoryUpdated: false, recordAppended: true }
    },
    prepareChildSpawn: async (options) => {
      const child = await sessions.createChild(options)
      const childSession = await createSession({
        storage: sessionStorage,
        llm: currentLlm,
        label: child.label,
        systemPrompt: makeRegionPrompt(child.scope ?? child.label, child.label),
        tools: [...toolDefs],
      })
      sessionMap.set(child.id, { session: childSession })
      return child
    },
  }

  // ─── Tool Runtime ───

  const allToolDefs = toolDefs.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.inputSchema as Record<string, unknown>,
  }))

  const tools: EngineToolRuntime = {
    getToolDefinitions: () => allToolDefs.filter((t) => !disabledTools.has(t.name)),
    async executeTool(name, args) {
      if (name === 'stello_create_session') {
        if (!currentToolSessionId) return { success: false, error: 'No active session context' }
        const source = await requireSession(sessions, currentToolSessionId)
        const effectiveParentId = source.parentId === null ? source.id : (await sessions.getRoot()).id
        const child = await lifecycle.prepareChildSpawn({
          parentId: effectiveParentId,
          label: String(args.label ?? '新地区'),
          scope: args.scope ? String(args.scope) : undefined,
        })
        return { success: true, data: { sessionId: child.id, label: child.label, scope: child.scope, parentId: child.parentId } }
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

  // ─── Scheduler + SplitGuard ───

  const scheduler = new Scheduler({
    consolidation: { trigger: 'everyNTurns', everyNTurns: 3 },
    integration: { trigger: 'afterConsolidate' },
  })

  const splitGuard = new SplitGuard(sessions, { minTurns: 2, cooldownTurns: 3 })

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
        if ('main' in entry && entry.main) return wrapSession(sessionId, entry.main, memory)
        return wrapSession(sessionId, entry.session, memory)
      },
      mainSessionResolver: async () => ({
        ...mainSession,
        async integrate(fn: Parameters<typeof mainSession.integrate>[0]) {
          const result = await mainSession.integrate(fn)
          /* 同步 synthesis + insights 到文件持久化层 */
          if (result) {
            await memory.writeMemory(root.id, result.synthesis)
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
      skills: new SkillRouterImpl(),
      confirm,
    },
    runtime: { recyclePolicy: { idleTtlMs: 60_000 } },
    orchestration: {
      scheduler,
      splitGuard,
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
      },
      async getScope(sessionId: string) { return memory.readScope(sessionId) },
      async setScope(sessionId: string, content: string) { await memory.writeScope(sessionId, content) },
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
      setConfig: (cfg: { model: string; baseURL: string; apiKey?: string; temperature?: number; maxTokens?: number }) => {
        const newLlm = createOpenAICompatibleAdapter({ apiKey: cfg.apiKey ?? currentLlmConfig.apiKey, baseURL: cfg.baseURL, model: cfg.model, extraBody: { reasoning_split: true } })
        currentLlmConfig = { model: cfg.model, baseURL: cfg.baseURL, apiKey: cfg.apiKey ?? currentLlmConfig.apiKey, temperature: cfg.temperature ?? currentLlmConfig.temperature, maxTokens: cfg.maxTokens ?? currentLlmConfig.maxTokens }
        currentLlm = newLlm
        for (const entry of sessionMap.values()) {
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
      getSkills: () => config.capabilities.skills.getAll().map((s) => ({ name: s.name, description: s.description, enabled: !disabledSkills.has(s.name) })),
      setEnabled: (name: string, enabled: boolean) => { if (enabled) disabledSkills.delete(name); else disabledSkills.add(name) },
    },
    integration: {
      async trigger() {
        const integrateFn = config.session!.integrateFn!
        const allL2s: Array<{ sessionId: string; label: string; l2: string }> = []
        for (const [id, entry] of sessionMap) {
          if ('main' in entry && entry.main) continue
          const l2 = await memory.readMemory(id).catch(() => null)
          if (l2) {
            const meta = await sessions.get(id)
            allL2s.push({ sessionId: id, label: meta?.label ?? id, l2 })
          }
        }
        const currentSynthesis = await memory.readMemory(root.id).catch(() => null)
        const result = await integrateFn(allL2s, currentSynthesis)
        await memory.writeMemory(root.id, result.synthesis)
        console.log('[Integration] insights:', JSON.stringify(result.insights.map(i => ({ sessionId: i.sessionId, contentLen: i.content.length }))))
        console.log('[Integration] known sessionIds:', [...sessionMap.keys()])
        for (const { sessionId, content } of result.insights) await memory.writeScope(sessionId, content)
        return { synthesis: result.synthesis, insightCount: result.insights.length }
      },
    },
  }
}

async function requireSession(sessions: SessionTreeImpl, sessionId: string): Promise<SessionMeta> {
  const session = await sessions.get(sessionId)
  if (!session) throw new Error(`Session not found: ${sessionId}`)
  return session
}

async function main() {
  const app = await bootstrap()

  if (process.env.DEMO_DRY_RUN === '1') {
    console.log('Bootstrap succeeded.')
    return
  }

  const devtoolsPort = Number(process.env.DEVTOOLS_PORT ?? 4800)
  const dt = await startDevtools(app.agent, {
    port: devtoolsPort,
    open: false,
    llm: app.llm,
    prompts: app.prompts,
    sessionAccess: app.sessionAccess,
    tools: app.tools,
    skills: app.skills,
    integration: app.integration,
  })

  console.log(`\nStello 留学选校顾问 Demo`)
  console.log(`  Model:    ${openaiModel}`)
  console.log(`  Base URL: ${openaiBaseURL}`)
  console.log(`  DevTools: http://${host}:${dt.port}`)
  console.log(`\n  试试说：「我想申请 CS 硕士，考虑美国和英国」\n`)
}

main().catch((error) => { console.error(error); process.exit(1) })
