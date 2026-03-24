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
import { fetchSessions, fetchConfig, fetchSessionDetail, sendTurn, enterSession, type SessionMeta, type AgentConfig, type TurnResult } from '@/lib/api'
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

/** Mock session 列表 */
const mockSessions: SessionItem[] = [
  { id: 'sess-1', label: 'research', turns: 12, status: 'active', color: '#3D8A5A' },
  { id: 'sess-2', label: 'coding', turns: 8, status: 'active', color: '#B8956A' },
  { id: 'sess-main', label: 'Main Session', turns: 24, status: 'active', color: '#C4A882' },
  { id: 'sess-3', label: 'papers', turns: 4, status: 'active', color: '#A8C4A0' },
  { id: 'sess-4', label: 'old-api', turns: 6, status: 'archived', color: '#D89575' },
]

/** Mock 对话 */
const mockMessages: ChatMessage[] = [
  { id: '1', role: 'user', content: 'Search for recent papers on conversation topology' },
  {
    id: '2',
    role: 'assistant',
    content: 'I found 3 relevant papers on conversation branching and session topology. Let me summarize the key findings...',
    toolCall: { name: 'search_papers', args: '{"query": "conversation topology"}', duration: '1.2s' },
  },
  { id: '3', role: 'user', content: 'Can you focus on the ones from 2024?' },
  {
    id: '4',
    role: 'assistant',
    content: 'Filtering for 2024 publications. Here are the two most relevant:\n\n1. "Branching Dialogue Trees for Multi-Agent Systems" — Chen et al.\n2. "Session Topology in LLM Orchestration" — Park & Kim',
    toolCall: { name: 'search_papers', args: '{"query": "...", "year": 2024}', duration: '0.8s' },
  },
]

/** Mock L3 记录 */
const mockL3Records = [
  { role: 'user' as const, text: 'Search for recent papers on...' },
  { role: 'asst' as const, text: 'I found 3 relevant papers...' },
  { role: 'tool' as const, text: 'search_papers → 3 results' },
  { role: 'user' as const, text: 'Can you focus on the ones from 2024?' },
  { role: 'asst' as const, text: 'Filtering for 2024 publications...' },
]

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
  const [sessions, setSessions] = useState(mockSessions)
  const [selectedSession, setSelectedSession] = useState(mockSessions[0]!)
  const [messages, setMessages] = useState<ChatMessage[]>(mockMessages)
  const [activeTab, setActiveTab] = useState<'l3' | 'l2' | 'insights' | 'prompt'>('l3')
  const [inputValue, setInputValue] = useState('')
  const [sending, setSending] = useState(false)
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
        if (all.length > 0) {
          setSessions(all)
          const target = initialSessionId ? all.find((s) => s.id === initialSessionId) : null
          setSelectedSession(target ?? all[0]!)
        }
      })
      .catch(() => {})
    fetchConfig().then(setConfig).catch(() => {})
  }, [])

  /* 切换 session 时拉取该 session 的 L3 对话记录 */
  useEffect(() => {
    fetchSessionDetail(selectedSession.id)
      .then((detail) => {
        if (detail.records.length > 0) {
          const msgs: ChatMessage[] = detail.records.map((r, i) => ({
            id: `hist-${i}`,
            role: r.role === 'user' ? 'user' as const : 'assistant' as const,
            content: r.content,
          }))
          setMessages(msgs)
        } else {
          setMessages([])
        }
      })
      .catch(() => {
        /* API 不可用时保持 mock 数据（首次）或清空 */
        if (selectedSession.id !== mockSessions[0]?.id) {
          setMessages([])
        }
      })
  }, [selectedSession.id])

  /* 消息列表自动滚到底部 */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [selectedSession, messages])

  /** 尝试流式发送（WS），fallback 非流式（REST） */
  const handleSend = async () => {
    const text = inputValue.trim()
    if (!text || sending) return

    const userMsg: ChatMessage = { id: String(nextIdRef.current++), role: 'user', content: text }
    setMessages((prev) => [...prev, userMsg])
    setInputValue('')
    setSending(true)

    const botId = String(nextIdRef.current++)

    /* 先尝试 WS 流式 */
    try {
      /* 先 enter session（如果还没进） */
      sendWs({ type: 'session.enter', sessionId: selectedSession.id })

      /* 创建一个空的 assistant 消息占位 */
      setMessages((prev) => [...prev, { id: botId, role: 'assistant', content: '' }])

      /* 监听流式响应 */
      let resolved = false
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (!resolved) { resolved = true; reject(new Error('Stream timeout')) }
        }, 30000)

        const unsub = subscribeWs((msg) => {
          const type = msg['type'] as string
          if (type === 'stream.delta') {
            const chunk = String(msg['chunk'] ?? '')
            setMessages((prev) =>
              prev.map((m) => m.id === botId ? { ...m, content: m.content + chunk } : m)
            )
          } else if (type === 'stream.end') {
            clearTimeout(timeout)
            unsub()
            resolved = true
            /* 用完整结果替换 */
            const result = msg['result']
            if (result && typeof result === 'object' && 'response' in (result as Record<string, unknown>)) {
              setMessages((prev) =>
                prev.map((m) => m.id === botId ? { ...m, content: String((result as { response: string }).response) } : m)
              )
            }
            resolve()
          } else if (type === 'turn.complete') {
            /* 非流式回退：server 返回了 turn.complete 而不是 stream */
            clearTimeout(timeout)
            unsub()
            resolved = true
            const result = msg['result']
            const response = result && typeof result === 'object' && 'response' in (result as Record<string, unknown>)
              ? String((result as { response: string }).response)
              : JSON.stringify(result)
            setMessages((prev) =>
              prev.map((m) => m.id === botId ? { ...m, content: response } : m)
            )
            resolve()
          } else if (type === 'error') {
            clearTimeout(timeout)
            unsub()
            resolved = true
            reject(new Error(String(msg['message'] ?? 'WS error')))
          }
        })

        sendWs({ type: 'session.stream', input: text })
      })
    } catch {
      /* WS 失败，fallback REST——先 enter 再 turn */
      try {
        await enterSession(selectedSession.id).catch(() => {})
        const result = await sendTurn(selectedSession.id, text)
        const response = result?.turn?.finalContent ?? result?.turn?.rawResponse ?? JSON.stringify(result)
        setMessages((prev) =>
          prev.map((m) => m.id === botId ? { ...m, content: response } : m)
        )
      } catch (err) {
        setMessages((prev) => {
          const existing = prev.find((m) => m.id === botId)
          if (existing && existing.content === '') {
            return prev.map((m) => m.id === botId
              ? { ...m, content: `⚠ Error: ${err instanceof Error ? err.message : 'Failed to send'}` }
              : m)
          }
          return [...prev, {
            id: botId,
            role: 'assistant' as const,
            content: `⚠ Error: ${err instanceof Error ? err.message : 'Failed to send'}`,
          }]
        })
      }
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex h-full">
      {/* 左侧 Session 列表 */}
      <div className="w-60 bg-card border-r border-border flex flex-col shrink-0">
        {/* 列表头 */}
        <div className="flex items-center justify-between px-4 pt-4 pb-3">
          <span className="text-sm font-semibold text-text">Sessions</span>
          <span className="text-xs text-text-muted">{sessions.length}</span>
        </div>
        {/* 搜索 */}
        <div className="px-3 pb-2">
          <div className="flex items-center gap-2 px-2.5 h-8 bg-surface rounded-lg border border-border">
            <Search size={14} className="text-text-muted shrink-0" />
            <input
              type="text"
              placeholder="Filter sessions..."
              className="flex-1 bg-transparent text-xs outline-none placeholder:text-text-muted"
            />
          </div>
        </div>
        {/* Session 列表 */}
        <div className="flex-1 overflow-y-auto">
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => setSelectedSession(s)}
              className={`flex items-center gap-2.5 w-full px-4 py-2.5 text-left transition-colors ${
                selectedSession.id === s.id ? 'bg-primary-light' : 'hover:bg-surface'
              }`}
            >
              <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
              <div className="flex-1 min-w-0">
                <div className={`text-[13px] truncate ${selectedSession.id === s.id ? 'font-semibold text-text' : 'font-medium text-text'}`}>
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
        {/* 对话 Header */}
        <div className="flex items-center justify-between h-13 px-5 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: selectedSession.color }} />
            <span className="text-[15px] font-semibold text-text">{selectedSession.label}</span>
            <span className="text-[10px] font-medium text-text-secondary bg-muted px-2 py-0.5 rounded-full">
              {selectedSession.turns} turns
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 px-2.5 py-1 bg-surface rounded-md border border-border">
              <Zap size={12} className="text-[#D89575]" />
              <span className="text-[11px] font-medium text-text-secondary">{config?.capabilities.skills.length ?? 3} Skills</span>
            </div>
            <div className="flex items-center gap-1 px-2.5 py-1 bg-surface rounded-md border border-border">
              <Wrench size={12} className="text-text-secondary" />
              <span className="text-[11px] font-medium text-text-secondary">{config?.capabilities.tools.length ?? 5} Tools</span>
            </div>
          </div>
        </div>

        {/* 消息流 */}
        <div className="flex-1 overflow-y-auto bg-surface px-6 py-5 space-y-4">
          {messages.map((msg, i) => (
            <div
              key={msg.id}
              className="page-enter"
              style={{ animationDelay: `${i * 50}ms`, animationFillMode: 'both' }}
            >
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
                      <span className="text-[11px] font-medium text-primary-dark">
                        {msg.toolCall.name}({msg.toolCall.args})
                      </span>
                      <span className="text-[10px] text-text-muted">{msg.toolCall.duration}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* 输入栏 */}
        <div className="flex items-center gap-2.5 h-14 px-5 border-t border-border bg-card shrink-0">
          <div className="flex items-center gap-2 flex-1 h-9 px-3 bg-surface rounded-[10px] border border-border transition-all duration-200 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10">
            <Terminal size={14} className="text-text-muted shrink-0" />
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSend() }}
              placeholder="Send a message or simulate a tool call..."
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
            {sending
              ? <Loader2 size={16} className="text-white animate-spin" />
              : <ArrowUp size={16} className="text-white" />
            }
          </button>
        </div>
      </div>

      {/* 右侧上下文面板 */}
      <div className="w-75 bg-card border-l border-border flex flex-col shrink-0">
        {/* Header */}
        <div className="flex items-center h-13 px-4 border-b border-border">
          <span className="text-sm font-semibold text-text">Context</span>
        </div>

        {/* Tabs */}
        <div className="flex px-4 border-b border-border">
          {(['l3', 'l2', 'insights', 'prompt'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-2.5 text-xs font-medium transition-colors ${
                activeTab === tab
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              {tab === 'l3' ? 'L3' : tab === 'l2' ? 'L2' : tab === 'insights' ? 'Insights' : 'Prompt'}
            </button>
          ))}
        </div>

        {/* Tab 内容 */}
        <div className="flex-1 overflow-y-auto bg-surface p-4 space-y-3">
          {activeTab === 'l3' && (
            <>
              <p className="text-[10px] font-semibold text-text-muted tracking-wide">SYSTEM PROMPT</p>
              <div className="bg-card rounded-lg p-3 shadow-sm border border-border/30">
                <p className="text-[11px] text-text-secondary leading-relaxed">
                  You are a research assistant specialized in finding and summarizing academic papers...
                </p>
              </div>
              <p className="text-[10px] font-semibold text-text-muted tracking-wide">INSIGHTS FROM MAIN</p>
              <div className="bg-card rounded-lg p-3 shadow-sm border border-border/30">
                <div className="flex items-center gap-1 mb-1.5">
                  <ArrowDownRight size={10} className="text-primary" />
                  <span className="text-[10px] font-medium text-primary">Latest integration</span>
                </div>
                <p className="text-[11px] text-text-secondary leading-relaxed">
                  Focus on recent 2024 publications. The coding session has identified key APIs that may relate to your findings.
                </p>
              </div>
              <p className="text-[10px] font-semibold text-text-muted tracking-wide">L3 HISTORY ({mockL3Records.length} RECORDS)</p>
              <div className="bg-card rounded-lg p-3 shadow-sm border border-border/30 space-y-2">
                {mockL3Records.map((r, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <RoleBadge role={r.role} />
                    <span className="text-[11px] text-text-secondary">{r.text}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {activeTab === 'l2' && (
            <>
              <p className="text-[10px] font-semibold text-text-muted tracking-wide">L2 MEMORY</p>
              <div className="bg-card rounded-lg p-3 shadow-sm border border-border/30">
                <div className="flex items-center gap-1 mb-2">
                  <span className="text-[10px] font-medium text-success bg-[#E8F5E9] px-1.5 py-0.5 rounded">consolidated</span>
                </div>
                <p className="text-[11px] text-text-secondary leading-relaxed">
                  This session focuses on academic research in conversation topology. Key findings include
                  tree-structured dialogue management, cross-branch knowledge transfer via synthesis, and
                  session lifecycle patterns.
                </p>
              </div>
            </>
          )}

          {activeTab === 'insights' && (
            <>
              <p className="text-[10px] font-semibold text-text-muted tracking-wide">INSIGHTS FROM MAIN</p>
              <div className="bg-card rounded-lg p-3 shadow-sm border border-border/30">
                <div className="flex items-center gap-1 mb-1.5">
                  <ArrowDownRight size={10} className="text-primary" />
                  <span className="text-[10px] font-medium text-primary">Latest integration</span>
                </div>
                <p className="text-[11px] text-text-secondary leading-relaxed">
                  Focus on recent 2024 publications. The coding session has identified key APIs
                  that may relate to your research findings. Consider cross-referencing with the
                  implementation patterns found.
                </p>
              </div>
            </>
          )}

          {activeTab === 'prompt' && (
            <>
              <p className="text-[10px] font-semibold text-text-muted tracking-wide">SYSTEM PROMPT</p>
              <div className="bg-card rounded-lg p-3 shadow-sm border border-border/30">
                <p className="text-[11px] text-text-secondary leading-relaxed">
                  You are a research assistant specialized in finding and summarizing academic
                  papers on AI conversation systems, dialogue management, and multi-session
                  architectures.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
