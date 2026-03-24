import { useState, useRef, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Search,
  Zap,
  Wrench,
  Terminal,
  ArrowUp,
  ArrowDownRight,
  Loader2,
} from 'lucide-react'
import { fetchSessions, fetchConfig, fetchSessionDetail, sendTurn, enterSession, type AgentConfig, type SessionDetail } from '@/lib/api'
import { sendWs, subscribeWs } from '@/lib/ws'

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
  toolCall?: { name: string; args: string; duration: string }
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
  const [loadError, setLoadError] = useState<string | null>(null)
  const [config, setConfig] = useState<AgentConfig | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const nextIdRef = useRef(100)

  /* 从 API 拉取 session 列表 */
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

  /* 切换 session 时拉取 detail（L2/scope）+ 历史 records */
  useEffect(() => {
    if (!selectedSession) return
    setMessages([])
    setDetail(null)
    fetchSessionDetail(selectedSession.id)
      .then((d) => {
        setDetail(d)
        /* 如果有 L3 records，加载为对话历史 */
        if (d.records.length > 0) {
          const msgs: ChatMessage[] = d.records.map((r, i) => ({
            id: `hist-${i}`,
            role: r.role === 'user' ? 'user' as const : 'assistant' as const,
            content: r.content,
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

  /** 发送消息——优先 REST（更可靠） */
  const handleSend = async () => {
    const text = inputValue.trim()
    if (!text || sending || !selectedSession) return

    const userMsg: ChatMessage = { id: String(nextIdRef.current++), role: 'user', content: text }
    setMessages((prev) => [...prev, userMsg])
    setInputValue('')
    setSending(true)

    const botId = String(nextIdRef.current++)

    try {
      /* 先 enter session */
      await enterSession(selectedSession.id).catch(() => {})
      /* 调用 turn */
      const result = await sendTurn(selectedSession.id, text)
      const response = result?.turn?.finalContent ?? result?.turn?.rawResponse ?? JSON.stringify(result)
      setMessages((prev) => [...prev, { id: botId, role: 'assistant', content: response }])
      /* 刷新 detail（可能有新的 L2/records） */
      fetchSessionDetail(selectedSession.id).then(setDetail).catch(() => {})
    } catch (err) {
      setMessages((prev) => [...prev, {
        id: botId,
        role: 'assistant',
        content: `⚠ Error: ${err instanceof Error ? err.message : 'Failed to send'}`,
      }])
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
                    <p className="text-[13px] text-text leading-relaxed whitespace-pre-line">{msg.content}</p>
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
                        {r.content.length > 100 ? r.content.slice(0, 100) + '...' : r.content}
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
                        {m.content.length > 100 ? m.content.slice(0, 100) + '...' : m.content}
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
              <p className="text-[10px] font-semibold text-text-muted tracking-wide">L2 MEMORY</p>
              {detail?.l2 ? (
                <div className="bg-card rounded-lg p-3 shadow-sm border border-border/30">
                  <div className="flex items-center gap-1 mb-2">
                    <span className="text-[10px] font-medium text-success bg-[#E8F5E9] px-1.5 py-0.5 rounded">consolidated</span>
                  </div>
                  <p className="text-[11px] text-text-secondary leading-relaxed">{detail.l2}</p>
                </div>
              ) : (
                <p className="text-[11px] text-text-muted italic">No L2 memory consolidated yet</p>
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
