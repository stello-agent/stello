import type { MainStorage, SessionStorage, ListRecordsOptions, TopologyNode } from '../types/storage.js'
import type { SessionMeta, SessionFilter } from '../types/session.js'
import type { ChildL2Summary } from '../types/functions.js'
import type { Message } from '../types/llm.js'

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
    return this.insights.get(sessionId) ?? null
  }

  async putInsight(sessionId: string, content: string): Promise<void> {
    this.insights.set(sessionId, content)
  }

  async clearInsight(sessionId: string): Promise<void> {
    this.insights.delete(sessionId)
  }

  async getMemory(sessionId: string): Promise<string | null> {
    return this.memories.get(sessionId) ?? null
  }

  async putMemory(sessionId: string, content: string): Promise<void> {
    this.memories.set(sessionId, content)
  }

  /** 扁平收集所有 standard session 的 L2 */
  async getAllSessionL2s(): Promise<ChildL2Summary[]> {
    const result: ChildL2Summary[] = []
    for (const session of this.sessions.values()) {
      if (session.role !== 'standard' || session.status !== 'active') continue
      const l2 = this.memories.get(session.id)
      if (l2 === undefined) continue
      result.push({ sessionId: session.id, label: session.label, l2 })
    }
    return result
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
