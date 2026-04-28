import { randomUUID } from 'node:crypto'
import type { MainSession } from './types/main-session-api.js'
import type { Session, MessageQueryOptions, SessionSendOptions } from './types/session-api.js'
import { SessionArchivedError } from './types/session-api.js'
import type { SessionMeta, SessionMetaUpdate, ForkOptions } from './types/session.js'
import type { Message } from './types/llm.js'
import type {
  IntegrateResult, CreateMainSessionOptions, LoadMainSessionOptions,
  SendResult, StreamResult,
} from './types/functions.js'
import { createSession } from './create-session.js'
import { assembleMainSessionContext, createBuiltinCompressFn, type CompressionCache } from './context-utils.js'

interface ToolResultEnvelope {
  toolResults: Array<{
    toolCallId: string | null
    toolName: string
    args: Record<string, unknown>
    success: boolean
    data: unknown
    error: string | null
  }>
}

/** 判断输入是否是 TurnRunner 回灌的 toolResults 包。 */
function parseToolResultEnvelope(content: string): ToolResultEnvelope | null {
  try {
    const parsed = JSON.parse(content) as Partial<ToolResultEnvelope>
    if (!Array.isArray(parsed.toolResults)) return null
    return {
      toolResults: parsed.toolResults.map((item) => ({
        toolCallId: typeof item?.toolCallId === 'string' ? item.toolCallId : null,
        toolName: typeof item?.toolName === 'string' ? item.toolName : 'unknown_tool',
        args: typeof item?.args === 'object' && item.args ? item.args : {},
        success: Boolean(item?.success),
        data: item?.data ?? null,
        error: typeof item?.error === 'string' ? item.error : null,
      })),
    }
  } catch {
    return null
  }
}

/** 把 tool 执行结果序列化为 tool message content，对齐 OpenAI/Anthropic 标准（只含结果数据）。 */
function serializeToolResultContent(result: ToolResultEnvelope['toolResults'][number]): string {
  if (!result.success) {
    return result.error ?? 'Unknown error'
  }
  if (typeof result.data === 'string') return result.data
  if (result.data == null) return ''
  return JSON.stringify(result.data)
}

/** 为 MainSession 的 toolResults continuation 组装固定上下文与历史。 */
async function assembleMainSessionReplayContext(
  sessionId: string,
  storage: CreateMainSessionOptions['storage'] | LoadMainSessionOptions['storage'],
): Promise<Message[]> {
  const messages: Message[] = []

  const sysPrompt = await storage.getSystemPrompt(sessionId)
  if (sysPrompt) {
    messages.push({ role: 'system', content: sysPrompt })
  }

  const synthContent = await storage.getMemory(sessionId)
  if (synthContent) {
    messages.push({ role: 'system', content: synthContent })
  }

  const history = await storage.listRecords(sessionId)
  messages.push(...history)
  return messages
}

function createStreamResult(
  processor: (push: (chunk: string) => void) => Promise<SendResult>
): StreamResult {
  const queue: string[] = []
  let done = false
  let notify: (() => void) | null = null

  const wake = () => {
    if (!notify) return
    const current = notify
    notify = null
    current()
  }

  const push = (chunk: string) => {
    if (!chunk) return
    queue.push(chunk)
    wake()
  }

  const result = (async () => {
    try {
      return await processor(push)
    } finally {
      done = true
      wake()
    }
  })()

  return {
    result,
    async *[Symbol.asyncIterator]() {
      while (!done || queue.length > 0) {
        if (queue.length > 0) {
          yield queue.shift()!
          continue
        }
        await new Promise<void>((resolve) => {
          notify = resolve
        })
      }
    },
  }
}

/** 创建 MainSession 实例的内部工厂 */
function buildMainSession(
  meta: SessionMeta,
  options: CreateMainSessionOptions | LoadMainSessionOptions
): MainSession {
  let currentMeta = { ...meta }
  const { storage } = options
  let tools = options.tools
  let lastPromptTokens: number | null = null
  let compressionCache: CompressionCache | null = null
  function resolveCompressFn() {
    return options.compressFn ?? createBuiltinCompressFn(options.llm!)
  }

  const mainSession: MainSession = {
    get meta(): Readonly<SessionMeta> {
      return currentMeta
    },

    async send(content: string, sendOptions?: SessionSendOptions): Promise<SendResult> {
      if (currentMeta.status === 'archived') {
        throw new SessionArchivedError(currentMeta.id)
      }
      if (!options.llm) {
        throw new Error('LLMAdapter is required for send()')
      }
      sendOptions?.signal?.throwIfAborted()

      // 组装上下文（自动压缩）
      const assembled = await assembleMainSessionContext(
        currentMeta.id, storage, content,
        { maxContextTokens: options.llm.maxContextTokens, lastPromptTokens, compressFn: resolveCompressFn(), compressionCache },
      )
      if (assembled.compressionCache !== undefined) {
        compressionCache = assembled.compressionCache
      }

      let promptMessages = assembled.messages
      let recordsToPersist: Message[] = [{ role: 'user', content, timestamp: assembled.userTimestamp }]
      const toolEnvelope = parseToolResultEnvelope(content)
      if (toolEnvelope) {
        const replayContext = await assembleMainSessionReplayContext(currentMeta.id, storage)
        promptMessages = [
          ...replayContext,
          ...toolEnvelope.toolResults.map((result) => ({
            role: 'tool' as const,
            toolCallId: result.toolCallId ?? undefined,
            content: serializeToolResultContent(result),
            timestamp: assembled.userTimestamp,
          })),
        ]
        recordsToPersist = promptMessages.slice(replayContext.length)
      }

      // 调 LLM — abort 时直接向上传播；下方 L3 写入分支整体跳过
      const result = await options.llm.complete(promptMessages, { tools, signal: sendOptions?.signal })

      // 更新 promptTokens 基线
      if (result.usage?.promptTokens) {
        lastPromptTokens = result.usage.promptTokens
      }
      const assistantRecord: Message = {
        role: 'assistant',
        content: result.content ?? '',
        ...(result.toolCalls && result.toolCalls.length > 0 ? { toolCalls: result.toolCalls } : {}),
        timestamp: new Date().toISOString(),
      }
      for (const record of recordsToPersist) {
        await storage.appendRecord(currentMeta.id, record)
      }
      await storage.appendRecord(currentMeta.id, assistantRecord)

      return {
        content: result.content,
        toolCalls: result.toolCalls,
        usage: result.usage,
      }
    },

    stream(content: string, sendOptions?: SessionSendOptions): StreamResult {
      if (currentMeta.status === 'archived') {
        throw new SessionArchivedError(currentMeta.id)
      }
      if (!options.llm) {
        throw new Error('LLMAdapter is required for stream()')
      }

      return createStreamResult(async (push) => {
        sendOptions?.signal?.throwIfAborted()

        // 组装上下文（自动压缩）
        const assembled = await assembleMainSessionContext(
          currentMeta.id, storage, content,
          { maxContextTokens: options.llm!.maxContextTokens, lastPromptTokens, compressFn: resolveCompressFn(), compressionCache },
        )
        if (assembled.compressionCache !== undefined) {
          compressionCache = assembled.compressionCache
        }

        let promptMessages = assembled.messages
        let recordsToPersist: Message[] = [{ role: 'user', content, timestamp: assembled.userTimestamp }]
        const toolEnvelope = parseToolResultEnvelope(content)
        if (toolEnvelope) {
          const replayContext = await assembleMainSessionReplayContext(currentMeta.id, storage)
          promptMessages = [
            ...replayContext,
            ...toolEnvelope.toolResults.map((result) => ({
              role: 'tool' as const,
              toolCallId: result.toolCallId ?? undefined,
              content: serializeToolResultContent(result),
              timestamp: assembled.userTimestamp,
            })),
          ]
          recordsToPersist = promptMessages.slice(replayContext.length)
        }

        if (!options.llm) {
          throw new Error('LLM adapter not set. Call setLLM() first or pass llm to createMainSession().')
        }

        let result: SendResult
        if (options.llm.stream) {
          let accumulated = ''
          const toolCallsByIndex = new Map<number, { id?: string; name?: string; input: string }>()
          for await (const chunk of options.llm.stream(promptMessages, { tools, signal: sendOptions?.signal })) {
            accumulated += chunk.delta
            push(chunk.delta)
            for (const delta of chunk.toolCallDeltas ?? []) {
              const current = toolCallsByIndex.get(delta.index) ?? { input: '' }
              if (delta.id) current.id = delta.id
              if (delta.name) current.name = delta.name
              if (delta.input) current.input += delta.input
              toolCallsByIndex.set(delta.index, current)
            }
          }
          const toolCalls = Array.from(toolCallsByIndex.values()).map((call, index) => ({
            id: call.id ?? `tool_${index}`,
            name: call.name ?? 'unknown_tool',
            input: call.input ? JSON.parse(call.input) as Record<string, unknown> : {},
          }))
          result = { content: accumulated, toolCalls }
        } else {
          result = await options.llm.complete(promptMessages, { tools, signal: sendOptions?.signal })
          if (result.content) {
            push(result.content)
          }
        }

        const assistantRecord: Message = {
          role: 'assistant',
          content: result.content ?? '',
          ...(result.toolCalls && result.toolCalls.length > 0 ? { toolCalls: result.toolCalls } : {}),
          timestamp: new Date().toISOString(),
        }
        for (const record of recordsToPersist) {
          await storage.appendRecord(currentMeta.id, record)
        }
        await storage.appendRecord(currentMeta.id, assistantRecord)

        // 更新 promptTokens 基线
        if (result.usage?.promptTokens) {
          lastPromptTokens = result.usage.promptTokens
        }

        return {
          content: result.content,
          toolCalls: result.toolCalls,
          usage: result.usage,
        }
      })
    },

    async messages(queryOptions?: MessageQueryOptions): Promise<Message[]> {
      return storage.listRecords(currentMeta.id, queryOptions)
    },

    async systemPrompt(): Promise<string | null> {
      return storage.getSystemPrompt(currentMeta.id)
    },

    async setSystemPrompt(content: string): Promise<void> {
      if (currentMeta.status === 'archived') {
        throw new SessionArchivedError(currentMeta.id)
      }
      await storage.putSystemPrompt(currentMeta.id, content)
    },

    async synthesis(): Promise<string | null> {
      return storage.getMemory(currentMeta.id)
    },

    async integrate(): Promise<IntegrateResult> {
      if (currentMeta.status === 'archived') {
        throw new SessionArchivedError(currentMeta.id)
      }
      if (!options.integrateFn) {
        throw new Error('No integrateFn configured for this main session')
      }

      // 1. 扁平收集所有子 Session 的 L2
      const childSummaries = await storage.getAllSessionL2s()
      const validChildSessionIds = new Set(childSummaries.map((child) => child.sessionId))

      // 2. 读取当前 synthesis
      const currentSynthesis = await storage.getMemory(currentMeta.id)

      // 3. 调用 IntegrateFn
      const result = await options.integrateFn(childSummaries, currentSynthesis)
      const filteredInsights = result.insights.filter(({ sessionId }) => validChildSessionIds.has(sessionId))

      // 4. 在事务中一起保存 synthesis 和有效 insights，避免部分写入。
      await storage.transaction(async (tx) => {
        await tx.putMemory(currentMeta.id, result.synthesis)
        for (const { sessionId, content } of filteredInsights) {
          await tx.putInsight(sessionId, content)
        }
      })

      return { ...result, insights: filteredInsights }
    },

    async trimRecords(keepRecent: number): Promise<void> {
      if (keepRecent < 0) {
        throw new Error('keepRecent must be a non-negative integer')
      }
      if (currentMeta.status === 'archived') {
        throw new SessionArchivedError(currentMeta.id)
      }
      await storage.trimRecords(currentMeta.id, keepRecent)
    },

    async updateMeta(updates: SessionMetaUpdate): Promise<void> {
      if (currentMeta.status === 'archived') {
        throw new SessionArchivedError(currentMeta.id)
      }
      const updatedMeta: SessionMeta = {
        ...currentMeta,
        ...(updates.label !== undefined && { label: updates.label }),
        ...(updates.tags !== undefined && { tags: updates.tags }),
        ...(updates.metadata !== undefined && { metadata: updates.metadata }),
        updatedAt: new Date().toISOString(),
      }
      await storage.putSession(updatedMeta)
      currentMeta = updatedMeta
    },

    async fork(forkOptions: ForkOptions): Promise<Session> {
      const childId = forkOptions.id ?? randomUUID()
      const now = new Date().toISOString()

      // 创建子 Session（标准 Session，非 MainSession）
      const child = await createSession({
        id: childId,
        storage,
        llm: forkOptions.llm ?? options.llm!,
        label: forkOptions.label,
        systemPrompt: forkOptions.systemPrompt ?? await storage.getSystemPrompt(currentMeta.id) ?? undefined,
        tools: forkOptions.tools ?? options.tools,
        tags: forkOptions.tags,
        metadata: forkOptions.metadata,
        consolidateFn: forkOptions.consolidateFn,
        compressFn: forkOptions.compressFn,
      })

      // 上下文策略：决定子 Session 继承多少父 L3
      const ctx = forkOptions.context ?? 'none'
      if (ctx !== 'none') {
        const parentRecords = await storage.listRecords(currentMeta.id)
        const records = ctx === 'inherit' ? parentRecords : await ctx(parentRecords)
        for (const record of records) {
          await storage.appendRecord(childId, record)
        }
      }

      // 初始 prompt：写入子 Session 的第一条 assistant 开场消息
      if (forkOptions.prompt) {
        await storage.appendRecord(childId, {
          role: 'assistant',
          content: forkOptions.prompt,
          timestamp: now,
        })
      }

      return child
    },

    async archive(): Promise<void> {
      const updatedMeta: SessionMeta = {
        ...currentMeta,
        status: 'archived',
        updatedAt: new Date().toISOString(),
      }
      await storage.putSession(updatedMeta)
      currentMeta = updatedMeta
    },

    setLLM(adapter) {
      options.llm = adapter
    },

    get tools() {
      return tools
    },

    setTools(newTools) {
      tools = newTools
    },
  }

  return mainSession
}

/** createMainSession — 创建 Main Session */
export async function createMainSession(options: CreateMainSessionOptions): Promise<MainSession> {
  const id = randomUUID()
  const now = new Date().toISOString()

  const meta: SessionMeta = {
    id,
    label: options.label ?? 'Main Session',
    role: 'main',
    status: 'active',
    tags: options.tags ?? [],
    metadata: options.metadata ?? {},
    createdAt: now,
    updatedAt: now,
  }

  await options.storage.putSession(meta)

  if (options.systemPrompt) {
    await options.storage.putSystemPrompt(id, options.systemPrompt)
  }

  return buildMainSession(meta, options)
}

/** loadMainSession — 从存储中加载已有的 Main Session */
export async function loadMainSession(
  id: string,
  options: LoadMainSessionOptions
): Promise<MainSession | null> {
  const meta = await options.storage.getSession(id)
  if (!meta || meta.role !== 'main') return null
  return buildMainSession(meta, options)
}
