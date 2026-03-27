import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import 'highlight.js/styles/atom-one-dark.css'
import {
  Search,
  Zap,
  Wrench,
  Terminal,
  ArrowUp,
  ArrowDownRight,
  Loader2,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Clock,
} from 'lucide-react'
import { fetchSessions, fetchConfig, fetchSessionDetail, enterSession, consolidateSession, type AgentConfig, type SessionDetail } from '@/lib/api'
import { useI18n } from '@/lib/i18n'

/** 可点击的 Tool/Skill badge，展开显示详情列表 */
function CapabilityPopover({
  icon: Icon,
  iconClass,
  label,
  items,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>
  iconClass: string
  label: string
  items: Array<{ name: string; description: string; parameters?: Record<string, unknown> }>
}) {
  const [open, setOpen] = useState(false)
  const [expandedItem, setExpandedItem] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-2.5 py-1 bg-surface rounded-md border border-border hover:border-primary/50 transition-colors cursor-pointer"
      >
        <Icon size={12} className={iconClass} />
        <span className="text-[11px] font-medium text-text-secondary">{items.length} {label}</span>
        <ChevronDown size={10} className={`text-text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && items.length > 0 && (
        <div className="absolute top-full right-0 mt-1 w-72 bg-card rounded-lg border border-border shadow-lg z-50 py-1 pop-enter max-h-80 overflow-y-auto">
          {items.map((item) => (
            <div key={item.name} className="border-b border-border/30 last:border-b-0">
              <button
                onClick={() => setExpandedItem(expandedItem === item.name ? null : item.name)}
                className="flex items-center justify-between w-full px-3 py-2 text-left hover:bg-surface transition-colors"
              >
                <span className="text-[11px] font-medium text-text">{item.name}</span>
                {expandedItem === item.name
                  ? <ChevronDown size={10} className="text-text-muted shrink-0" />
                  : <ChevronRight size={10} className="text-text-muted shrink-0" />
                }
              </button>
              {expandedItem === item.name && (
                <div className="px-3 pb-2 space-y-1.5">
                  <p className="text-[10px] text-text-secondary leading-relaxed">{item.description}</p>
                  {item.parameters && Object.keys(item.parameters).length > 0 && (
                    <pre className="text-[9px] font-mono bg-surface rounded p-2 text-text-muted overflow-x-auto max-h-40 overflow-y-auto">
                      {JSON.stringify(item.parameters, null, 2)}
                    </pre>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Session 列表项 */
interface SessionItem {
  id: string
  label: string
  turns: number
  status: 'active' | 'archived'
  color: string
}

/** Tool call 详情 */
interface ToolCallInfo {
  id: string
  name: string
  args: string
  result?: string
  success?: boolean
  duration?: number
}

/** Turn 统计 */
interface TurnStats {
  toolRoundCount: number
  toolCallsExecuted: number
}

/** 对话消息 */
interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
  toolCalls?: ToolCallInfo[]
  turnStats?: TurnStats
}

/** 过滤 think 标签——提取 think 内容和正文 */
function parseThinkContent(text: string): { think: string | null; content: string } {
  const thinkMatch = text.match(/<think>([\s\S]*?)<\/think>/)
  const think = thinkMatch ? thinkMatch[1]!.trim() : null
  const content = text.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim()
  return { think, content }
}

/** Markdown 渲染的 assistant 消息 */
function MarkdownMessage({ text, streaming }: { text: string; streaming?: boolean }) {
  const { t } = useI18n()
  const { think, content } = useMemo(() => parseThinkContent(text), [text])
  const displayText = content || (streaming ? '' : text)

  return (
    <div className="space-y-2">
      {think && (
        <details className="group">
          <summary className="text-[10px] text-text-muted cursor-pointer hover:text-text-secondary transition-colors">
            {t('conv.thinking')}
          </summary>
          <div className="mt-1 px-3 py-2 bg-surface rounded-lg border border-border/30 text-[11px] text-text-muted leading-relaxed whitespace-pre-wrap">
            {think}
          </div>
        </details>
      )}
      <div className="prose-sm max-w-none text-text [&_p]:my-1 [&_p]:text-[13px] [&_p]:leading-relaxed [&_p]:text-text [&_ul]:my-1 [&_ol]:my-1 [&_li]:text-[13px] [&_li]:text-text [&_strong]:text-text [&_strong]:font-semibold [&_h1]:text-base [&_h1]:text-text [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:text-text [&_h3]:text-[13px] [&_h3]:text-text [&_code]:text-[11px] [&_code]:bg-surface [&_code]:text-primary-dark [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_pre]:bg-[#2a2520] [&_pre]:text-[#e5e4e1] [&_pre]:rounded-lg [&_pre]:p-3 [&_pre]:text-[11px] [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[#e5e4e1] [&_blockquote]:border-l-2 [&_blockquote]:border-primary/30 [&_blockquote]:pl-3 [&_blockquote]:text-text-secondary [&_a]:text-primary [&_a]:underline [&_table]:text-[12px] [&_th]:px-2 [&_th]:py-1 [&_td]:px-2 [&_td]:py-1 [&_th]:bg-surface [&_th]:border-b [&_th]:border-border [&_hr]:border-border">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>{displayText}</ReactMarkdown>
      </div>
      {streaming && <span className="inline-block w-1.5 h-4 bg-primary/60 animate-pulse rounded-sm" />}
    </div>
  )
}

/** 折叠式 tool call 卡片 */
function ToolCallCard({ toolCall }: { toolCall: ToolCallInfo }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const hasResult = toolCall.result !== undefined

  return (
    <div className="border border-border/40 rounded-lg overflow-hidden bg-card/50">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-surface/50 transition-colors"
      >
        {open ? <ChevronDown size={12} className="text-text-muted shrink-0" /> : <ChevronRight size={12} className="text-text-muted shrink-0" />}
        <Terminal size={12} className="text-primary shrink-0" />
        <span className="text-[11px] font-semibold text-primary-dark">{toolCall.name}</span>
        {hasResult && (
          toolCall.success
            ? <CheckCircle2 size={11} className="text-success shrink-0" />
            : <XCircle size={11} className="text-error shrink-0" />
        )}
        {!hasResult && <Loader2 size={11} className="text-text-muted animate-spin shrink-0" />}
        {toolCall.duration !== undefined && (
          <span className="flex items-center gap-0.5 text-[10px] text-text-muted ml-auto">
            <Clock size={9} />
            {toolCall.duration}ms
          </span>
        )}
      </button>
      {open && (
        <div className="border-t border-border/30 px-3 py-2 space-y-2">
          <div>
            <p className="text-[9px] font-semibold text-text-muted tracking-wide mb-1">{t('conv.arguments')}</p>
            <pre className="text-[10px] font-mono bg-surface rounded p-2 text-text-secondary overflow-x-auto max-h-32 overflow-y-auto">{toolCall.args}</pre>
          </div>
          {toolCall.result !== undefined && (
            <div>
              <p className="text-[9px] font-semibold text-text-muted tracking-wide mb-1">{t('conv.result')}</p>
              <pre className={`text-[10px] font-mono bg-surface rounded p-2 overflow-x-auto max-h-32 overflow-y-auto ${toolCall.success ? 'text-text-secondary' : 'text-error'}`}>{toolCall.result}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** 角色 badge */
function RoleBadge({ role }: { role: 'user' | 'asst' | 'tool' }) {
  const styles = {
    user: 'bg-primary-light text-primary',
    asst: 'bg-muted text-text-secondary',
    tool: 'bg-[#FFF5EE] text-primary',
  }
  return (
    <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${styles[role]}`}>
      {role}
    </span>
  )
}

/** Conversation 对话栏页面 */
export function Conversation() {
  const { t } = useI18n()
  const [searchParams] = useSearchParams()
  const initialSessionId = searchParams.get('session')
  const [sessions, setSessions] = useState<SessionItem[]>([])
  const [selectedSession, setSelectedSession] = useState<SessionItem | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [detail, setDetail] = useState<SessionDetail | null>(null)
  const [activeTab, setActiveTab] = useState<'l3' | 'l2' | 'insights' | 'prompt'>('l3')
  const [inputValue, setInputValue] = useState('')
  const [sendingSessions, setSendingSessions] = useState<Set<string>>(new Set())
  const [consolidating, setConsolidating] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [config, setConfig] = useState<AgentConfig | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const nextIdRef = useRef(100)

  /** 拉取 session 列表 */
  const refreshSessions = useCallback(() => {
    fetchSessions()
      .then(({ sessions: list }) => {
        const all = list.map((s, i) => ({
          id: s.id,
          label: s.label,
          turns: s.turnCount ?? 0,
          status: s.status,
          color: i === 0 ? '#C4A882' : s.status === 'archived' ? '#D89575' : '#B8956A',
        }))
        setSessions(all)
        setLoadError(null)
        return all
      })
      .catch((err: Error) => setLoadError(err.message))
  }, [])

  /* 初始加载 */
  useEffect(() => {
    fetchSessions()
      .then(({ sessions: list }) => {
        const all = list.map((s, i) => ({
          id: s.id,
          label: s.label,
          turns: s.turnCount ?? 0,
          status: s.status,
          color: i === 0 ? '#C4A882' : s.status === 'archived' ? '#D89575' : '#B8956A',
        }))
        setSessions(all)
        const target = initialSessionId ? all.find((s) => s.id === initialSessionId) : null
        setSelectedSession(target ?? all[0] ?? null)
        setLoadError(null)
      })
      .catch((err: Error) => setLoadError(err.message))
    fetchConfig().then(setConfig).catch(() => {})
  }, [])

  /* 监听 WS 事件——fork/archive 时刷新列表 + 5s 轮询兜底 */
  useEffect(() => {
    const timer = setInterval(refreshSessions, 5_000)

    /* 组件自管理 WS 连接 */
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = `${protocol}//${window.location.host}/ws`
    let ws: WebSocket | null = null
    let closed = false

    function connect() {
      if (closed) return
      try { ws = new WebSocket(url) } catch { return }
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as Record<string, unknown>
          const type = msg['type'] as string
          if (type === 'fork.created' || type === 'session.left' || type === 'session.archived') {
            refreshSessions()
          }
        } catch { /* ignore */ }
      }
      ws.onclose = () => { if (!closed) setTimeout(connect, 3000) }
      ws.onerror = () => ws?.close()
    }

    connect()
    return () => { closed = true; ws?.close(); clearInterval(timer) }
  }, [refreshSessions])

  /* 切换 session 时拉取 detail（L2/scope）+ 历史 records */
  useEffect(() => {
    if (!selectedSession) return
    setMessages([])
    setDetail(null)
    fetchSessionDetail(selectedSession.id)
      .then((d) => {
        setDetail(d)
        const records = d?.records ?? []
        if (records.length > 0) {
          const msgs: ChatMessage[] = records.map((r, i) => ({
            id: `hist-${i}`,
            role: r.role === 'user' ? 'user' as const : 'assistant' as const,
            content: r.content ?? '',
          }))
          setMessages(msgs)
        }
      })
      .catch(() => {
        setDetail(null)
      })
  }, [selectedSession?.id])

  /* 消息列表自动滚到底部 */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [selectedSession, messages])

  /** 发送消息——NDJSON 流式输出 */
  const handleSend = async () => {
    const text = inputValue.trim()
    if (!text || !selectedSession || sendingSessions.has(selectedSession.id)) return

    const sendingSessionId = selectedSession.id
    const userMsg: ChatMessage = { id: String(nextIdRef.current++), role: 'user', content: text }
    setMessages((prev) => [...prev, userMsg])
    setInputValue('')
    setSendingSessions((prev) => new Set(prev).add(sendingSessionId))

    const botId = String(nextIdRef.current++)
    /* 先创建空的 streaming 占位 */
    setMessages((prev) => [...prev, { id: botId, role: 'assistant', content: '', streaming: true }])

    try {
      /* enter session */
      await enterSession(selectedSession.id).catch(() => {})

      /* 流式请求——用 demo server 的 /stream NDJSON 端点 */
      const res = await fetch(`/api/sessions/${selectedSession.id}/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: text }),
      })

      if (!res.ok || !res.body) {
        /* fallback REST turn */
        const turnRes = await fetch(`/api/sessions/${selectedSession.id}/turn`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: text }),
        })
        const result = await turnRes.json()
        const content = result?.turn?.finalContent ?? result?.turn?.rawResponse ?? JSON.stringify(result)
        setMessages((prev) => prev.map((m) => m.id === botId ? { ...m, content, streaming: false } : m))
      } else {
        /* 逐行读取 NDJSON */
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let fullContent = ''
        const pendingToolCalls: ToolCallInfo[] = []

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            if (!line.trim()) continue
            try {
              const chunk = JSON.parse(line) as Record<string, unknown>
              if (chunk['type'] === 'delta') {
                const delta = String(chunk['delta'] ?? '')
                fullContent += delta
                setMessages((prev) => prev.map((m) => m.id === botId ? { ...m, content: fullContent } : m))
              } else if (chunk['type'] === 'tool_call') {
                const tc = chunk['toolCall'] as Record<string, unknown>
                pendingToolCalls.push({
                  id: String(tc['id'] ?? tc['name']),
                  name: String(tc['name']),
                  args: typeof tc['args'] === 'object' ? JSON.stringify(tc['args'], null, 2) : String(tc['args'] ?? ''),
                })
                setMessages((prev) => prev.map((m) => m.id === botId ? { ...m, toolCalls: [...pendingToolCalls] } : m))
              } else if (chunk['type'] === 'tool_result') {
                const tr = chunk['result'] as Record<string, unknown>
                const callId = String(tr['toolCallId'] ?? tr['toolName'])
                const idx = pendingToolCalls.findIndex((tc) => tc.id === callId)
                if (idx >= 0) {
                  pendingToolCalls[idx] = {
                    ...pendingToolCalls[idx]!,
                    success: tr['success'] as boolean,
                    result: typeof tr['data'] === 'object' ? JSON.stringify(tr['data'], null, 2) : String(tr['data'] ?? ''),
                    duration: tr['duration'] as number | undefined,
                  }
                  setMessages((prev) => prev.map((m) => m.id === botId ? { ...m, toolCalls: [...pendingToolCalls] } : m))
                }
              } else if (chunk['type'] === 'done') {
                const result = chunk['result'] as Record<string, unknown> | undefined
                const turn = result?.['turn'] as Record<string, unknown> | undefined
                const finalContent = turn?.['finalContent'] ?? turn?.['rawResponse'] ?? fullContent
                const turnStats: TurnStats | undefined = turn ? {
                  toolRoundCount: (turn['toolRoundCount'] as number) ?? 0,
                  toolCallsExecuted: (turn['toolCallsExecuted'] as number) ?? 0,
                } : undefined
                setMessages((prev) => prev.map((m) => m.id === botId ? { ...m, content: String(finalContent), streaming: false, toolCalls: pendingToolCalls.length > 0 ? [...pendingToolCalls] : m.toolCalls, turnStats } : m))
              }
            } catch { /* ignore parse error */ }
          }
        }
        /* 确保 streaming 标记关闭 */
        setMessages((prev) => prev.map((m) => m.id === botId ? { ...m, streaming: false } : m))
      }

      /* 刷新 detail 和 session 列表 */
      setTimeout(() => {
        fetchSessionDetail(selectedSession.id).then(setDetail).catch(() => {})
        refreshSessions()
      }, 500)
    } catch (err) {
      setMessages((prev) => prev.map((m) => m.id === botId
        ? { ...m, content: `⚠ Error: ${err instanceof Error ? err.message : 'Failed to send'}`, streaming: false }
        : m
      ))
    } finally {
      setSendingSessions((prev) => { const next = new Set(prev); next.delete(sendingSessionId); return next })
    }
  }

  if (loadError) {
    return (
      <div className="flex items-center justify-center h-full bg-surface">
        <div className="bg-card border border-error/30 rounded-lg px-6 py-4 max-w-md text-center">
          <p className="text-sm font-semibold text-error mb-1">{t('conv.loadFailed')}</p>
          <p className="text-xs text-text-muted">{loadError}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full">
      {/* 左侧 Session 列表 */}
      <div className="w-60 bg-card border-r border-border flex flex-col shrink-0">
        <div className="flex items-center justify-between px-4 pt-4 pb-3">
          <span className="text-sm font-semibold text-text">{t('conv.sessions')}</span>
          <span className="text-xs text-text-muted">{sessions.length}</span>
        </div>
        <div className="px-3 pb-2">
          <div className="flex items-center gap-2 px-2.5 h-8 bg-surface rounded-lg border border-border">
            <Search size={14} className="text-text-muted shrink-0" />
            <input type="text" placeholder={t('conv.filterSessions')} className="flex-1 bg-transparent text-xs outline-none placeholder:text-text-muted" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => setSelectedSession(s)}
              className={`flex items-center gap-2.5 w-full px-4 py-2.5 text-left transition-colors ${
                selectedSession?.id === s.id ? 'bg-primary-light' : 'hover:bg-surface'
              }`}
            >
              <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
              <div className="flex-1 min-w-0">
                <div className={`text-[13px] truncate ${selectedSession?.id === s.id ? 'font-semibold text-text' : 'font-medium text-text'}`}>
                  {s.label}
                </div>
                <div className="text-[10px] text-text-secondary">
                  {s.turns} {t('common.turns')} · {s.status === 'active' ? t('common.active') : t('common.archived')}
                  {sendingSessions.has(s.id) && <span className="ml-1 text-primary animate-pulse">●</span>}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* 中间对话区 */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between h-13 px-5 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: selectedSession?.color ?? '#9C9B99' }} />
            <span className="text-[15px] font-semibold text-text">{selectedSession?.label ?? t('conv.noSession')}</span>
            {selectedSession && (
              <span className="text-[10px] font-medium text-text-secondary bg-muted px-2 py-0.5 rounded-full">
                {selectedSession.turns} turns
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <CapabilityPopover
              icon={Zap}
              iconClass="text-[#D89575]"
              label={t('conv.skills')}
              items={(config?.capabilities.skills ?? []).map((s) => ({ name: s.name, description: s.description }))}
            />
            <CapabilityPopover
              icon={Wrench}
              iconClass="text-text-secondary"
              label={t('conv.tools')}
              items={config?.capabilities.tools ?? []}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-surface px-6 py-5 space-y-4">
          {messages.length === 0 && !(selectedSession && sendingSessions.has(selectedSession.id)) && (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-text-muted">{t('conv.noMessages')}</p>
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={msg.id} className="page-enter" style={{ animationDelay: `${i * 50}ms`, animationFillMode: 'both' }}>
              {msg.role === 'user' ? (
                <div className="flex justify-end">
                  <div className="bg-primary text-white rounded-xl rounded-br-sm px-3.5 py-2.5 max-w-md transition-shadow hover:shadow-lg">
                    <p className="text-[13px] leading-relaxed">{msg.content}</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="bg-card rounded-xl rounded-bl-sm px-3.5 py-2.5 max-w-lg shadow-sm border border-border/30 transition-shadow hover:shadow-md">
                    <MarkdownMessage text={msg.content} streaming={msg.streaming} />
                  </div>
                  {msg.toolCalls && msg.toolCalls.length > 0 && (
                    <div className="space-y-1.5 max-w-lg">
                      {msg.toolCalls.map((tc) => (
                        <ToolCallCard key={tc.id} toolCall={tc} />
                      ))}
                    </div>
                  )}
                  {msg.turnStats && (msg.turnStats.toolRoundCount > 0 || msg.turnStats.toolCallsExecuted > 0) && (
                    <div className="flex items-center gap-3 text-[10px] text-text-muted">
                      <span>{msg.turnStats.toolRoundCount} {t('conv.toolRounds')}</span>
                      <span>{msg.turnStats.toolCallsExecuted} {t('conv.toolCalls')}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <div className="flex items-center gap-2.5 h-14 px-5 border-t border-border bg-card shrink-0">
          <div className="flex items-center gap-2 flex-1 h-9 px-3 bg-surface rounded-[10px] border border-border transition-all duration-200 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10">
            <Terminal size={14} className="text-text-muted shrink-0" />
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); handleSend() } }}
              placeholder={t('conv.sendPlaceholder')}
              className="flex-1 bg-transparent text-xs outline-none placeholder:text-text-muted"
            />
          </div>
          <button
            onClick={handleSend}
            disabled={!inputValue.trim() || !!(selectedSession && sendingSessions.has(selectedSession.id))}
            className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all duration-200 ${
              inputValue.trim() && !(selectedSession && sendingSessions.has(selectedSession.id))
                ? 'bg-primary hover:bg-primary/90 scale-100 shadow-md'
                : 'bg-primary/40 scale-95'
            }`}
          >
            {selectedSession && sendingSessions.has(selectedSession.id) ? <Loader2 size={16} className="text-white animate-spin" /> : <ArrowUp size={16} className="text-white" />}
          </button>
        </div>
      </div>

      {/* 右侧上下文面板——从 API detail 读取真实数据 */}
      <div className="w-75 bg-card border-l border-border flex flex-col shrink-0">
        <div className="flex items-center h-13 px-4 border-b border-border">
          <span className="text-sm font-semibold text-text">{t('conv.context')}</span>
        </div>

        <div className="flex px-4 border-b border-border">
          {(['l3', 'l2', 'insights', 'prompt'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-2.5 text-xs font-medium transition-colors ${
                activeTab === tab ? 'text-primary border-b-2 border-primary' : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              {tab === 'l3' ? 'L3' : tab === 'l2' ? 'L2' : tab === 'insights' ? 'Insights' : 'Prompt'}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto bg-surface p-4 space-y-3">
          {activeTab === 'l3' && (
            <>
              <p className="text-[10px] font-semibold text-text-muted tracking-wide">
                {t('conv.l3History')} ({detail?.records.length ?? messages.length} {t('conv.records')})
              </p>
              {(detail?.records.length ?? 0) > 0 ? (
                <div className="bg-card rounded-lg p-3 shadow-sm border border-border/30 space-y-2 overflow-y-auto">
                  {detail!.records.map((r, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <RoleBadge role={r.role === 'user' ? 'user' : r.role === 'system' ? 'tool' : 'asst'} />
                      <span className="text-[11px] text-text-secondary">
                        {(() => { const c = parseThinkContent(r.content).content || r.content; return c.length > 100 ? c.slice(0, 100) + '...' : c })()}
                      </span>
                    </div>
                  ))}
                </div>
              ) : messages.length > 0 ? (
                <div className="bg-card rounded-lg p-3 shadow-sm border border-border/30 space-y-2 overflow-y-auto">
                  {messages.map((m, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <RoleBadge role={m.role === 'user' ? 'user' : 'asst'} />
                      <span className="text-[11px] text-text-secondary">
                        {(() => { const c = parseThinkContent(m.content).content || m.content; return c.length > 100 ? c.slice(0, 100) + '...' : c })()}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-text-muted italic">{t('conv.noRecords')}</p>
              )}
            </>
          )}

          {activeTab === 'l2' && (
            <>
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold text-text-muted tracking-wide">{t('conv.l2Memory')}</p>
                <button
                  onClick={async () => {
                    if (!selectedSession || consolidating) return
                    setConsolidating(true)
                    try {
                      const result = await consolidateSession(selectedSession.id)
                      setDetail((prev) => prev ? { ...prev, l2: result.l2 } : prev)
                    } catch (err) {
                      alert(`Consolidation failed: ${err instanceof Error ? err.message : err}`)
                    } finally {
                      setConsolidating(false)
                    }
                  }}
                  disabled={consolidating || !selectedSession}
                  className="flex items-center gap-1 px-2 py-1 bg-primary/10 hover:bg-primary/20 rounded-md transition-colors disabled:opacity-40"
                >
                  {consolidating
                    ? <Loader2 size={10} className="text-primary animate-spin" />
                    : <Zap size={10} className="text-primary" />
                  }
                  <span className="text-[10px] font-medium text-primary">
                    {consolidating ? t('conv.generating') : detail?.l2 ? t('conv.regenerate') : t('conv.generateL2')}
                  </span>
                </button>
              </div>
              {detail?.l2 ? (
                <div className="bg-card rounded-lg p-3 shadow-sm border border-border/30 mt-2">
                  <div className="flex items-center gap-1 mb-2">
                    <span className="text-[10px] font-medium text-success bg-[#E8F5E9] px-1.5 py-0.5 rounded">{t('conv.consolidated')}</span>
                  </div>
                  <p className="text-[11px] text-text-secondary leading-relaxed">{detail.l2}</p>
                </div>
              ) : (
                <p className="text-[11px] text-text-muted italic mt-2">{t('conv.noL2')}</p>
              )}
            </>
          )}

          {activeTab === 'insights' && (
            <>
              <p className="text-[10px] font-semibold text-text-muted tracking-wide">{t('conv.insightsScope')}</p>
              {detail?.scope ? (
                <div className="bg-card rounded-lg p-3 shadow-sm border border-border/30">
                  <div className="flex items-center gap-1 mb-1.5">
                    <ArrowDownRight size={10} className="text-primary" />
                    <span className="text-[10px] font-medium text-primary">{t('conv.fromMain')}</span>
                  </div>
                  <p className="text-[11px] text-text-secondary leading-relaxed">{detail.scope}</p>
                </div>
              ) : (
                <p className="text-[11px] text-text-muted italic">{t('conv.noInsights')}</p>
              )}
            </>
          )}

          {activeTab === 'prompt' && (
            <>
              <p className="text-[10px] font-semibold text-text-muted tracking-wide">{t('conv.sessionInfo')}</p>
              {detail?.meta ? (
                <div className="bg-card rounded-lg p-3 shadow-sm border border-border/30 space-y-1.5">
                  {[
                    { label: t('conv.id'), value: detail.meta.id },
                    { label: t('conv.label'), value: detail.meta.label },
                    { label: t('conv.status'), value: detail.meta.status },
                    { label: 'Turns', value: String(detail.meta.turnCount) },
                    { label: t('conv.created'), value: new Date(detail.meta.createdAt).toLocaleString() },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex justify-between">
                      <span className="text-[11px] font-medium text-text-muted">{label}</span>
                      <span className="text-[11px] font-medium text-text">{value}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-text-muted italic">{t('conv.selectSession')}</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
