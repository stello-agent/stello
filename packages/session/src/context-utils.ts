import type { Message } from './types/llm.js'
import type { SessionStorage } from './types/storage.js'

/** 粗估消息的 token 数（字符数 / 4） */
function estimateTokens(messages: Message[]): number {
  return messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0)
}

/** 按 token 预算从最近的 L3 往前填充 */
function selectHistoryByBudget(
  history: Message[],
  budgetTokens: number,
): Message[] {
  let usedTokens = 0
  let startIndex = history.length
  for (let i = history.length - 1; i >= 0; i--) {
    const msgTokens = Math.ceil(history[i]!.content.length / 4)
    if (usedTokens + msgTokens > budgetTokens) break
    usedTokens += msgTokens
    startIndex = i
  }
  return history.slice(startIndex)
}

/** 自动压缩的配置参数 */
export interface CompressContext {
  /** 模型上下文窗口大小（token 数） */
  maxContextTokens: number
  /** 上次 send() 返回的 promptTokens，用于估算（首次为 null） */
  lastPromptTokens: number | null
}

/** 压缩阈值：超过 80% 上下文窗口时触发 */
const COMPRESS_THRESHOLD = 0.8

/** assembleContext 的返回结果 */
export interface AssembleResult {
  /** 组装好的消息数组 */
  messages: Message[]
  /** 是否消费了 insight（需要后续清除） */
  insightConsumed: boolean
  /** 用户消息的时间戳 */
  userTimestamp: string
  /** 是否触发了压缩（上下文被裁剪） */
  compressed: boolean
}

/**
 * 组装 Session 上下文，支持自动压缩
 *
 * 默认全量回放。当估算 token 数超过 maxContextTokens * 0.8 且有 L2 时，
 * 自动切换为：system + insight + L2 + 最近 L3 + user msg。
 */
export async function assembleSessionContext(
  sessionId: string,
  storage: SessionStorage,
  userContent: string,
  compress: CompressContext,
): Promise<AssembleResult> {
  const prefixMessages: Message[] = []
  let insightConsumed = false

  // 1. system prompt
  const sysPrompt = await storage.getSystemPrompt(sessionId)
  if (sysPrompt) {
    prefixMessages.push({ role: 'system', content: sysPrompt })
  }

  // 2. insight
  const insightContent = await storage.getInsight(sessionId)
  if (insightContent) {
    prefixMessages.push({ role: 'system', content: insightContent })
    insightConsumed = true
  }

  const userTimestamp = new Date().toISOString()
  const userMessage: Message = { role: 'user', content: userContent, timestamp: userTimestamp }

  const history = await storage.listRecords(sessionId)

  // 估算全量 token 数
  const fullMessages = [...prefixMessages, ...history, userMessage]
  const estimatedTokens = compress.lastPromptTokens !== null
    ? compress.lastPromptTokens + estimateTokens([...history.slice(-2), userMessage])
    : estimateTokens(fullMessages)

  const threshold = compress.maxContextTokens * COMPRESS_THRESHOLD

  // 未超阈值 → 全量回放
  if (estimatedTokens < threshold) {
    return { messages: fullMessages, insightConsumed, userTimestamp, compressed: false }
  }

  // 超阈值：检查是否有 L2 可用
  const memory = await storage.getMemory(sessionId)
  if (!memory) {
    // 无 L2 → 仍发全量（无法压缩）
    return { messages: fullMessages, insightConsumed, userTimestamp, compressed: false }
  }

  // 有 L2 → 压缩模式：prefix + L2 + 最近 L3 + user msg
  const compressedPrefix = [...prefixMessages, { role: 'system' as const, content: memory }]
  const fixedTokens = estimateTokens([...compressedPrefix, userMessage])
  const historyBudget = threshold - fixedTokens
  const selectedHistory = historyBudget > 0
    ? selectHistoryByBudget(history, historyBudget)
    : []

  return {
    messages: [...compressedPrefix, ...selectedHistory, userMessage],
    insightConsumed,
    userTimestamp,
    compressed: true,
  }
}

/**
 * 组装 MainSession 上下文，支持自动压缩
 *
 * MainSession 始终注入 synthesis。超阈值时裁剪 L3。
 */
export async function assembleMainSessionContext(
  sessionId: string,
  storage: SessionStorage,
  userContent: string,
  compress: CompressContext,
): Promise<{ messages: Message[]; userTimestamp: string; compressed: boolean }> {
  const prefixMessages: Message[] = []

  // 1. system prompt
  const sysPrompt = await storage.getSystemPrompt(sessionId)
  if (sysPrompt) {
    prefixMessages.push({ role: 'system', content: sysPrompt })
  }

  // 2. synthesis（始终注入）
  const synthContent = await storage.getMemory(sessionId)
  if (synthContent) {
    prefixMessages.push({ role: 'system', content: synthContent })
  }

  const userTimestamp = new Date().toISOString()
  const userMessage: Message = { role: 'user', content: userContent, timestamp: userTimestamp }

  const history = await storage.listRecords(sessionId)

  // 估算全量 token 数
  const fullMessages = [...prefixMessages, ...history, userMessage]
  const estimatedTokens = compress.lastPromptTokens !== null
    ? compress.lastPromptTokens + estimateTokens([...history.slice(-2), userMessage])
    : estimateTokens(fullMessages)

  const threshold = compress.maxContextTokens * COMPRESS_THRESHOLD

  // 未超阈值 → 全量
  if (estimatedTokens < threshold) {
    return { messages: fullMessages, userTimestamp, compressed: false }
  }

  // 超阈值 → 裁剪 L3（synthesis 已在 prefix 中）
  const fixedTokens = estimateTokens([...prefixMessages, userMessage])
  const historyBudget = threshold - fixedTokens
  const selectedHistory = historyBudget > 0
    ? selectHistoryByBudget(history, historyBudget)
    : []

  return {
    messages: [...prefixMessages, ...selectedHistory, userMessage],
    userTimestamp,
    compressed: true,
  }
}
