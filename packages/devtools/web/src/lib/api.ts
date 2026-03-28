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
  sourceSessionId?: string
  status: 'active' | 'archived'
  turnCount: number
  children: SessionTreeNode[]
}

/** L3 对话记录 */
export interface TurnRecord {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  timestamp: string
  metadata?: {
    toolCallId?: string
    toolCalls?: Array<{
      id: string
      name: string
      input: Record<string, unknown>
    }>
  } & Record<string, unknown>
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
    toolCalls?: Array<{
      id: string
      name: string
      args: Record<string, unknown>
      success?: boolean
      data?: unknown
      error?: string | null
      duration?: number
    }>
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

/** 清空数据并重新初始化 */
export function resetRuntime() {
  return request<{ ok: boolean }>('/reset', {
    method: 'POST',
  })
}

/** LLM 配置 */
export interface LLMConfig {
  configured: boolean
  model?: string
  baseURL?: string
  apiKey?: string
  temperature?: number
  maxTokens?: number
}

/** 获取当前 LLM 配置 */
export function fetchLLMConfig() {
  return request<LLMConfig>('/llm')
}

/** 切换 LLM 配置 */
export function patchLLMConfig(config: { model?: string; baseURL?: string; apiKey?: string; temperature?: number; maxTokens?: number }) {
  return request<LLMConfig & { ok: boolean }>('/llm', {
    method: 'PATCH',
    body: JSON.stringify(config),
  })
}

/** 提示词配置 */
export interface PromptsConfig {
  configured: boolean
  consolidate?: string
  integrate?: string
}

/** 获取 Consolidation/Integration 提示词 */
export function fetchPrompts() {
  return request<PromptsConfig>('/prompts')
}

/** 更新提示词 */
export function patchPrompts(prompts: { consolidate?: string; integrate?: string }) {
  return request<PromptsConfig & { ok: boolean }>('/prompts', {
    method: 'PATCH',
    body: JSON.stringify(prompts),
  })
}

/** 获取 session 的 system prompt */
export function fetchSystemPrompt(sessionId: string) {
  return request<{ configured: boolean; content: string | null }>(`/sessions/${sessionId}/system-prompt`)
}

/** 更新 session 的 system prompt */
export function updateSystemPrompt(sessionId: string, content: string) {
  return request<{ ok: boolean }>(`/sessions/${sessionId}/system-prompt`, {
    method: 'PUT',
    body: JSON.stringify({ content }),
  })
}

/** 获取 session 的 consolidate prompt */
export function fetchConsolidatePrompt(sessionId: string) {
  return request<{ configured: boolean; content: string | null }>(`/sessions/${sessionId}/consolidate-prompt`)
}

/** 更新 session 的 consolidate prompt */
export function updateConsolidatePrompt(sessionId: string, content: string) {
  return request<{ ok: boolean }>(`/sessions/${sessionId}/consolidate-prompt`, {
    method: 'PUT',
    body: JSON.stringify({ content }),
  })
}

/** 获取 session 的 integrate prompt */
export function fetchIntegratePrompt(sessionId: string) {
  return request<{ configured: boolean; content: string | null }>(`/sessions/${sessionId}/integrate-prompt`)
}

/** 更新 session 的 integrate prompt */
export function updateIntegratePrompt(sessionId: string, content: string) {
  return request<{ ok: boolean }>(`/sessions/${sessionId}/integrate-prompt`, {
    method: 'PUT',
    body: JSON.stringify({ content }),
  })
}

/** 获取 session 的 scope */
export function fetchScope(sessionId: string) {
  return request<{ configured: boolean; content: string | null }>(`/sessions/${sessionId}/scope`)
}

/** 更新 session 的 scope */
export function updateScope(sessionId: string, content: string) {
  return request<{ ok: boolean }>(`/sessions/${sessionId}/scope`, {
    method: 'PUT',
    body: JSON.stringify({ content }),
  })
}

/** 注入对话记录 */
export function injectRecord(sessionId: string, role: string, content: string) {
  return request<{ ok: boolean }>(`/sessions/${sessionId}/inject-record`, {
    method: 'POST',
    body: JSON.stringify({ role, content }),
  })
}

/** Tool 信息（含启用状态） */
export interface ToolWithStatus {
  name: string
  description: string
  enabled: boolean
}

/** 获取 tools 列表 */
export function fetchTools() {
  return request<{ configured: boolean; tools: ToolWithStatus[] }>('/tools')
}

/** 切换 tool 启用/禁用 */
export function toggleTool(name: string, enabled: boolean) {
  return request<{ ok: boolean; tools: ToolWithStatus[] }>(`/tools/${encodeURIComponent(name)}`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  })
}

/** Skill 信息（含启用状态） */
export interface SkillWithStatus {
  name: string
  description: string
  enabled: boolean
}

/** 获取 skills 列表 */
export function fetchSkills() {
  return request<{ configured: boolean; skills: SkillWithStatus[] }>('/skills')
}

/** 切换 skill 启用/禁用 */
export function toggleSkill(name: string, enabled: boolean) {
  return request<{ ok: boolean; skills: SkillWithStatus[] }>(`/skills/${encodeURIComponent(name)}`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  })
}

/** 手动触发 integration */
export function triggerIntegration() {
  return request<{ ok: boolean; synthesis: string; insightCount: number }>('/integrate', {
    method: 'POST',
  })
}
