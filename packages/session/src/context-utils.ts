import type { Message, LLMAdapter } from './types/llm.js'
import type { SessionStorage } from './types/storage.js'
import type { CompressFn } from './types/functions.js'

/**
 * 从历史中移除所有不完整的 tool call 组：
 * 任何 `assistant(toolCalls=[A,B,...])` 后续若缺少与之 `toolCallId` 对应的 `tool` 消息，
 * 则整组（assistant + 已写入的 tool 消息）一并丢弃；同时丢弃没有匹配 assistant 的孤立 tool 消息。
 *
 * 触发场景：
 *   - tool 执行被 AbortSignal 中断 → assistant 已写入但 tool result 永远不再回灌（最常见）
 *   - 进程崩溃 / 手动改库 / 旧版 bug 残留
 *
 * 这是历史→prompt 的不变量保证：送给 LLM 的 messages 必须满足 OpenAI/Anthropic 协议
 * 对 tool call group 完整性的要求，否则 OpenAI-compat adapter 会返回 400。
 */
export function removeIncompleteToolCallGroups(records: Message[]): Message[] {
  const result: Message[] = []
  let i = 0
  while (i < records.length) {
    const rec = records[i]!
    if (rec.role === 'assistant' && rec.toolCalls && rec.toolCalls.length > 0) {
      const expectedIds = new Set(rec.toolCalls.map((tc) => tc.id))
      let j = i + 1
      while (j < records.length && records[j]!.role === 'tool') {
        const t = records[j]!
        if (t.toolCallId) expectedIds.delete(t.toolCallId)
        j++
      }
      if (expectedIds.size === 0) {
        for (let k = i; k < j; k++) result.push(records[k]!)
      }
      // 不完整 → 整组丢弃
      i = j
      continue
    }
    if (rec.role === 'tool') {
      // 没有前导 assistant(toolCalls) 的孤立 tool 消息 → 丢弃
      i++
      continue
    }
    result.push(rec)
    i++
  }
  return result
}

/** 内置默认压缩提示词 */
const BUILTIN_COMPRESS_PROMPT = `你是对话压缩助手。请将以下对话历史压缩为一段简洁的摘要，保留关键上下文信息。
要求：
- 保留对话的核心主题、已做出的决定和关键事实
- 省略重复信息和冗余细节
- 输出一段连贯文字
- 语言精炼，像一份上下文备忘录`

/** 用已注入的 LLMAdapter 创建内置默认 compressFn */
export function createBuiltinCompressFn(llm: LLMAdapter): CompressFn {
  return async (messages) => {
    const content = messages.map((m) => `${m.role}: ${m.content}`).join('\n')
    const result = await llm.complete([
      { role: 'system', content: BUILTIN_COMPRESS_PROMPT },
      { role: 'user', content: `对话记录:\n${content}` },
    ])
    return (result.content ?? '').replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim()
  }
}

/** 粗估消息的 token 数（字符数 / 4） */
function estimateTokens(messages: Message[]): number {
  return messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0)
}

/** 按 token 预算从最近的 L3 往前填充，保证 tool call 组完整性 */
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
  // 确保不从 tool call 组中间截断：如果 startIndex 落在 tool 消息上，
  // 向前找到对应的 assistant(toolCalls) 并一起包含；若预算不够则跳过整个组
  while (startIndex < history.length) {
    const msg = history[startIndex]!
    if (msg.role === 'tool') {
      // 向前找 assistant(toolCalls)
      let assistantIdx = startIndex - 1
      while (assistantIdx >= 0 && history[assistantIdx]!.role === 'tool') {
        assistantIdx--
      }
      if (assistantIdx >= 0 && history[assistantIdx]!.role === 'assistant' && history[assistantIdx]!.toolCalls?.length) {
        startIndex = assistantIdx
      } else {
        // 找不到对应的 assistant → 跳过这些孤立 tool 消息
        startIndex++
        continue
      }
      break
    }
    if (msg.role === 'assistant' && msg.toolCalls?.length) {
      // 已经在 assistant(toolCalls) 上，检查后面的 tool 消息是否都在范围内
      break
    }
    break
  }
  return history.slice(startIndex)
}

/** 压缩缓存：避免每次 send() 都调 compressFn */
export interface CompressionCache {
  /** 压缩摘要文本 */
  summary: string
  /** 摘要覆盖的消息数（从 history[0] 起） */
  compressedCount: number
}

/** 自动压缩的配置参数 */
export interface CompressContext {
  /** 模型上下文窗口大小（token 数） */
  maxContextTokens: number
  /** 上次 send() 返回的 promptTokens，用于估算（首次为 null） */
  lastPromptTokens: number | null
  /** 上下文压缩函数（超阈值时调用），由 Session 闭包保证始终存在 */
  compressFn: CompressFn
  /** 压缩缓存（Session 闭包持有，跨 send() 复用） */
  compressionCache?: CompressionCache | null
}

/** 压缩阈值：超过 80% 上下文窗口时触发 */
const COMPRESS_THRESHOLD = 0.8

/** 首次压缩时预留给摘要的 token 估值 */
const ESTIMATED_SUMMARY_TOKENS = 500

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
  /** 更新后的压缩缓存（调用方应回写） */
  compressionCache?: CompressionCache | null
}

/** 根据 label 生成 <session_identity> 系统消息；label 空或 undefined 时返回空数组 */
export function buildSessionIdentityMessages(label: string | undefined): Message[] {
  if (!label) return []
  return [{
    role: 'system',
    content: `<session_identity>\n你当前在「${label}」子会话中。\n</session_identity>`,
  }]
}

/**
 * 组装 Session 上下文，支持自动压缩
 *
 * 默认全量回放。当估算 token 数超过 maxContextTokens * 0.8 时，
 * 调用 compressFn 生成摘要，注入 system + 摘要 + 近期 L3。
 *
 * 若传入 `label`（非空）则在 systemPrompt 之后插入 `<session_identity>` 系统消息，
 * 让子 session 感知自己的身份标签。
 */
export async function assembleSessionContext(
  sessionId: string,
  storage: SessionStorage,
  userContent: string,
  compress: CompressContext,
  label?: string,
): Promise<AssembleResult> {
  const prefixMessages: Message[] = []
  let insightConsumed = false

  // 1. system prompt
  const sysPrompt = await storage.getSystemPrompt(sessionId)
  if (sysPrompt) {
    prefixMessages.push({ role: 'system', content: sysPrompt })
  }

  // 2. session identity (label)
  prefixMessages.push(...buildSessionIdentityMessages(label))

  // 3. insight
  const insightContent = await storage.getInsight(sessionId)
  if (insightContent) {
    prefixMessages.push({ role: 'system', content: insightContent })
    insightConsumed = true
  }

  const userTimestamp = new Date().toISOString()
  const userMessage: Message = { role: 'user', content: userContent, timestamp: userTimestamp }

  // 净化历史：移除中断/崩溃残留的不完整 tool call 组，保证送给 LLM 的 prompt 协议合法
  const history = removeIncompleteToolCallGroups(await storage.listRecords(sessionId))

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

  // 超阈值 → 调用 compressFn 压缩
  return compressWithFn(prefixMessages, history, userMessage, threshold, compress, insightConsumed, userTimestamp)
}

/** 用 compressFn 做 LLM 摘要式压缩 */
async function compressWithFn(
  prefix: Message[],
  history: Message[],
  userMessage: Message,
  threshold: number,
  compress: CompressContext,
  insightConsumed: boolean,
  userTimestamp: string,
): Promise<AssembleResult> {
  const fixedTokens = estimateTokens([...prefix, userMessage])

  // 先用摘要预估大小计算近期消息预算
  const cachedSummary = compress.compressionCache?.summary
  const summaryEstimate = cachedSummary
    ? Math.ceil(cachedSummary.length / 4)
    : ESTIMATED_SUMMARY_TOKENS
  const recentBudget = threshold - fixedTokens - summaryEstimate
  const recentMessages = recentBudget > 0
    ? selectHistoryByBudget(history, recentBudget)
    : []

  // 待压缩 = 近期消息之前的部分
  const compressCount = history.length - recentMessages.length

  if (compressCount === 0) {
    // 所有消息都在近期范围内，无需压缩
    return {
      messages: [...prefix, ...history, userMessage],
      insightConsumed,
      userTimestamp,
      compressed: false,
    }
  }

  // 检查缓存
  let summary: string
  let newCache: CompressionCache
  if (compress.compressionCache && compress.compressionCache.compressedCount === compressCount) {
    summary = compress.compressionCache.summary
    newCache = compress.compressionCache
  } else {
    const messagesToCompress = history.slice(0, compressCount)
    summary = await compress.compressFn!(messagesToCompress)
    newCache = { summary, compressedCount: compressCount }
  }

  // 用实际摘要大小重新计算近期消息预算
  const summaryMessage: Message = { role: 'system', content: summary }
  const actualFixedTokens = estimateTokens([...prefix, summaryMessage, userMessage])
  const actualBudget = threshold - actualFixedTokens
  const finalRecent = actualBudget > 0
    ? selectHistoryByBudget(history, actualBudget)
    : []

  return {
    messages: [...prefix, summaryMessage, ...finalRecent, userMessage],
    insightConsumed,
    userTimestamp,
    compressed: true,
    compressionCache: newCache,
  }
}

/**
 * 组装 MainSession 上下文，支持自动压缩
 *
 * MainSession 始终注入 synthesis。超阈值时调用 compressFn 压缩 + 近期 L3。
 */
export async function assembleMainSessionContext(
  sessionId: string,
  storage: SessionStorage,
  userContent: string,
  compress: CompressContext,
): Promise<{ messages: Message[]; userTimestamp: string; compressed: boolean; compressionCache?: CompressionCache | null }> {
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

  // 净化历史：与 assembleSessionContext 对称，避免不完整 tool call 组流入 prompt
  const history = removeIncompleteToolCallGroups(await storage.listRecords(sessionId))

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

  // 超阈值 → 调用 compressFn 压缩
  const fixedTokens = estimateTokens([...prefixMessages, userMessage])
  const cachedSummary = compress.compressionCache?.summary
  const summaryEstimate = cachedSummary
    ? Math.ceil(cachedSummary.length / 4)
    : ESTIMATED_SUMMARY_TOKENS
  const recentBudget = threshold - fixedTokens - summaryEstimate
  const recentMessages = recentBudget > 0
    ? selectHistoryByBudget(history, recentBudget)
    : []

  const compressCount = history.length - recentMessages.length

  if (compressCount === 0) {
    return { messages: fullMessages, userTimestamp, compressed: false }
  }

  let summary: string
  let newCache: CompressionCache
  if (compress.compressionCache && compress.compressionCache.compressedCount === compressCount) {
    summary = compress.compressionCache.summary
    newCache = compress.compressionCache
  } else {
    summary = await compress.compressFn(history.slice(0, compressCount))
    newCache = { summary, compressedCount: compressCount }
  }

  const summaryMessage: Message = { role: 'system', content: summary }
  const actualFixedTokens = estimateTokens([...prefixMessages, summaryMessage, userMessage])
  const actualBudget = threshold - actualFixedTokens
  const finalRecent = actualBudget > 0
    ? selectHistoryByBudget(history, actualBudget)
    : []

  return {
    messages: [...prefixMessages, summaryMessage, ...finalRecent, userMessage],
    userTimestamp,
    compressed: true,
    compressionCache: newCache,
  }
}
