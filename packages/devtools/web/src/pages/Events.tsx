import { useState, useEffect, useRef } from 'react'
import { subscribeWs } from '@/lib/ws'

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

/** 过滤器选项 */
const filterOptions: Array<{ key: string; label: string; types: EventType[] }> = [
  { key: 'all', label: 'All', types: [] },
  { key: 'turn', label: 'Turn', types: ['turn:start', 'turn:end'] },
  { key: 'consolidation', label: 'Consolidation', types: ['consolidate'] },
  { key: 'integration', label: 'Integration', types: ['integrate'] },
  { key: 'fork', label: 'Fork', types: ['fork'] },
  { key: 'error', label: 'Error', types: ['error'] },
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
  const [activeFilter, setActiveFilter] = useState('all')
  const [events, setEvents] = useState<StelloEvent[]>([])
  const [wsConnected, setWsConnected] = useState(false)
  const nextIdRef = useRef(100)

  /* 订阅 WS 事件（EventBus 格式：{type, sessionId, timestamp, data}） */
  useEffect(() => {
    const unsub = subscribeWs((msg) => {
      setWsConnected(true)
      const rawType = String(msg['type'] ?? '')
      const eventType = wsTypeToEventType(rawType)
      if (!eventType) return

      const data = msg['data'] as Record<string, unknown> | undefined
      const desc = data
        ? Object.entries(data).map(([k, v]) => `${k}: ${String(v).slice(0, 50)}`).join(' · ')
        : rawType

      const newEvent: StelloEvent = {
        id: String(nextIdRef.current++),
        time: msg['timestamp'] ? formatTime(new Date(String(msg['timestamp']))) : formatTime(new Date()),
        type: eventType,
        session: String(msg['sessionId'] ?? '—'),
        description: `${rawType}${desc !== rawType ? ` — ${desc}` : ''}`,
      }
      setEvents((prev) => [newEvent, ...prev])
    })
    return unsub
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
        <h2 className="text-[15px] font-semibold text-text">Event Stream</h2>
        <div className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-success animate-pulse shadow-[0_0_6px_rgba(77,155,106,0.6)]' : 'bg-text-muted'}`} />
          <span className={`text-xs font-medium ${wsConnected ? 'text-success' : 'text-text-muted'}`}>
            {wsConnected ? 'Live' : 'Offline'}
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
            {opt.label}
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
              <span className="text-[11px] font-medium text-text w-20 shrink-0">
                {event.session}
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
