import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronDown, ChevronRight, Pencil, ArrowDownRight, Loader2, Search, Filter } from 'lucide-react'
import { fetchSessions, fetchSessionDetail, type SessionMeta, type SessionDetail } from '@/lib/api'

/** 角色 badge */
function RoleBadge({ role }: { role: string }) {
  const r = role === 'assistant' ? 'asst' : role === 'function' ? 'tool' : role
  const styles: Record<string, string> = {
    user: 'bg-primary-light text-primary',
    asst: 'bg-muted text-text-secondary',
    tool: 'bg-[#FFF5EE] text-primary',
  }
  return (
    <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${styles[r] ?? styles['asst']}`}>
      {r}
    </span>
  )
}

/** 数据卡片 */
function DataCard({
  title,
  badge,
  badgeColor = 'orange',
  children,
}: {
  title: string
  badge?: string
  badgeColor?: 'orange' | 'green'
  children: React.ReactNode
}) {
  const badgeStyles = {
    orange: 'bg-primary-light text-primary',
    green: 'bg-[#E8F5E9] text-success',
  }
  return (
    <div className="bg-card rounded-xl p-4 shadow-sm border border-border/50 page-enter">
      <div className="flex items-center justify-between mb-2.5">
        <h4 className="text-[13px] font-semibold text-text">{title}</h4>
        {badge && (
          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${badgeStyles[badgeColor]}`}>
            {badge}
          </span>
        )}
      </div>
      <div className="h-px bg-border mb-3" />
      {children}
    </div>
  )
}

/** JSON 值渲染——根据类型着色 */
function JsonValue({ value }: { value: unknown }) {
  if (value === null) return <span className="text-text-muted italic">null</span>
  if (typeof value === 'boolean') return <span className="text-purple">{String(value)}</span>
  if (typeof value === 'number') return <span className="text-info">{value}</span>
  if (typeof value === 'string') {
    const display = value.length > 80 ? value.slice(0, 80) + '…' : value
    return <span className="text-success">"{display}"</span>
  }
  return <span className="text-text-secondary">{String(value)}</span>
}

/** 可折叠 JSON 树 viewer */
function JsonTree({ data, defaultOpen = true, depth = 0 }: { data: unknown; defaultOpen?: boolean; depth?: number }) {
  const [open, setOpen] = useState(defaultOpen)

  if (data === null || data === undefined) return <JsonValue value={data} />
  if (typeof data !== 'object') return <JsonValue value={data} />

  const isArray = Array.isArray(data)
  const entries = isArray ? data.map((v, i) => [String(i), v] as const) : Object.entries(data as Record<string, unknown>)

  if (entries.length === 0) return <span className="text-text-muted">{isArray ? '[]' : '{}'}</span>

  return (
    <div className="text-[11px] font-mono">
      <button onClick={() => setOpen(!open)} className="inline-flex items-center gap-0.5 hover:text-primary transition-colors">
        {open ? <ChevronDown size={10} className="shrink-0" /> : <ChevronRight size={10} className="shrink-0" />}
        <span className="text-text-muted">{isArray ? `[${entries.length}]` : `{${entries.length}}`}</span>
      </button>
      {open && (
        <div className="ml-3 border-l border-border/30 pl-2 space-y-0.5">
          {entries.map(([key, val]) => (
            <div key={key} className="flex items-start gap-1">
              <span className="text-primary-dark shrink-0">{isArray ? `${key}:` : `"${key}":`}</span>
              {typeof val === 'object' && val !== null ? (
                <JsonTree data={val} defaultOpen={depth < 1} depth={depth + 1} />
              ) : (
                <JsonValue value={val} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Inspector 检查器页面 */
export function Inspector() {
  const [searchParams] = useSearchParams()
  const initialSessionId = searchParams.get('session')
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<SessionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<'all' | 'user' | 'assistant' | 'system'>('all')

  /* 拉取 session 列表 */
  useEffect(() => {
    fetchSessions()
      .then(({ sessions: list }) => {
        setSessions(list)
        const target = initialSessionId ? list.find((s) => s.id === initialSessionId) : null
        setSelectedId(target?.id ?? list[0]?.id ?? null)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  /* 选中 session 变化时拉取详情 */
  useEffect(() => {
    if (!selectedId) return
    setLoading(true)
    fetchSessionDetail(selectedId)
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setLoading(false))
  }, [selectedId])

  const selectedNode = sessions.find((s) => s.id === selectedId)

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between h-13 px-6 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="text-[15px] font-semibold text-text">Inspector</h2>
          {/* Session 选择器 */}
          <div className="relative">
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-surface rounded-lg border border-border cursor-pointer hover:bg-muted transition-colors"
            >
              <div className="w-1.5 h-1.5 rounded-full bg-primary" />
              <span className="text-xs font-medium text-text">{selectedNode?.label ?? '—'}</span>
              <ChevronDown size={12} className="text-text-muted" />
            </button>
            {dropdownOpen && (
              <div className="absolute top-full left-0 mt-1 w-48 bg-card rounded-lg border border-border shadow-lg z-50 py-1 pop-enter">
                {sessions.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => { setSelectedId(s.id); setDropdownOpen(false) }}
                    className={`flex items-center gap-2 w-full px-3 py-2 text-left text-xs hover:bg-surface transition-colors ${s.id === selectedId ? 'font-semibold text-primary' : 'text-text'}`}
                  >
                    <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: s.id === selectedId ? '#C4793D' : '#9C9B99' }} />
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 px-3 py-1.5 bg-primary-light rounded-lg cursor-pointer hover:bg-primary-light/80 transition-colors">
          <Pencil size={12} className="text-primary" />
          <span className="text-[11px] font-medium text-primary">Edit Mode</span>
        </div>
      </div>

      {/* 内容 */}
      <div className="flex-1 overflow-y-auto bg-surface p-6">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 size={24} className="text-primary animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-5">
            {/* 左列 */}
            <div className="space-y-5">
              {/* L3 Records */}
              <DataCard
                title="L3 — Conversation Records"
                badge={detail ? `${detail.records.length} records` : '—'}
              >
                {/* 搜索框 + role 过滤器 */}
                <div className="flex items-center gap-2 mb-3">
                  <div className="flex items-center gap-1.5 flex-1 h-7 px-2 bg-surface rounded-lg border border-border">
                    <Search size={12} className="text-text-muted shrink-0" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search records..."
                      className="flex-1 bg-transparent text-[11px] outline-none placeholder:text-text-muted"
                    />
                  </div>
                  <div className="flex items-center gap-0.5">
                    <Filter size={11} className="text-text-muted mr-1" />
                    {(['all', 'user', 'assistant', 'system'] as const).map((r) => (
                      <button
                        key={r}
                        onClick={() => setRoleFilter(r)}
                        className={`text-[9px] font-medium px-1.5 py-0.5 rounded transition-colors ${
                          roleFilter === r ? 'bg-primary text-white' : 'bg-surface text-text-muted hover:bg-muted'
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
                {(() => {
                  const filtered = (detail?.records ?? []).filter((r) => {
                    if (roleFilter !== 'all' && r.role !== roleFilter) return false
                    if (searchQuery && !r.content.toLowerCase().includes(searchQuery.toLowerCase())) return false
                    return true
                  })
                  return filtered.length > 0 ? (
                    <div className="space-y-2.5 max-h-80 overflow-y-auto">
                      {filtered.map((r, i) => (
                        <div key={i} className="flex gap-2 items-start">
                          <RoleBadge role={r.role} />
                          <p className="text-[11px] text-text-secondary leading-relaxed break-words">
                            {r.content.length > 200 ? r.content.slice(0, 200) + '...' : r.content}
                          </p>
                        </div>
                      ))}
                      {filtered.length < (detail?.records.length ?? 0) && (
                        <p className="text-[10px] text-text-muted italic">
                          Showing {filtered.length} of {detail?.records.length} records
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-[11px] text-text-muted italic">
                      {(detail?.records.length ?? 0) > 0 ? 'No matching records' : 'No records yet'}
                    </p>
                  )
                })()}
              </DataCard>

              {/* L2 Memory */}
              <DataCard
                title="L2 — Memory"
                badge={detail?.l2 ? 'consolidated' : 'pending'}
                badgeColor={detail?.l2 ? 'green' : 'orange'}
              >
                {detail?.l2 ? (
                  <p className="text-[11px] text-text-secondary leading-relaxed">{detail.l2}</p>
                ) : (
                  <p className="text-[11px] text-text-muted italic">No L2 memory consolidated yet</p>
                )}
              </DataCard>
            </div>

            {/* 右列 */}
            <div className="space-y-5">
              {/* Insights / Scope */}
              <DataCard title="Insights / Scope">
                {detail?.scope ? (
                  <>
                    <div className="flex items-center gap-1 mb-2">
                      <ArrowDownRight size={10} className="text-primary" />
                      <span className="text-[10px] font-medium text-primary">from Main</span>
                    </div>
                    {(() => {
                      try {
                        const parsed = JSON.parse(detail.scope)
                        return (
                          <div className="bg-surface rounded-lg p-3 border border-border/30 overflow-x-auto">
                            <JsonTree data={parsed} />
                          </div>
                        )
                      } catch {
                        return <p className="text-[11px] text-text-secondary leading-relaxed">{detail.scope}</p>
                      }
                    })()}
                  </>
                ) : (
                  <p className="text-[11px] text-text-muted italic">No insights received</p>
                )}
              </DataCard>

              {/* System Prompt */}
              <DataCard title="System Prompt">
                <p className="text-[11px] text-text-secondary leading-relaxed">
                  {/* system prompt 从 config 读 */}
                  Available via Settings page
                </p>
              </DataCard>

              {/* Session Meta */}
              <DataCard title="Session Meta">
                {selectedNode ? (
                  <div className="bg-surface rounded-lg p-3 border border-border/30 overflow-x-auto">
                    <JsonTree data={{
                      id: selectedNode.id,
                      label: selectedNode.label,
                      status: selectedNode.status,
                      turnCount: selectedNode.turnCount,
                      scope: selectedNode.scope,
                      tags: selectedNode.tags,
                      createdAt: selectedNode.createdAt,
                      updatedAt: selectedNode.updatedAt,
                    }} />
                  </div>
                ) : (
                  <p className="text-[11px] text-text-muted italic">Select a session</p>
                )}
              </DataCard>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
