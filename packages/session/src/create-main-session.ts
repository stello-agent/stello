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

/** 创建 MainSession 实例的内部工厂 */
function buildMainSession(
  meta: SessionMeta,
  options: CreateMainSessionOptions | LoadMainSessionOptions
): MainSession {
  let currentMeta = { ...meta }
  const { storage } = options

  const mainSession: MainSession = {
    get meta(): Readonly<SessionMeta> {
      return currentMeta
    },

    async send(_content: string): Promise<SendResult> {
      if (currentMeta.status === 'archived') {
        throw new SessionArchivedError(currentMeta.id)
      }
      throw new NotImplementedError('send()')
    },

    stream(_content: string): StreamResult {
      if (currentMeta.status === 'archived') {
        throw new SessionArchivedError(currentMeta.id)
      }
      throw new NotImplementedError('stream()')
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
    turnCount: 0,
    consolidatedTurn: 0,
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
