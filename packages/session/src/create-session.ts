import { randomUUID } from 'node:crypto'
import type { Session, MessageQueryOptions } from './types/session-api.js'
import { SessionArchivedError, NotImplementedError } from './types/session-api.js'
import type { SessionMeta, SessionMetaUpdate, ForkOptions } from './types/session.js'
import type { Message } from './types/llm.js'
import type { ConsolidateFn, CreateSessionOptions, LoadSessionOptions, SendResult, StreamResult } from './types/functions.js'

/** 创建 Session 实例的内部工厂 */
function buildSession(
  meta: SessionMeta,
  options: CreateSessionOptions | LoadSessionOptions
): Session {
  let currentMeta = { ...meta }
  const { storage } = options

  const session: Session = {
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

    async consolidate(fn: ConsolidateFn): Promise<void> {
      if (currentMeta.status === 'archived') {
        throw new SessionArchivedError(currentMeta.id)
      }
      const currentMemory = await storage.getMemory(currentMeta.id)
      const messages = await storage.listRecords(currentMeta.id)
      const newMemory = await fn(currentMemory, messages)
      await storage.putMemory(currentMeta.id, newMemory)

      const updatedMeta: SessionMeta = {
        ...currentMeta,
        consolidatedTurn: currentMeta.turnCount,
        updatedAt: new Date().toISOString(),
      }
      await storage.putSession(updatedMeta)
      currentMeta = updatedMeta
    },

    async fork(forkOptions: ForkOptions): Promise<Session> {
      const childId = randomUUID()
      const now = new Date().toISOString()

      const childMeta: SessionMeta = {
        id: childId,
        label: forkOptions.label,
        role: 'standard',
        status: 'active',
        turnCount: 0,
        consolidatedTurn: 0,
        tags: forkOptions.tags ?? [],
        metadata: forkOptions.metadata ?? {},
        createdAt: now,
        updatedAt: now,
      }

      await storage.putSession(childMeta)
      return buildSession(childMeta, options)
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

  return session
}

/** createSession — 创建一个新的 Session */
export async function createSession(options: CreateSessionOptions): Promise<Session> {
  const id = randomUUID()
  const now = new Date().toISOString()

  const meta: SessionMeta = {
    id,
    label: options.label ?? 'New Session',
    role: 'standard',
    status: 'active',
    turnCount: 0,
    consolidatedTurn: 0,
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
