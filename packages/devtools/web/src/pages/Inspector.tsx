import { useState } from 'react'
import { ChevronDown, Pencil, ArrowDownRight } from 'lucide-react'

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
    <div className="bg-card rounded-xl p-4 shadow-sm border border-border/50">
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

/** Inspector 检查器页面 */
export function Inspector() {
  const [selectedSession] = useState('research')

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between h-13 px-6 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="text-[15px] font-semibold text-text">Inspector</h2>
          {/* Session 选择器 */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-surface rounded-lg border border-border cursor-pointer">
            <div className="w-1.5 h-1.5 rounded-full bg-primary" />
            <span className="text-xs font-medium text-text">{selectedSession}</span>
            <ChevronDown size={12} className="text-text-muted" />
          </div>
        </div>
        {/* Edit Mode */}
        <div className="flex items-center gap-1 px-3 py-1.5 bg-primary-light rounded-lg cursor-pointer">
          <Pencil size={12} className="text-primary" />
          <span className="text-[11px] font-medium text-primary">Edit Mode</span>
        </div>
      </div>

      {/* 双列内容 */}
      <div className="flex-1 overflow-y-auto bg-surface p-6">
        <div className="grid grid-cols-2 gap-5">
          {/* 左列 */}
          <div className="space-y-5">
            {/* L3 Records */}
            <DataCard title="L3 — Conversation Records" badge="12 records">
              <div className="space-y-2.5">
                <div className="flex gap-2 items-start">
                  <RoleBadge role="user" />
                  <p className="text-[11px] text-text-secondary leading-relaxed">
                    Search for recent papers on conversation topology and branching dialogue systems
                  </p>
                </div>
                <div className="flex gap-2 items-start">
                  <RoleBadge role="asst" />
                  <p className="text-[11px] text-text-secondary leading-relaxed">
                    I found 3 relevant papers. Let me summarize the key findings from each...
                  </p>
                </div>
                <div className="flex gap-2 items-start">
                  <RoleBadge role="tool" />
                  <p className="text-[11px] text-text-secondary leading-relaxed">
                    search_papers({'{'}query: &quot;conversation topology&quot;{'}'}) → 3 results
                  </p>
                </div>
                <div className="flex gap-2 items-start">
                  <RoleBadge role="user" />
                  <p className="text-[11px] text-text-secondary leading-relaxed">
                    Can you focus on the ones from 2024?
                  </p>
                </div>
                <div className="flex gap-2 items-start">
                  <RoleBadge role="asst" />
                  <p className="text-[11px] text-text-secondary leading-relaxed">
                    Filtering for 2024 publications. Here are the two most relevant...
                  </p>
                </div>
              </div>
            </DataCard>

            {/* L2 Memory */}
            <DataCard title="L2 — Memory" badge="consolidated" badgeColor="green">
              <p className="text-[11px] text-text-secondary leading-relaxed">
                This session focuses on academic research in conversation topology. Key findings
                include tree-structured dialogue management, cross-branch knowledge transfer via
                synthesis, and session lifecycle patterns. Two 2024 papers identified as most
                relevant: Chen et al. on branching dialogue trees, Park &amp; Kim on session
                topology in LLM orchestration.
              </p>
            </DataCard>
          </div>

          {/* 右列 */}
          <div className="space-y-5">
            {/* Insights */}
            <DataCard title="Insights">
              <div className="flex items-center gap-1 mb-2">
                <ArrowDownRight size={10} className="text-primary" />
                <span className="text-[10px] font-medium text-primary">from Main</span>
              </div>
              <p className="text-[11px] text-text-secondary leading-relaxed">
                Focus on recent 2024 publications. The coding session has identified key APIs
                that may relate to your research findings. Consider cross-referencing with the
                implementation patterns found.
              </p>
            </DataCard>

            {/* System Prompt */}
            <DataCard title="System Prompt">
              <p className="text-[11px] text-text-secondary leading-relaxed">
                You are a research assistant specialized in finding and summarizing academic
                papers on AI conversation systems, dialogue management, and multi-session
                architectures.
              </p>
            </DataCard>

            {/* Session Meta */}
            <DataCard title="Session Meta">
              <div className="space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-[11px] font-medium text-text-muted">ID</span>
                  <span className="text-[11px] font-medium text-text font-mono">sess_a1b2c3</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[11px] font-medium text-text-muted">Status</span>
                  <span className="text-[11px] font-semibold text-primary">Active</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[11px] font-medium text-text-muted">Created</span>
                  <span className="text-[11px] font-medium text-text">2026-03-24 10:32</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[11px] font-medium text-text-muted">Turns</span>
                  <span className="text-[11px] font-medium text-text">12</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[11px] font-medium text-text-muted">Children</span>
                  <span className="text-[11px] font-medium text-text">2 (papers, notes)</span>
                </div>
              </div>
            </DataCard>
          </div>
        </div>
      </div>
    </div>
  )
}
