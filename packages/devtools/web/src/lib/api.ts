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

/** 拓扑节点 */
export interface TopologyNode {
  id: string
  parentId: string | null
  children: string[]
  refs: string[]
  depth: number
  index: number
  label: string
}

/** 递归树节点 */
export interface SessionTreeNode {
  node: TopologyNode
  meta: SessionMeta
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

/** Agent 配置 */
export interface AgentConfig {
  orchestration: { strategy: string }
  capabilities: {
    tools: Array<{ name: string; description: string; parameters?: Record<string, unknown> }>
    skills: Array<{ name: string; description: string }>
  }
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

/** 获取拓扑节点 */
export function fetchNode(id: string) {
  return request<TopologyNode>(`/sessions/${id}/node`)
}

/** 获取 session 详细数据 */
export function fetchSessionDetail(id: string) {
  return request<SessionDetail>(`/sessions/${id}/detail`)
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

/** 更新 agent 配置 */
export function patchConfig(updates: Record<string, unknown>) {
  return request<{ ok: boolean; applied: string[] }>('/config', {
    method: 'PATCH',
    body: JSON.stringify(updates),
  })
}
