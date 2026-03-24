import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Search,
  Zap,
  Wrench,
  Terminal,
  ArrowUp,
  ArrowDownRight,
  Loader2,
} from 'lucide-react'
import { fetchSessions, fetchConfig, fetchSessionDetail, enterSession, consolidateSession, type AgentConfig, type SessionDetail } from '@/lib/api'

/** Session 列表项 */
interface SessionItem {
  id: string
  label: string
  turns: number
  status: 'active' | 'archived'
  color: string
}

/** 对话消息 */
interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
  toolCall?: { name: string; args: string; duration: string }
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
  const { think, content } = useMemo(() => parseThinkContent(text), [text])
  const displayText = content || (streaming ? '' : text)

  return (
    <div className="space-y-2">
      {think && (
        <details className="group">
          <summary className="text-[10px] text-text-muted cursor-pointer hover:text-text-secondary transition-colors">
            Thinking...
          </summary>
          <div className="mt-1 px-3 py-2 bg-surface rounded-lg border border-border/30 text-[11px] text-text-muted leading-relaxed whitespace-pre-wrap">
            {think}
          </div>
        </details>
      )}
      <div className="prose-sm max-w-none text-text [&_p]:my-1 [&_p]:text-[13px] [&_p]:leading-relaxed [&_p]:text-text [&_ul]:my-1 [&_ol]:my-1 [&_li]:text-[13px] [&_li]:text-text [&_strong]:text-text [&_strong]:font-semibold [&_h1]:text-base [&_h1]:text-text [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:text-text [&_h3]:text-[13px] [&_h3]:text-text [&_code]:text-[11px] [&_code]:bg-surface [&_code]:text-primary-dark [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_pre]:bg-[#2a2520] [&_pre]:text-[#e5e4e1] [&_pre]:rounded-lg [&_pre]:p-3 [&_pre]:text-[11px] [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[#e5e4e1] [&_blockquote]:border-l-2 [&_blockquote]:border-primary/30 [&_blockquote]:pl-3 [&_blockquote]:text-text-secondary [&_a]:text-primary [&_a]:underline [&_table]:text-[12px] [&_th]:px-2 [&_th]:py-1 [&_td]:px-2 [&_td]:py-1 [&_th]:bg-surface [&_th]:border-b [&_th]:border-border [&_hr]:border-border">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayText}</ReactMarkdown>
      </div>
      {streaming && <span className="inline-block w-1.5 h-4 bg-primary/60 animate-pulse rounded-sm" />}
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
  const [searchParams] = useSearchParams()
  const initialSessionId = searchParams.get('session')
  const [sessions, setSessions] = useState<SessionItem[]>([])
  const [selectedSession, setSelectedSession] = useState<SessionItem | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [detail, setDetail] = useState<SessionDetail | null>(null)
  const [activeTab, setActiveTab] = useState<'l3' | 'l2' | 'insights' | 'prompt'>('l3')
  const [inputValue, setInputValue] = useState('')
  const [sending, setSending] = useState(false)
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
    console.log('[Chat] mount, fetching sessions...')
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
    console.log('[Chat] selectedSession changed:', selectedSession?.id, selectedSession?.label)
    if (!selectedSession) return
    setMessages([])
    setDetail(null)
    console.log('[Chat] fetching detail for', selectedSession.id)
    fetchSessionDetail(selectedSession.id)
      .then((d) => {
        console.log('[Chat] detail loaded:', { records: d?.records?.length, l2: !!d?.l2 })
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
    if (!text || sending || !selectedSession) return

    const userMsg: ChatMessage = { id: String(nextIdRef.current++), role: 'user', content: text }
    setMessages((prev) => [...prev, userMsg])
    setInputValue('')
    setSending(true)

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
              } else if (chunk['type'] === 'done') {
                /* 流结束——用完整结果替换 */
                const result = chunk['result'] as Record<string, unknown> | undefined
                const turn = result?.['turn'] as Record<string, unknown> | undefined
                const finalContent = turn?.['finalContent'] ?? turn?.['rawResponse'] ?? fullContent
                setMessages((prev) => prev.map((m) => m.id === botId ? { ...m, content: String(finalContent), streaming: false } : m))
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
      setSending(false)
    }
  }

  if (loadError) {
    return (
      <div className="flex items-center justify-center h-full bg-surface">
        <div className="bg-card border border-error/30 rounded-lg px-6 py-4 max-w-md text-center">
          <p className="text-sm font-semibold text-error mb-1">Failed to load sessions</p>
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
          <span className="text-sm font-semibold text-text">Sessions</span>
          <span className="text-xs text-text-muted">{sessions.length}</span>
        </div>
        <div className="px-3 pb-2">
          <div className="flex items-center gap-2 px-2.5 h-8 bg-surface rounded-lg border border-border">
            <Search size={14} className="text-text-muted shrink-0" />
            <input type="text" placeholder="Filter sessions..." className="flex-1 bg-transparent text-xs outline-none placeholder:text-text-muted" />
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
                  {s.turns} turns · {s.status === 'active' ? 'Active' : 'Archived'}
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
            <span className="text-[15px] font-semibold text-text">{selectedSession?.label ?? 'No session'}</span>
            {selectedSession && (
              <span className="text-[10px] font-medium text-text-secondary bg-muted px-2 py-0.5 rounded-full">
                {selectedSession.turns} turns
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 px-2.5 py-1 bg-surface rounded-md border border-border">
              <Zap size={12} className="text-[#D89575]" />
              <span className="text-[11px] font-medium text-text-secondary">{config?.capabilities.skills.length ?? 0} Skills</span>
            </div>
            <div className="flex items-center gap-1 px-2.5 py-1 bg-surface rounded-md border border-border">
              <Wrench size={12} className="text-text-secondary" />
              <span className="text-[11px] font-medium text-text-secondary">{config?.capabilities.tools.length ?? 0} Tools</span>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-surface px-6 py-5 space-y-4">
          {messages.length === 0 && !sending && (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-text-muted">No messages yet. Start a conversation below.</p>
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
                  {msg.toolCall && (
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-[#FFF5EE] rounded-lg border border-primary/20 transition-all hover:bg-[#FFF0E5] hover:shadow-sm cursor-pointer">
                      <Terminal size={12} className="text-primary" />
                      <span className="text-[11px] font-medium text-primary-dark">{msg.toolCall.name}({msg.toolCall.args})</span>
                      <span className="text-[10px] text-text-muted">{msg.toolCall.duration}</span>
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
              placeholder="Send a message..."
              className="flex-1 bg-transparent text-xs outline-none placeholder:text-text-muted"
            />
          </div>
          <button
            onClick={handleSend}
            disabled={!inputValue.trim() || sending}
            className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all duration-200 ${
              inputValue.trim() && !sending
                ? 'bg-primary hover:bg-primary/90 scale-100 shadow-md'
                : 'bg-primary/40 scale-95'
            }`}
          >
            {sending ? <Loader2 size={16} className="text-white animate-spin" /> : <ArrowUp size={16} className="text-white" />}
          </button>
        </div>
      </div>

      {/* 右侧上下文面板——从 API detail 读取真实数据 */}
      <div className="w-75 bg-card border-l border-border flex flex-col shrink-0">
        <div className="flex items-center h-13 px-4 border-b border-border">
          <span className="text-sm font-semibold text-text">Context</span>
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
                L3 HISTORY ({detail?.records.length ?? messages.length} RECORDS)
              </p>
              {(detail?.records.length ?? 0) > 0 ? (
                <div className="bg-card rounded-lg p-3 shadow-sm border border-border/30 space-y-2 max-h-80 overflow-y-auto">
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
                <div className="bg-card rounded-lg p-3 shadow-sm border border-border/30 space-y-2 max-h-80 overflow-y-auto">
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
                <p className="text-[11px] text-text-muted italic">No records yet</p>
              )}
            </>
          )}

          {activeTab === 'l2' && (
            <>
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold text-text-muted tracking-wide">L2 MEMORY</p>
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
                    {consolidating ? 'Generating...' : detail?.l2 ? 'Regenerate' : 'Generate L2'}
                  </span>
                </button>
              </div>
              {detail?.l2 ? (
                <div className="bg-card rounded-lg p-3 shadow-sm border border-border/30 mt-2">
                  <div className="flex items-center gap-1 mb-2">
                    <span className="text-[10px] font-medium text-success bg-[#E8F5E9] px-1.5 py-0.5 rounded">consolidated</span>
                  </div>
                  <p className="text-[11px] text-text-secondary leading-relaxed">{detail.l2}</p>
                </div>
              ) : (
                <p className="text-[11px] text-text-muted italic mt-2">No L2 memory yet. Click Generate to create from conversation history.</p>
              )}
            </>
          )}

          {activeTab === 'insights' && (
            <>
              <p className="text-[10px] font-semibold text-text-muted tracking-wide">INSIGHTS / SCOPE</p>
              {detail?.scope ? (
                <div className="bg-card rounded-lg p-3 shadow-sm border border-border/30">
                  <div className="flex items-center gap-1 mb-1.5">
                    <ArrowDownRight size={10} className="text-primary" />
                    <span className="text-[10px] font-medium text-primary">from Main</span>
                  </div>
                  <p className="text-[11px] text-text-secondary leading-relaxed">{detail.scope}</p>
                </div>
              ) : (
                <p className="text-[11px] text-text-muted italic">No insights received</p>
              )}
            </>
          )}

          {activeTab === 'prompt' && (
            <>
              <p className="text-[10px] font-semibold text-text-muted tracking-wide">SESSION INFO</p>
              {detail?.meta ? (
                <div className="bg-card rounded-lg p-3 shadow-sm border border-border/30 space-y-1.5">
                  {[
                    { label: 'ID', value: detail.meta.id },
                    { label: 'Label', value: detail.meta.label },
                    { label: 'Status', value: detail.meta.status },
                    { label: 'Turns', value: String(detail.meta.turnCount) },
                    { label: 'Created', value: new Date(detail.meta.createdAt).toLocaleString() },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex justify-between">
                      <span className="text-[11px] font-medium text-text-muted">{label}</span>
                      <span className="text-[11px] font-medium text-text">{value}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-text-muted italic">Select a session to view info</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
