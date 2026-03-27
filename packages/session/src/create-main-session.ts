import { randomUUID } from 'node:crypto'
import type { MainSession } from './types/main-session-api.js'
import type { MessageQueryOptions } from './types/session-api.js'
import { SessionArchivedError, NotImplementedError } from './types/session-api.js'
import type { SessionMeta, SessionMetaUpdate } from './types/session.js'
import type { Message } from './types/llm.js'
import type {
  IntegrateFn, IntegrateResult, CreateMainSessionOptions, LoadMainSessionOptions,
  SendResult, StreamResult,
} from './types/functions.js'
import { assembleMainSessionContext } from './context-utils.js'

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
  const tools = options.tools

  const mainSession: MainSession = {
    get meta(): Readonly<SessionMeta> {
      return currentMeta
    },

    async send(content: string): Promise<SendResult> {
      if (currentMeta.status === 'archived') {
        throw new SessionArchivedError(currentMeta.id)
      }
      if (!options.llm) {
        throw new Error('LLMAdapter is required for send()')
      }

      // 组装上下文（含 token 预算压缩）
      const { messages, userTimestamp } = await assembleMainSessionContext(
        currentMeta.id, storage, content, options.contextWindow,
      )

      // 调 LLM
      const result = await options.llm.complete(messages, { tools })

      // 存 L3：用户消息 + assistant 响应
      const userRecord: Message = { role: 'user', content, timestamp: userTimestamp }
      const assistantRecord: Message = {
        role: 'assistant',
        content: result.content ?? '',
        timestamp: new Date().toISOString(),
      }
      await storage.appendRecord(currentMeta.id, userRecord)
      await storage.appendRecord(currentMeta.id, assistantRecord)

      return {
        content: result.content,
        toolCalls: result.toolCalls,
        usage: result.usage,
      }
    },

    stream(content: string): StreamResult {
      if (currentMeta.status === 'archived') {
        throw new SessionArchivedError(currentMeta.id)
      }
      if (!options.llm) {
        throw new Error('LLMAdapter is required for stream()')
      }

      return createStreamResult(async (push) => {
        // 组装上下文（含 token 预算压缩）
        const { messages, userTimestamp } = await assembleMainSessionContext(
          currentMeta.id, storage, content, options.contextWindow,
        )

        const now = userTimestamp

        if (!options.llm) {
          throw new Error('LLM adapter not set. Call setLLM() first or pass llm to createMainSession().')
        }

        let result: SendResult
        if (options.llm.stream) {
          let accumulated = ''
          const toolCallsByIndex = new Map<number, { id?: string; name?: string; input: string }>()
          for await (const chunk of options.llm.stream(messages, { tools })) {
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
          result = await options.llm.complete(messages, { tools })
          if (result.content) {
            push(result.content)
          }
        }

        const userRecord: Message = { role: 'user', content, timestamp: now }
        const assistantRecord: Message = {
          role: 'assistant',
          content: result.content ?? '',
          timestamp: new Date().toISOString(),
        }
        await storage.appendRecord(currentMeta.id, userRecord)
        await storage.appendRecord(currentMeta.id, assistantRecord)

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

    async integrate(fn: IntegrateFn): Promise<IntegrateResult> {
      if (currentMeta.status === 'archived') {
        throw new SessionArchivedError(currentMeta.id)
      }

      // 1. 扁平收集所有子 Session 的 L2
      const childSummaries = await storage.getAllSessionL2s()

      // 2. 读取当前 synthesis
      const currentSynthesis = await storage.getMemory(currentMeta.id)

      // 3. 调用 IntegrateFn
      const result = await fn(childSummaries, currentSynthesis)

      // 4. 保存 synthesis
      await storage.putMemory(currentMeta.id, result.synthesis)

      // 5. 推送 insights 到各子 Session
      for (const { sessionId, content } of result.insights) {
        await storage.putInsight(sessionId, content)
      }

      return result
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
