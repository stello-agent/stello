import { randomUUID } from 'node:crypto'
import type { Session, MessageQueryOptions, SessionSendOptions } from './types/session-api.js'
import { SessionArchivedError } from './types/session-api.js'
import type { SessionMeta, SessionMetaUpdate, ForkOptions } from './types/session.js'
import type { Message } from './types/llm.js'
import type { CreateSessionOptions, LoadSessionOptions, SendResult, StreamResult } from './types/functions.js'
import { assembleSessionContext, buildSessionIdentityMessages, createBuiltinCompressFn, removeIncompleteToolCallGroups, type CompressionCache } from './context-utils.js'

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

/** 为 toolResults continuation 组装固定上下文与历史。 */
async function assembleSessionReplayContext(
  sessionId: string,
  storage: CreateSessionOptions['storage'] | LoadSessionOptions['storage'],
  label?: string,
): Promise<{ messages: Message[]; insightConsumed: boolean }> {
  const messages: Message[] = []
  let insightConsumed = false

  const sysPrompt = await storage.getSystemPrompt(sessionId)
  if (sysPrompt) {
    messages.push({ role: 'system', content: sysPrompt })
  }

  messages.push(...buildSessionIdentityMessages(label))

  const insightContent = await storage.getInsight(sessionId)
  if (insightContent) {
    messages.push({ role: 'system', content: insightContent })
    insightConsumed = true
  }

  const memory = await storage.getMemory(sessionId)
  if (memory) {
    messages.push({ role: 'system', content: memory })
  }

  // 注意：此处刻意不调用 removeIncompleteToolCallGroups。
  // replay 路径会把"assistant(toolCalls) + 由 envelope 合成的 tool 消息"拼接成完整组，
  // 在加载阶段过早裁剪反而会把回灌目标删掉。完整组校验放在拼接后由调用方做。
  const history = await storage.listRecords(sessionId)
  messages.push(...history)
  return { messages, insightConsumed }
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

/** 创建 Session 实例的内部工厂 */
function buildSession(
  meta: SessionMeta,
  options: CreateSessionOptions | LoadSessionOptions
): Session {
  let currentMeta = { ...meta }
  const { storage } = options
  let tools = options.tools
  let lastPromptTokens: number | null = null
  let compressionCache: CompressionCache | null = null
  /** 解析 compressFn：用户提供 > 内置 LLM 压缩 */
  function resolveCompressFn() {
    return options.compressFn ?? createBuiltinCompressFn(options.llm!)
  }

  const session: Session = {
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
      // pre-flight：已 abort 的 signal 立即抛出，不发起任何 LLM 请求
      sendOptions?.signal?.throwIfAborted()

      // 组装上下文（自动压缩）
      const assembled = await assembleSessionContext(
        currentMeta.id, storage, content,
        { maxContextTokens: options.llm.maxContextTokens, lastPromptTokens, compressFn: resolveCompressFn(), compressionCache },
        currentMeta.label,
      )
      if (assembled.compressionCache !== undefined) {
        compressionCache = assembled.compressionCache
      }

      // 消费 insight
      if (assembled.insightConsumed) {
        await storage.clearInsight(currentMeta.id)
      }

      let promptMessages = assembled.messages
      let recordsToPersist: Message[] = [{ role: 'user', content, timestamp: assembled.userTimestamp }]
      const toolEnvelope = parseToolResultEnvelope(content)
      if (toolEnvelope) {
        const replayContext = await assembleSessionReplayContext(currentMeta.id, storage, currentMeta.label)
        promptMessages = [
          ...replayContext.messages,
          ...toolEnvelope.toolResults.map((result) => ({
            role: 'tool' as const,
            toolCallId: result.toolCallId ?? undefined,
            content: serializeToolResultContent(result),
            timestamp: assembled.userTimestamp,
          })),
        ]
        recordsToPersist = promptMessages.slice(replayContext.messages.length)
        if (replayContext.insightConsumed) {
          await storage.clearInsight(currentMeta.id)
        }
        // 替换为 replay 上下文后，原 assembled.messages 里的 sanitize 不再生效；
        // 在拼好"assistant + tool 结果"完整组之后，再做一次孤儿组清理（防御中段 orphan）。
        promptMessages = removeIncompleteToolCallGroups(promptMessages)
      }

      // 调 LLM — adapter 抛 AbortError 时直接向上传播，下方 L3 写入分支整体跳过
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
        // pre-flight：已 abort 的 signal 立即让 result reject，processor 不进入下游
        sendOptions?.signal?.throwIfAborted()

        // 组装上下文（自动压缩）
        const assembled = await assembleSessionContext(
          currentMeta.id, storage, content,
          { maxContextTokens: options.llm!.maxContextTokens, lastPromptTokens, compressFn: resolveCompressFn(), compressionCache },
          currentMeta.label,
        )
        if (assembled.compressionCache !== undefined) {
          compressionCache = assembled.compressionCache
        }

        // 消费 insight
        if (assembled.insightConsumed) {
          await storage.clearInsight(currentMeta.id)
        }

        let promptMessages = assembled.messages
        let recordsToPersist: Message[] = [{ role: 'user', content, timestamp: assembled.userTimestamp }]
        const toolEnvelope = parseToolResultEnvelope(content)
        if (toolEnvelope) {
          const replayContext = await assembleSessionReplayContext(currentMeta.id, storage, currentMeta.label)
          promptMessages = [
            ...replayContext.messages,
            ...toolEnvelope.toolResults.map((result) => ({
              role: 'tool' as const,
              toolCallId: result.toolCallId ?? undefined,
              content: serializeToolResultContent(result),
              timestamp: assembled.userTimestamp,
            })),
          ]
          recordsToPersist = promptMessages.slice(replayContext.messages.length)
          if (replayContext.insightConsumed) {
            await storage.clearInsight(currentMeta.id)
          }
          // 拼好完整组之后再清孤儿，防御中段 orphan（与 send() 对称）
          promptMessages = removeIncompleteToolCallGroups(promptMessages)
        }

        if (!options.llm) {
          throw new Error('LLM adapter not set. Call setLLM() first or pass llm to createSession().')
        }

        let result: SendResult
        if (options.llm.stream) {
          let accumulated = ''
          const toolCallsByIndex = new Map<number, { id?: string; name?: string; input: string }>()
          // adapter 在 abort 时抛 AbortError，这里直接向上传播给 result promise；
          // 下方 L3 写入分支不会执行（policy: drop entirely），与非流式 send() 对称。
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

    async insight(): Promise<string | null> {
      return storage.getInsight(currentMeta.id)
    },

    async setInsight(content: string): Promise<void> {
      if (currentMeta.status === 'archived') {
        throw new SessionArchivedError(currentMeta.id)
      }
      await storage.putInsight(currentMeta.id, content)
    },

    async memory(): Promise<string | null> {
      return storage.getMemory(currentMeta.id)
    },

    async consolidate(): Promise<void> {
      if (currentMeta.status === 'archived') {
        throw new SessionArchivedError(currentMeta.id)
      }
      if (!options.consolidateFn) {
        throw new Error('No consolidateFn configured for this session')
      }
      const currentMemory = await storage.getMemory(currentMeta.id)
      const messages = await storage.listRecords(currentMeta.id)
      const newMemory = await options.consolidateFn(currentMemory, messages)
      await storage.putMemory(currentMeta.id, newMemory)
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

    async fork(forkOptions: ForkOptions): Promise<Session> {
      const childId = forkOptions.id ?? randomUUID()
      const now = new Date().toISOString()

      const childMeta: SessionMeta = {
        id: childId,
        label: forkOptions.label,
        role: 'standard',
        status: 'active',
        tags: forkOptions.tags ?? [],
        metadata: forkOptions.metadata ?? {},
        createdAt: now,
        updatedAt: now,
      }

      await storage.putSession(childMeta)

      // system prompt：提供则用，否则继承父 Session
      const sp = forkOptions.systemPrompt ?? await storage.getSystemPrompt(currentMeta.id)
      if (sp) {
        await storage.putSystemPrompt(childId, sp)
      }

      // 上下文策略：决定子 Session 继承多少父 L3
      const ctx = forkOptions.context ?? 'none'
      if (ctx !== 'none') {
        const parentRecords = await storage.listRecords(currentMeta.id)
        const selected = ctx === 'inherit' ? parentRecords : await ctx(parentRecords)
        // 净化掉不完整的 tool call 组（fork 在 tool 执行中、或父历史里夹有中段 orphan 时都需要）
        const records = removeIncompleteToolCallGroups(selected)
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

      // 构建子 Session 选项（支持 llm/tools/consolidateFn/compressFn 覆盖）
      const childOptions = {
        ...options,
        ...(forkOptions.llm && { llm: forkOptions.llm }),
        ...(forkOptions.tools && { tools: forkOptions.tools }),
        ...(forkOptions.consolidateFn && { consolidateFn: forkOptions.consolidateFn }),
        ...(forkOptions.compressFn && { compressFn: forkOptions.compressFn }),
      }
      return buildSession(childMeta, childOptions)
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

  return session
}

/** createSession — 创建一个新的 Session */
export async function createSession(options: CreateSessionOptions): Promise<Session> {
  const id = options.id ?? randomUUID()
  const now = new Date().toISOString()

  const meta: SessionMeta = {
    id,
    label: options.label ?? 'New Session',
    role: 'standard',
    status: 'active',
    tags: options.tags ?? [],
    metadata: options.metadata ?? {},
    createdAt: now,
    updatedAt: now,
  }

  await options.storage.putSession(meta)

  // 如果提供了 systemPrompt，持久化到 storage
  if (options.systemPrompt) {
    await options.storage.putSystemPrompt(id, options.systemPrompt)
  }

  return buildSession(meta, options)
}

/** loadSession — 从存储中加载已有 Session */
export async function loadSession(
  id: string,
  options: LoadSessionOptions
): Promise<Session | null> {
  const meta = await options.storage.getSession(id)
  if (!meta) return null
  return buildSession(meta, options)
}
