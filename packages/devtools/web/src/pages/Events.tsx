import { useState, useEffect, useRef, useCallback } from 'react'
import { useI18n } from '@/lib/i18n'

/** 事件类型 */
type EventType = 'turn:start' | 'turn:end' | 'consolidate' | 'integrate' | 'fork' | 'error'

/** 事件数据 */
interface StelloEvent {
  id: string
  time: string
  type: EventType
  session: string
  description: string
}

/** 事件类型 badge 样式 */
const eventStyles: Record<EventType, { bg: string; text: string; label: string }> = {
  'turn:start': { bg: 'bg-primary-light', text: 'text-primary', label: 'turn:start' },
  'turn:end': { bg: 'bg-primary-light', text: 'text-primary', label: 'turn:end' },
  consolidate: { bg: 'bg-[#E8F5E9]', text: 'text-success', label: 'consolidate' },
  integrate: { bg: 'bg-[#EDE7F6]', text: 'text-purple', label: 'integrate' },
  fork: { bg: 'bg-[#E3F2FD]', text: 'text-info', label: 'fork' },
  error: { bg: 'bg-[#FFEBEE]', text: 'text-error', label: 'error' },
}

/** 过滤器选项（labelKey 在渲染时通过 t() 翻译） */
const filterOptions: Array<{ key: string; labelKey: string; types: EventType[] }> = [
  { key: 'all', labelKey: 'events.all', types: [] },
  { key: 'turn', labelKey: 'events.turn', types: ['turn:start', 'turn:end'] },
  { key: 'consolidation', labelKey: 'events.consolidation', types: ['consolidate'] },
  { key: 'integration', labelKey: 'events.integration', types: ['integrate'] },
  { key: 'fork', labelKey: 'events.fork', types: ['fork'] },
  { key: 'error', labelKey: 'events.error', types: ['error'] },
]

/* 无 mock 数据——全部从 WS 实时接收 */

/** 将 EventBus 事件类型映射为 EventType */
function wsTypeToEventType(type: string): EventType | null {
  const map: Record<string, EventType> = {
    'turn.start': 'turn:start',
    'turn.end': 'turn:end',
    'session.enter': 'turn:start',
    'session.entered': 'turn:start',
    'session.leave': 'turn:end',
    'session.left': 'turn:end',
    'fork.start': 'fork',
    'fork.created': 'fork',
    'session.archived': 'turn:end',
    'consolidate.start': 'consolidate',
    'consolidate.done': 'consolidate',
    'integrate.start': 'integrate',
    'integrate.done': 'integrate',
    'error': 'error',
  }
  return map[type] ?? null
}

/** 格式化时间戳 */
function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/** Events 事件流页面 */
export function Events() {
  const { t } = useI18n()
  const [activeFilter, setActiveFilter] = useState('all')
  const [events, setEvents] = useState<StelloEvent[]>([])
  const [wsConnected, setWsConnected] = useState(false)
  const [sessionLabels, setSessionLabels] = useState<Record<string, string>>({})
  const nextIdRef = useRef(100)

  /** 拉取 session 列表建立 id→label 映射 */
  const refreshLabels = useCallback(() => {
    fetch('/api/sessions').then((r) => r.json()).then((body: { sessions: Array<{ id: string; label: string }> }) => {
      const map: Record<string, string> = {}
      for (const s of body.sessions) map[s.id] = s.label
      setSessionLabels(map)
    }).catch(() => {})
  }, [])

  useEffect(() => { refreshLabels() }, [refreshLabels])

  /** 将 raw event 转成 StelloEvent */
  const parseEvent = useCallback((msg: Record<string, unknown>): StelloEvent | null => {
    const rawType = String(msg['type'] ?? '')
    const eventType = wsTypeToEventType(rawType)
    if (!eventType) return null
    const data = msg['data'] as Record<string, unknown> | undefined
    const desc = data
      ? Object.entries(data).map(([k, v]) => `${k}: ${String(v).slice(0, 50)}`).join(' · ')
      : rawType
    return {
      id: String(nextIdRef.current++),
      time: msg['timestamp'] ? formatTime(new Date(String(msg['timestamp']))) : formatTime(new Date()),
      type: eventType,
      session: String(msg['sessionId'] ?? '—'),
      description: `${rawType}${desc !== rawType ? ` — ${desc}` : ''}`,
    }
  }, [])

  /* 挂载时拉历史 + WS 接增量 */
  useEffect(() => {
    /* 1. 拉历史 */
    fetch('/api/events').then((r) => r.json()).then((body: { events: Array<Record<string, unknown>> }) => {
      const hist = body.events.map(parseEvent).filter((e): e is StelloEvent => e !== null).reverse()
      setEvents(hist)
    }).catch(() => {})

    /* 2. WS 接增量 */
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = `${protocol}//${window.location.host}/ws`
    let ws: WebSocket | null = null
    let closed = false

    function connect() {
      if (closed) return
      ws = new WebSocket(url)
      ws.onopen = () => setWsConnected(true)
      ws.onclose = () => { setWsConnected(false); if (!closed) setTimeout(connect, 3000) }
      ws.onerror = () => ws?.close()
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as Record<string, unknown>
          const rawType = String(msg['type'] ?? '')
          if (rawType === 'fork.created') refreshLabels()
          const parsed = parseEvent(msg)
          if (parsed) setEvents((prev) => [parsed, ...prev])
        } catch { /* ignore */ }
      }
    }

    connect()
    return () => { closed = true; ws?.close() }
  }, [])

  const filtered = activeFilter === 'all'
    ? events
    : events.filter((e) => {
        const opt = filterOptions.find((f) => f.key === activeFilter)
        return opt?.types.includes(e.type)
      })

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between h-13 px-6 border-b border-border shrink-0">
        <h2 className="text-[15px] font-semibold text-text">{t('events.title')}</h2>
        <div className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-success animate-pulse shadow-[0_0_6px_rgba(77,155,106,0.6)]' : 'bg-text-muted'}`} />
          <span className={`text-xs font-medium ${wsConnected ? 'text-success' : 'text-text-muted'}`}>
            {wsConnected ? t('events.live') : t('events.offline')}
          </span>
        </div>
      </div>

      {/* 过滤器 */}
      <div className="flex items-center gap-2 px-6 py-2.5 border-b border-border shrink-0">
        {filterOptions.map((opt) => (
          <button
            key={opt.key}
            onClick={() => setActiveFilter(opt.key)}
            className={`text-[11px] font-medium px-3 py-1 rounded-full transition-colors ${
              activeFilter === opt.key
                ? 'bg-primary text-white'
                : opt.key === 'error'
                  ? 'bg-surface text-error border border-border hover:bg-muted'
                  : 'bg-surface text-text-secondary border border-border hover:bg-muted'
            }`}
          >
            {t(opt.labelKey)}
          </button>
        ))}
      </div>

      {/* 事件列表 */}
      <div className="flex-1 overflow-y-auto bg-surface">
        {filtered.map((event, i) => {
          const style = eventStyles[event.type]
          const isError = event.type === 'error'
          return (
            <div
              key={event.id}
              className={`flex items-center gap-4 px-6 py-3 border-b border-border/30 transition-all duration-200 hover:bg-muted/50 cursor-pointer page-enter ${
                isError ? 'bg-[#FFF5F5] hover:bg-[#FFF0F0]' : i % 2 === 1 ? 'bg-card' : ''
              }`}
              style={{ animationDelay: `${i * 30}ms`, animationFillMode: 'both' }}
            >
              <span className="text-[11px] font-medium text-text-muted w-15 shrink-0">
                {event.time}
              </span>
              <div className={`${style.bg} rounded px-2 py-0.5 w-22 text-center shrink-0`}>
                <span className={`text-[10px] font-semibold ${style.text}`}>
                  {style.label}
                </span>
              </div>
              <span className="text-[11px] font-medium text-text w-28 shrink-0 truncate" title={event.session}>
                {sessionLabels[event.session] ?? event.session}
              </span>
              <span className={`text-[11px] ${isError ? 'text-error' : 'text-text-secondary'}`}>
                {event.description}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
