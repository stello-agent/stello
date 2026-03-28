import { Hono } from 'hono'
import type { StelloAgent, StelloAgentHotConfig } from '@stello-ai/core'
import type { LLMConfigProvider, PromptProvider, SessionAccessProvider, ToolsProvider, SkillsProvider, IntegrationProvider, ResetProvider, DevtoolsPersistedState, DevtoolsStateStore } from './types.js'

/** 让主 session 固定排第一，其余保持原始顺序 */
async function orderSessionsWithMainFirst(agent: StelloAgent) {
  const [all, root] = await Promise.all([
    agent.sessions.listAll(),
    agent.sessions.getRoot().catch(() => null),
  ])
  if (!root) return all

  const indexed = all.map((session, index) => ({ session, index }))
  indexed.sort((a, b) => {
    if (a.session.id === root.id && b.session.id !== root.id) return -1
    if (a.session.id !== root.id && b.session.id === root.id) return 1
    return a.index - b.index
  })
  return indexed.map(({ session }) => session)
}

/** 全局错误处理 */
function withErrorHandler(app: Hono): void {
  app.onError((err, c) => {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[devtools]', c.req.method, c.req.path, message)
    return c.json({ error: message }, 500)
  })
}

/** 合法的 consolidation trigger 值 */
const CONSOLIDATION_TRIGGERS = new Set(['manual', 'everyNTurns', 'onSwitch', 'onArchive', 'onLeave'])

/** 合法的 integration trigger 值 */
const INTEGRATION_TRIGGERS = new Set(['manual', 'afterConsolidate', 'everyNTurns', 'onSwitch', 'onArchive', 'onLeave'])

/** 序列化 agent 配置为 JSON 快照 */
function serializeConfig(agent: StelloAgent) {
  const config = agent.config
  const schedulerConfig = config.orchestration?.scheduler?.getConfig?.()
  const splitGuardConfig = config.orchestration?.splitGuard?.getConfig?.()

  const hooksProvider = config.orchestration?.hooks
  let hookKeys: string[] = []
  if (typeof hooksProvider === 'function') {
    hookKeys = ['(per-session factory)']
  } else if (hooksProvider) {
    hookKeys = Object.keys(hooksProvider)
  }

  return {
    orchestration: {
      strategy: config.orchestration?.strategy?.constructor?.name ?? 'MainSessionFlatStrategy',
      hasMainSession: !!config.orchestration?.mainSession,
      hasTurnRunner: !!config.orchestration?.turnRunner,
    },
    runtime: {
      idleTtlMs: config.runtime?.recyclePolicy?.idleTtlMs ?? 0,
      hasResolver: !!config.runtime?.resolver,
    },
    scheduling: {
      consolidation: schedulerConfig?.consolidation ?? { trigger: 'manual' },
      integration: schedulerConfig?.integration ?? { trigger: 'manual' },
      hasScheduler: !!config.orchestration?.scheduler,
    },
    splitGuard: splitGuardConfig ?? null,
    session: {
      hasSessionResolver: !!config.session?.sessionResolver,
      hasMainSessionResolver: !!config.session?.mainSessionResolver,
      hasConsolidateFn: !!config.session?.consolidateFn,
      hasIntegrateFn: !!config.session?.integrateFn,
      hasSerializeSendResult: !!config.session?.serializeSendResult,
      hasToolCallParser: !!config.session?.toolCallParser,
      options: config.session?.options ?? null,
    },
    capabilities: {
      tools: config.capabilities.tools.getToolDefinitions(),
      skills: config.capabilities.skills.getAll().map((s) => ({
        name: s.name,
        description: s.description,
      })),
      hasLifecycle: !!config.capabilities.lifecycle,
      hasConfirm: !!config.capabilities.confirm,
    },
    hooks: hookKeys,
  }
}

/** 提取可持久化的热更新配置子集。 */
function serializeHotConfig(agent: StelloAgent): StelloAgentHotConfig {
  const config = agent.config
  const schedulerConfig = config.orchestration?.scheduler?.getConfig?.()
  const splitGuardConfig = config.orchestration?.splitGuard?.getConfig?.()

  return {
    runtime: {
      idleTtlMs: config.runtime?.recyclePolicy?.idleTtlMs ?? 0,
    },
    scheduling: {
      consolidation: schedulerConfig?.consolidation ?? { trigger: 'manual' },
      integration: schedulerConfig?.integration ?? { trigger: 'manual' },
    },
    splitGuard: splitGuardConfig ?? undefined,
  }
}

/** 组装当前 DevTools 的可持久化状态。 */
function buildPersistedState(
  agent: StelloAgent,
  llmProvider?: LLMConfigProvider,
  promptProvider?: PromptProvider,
  toolsProvider?: ToolsProvider,
  skillsProvider?: SkillsProvider,
): DevtoolsPersistedState {
  return {
    hotConfig: serializeHotConfig(agent),
    llm: llmProvider
      ? (() => {
          const llm = llmProvider.getConfig()
          return {
            model: llm.model,
            baseURL: llm.baseURL,
            temperature: llm.temperature,
            maxTokens: llm.maxTokens,
          }
        })()
      : undefined,
    prompts: promptProvider?.getPrompts(),
    disabledTools: toolsProvider?.getTools().filter((tool) => !tool.enabled).map((tool) => tool.name) ?? [],
    disabledSkills: skillsProvider?.getSkills().filter((skill) => !skill.enabled).map((skill) => skill.name) ?? [],
  }
}

/** 非流式 turn 的 tool call 展示项。 */
interface TurnToolCallDetail {
  id: string
  name: string
  args: Record<string, unknown>
  success?: boolean
  data?: unknown
  error?: string | null
  duration?: number
}

type AgentTurnResponse = Awaited<ReturnType<StelloAgent['turn']>>
type DevtoolsTurnResponse = Omit<AgentTurnResponse, 'turn'> & {
  turn: AgentTurnResponse['turn'] & {
    toolCalls?: TurnToolCallDetail[]
  }
}

/** 创建 DevTools REST 路由 */
export function createRoutes(
  agent: StelloAgent,
  onEvent?: (event: { type: string; sessionId?: string; data?: Record<string, unknown> }) => void,
  getEventHistory?: () => Array<{ type: string; sessionId?: string; timestamp: string; data?: Record<string, unknown> }>,
  llmProvider?: LLMConfigProvider,
  promptProvider?: PromptProvider,
  sessionAccessProvider?: SessionAccessProvider,
  toolsProvider?: ToolsProvider,
  skillsProvider?: SkillsProvider,
  integrationProvider?: IntegrationProvider,
  resetProvider?: ResetProvider,
  stateStore?: DevtoolsStateStore,
): Hono {
  const app = new Hono()
  withErrorHandler(app)

  /** 获取完整 session 树（递归 SessionTreeNode） */
  app.get('/sessions/tree', async (c) => {
    const tree = await agent.sessions.getTree()
    return c.json(tree)
  })

  /** 获取所有 session 列表（扁平 SessionMeta[]） */
  app.get('/sessions', async (c) => {
    const all = await orderSessionsWithMainFirst(agent)
    return c.json({ sessions: all })
  })

  /** 获取单个 session 元数据 */
  app.get('/sessions/:id', async (c) => {
    const id = c.req.param('id')
    const meta = await agent.sessions.get(id)
    if (!meta) return c.json({ error: 'Session not found' }, 404)
    return c.json(meta)
  })

  /** 获取单个 session 的拓扑节点 */
  app.get('/sessions/:id/node', async (c) => {
    const id = c.req.param('id')
    const node = await agent.sessions.getNode(id)
    if (!node) return c.json({ error: 'Node not found' }, 404)
    return c.json(node)
  })

  /** 获取 session 详细数据（L3/L2/insight-scope） */
  app.get('/sessions/:id/detail', async (c) => {
    const id = c.req.param('id')
    const memory = agent.config.memory
    const [meta, records, l2, mirroredScope, liveScope] = await Promise.all([
      agent.sessions.get(id),
      memory.readRecords(id).catch(() => []),
      memory.readMemory(id).catch(() => null),
      memory.readScope(id).catch(() => null),
      sessionAccessProvider?.getScope ? sessionAccessProvider.getScope(id).catch(() => null) : Promise.resolve(null),
    ])
    if (!meta) return c.json({ error: 'Session not found' }, 404)
    const scope = liveScope ?? mirroredScope
    return c.json({ meta, records, l2, scope })
  })

  /** 手动触发 consolidation（L3 → L2） */
  app.post('/sessions/:id/consolidate', async (c) => {
    const id = c.req.param('id')
    const memory = agent.config.memory
    const consolidateFn = agent.config.session?.consolidateFn
    if (!consolidateFn) {
      return c.json({ error: 'No consolidateFn configured' }, 400)
    }
    const records = await memory.readRecords(id)
    if (records.length === 0) {
      return c.json({ error: 'No records to consolidate' }, 400)
    }
    const currentMemory = await memory.readMemory(id).catch(() => null)
    const messages = records.map((r) => ({ role: r.role, content: r.content, timestamp: r.timestamp }))
    onEvent?.({ type: 'consolidate.start', sessionId: id })
    const l2 = await consolidateFn(currentMemory, messages)
    await memory.writeMemory(id, l2)
    onEvent?.({ type: 'consolidate.done', sessionId: id, data: { l2Length: l2.length } })
    return c.json({ ok: true, l2 })
  })

  /** 进入 session */
  app.post('/sessions/:id/enter', async (c) => {
    const id = c.req.param('id')
    const result = await agent.enterSession(id)
    return c.json(result)
  })

  /** 流式对话（NDJSON，含 tool call 事件） */
  app.post('/sessions/:id/stream', async (c) => {
    const id = c.req.param('id')
    const { input } = await c.req.json<{ input: string }>()
    try {
      const encoder = new TextEncoder()
      const toolCallTimers = new Map<string, number>()

      /* 先用 let 声明 controller，在 ReadableStream 回调中赋值 */
      let ctrl: ReadableStreamDefaultController<Uint8Array> | null = null
      const emit = (data: Record<string, unknown>) => {
        ctrl?.enqueue(encoder.encode(JSON.stringify(data) + '\n'))
      }

      const stream = await agent.stream(id, input, {
        onToolCall: (toolCall) => {
          const callId = toolCall.id ?? toolCall.name
          toolCallTimers.set(callId, Date.now())
          emit({ type: 'tool_call', toolCall: { id: callId, name: toolCall.name, args: toolCall.args } })
        },
        onToolResult: (result) => {
          const callId = result.toolCallId ?? result.toolName
          const startTime = toolCallTimers.get(callId)
          const duration = startTime ? Date.now() - startTime : undefined
          toolCallTimers.delete(callId)
          emit({
            type: 'tool_result',
            result: {
              toolCallId: callId,
              toolName: result.toolName,
              success: result.success,
              data: result.data,
              error: result.error,
              duration,
            },
          })
        },
      })

      const readable = new ReadableStream({
        async start(controller) {
          ctrl = controller
          try {
            for await (const chunk of stream) {
              emit({ type: 'delta', delta: chunk })
            }
            const result = await stream.result
            emit({ type: 'done', result })
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            emit({ type: 'error', error: msg })
          } finally {
            controller.close()
          }
        },
      })
      return new Response(readable, {
        headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache' },
      })
    } catch {
      /* agent.stream 不可用，fallback 到非流式 */
      const result = await agent.turn(id, input)
      return c.json(result)
    }
  })

  /** 非流式对话 */
  app.post('/sessions/:id/turn', async (c) => {
    const id = c.req.param('id')
    const { input } = await c.req.json<{ input: string }>()
    const toolCallTimers = new Map<string, number>()
    const toolCalls: TurnToolCallDetail[] = []
    const result = await agent.turn(id, input, {
      onToolCall: (toolCall) => {
        const callId = toolCall.id ?? toolCall.name
        toolCallTimers.set(callId, Date.now())
        toolCalls.push({
          id: callId,
          name: toolCall.name,
          args: toolCall.args,
        })
      },
      onToolResult: (toolResult) => {
        const callId = toolResult.toolCallId ?? toolResult.toolName
        const startTime = toolCallTimers.get(callId)
        const duration = startTime ? Date.now() - startTime : undefined
        toolCallTimers.delete(callId)
        const target = toolCalls.find((toolCall) => toolCall.id === callId)
        if (!target) return
        target.success = toolResult.success
        target.data = toolResult.data
        target.error = toolResult.error
        target.duration = duration
      },
    })
    const response: DevtoolsTurnResponse = toolCalls.length > 0
      ? {
          ...result,
          turn: {
            ...result.turn,
            toolCalls,
          },
        }
      : result
    return c.json(response)
  })

  /** 离开 session */
  app.post('/sessions/:id/leave', async (c) => {
    const id = c.req.param('id')
    const result = await agent.leaveSession(id)
    return c.json(result)
  })

  /** Fork session */
  app.post('/sessions/:id/fork', async (c) => {
    const id = c.req.param('id')
    const options = await c.req.json<{ label: string; scope?: string }>()
    const child = await agent.forkSession(id, options)
    return c.json(child)
  })

  /** 归档 session */
  app.post('/sessions/:id/archive', async (c) => {
    const id = c.req.param('id')
    await agent.archiveSession(id)
    return c.json({ ok: true })
  })

  /** 获取 agent 配置（完整只读序列化） */
  app.get('/config', (c) => {
    return c.json(serializeConfig(agent))
  })

  /** 热更新 agent 配置（仅值类型字段） */
  app.patch('/config', async (c) => {
    const body = await c.req.json<{
      runtime?: { idleTtlMs?: number }
      scheduling?: {
        consolidation?: { trigger?: string; everyNTurns?: number }
        integration?: { trigger?: string; everyNTurns?: number }
      }
      splitGuard?: { minTurns?: number; cooldownTurns?: number }
    }>()

    /* 输入校验 */
    const errors: string[] = []
    if (body.runtime?.idleTtlMs !== undefined && (typeof body.runtime.idleTtlMs !== 'number' || body.runtime.idleTtlMs < 0)) {
      errors.push('runtime.idleTtlMs must be a non-negative number')
    }
    if (body.scheduling?.consolidation?.trigger && !CONSOLIDATION_TRIGGERS.has(body.scheduling.consolidation.trigger)) {
      errors.push(`scheduling.consolidation.trigger must be one of: ${[...CONSOLIDATION_TRIGGERS].join(', ')}`)
    }
    if (body.scheduling?.integration?.trigger && !INTEGRATION_TRIGGERS.has(body.scheduling.integration.trigger)) {
      errors.push(`scheduling.integration.trigger must be one of: ${[...INTEGRATION_TRIGGERS].join(', ')}`)
    }
    if (body.scheduling?.consolidation?.everyNTurns !== undefined && (typeof body.scheduling.consolidation.everyNTurns !== 'number' || body.scheduling.consolidation.everyNTurns < 1)) {
      errors.push('scheduling.consolidation.everyNTurns must be a positive integer')
    }
    if (body.scheduling?.integration?.everyNTurns !== undefined && (typeof body.scheduling.integration.everyNTurns !== 'number' || body.scheduling.integration.everyNTurns < 1)) {
      errors.push('scheduling.integration.everyNTurns must be a positive integer')
    }
    if (body.splitGuard?.minTurns !== undefined && (typeof body.splitGuard.minTurns !== 'number' || body.splitGuard.minTurns < 0)) {
      errors.push('splitGuard.minTurns must be a non-negative number')
    }
    if (body.splitGuard?.cooldownTurns !== undefined && (typeof body.splitGuard.cooldownTurns !== 'number' || body.splitGuard.cooldownTurns < 0)) {
      errors.push('splitGuard.cooldownTurns must be a non-negative number')
    }
    if (errors.length > 0) {
      return c.json({ error: errors.join('; ') }, 400)
    }

    /* 构建热更新 patch */
    const patch: StelloAgentHotConfig = {}
    if (body.runtime) patch.runtime = body.runtime
    if (body.scheduling) patch.scheduling = body.scheduling as StelloAgentHotConfig['scheduling']
    if (body.splitGuard) patch.splitGuard = body.splitGuard

    agent.updateConfig(patch)
    if (stateStore) {
      await stateStore.save(buildPersistedState(agent, llmProvider, promptProvider, toolsProvider, skillsProvider))
    }
    onEvent?.({ type: 'config.updated', data: body as Record<string, unknown> })

    return c.json({ ok: true, config: serializeConfig(agent) })
  })

  /** 获取当前 LLM 配置 */
  app.get('/llm', (c) => {
    if (!llmProvider) return c.json({ configured: false })
    return c.json({ configured: true, ...llmProvider.getConfig() })
  })

  /** 切换 LLM 配置 */
  app.patch('/llm', async (c) => {
    if (!llmProvider) return c.json({ error: 'LLM provider not configured — pass llm option to startDevtools()' }, 400)
    const body = await c.req.json<{ model?: string; baseURL?: string; apiKey?: string; temperature?: number; maxTokens?: number }>()
    if (
      body.model === undefined &&
      body.baseURL === undefined &&
      body.apiKey === undefined &&
      body.temperature === undefined &&
      body.maxTokens === undefined
    ) {
      return c.json({ error: 'At least one of model, baseURL, apiKey, temperature, maxTokens is required' }, 400)
    }
    const current = llmProvider.getConfig()
    llmProvider.setConfig({
      model: body.model ?? current.model,
      baseURL: body.baseURL ?? current.baseURL,
      apiKey: body.apiKey ?? current.apiKey,
      temperature: body.temperature ?? current.temperature,
      maxTokens: body.maxTokens ?? current.maxTokens,
    })
    if (stateStore) {
      await stateStore.save(buildPersistedState(agent, llmProvider, promptProvider, toolsProvider, skillsProvider))
    }
    onEvent?.({
      type: 'llm.updated',
      data: {
        model: body.model,
        baseURL: body.baseURL,
        temperature: body.temperature,
        maxTokens: body.maxTokens,
      },
    })
    return c.json({ ok: true, configured: true, ...llmProvider.getConfig() })
  })

  /** 获取 Consolidation/Integration 提示词 */
  app.get('/prompts', (c) => {
    if (!promptProvider) return c.json({ configured: false })
    return c.json({ configured: true, ...promptProvider.getPrompts() })
  })

  /** 更新 Consolidation/Integration 提示词 */
  app.patch('/prompts', async (c) => {
    if (!promptProvider) return c.json({ error: 'Prompt provider not configured' }, 400)
    const body = await c.req.json<{ consolidate?: string; integrate?: string }>()
    promptProvider.setPrompts(body)
    if (stateStore) {
      await stateStore.save(buildPersistedState(agent, llmProvider, promptProvider, toolsProvider, skillsProvider))
    }
    onEvent?.({ type: 'prompts.updated' })
    return c.json({ ok: true, configured: true, ...promptProvider.getPrompts() })
  })

  /** 获取 session 的 system prompt */
  app.get('/sessions/:id/system-prompt', async (c) => {
    if (!sessionAccessProvider) return c.json({ configured: false, content: null })
    const id = c.req.param('id')
    const content = await sessionAccessProvider.getSystemPrompt(id)
    return c.json({ configured: true, content })
  })

  /** 更新 session 的 system prompt */
  app.put('/sessions/:id/system-prompt', async (c) => {
    if (!sessionAccessProvider) return c.json({ error: 'Session access not configured' }, 400)
    const id = c.req.param('id')
    const { content } = await c.req.json<{ content: string }>()
    if (typeof content !== 'string') return c.json({ error: 'content must be a string' }, 400)
    await sessionAccessProvider.setSystemPrompt(id, content)
    onEvent?.({ type: 'system-prompt.updated', sessionId: id })
    return c.json({ ok: true })
  })

  /** 获取 session 的 consolidate prompt */
  app.get('/sessions/:id/consolidate-prompt', async (c) => {
    if (!sessionAccessProvider?.getConsolidatePrompt) return c.json({ configured: false, content: null })
    const id = c.req.param('id')
    const content = await sessionAccessProvider.getConsolidatePrompt(id)
    return c.json({ configured: true, content })
  })

  /** 更新 session 的 consolidate prompt */
  app.put('/sessions/:id/consolidate-prompt', async (c) => {
    if (!sessionAccessProvider?.setConsolidatePrompt) return c.json({ error: 'Consolidate prompt editing not configured' }, 400)
    const id = c.req.param('id')
    const { content } = await c.req.json<{ content: string }>()
    if (typeof content !== 'string') return c.json({ error: 'content must be a string' }, 400)
    await sessionAccessProvider.setConsolidatePrompt(id, content)
    onEvent?.({ type: 'consolidate-prompt.updated', sessionId: id })
    return c.json({ ok: true })
  })

  /** 获取 session 的 integrate prompt */
  app.get('/sessions/:id/integrate-prompt', async (c) => {
    if (!sessionAccessProvider?.getIntegratePrompt) return c.json({ configured: false, content: null })
    const id = c.req.param('id')
    const content = await sessionAccessProvider.getIntegratePrompt(id)
    return c.json({ configured: true, content })
  })

  /** 更新 session 的 integrate prompt */
  app.put('/sessions/:id/integrate-prompt', async (c) => {
    if (!sessionAccessProvider?.setIntegratePrompt) return c.json({ error: 'Integrate prompt editing not configured' }, 400)
    const id = c.req.param('id')
    const { content } = await c.req.json<{ content: string }>()
    if (typeof content !== 'string') return c.json({ error: 'content must be a string' }, 400)
    await sessionAccessProvider.setIntegratePrompt(id, content)
    onEvent?.({ type: 'integrate-prompt.updated', sessionId: id })
    return c.json({ ok: true })
  })

  /** 读取 session 的 scope/insights */
  app.get('/sessions/:id/scope', async (c) => {
    if (!sessionAccessProvider?.getScope) return c.json({ configured: false, content: null })
    const id = c.req.param('id')
    const content = await sessionAccessProvider.getScope(id)
    return c.json({ configured: true, content })
  })

  /** 写入 session 的 scope/insights */
  app.put('/sessions/:id/scope', async (c) => {
    if (!sessionAccessProvider?.setScope) return c.json({ error: 'Scope editing not configured' }, 400)
    const id = c.req.param('id')
    const { content } = await c.req.json<{ content: string }>()
    await sessionAccessProvider.setScope(id, content)
    onEvent?.({ type: 'scope.updated', sessionId: id })
    return c.json({ ok: true })
  })

  /** 注入一条对话记录到 L3 */
  app.post('/sessions/:id/inject-record', async (c) => {
    if (!sessionAccessProvider?.injectRecord) return c.json({ error: 'Record injection not configured' }, 400)
    const id = c.req.param('id')
    const { role, content } = await c.req.json<{ role: string; content: string }>()
    if (!role || !content) return c.json({ error: 'role and content are required' }, 400)
    await sessionAccessProvider.injectRecord(id, { role, content })
    onEvent?.({ type: 'record.injected', sessionId: id })
    return c.json({ ok: true })
  })

  /** 获取 tools 列表（含启用状态） */
  app.get('/tools', (c) => {
    if (!toolsProvider) return c.json({ configured: false, tools: [] })
    return c.json({ configured: true, tools: toolsProvider.getTools() })
  })

  /** 切换 tool 启用/禁用 */
  app.patch('/tools/:name', async (c) => {
    if (!toolsProvider) return c.json({ error: 'Tools provider not configured' }, 400)
    const name = c.req.param('name')
    const { enabled } = await c.req.json<{ enabled: boolean }>()
    toolsProvider.setEnabled(name, enabled)
    if (stateStore) {
      await stateStore.save(buildPersistedState(agent, llmProvider, promptProvider, toolsProvider, skillsProvider))
    }
    onEvent?.({ type: 'tool.toggled', data: { name, enabled } })
    return c.json({ ok: true, tools: toolsProvider.getTools() })
  })

  /** 获取 skills 列表（含启用状态） */
  app.get('/skills', (c) => {
    if (!skillsProvider) return c.json({ configured: false, skills: [] })
    return c.json({ configured: true, skills: skillsProvider.getSkills() })
  })

  /** 切换 skill 启用/禁用 */
  app.patch('/skills/:name', async (c) => {
    if (!skillsProvider) return c.json({ error: 'Skills provider not configured' }, 400)
    const name = c.req.param('name')
    const { enabled } = await c.req.json<{ enabled: boolean }>()
    skillsProvider.setEnabled(name, enabled)
    if (stateStore) {
      await stateStore.save(buildPersistedState(agent, llmProvider, promptProvider, toolsProvider, skillsProvider))
    }
    onEvent?.({ type: 'skill.toggled', data: { name, enabled } })
    return c.json({ ok: true, skills: skillsProvider.getSkills() })
  })

  /** 手动触发 integration */
  app.post('/integrate', async (c) => {
    if (!integrationProvider) return c.json({ error: 'Integration provider not configured' }, 400)
    onEvent?.({ type: 'integrate.start' })
    const result = await integrationProvider.trigger()
    onEvent?.({ type: 'integrate.done', data: { synthesis: result.synthesis.slice(0, 100), insightCount: result.insightCount } })
    return c.json({ ok: true, ...result })
  })

  /** 清空数据并重新初始化 */
  app.post('/reset', async (c) => {
    if (!resetProvider) return c.json({ error: 'Reset provider not configured' }, 400)
    await stateStore?.reset?.()
    await resetProvider.reset()
    onEvent?.({ type: 'reset.done' })
    return c.json({ ok: true })
  })

  /** 获取事件历史 */
  app.get('/events', (c) => {
    const events = getEventHistory?.() ?? []
    return c.json({ events })
  })

  return app
}
