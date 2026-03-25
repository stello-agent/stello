/** DevTools API 客户端 */

const BASE = '/api'

/** Session 元数据 */
export interface SessionMeta {
  id: string
  label: string
  scope: string | null
  status: 'active' | 'archived'
  turnCount: number
  tags: string[]
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
  lastActiveAt: string
}

/** 递归树节点（和 core 的 SessionTreeNode 一致） */
export interface SessionTreeNode {
  id: string
  label: string
  status: 'active' | 'archived'
  children: SessionTreeNode[]
}

/** L3 对话记录 */
export interface TurnRecord {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
  metadata?: Record<string, unknown>
}

/** Session 详细数据 */
export interface SessionDetail {
  meta: SessionMeta
  records: TurnRecord[]
  l2: string | null
  scope: string | null
}

/** Agent 配置（只读快照） */
export interface AgentConfig {
  orchestration: {
    strategy: string
    hasMainSession: boolean
    hasTurnRunner: boolean
  }
  runtime: {
    idleTtlMs: number
    hasResolver: boolean
  }
  scheduling: {
    consolidation: { trigger: string; everyNTurns?: number }
    integration: { trigger: string; everyNTurns?: number }
    hasScheduler: boolean
  }
  splitGuard: { minTurns: number; cooldownTurns: number } | null
  session: {
    hasSessionResolver: boolean
    hasMainSessionResolver: boolean
    hasConsolidateFn: boolean
    hasIntegrateFn: boolean
    hasSerializeSendResult: boolean
    hasToolCallParser: boolean
    options: Record<string, unknown> | null
  }
  capabilities: {
    tools: Array<{ name: string; description: string; parameters?: Record<string, unknown> }>
    skills: Array<{ name: string; description: string }>
    hasLifecycle: boolean
    hasConfirm: boolean
  }
  hooks: string[]
}

/** Turn 结果 */
export interface TurnResult {
  turn: {
    finalContent: string | null
    toolRoundCount: number
    toolCallsExecuted: number
    rawResponse: string
  }
}

/** 通用 fetch 封装 */
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`API ${res.status}: ${body || res.statusText}`)
  }
  return res.json() as Promise<T>
}

/** 获取完整递归 session 树 */
export function fetchSessionTree() {
  return request<SessionTreeNode>('/sessions/tree')
}

/** 获取所有 session 列表（扁平） */
export function fetchSessions() {
  return request<{ sessions: SessionMeta[] }>('/sessions')
}

/** 获取单个 session 元数据 */
export function fetchSession(id: string) {
  return request<SessionMeta>(`/sessions/${id}`)
}

/** 获取 session 详细数据 */
export function fetchSessionDetail(id: string) {
  return request<SessionDetail>(`/sessions/${id}/detail`)
}

/** 手动触发 consolidation */
export function consolidateSession(id: string) {
  return request<{ ok: boolean; l2: string }>(`/sessions/${id}/consolidate`, { method: 'POST' })
}

/** 进入 session */
export function enterSession(id: string) {
  return request<unknown>(`/sessions/${id}/enter`, { method: 'POST' })
}

/** 发送 turn */
export function sendTurn(sessionId: string, input: string) {
  return request<TurnResult>(`/sessions/${sessionId}/turn`, {
    method: 'POST',
    body: JSON.stringify({ input }),
  })
}

/** Fork session */
export function forkSession(sessionId: string, label: string) {
  return request<TopologyNode>(`/sessions/${sessionId}/fork`, {
    method: 'POST',
    body: JSON.stringify({ label }),
  })
}

/** Archive session */
export function archiveSession(sessionId: string) {
  return request<{ ok: boolean }>(`/sessions/${sessionId}/archive`, {
    method: 'POST',
  })
}

/** 获取 agent 配置 */
export function fetchConfig() {
  return request<AgentConfig>('/config')
}

/** 可热更新的配置字段 */
export interface HotConfigPatch {
  runtime?: { idleTtlMs?: number }
  scheduling?: {
    consolidation?: { trigger?: string; everyNTurns?: number }
    integration?: { trigger?: string; everyNTurns?: number }
  }
  splitGuard?: { minTurns?: number; cooldownTurns?: number }
}

/** 热更新 agent 配置 */
export function patchConfig(patch: HotConfigPatch) {
  return request<{ ok: boolean; config: AgentConfig }>('/config', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

/** LLM 配置 */
export interface LLMConfig {
  configured: boolean
  model?: string
  baseURL?: string
  apiKey?: string
}

/** 获取当前 LLM 配置 */
export function fetchLLMConfig() {
  return request<LLMConfig>('/llm')
}

/** 切换 LLM 配置 */
export function patchLLMConfig(config: { model?: string; baseURL?: string; apiKey?: string }) {
  return request<LLMConfig & { ok: boolean }>('/llm', {
    method: 'PATCH',
    body: JSON.stringify(config),
  })
}
