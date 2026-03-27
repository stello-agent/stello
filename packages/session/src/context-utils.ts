import type { Message } from './types/llm.js'
import type { ContextWindowOptions } from './types/functions.js'
import type { SessionStorage } from './types/storage.js'

/** 按 token 预算从最近的 L3 往前填充，返回能装入预算的消息 */
export function selectHistoryByBudget(
  history: Message[],
  remainingBudget: number,
  countTokens: (messages: Message[]) => number,
): Message[] {
  // 逐条累加 token 消耗，从最近往前
  let usedTokens = 0
  let startIndex = history.length
  for (let i = history.length - 1; i >= 0; i--) {
    const msgTokens = countTokens([history[i]!])
    if (usedTokens + msgTokens > remainingBudget) break
    usedTokens += msgTokens
    startIndex = i
  }
  return history.slice(startIndex)
}

/** assembleContext 的返回结果 */
export interface AssembleResult {
  /** 组装好的消息数组 */
  messages: Message[]
  /** 是否消费了 insight（需要后续清除） */
  insightConsumed: boolean
  /** 用户消息的时间戳 */
  userTimestamp: string
}

/** 组装 Session 上下文：system prompt → insight → [L2] → L3 历史 → user msg */
export async function assembleSessionContext(
  sessionId: string,
  storage: SessionStorage,
  userContent: string,
  contextWindow?: ContextWindowOptions,
): Promise<AssembleResult> {
  const fixedMessages: Message[] = []
  let insightConsumed = false

  // 1. system prompt
  const sysPrompt = await storage.getSystemPrompt(sessionId)
  if (sysPrompt) {
    fixedMessages.push({ role: 'system', content: sysPrompt })
  }

  // 2. insight（读取后标记消费）
  const insightContent = await storage.getInsight(sessionId)
  if (insightContent) {
    fixedMessages.push({ role: 'system', content: insightContent })
    insightConsumed = true
  }

  // 3. L2 memory（仅在 contextWindow 模式下注入）
  if (contextWindow) {
    const memory = await storage.getMemory(sessionId)
    if (memory) {
      fixedMessages.push({ role: 'system', content: memory })
    }
  }

  const userTimestamp = new Date().toISOString()
  const userMessage: Message = {
    role: 'user',
    content: userContent,
    timestamp: userTimestamp,
  }

  const history = await storage.listRecords(sessionId)

  if (contextWindow) {
    // token 预算模式：固定部分 + 用户消息先占预算，剩余给 L3
    const fixedTokens = contextWindow.countTokens([...fixedMessages, userMessage])
    const remainingBudget = contextWindow.maxContextTokens - fixedTokens
    const selectedHistory = remainingBudget > 0
      ? selectHistoryByBudget(history, remainingBudget, contextWindow.countTokens)
      : []
    return {
      messages: [...fixedMessages, ...selectedHistory, userMessage],
      insightConsumed,
      userTimestamp,
    }
  }

  // 向后兼容：全量回放
  return {
    messages: [...fixedMessages, ...history, userMessage],
    insightConsumed,
    userTimestamp,
  }
}

/** 组装 MainSession 上下文：system prompt → synthesis → L3 历史 → user msg */
export async function assembleMainSessionContext(
  sessionId: string,
  storage: SessionStorage,
  userContent: string,
  contextWindow?: ContextWindowOptions,
): Promise<{ messages: Message[]; userTimestamp: string }> {
  const fixedMessages: Message[] = []

  // 1. system prompt
  const sysPrompt = await storage.getSystemPrompt(sessionId)
  if (sysPrompt) {
    fixedMessages.push({ role: 'system', content: sysPrompt })
  }

  // 2. synthesis（MainSession 始终注入，不受 contextWindow 影响）
  const synthContent = await storage.getMemory(sessionId)
  if (synthContent) {
    fixedMessages.push({ role: 'system', content: synthContent })
  }

  const userTimestamp = new Date().toISOString()
  const userMessage: Message = {
    role: 'user',
    content: userContent,
    timestamp: userTimestamp,
  }

  const history = await storage.listRecords(sessionId)

  if (contextWindow) {
    // token 预算模式
    const fixedTokens = contextWindow.countTokens([...fixedMessages, userMessage])
    const remainingBudget = contextWindow.maxContextTokens - fixedTokens
    const selectedHistory = remainingBudget > 0
      ? selectHistoryByBudget(history, remainingBudget, contextWindow.countTokens)
      : []
    return {
      messages: [...fixedMessages, ...selectedHistory, userMessage],
      userTimestamp,
    }
  }

  // 向后兼容：全量回放
  return {
    messages: [...fixedMessages, ...history, userMessage],
    userTimestamp,
  }
}
