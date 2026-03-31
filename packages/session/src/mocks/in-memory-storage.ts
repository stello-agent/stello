import type { MainStorage, SessionStorage, ListRecordsOptions, TopologyNode } from '../types/storage.js'
import type { SessionMeta, SessionFilter } from '../types/session.js'
import type { ChildL2Summary, EventEnvelope } from '../types/functions.js'
import type { Message } from '../types/llm.js'
import { tryParseEnvelope } from '../context-utils.js'

/**
 * InMemoryStorageAdapter — 完整的内存存储实现，主要用于测试
 * 实现 MainStorage（superset），可按需当作 SessionStorage 使用
 */
export class InMemoryStorageAdapter implements MainStorage {
  private sessions = new Map<string, SessionMeta>()
  private records = new Map<string, Message[]>()
  private memories = new Map<string, string>()
  private systemPrompts = new Map<string, string>()
  private insights = new Map<string, string>()
  private memoryEvents: EventEnvelope[] = []
  private insightEvents = new Map<string, EventEnvelope[]>()
  private insightCursors = new Map<string, number>()
  private integrationCursors = new Map<string, number>()
  private nextMemorySequence = 1
  private nextInsightSequences = new Map<string, number>()
  private nodes = new Map<string, TopologyNode>()
  private globals = new Map<string, unknown>()

  async getSession(id: string): Promise<SessionMeta | null> {
    return this.sessions.get(id) ?? null
  }

  async putSession(session: SessionMeta): Promise<void> {
    this.sessions.set(session.id, { ...session })
  }

  async listSessions(filter?: SessionFilter): Promise<SessionMeta[]> {
    const all = Array.from(this.sessions.values())
    if (!filter) return all

    return all.filter((s) => {
      if (filter.status !== undefined && s.status !== filter.status) return false
      if (filter.role !== undefined && s.role !== filter.role) return false
      if (filter.tags && filter.tags.length > 0) {
        const sessionTags = new Set(s.tags)
        if (!filter.tags.every((t) => sessionTags.has(t))) return false
      }
      return true
    })
  }

  async appendRecord(sessionId: string, record: Message): Promise<void> {
    const list = this.records.get(sessionId) ?? []
    list.push({ ...record })
    this.records.set(sessionId, list)
  }

  async listRecords(sessionId: string, options?: ListRecordsOptions): Promise<Message[]> {
    let list = this.records.get(sessionId) ?? []

    if (options?.role) {
      list = list.filter((m) => m.role === options.role)
    }

    const offset = options?.offset ?? 0
    const limit = options?.limit

    list = list.slice(offset)
    if (limit !== undefined) {
      list = list.slice(0, limit)
    }

    return list.map((m) => ({ ...m }))
  }

  /** 裁剪旧 L3，保留最近 keepRecent 条 */
  async trimRecords(sessionId: string, keepRecent: number): Promise<void> {
    if (keepRecent <= 0) {
      this.records.set(sessionId, [])
      return
    }
    const list = this.records.get(sessionId) ?? []
    if (list.length > keepRecent) {
      this.records.set(sessionId, list.slice(-keepRecent))
    }
  }

  async getSystemPrompt(sessionId: string): Promise<string | null> {
    return this.systemPrompts.get(sessionId) ?? null
  }

  async putSystemPrompt(sessionId: string, content: string): Promise<void> {
    this.systemPrompts.set(sessionId, content)
  }

  async getInsight(sessionId: string): Promise<string | null> {
    const unreadEvents = await this.listInsightEvents(sessionId, await this.getInsightCursor(sessionId))
    if (unreadEvents.length > 0) {
      return unreadEvents.map((event) => event.content).join('\n\n')
    }
    return this.insights.get(sessionId) ?? null
  }

  async putInsight(sessionId: string, content: string): Promise<void> {
    await this.appendInsightEvent(sessionId, content)
  }

  async clearInsight(sessionId: string): Promise<void> {
    const latest = (this.insightEvents.get(sessionId) ?? []).at(-1)
    if (latest) {
      this.insightCursors.set(sessionId, latest.sequence)
    }
    this.insights.delete(sessionId)
  }

  async getMemory(sessionId: string): Promise<string | null> {
    const latestEvent = await this.getLatestMemoryEvent(sessionId)
    if (latestEvent) {
      return JSON.stringify(latestEvent)
    }
    return this.memories.get(sessionId) ?? null
  }

  async putMemory(sessionId: string, content: string): Promise<void> {
    this.memories.set(sessionId, content)
  }

  /** 追加一条 memory 事件。 */
  async appendMemoryEvent(sessionId: string, content: string, timestamp = new Date().toISOString()): Promise<EventEnvelope> {
    const event: EventEnvelope = {
      sessionId,
      sequence: this.nextMemorySequence++,
      timestamp,
      content,
    }
    this.memoryEvents.push(event)
    return { ...event }
  }

  /** 读取某个 Session 最新的 memory 事件。 */
  async getLatestMemoryEvent(sessionId: string): Promise<EventEnvelope | null> {
    for (let i = this.memoryEvents.length - 1; i >= 0; i--) {
      const event = this.memoryEvents[i]
      if (!event) continue
      if (event.sessionId === sessionId) {
        return { ...event }
      }
    }
    return null
  }

  /** 追加一条 insight 事件。 */
  async appendInsightEvent(sessionId: string, content: string, timestamp = new Date().toISOString()): Promise<EventEnvelope> {
    const nextSequence = this.nextInsightSequences.get(sessionId) ?? 1
    const event: EventEnvelope = {
      sessionId,
      sequence: nextSequence,
      timestamp,
      content,
    }
    const events = this.insightEvents.get(sessionId) ?? []
    events.push(event)
    this.insightEvents.set(sessionId, events)
    this.nextInsightSequences.set(sessionId, nextSequence + 1)
    return { ...event }
  }

  /** 读取某个 Session 的 insight 事件。 */
  async listInsightEvents(sessionId: string, afterSequence = 0): Promise<EventEnvelope[]> {
    return (this.insightEvents.get(sessionId) ?? [])
      .filter((event) => event.sequence > afterSequence)
      .map((event) => ({ ...event }))
  }

  /** 读取某个 Session 的 insight cursor。 */
  async getInsightCursor(sessionId: string): Promise<number> {
    return this.insightCursors.get(sessionId) ?? 0
  }

  /** 更新某个 Session 的 insight cursor。 */
  async setInsightCursor(sessionId: string, sequence: number): Promise<void> {
    this.insightCursors.set(sessionId, sequence)
  }

  /** 扁平收集所有 standard session 的 L2 */
  async getAllSessionL2s(): Promise<ChildL2Summary[]> {
    const result: ChildL2Summary[] = []
    for (const session of this.sessions.values()) {
      if (session.role !== 'standard' || session.status !== 'active') continue
      const latestEvent = await this.getLatestMemoryEvent(session.id)
      const rawMemory = latestEvent ? JSON.stringify(latestEvent) : this.memories.get(session.id)
      if (rawMemory === undefined) continue
      const envelope = tryParseEnvelope(rawMemory)
      if (envelope) {
        result.push({
          sessionId: session.id,
          label: session.label,
          l2: envelope.content,
          sequence: envelope.sequence,
          timestamp: envelope.timestamp,
        })
        continue
      }
      result.push({
        sessionId: session.id,
        label: session.label,
        l2: rawMemory,
        sequence: 0,
        timestamp: '',
      })
    }
    return result
  }

  /** 读取指定序号之后的 memory 事件。 */
  async listMemoryEvents(afterSequence = 0, limit?: number): Promise<EventEnvelope[]> {
    const filtered = this.memoryEvents
      .filter((event) => event.sequence > afterSequence)
      .map((event) => ({ ...event }))
    return limit === undefined ? filtered : filtered.slice(0, limit)
  }

  /** 读取 MainSession 的 integration cursor。 */
  async getIntegrationCursor(sessionId: string): Promise<number> {
    return this.integrationCursors.get(sessionId) ?? 0
  }

  /** 更新 MainSession 的 integration cursor。 */
  async setIntegrationCursor(sessionId: string, sequence: number): Promise<void> {
    this.integrationCursors.set(sessionId, sequence)
  }

  async putNode(node: TopologyNode): Promise<void> {
    this.nodes.set(node.id, { ...node })
  }

  async getChildren(parentId: string): Promise<TopologyNode[]> {
    return Array.from(this.nodes.values()).filter((n) => n.parentId === parentId)
  }

  async removeNode(nodeId: string): Promise<void> {
    this.nodes.delete(nodeId)
  }

  async getGlobal(key: string): Promise<unknown> {
    return this.globals.get(key) ?? null
  }

  async putGlobal(key: string, value: unknown): Promise<void> {
    this.globals.set(key, value)
  }

  async transaction<T>(fn: (tx: SessionStorage) => Promise<T>): Promise<T> {
    return fn(this)
  }
}
