import { useEffect, useState } from 'react'
import {
  Wifi,
  HardDrive,
  Database,
  Clock,
  GitBranch,
  Shield,
  Wrench,
  Zap,
  Webhook,
  ChevronDown,
  Pencil,
} from 'lucide-react'

/** 从 API 获取的 agent 配置 */
interface AgentConfig {
  orchestration: {
    strategy: string
  }
  capabilities: {
    tools: Array<{ name: string; description: string }>
    skills: Array<{ name: string; description: string }>
  }
}

/** 配置卡片容器 */
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card rounded-xl p-5 shadow-sm border border-border/50">
      <h3 className="text-sm font-semibold text-text mb-3">{title}</h3>
      <div className="h-px bg-border mb-4" />
      {children}
    </div>
  )
}

/** 键值行 */
function Row({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-xs font-medium text-text-muted">{label}</span>
      {children}
    </div>
  )
}

/** 下拉选择器样式 */
function Select({ value, options }: { value: string; options: string[] }) {
  return (
    <div className="flex items-center gap-1 px-2.5 py-1 bg-surface rounded-md border border-border text-xs font-medium text-text cursor-pointer">
      <span>{value}</span>
      <ChevronDown size={10} className="text-text-muted" />
    </div>
  )
}

/** 数值输入框 */
function NumberInput({ value, unit }: { value: string; unit?: string }) {
  return (
    <div className="flex items-center gap-1">
      <div className="w-15 px-2.5 py-1 bg-surface rounded-md border border-border text-xs font-medium text-text text-center">
        {value}
      </div>
      {unit && <span className="text-[11px] text-text-muted">{unit}</span>}
    </div>
  )
}

/** 状态指示器 */
function StatusDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-xs font-medium" style={{ color }}>{label}</span>
    </div>
  )
}

/** 小标签 */
function Tag({ children, variant = 'default' }: { children: string; variant?: 'default' | 'orange' | 'purple' | 'green' }) {
  const styles = {
    default: 'bg-muted text-text-secondary',
    orange: 'bg-primary-light text-primary',
    purple: 'bg-[#EDE7F6] text-purple',
    green: 'bg-[#E8F5E9] text-success',
  }
  return (
    <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${styles[variant]}`}>
      {children}
    </span>
  )
}

/** Settings 配置页面 */
export function SettingsPage() {
  const [config, setConfig] = useState<AgentConfig | null>(null)

  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then(setConfig)
      .catch(() => {
        /* 开发模式下 API 可能不可用 */
      })
  }, [])

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center h-13 px-6 border-b border-border shrink-0">
        <h2 className="text-[15px] font-semibold text-text">Settings</h2>
      </div>

      {/* 可滚动内容 */}
      <div className="flex-1 overflow-y-auto bg-surface p-6 space-y-5">
        {/* Agent Connection */}
        <Card title="Agent Connection">
          <Row label="Status">
            <StatusDot color="#4D9B6A" label="Connected" />
          </Row>
          <Row label="Agent ID">
            <span className="text-xs font-medium text-text">stello-agent-demo</span>
          </Row>
          <Row label="Sessions">
            <span className="text-xs font-medium text-text">7 active · 2 archived</span>
          </Row>
        </Card>

        {/* Storage Mode */}
        <Card title="Storage Mode">
          <div className="flex gap-3">
            <div className="flex-1 bg-primary rounded-[10px] p-4 cursor-pointer border-2 border-primary">
              <div className="flex items-center gap-2 mb-1">
                <HardDrive size={14} className="text-white" />
                <span className="text-[13px] font-semibold text-white">RAM (In-Memory)</span>
              </div>
              <p className="text-[11px] text-white/60 leading-snug">Fast, data lost on restart. Best for quick debugging.</p>
            </div>
            <div className="flex-1 bg-card rounded-[10px] p-4 cursor-pointer border border-border">
              <div className="flex items-center gap-2 mb-1">
                <Database size={14} className="text-text" />
                <span className="text-[13px] font-semibold text-text">File Persistence</span>
              </div>
              <p className="text-[11px] text-text-secondary leading-snug">Saves to temp directory. Survives restart.</p>
            </div>
          </div>
        </Card>

        {/* Scheduling Policy */}
        <Card title="Scheduling Policy">
          <Row label="Consolidation Trigger">
            <Select value="onSwitch" options={['manual', 'everyNTurns', 'onSwitch', 'onArchive', 'onLeave']} />
          </Row>
          <Row label="Integration Trigger">
            <Select value="afterConsolidate" options={['manual', 'afterConsolidate', 'everyNTurns', 'onSwitch', 'onArchive', 'onLeave']} />
          </Row>
          <Row label="System Prompt">
            <div className="flex items-center gap-1 px-2.5 py-1 bg-primary-light rounded-md cursor-pointer">
              <Pencil size={10} className="text-primary" />
              <span className="text-[11px] font-medium text-primary">Edit</span>
            </div>
          </Row>
          <Row label="Consolidation Every N Turns">
            <NumberInput value="5" />
          </Row>
          <Row label="Integration Every N Turns">
            <NumberInput value="3" />
          </Row>
        </Card>

        {/* Runtime & Orchestration */}
        <Card title="Runtime & Orchestration">
          <Row label="Idle Recycle Delay">
            <NumberInput value="30000" unit="ms" />
          </Row>
          <Row label="Orchestration Strategy">
            <Select
              value={config?.orchestration.strategy ?? 'MainSessionFlat'}
              options={['MainSessionFlat', 'HierarchicalOkr']}
            />
          </Row>
        </Card>

        {/* Split Guard */}
        <Card title="Split Guard">
          <Row label="Min Turns Before Split">
            <NumberInput value="3" />
          </Row>
          <Row label="Cooldown Turns">
            <NumberInput value="5" />
          </Row>
        </Card>

        {/* Registered Tools & Skills */}
        <Card title="Registered Tools & Skills">
          <p className="text-[10px] font-semibold text-text-muted tracking-wide mb-3">TOOLS</p>
          <div className="space-y-2.5 mb-4">
            {(config?.capabilities.tools ?? []).map((tool) => (
              <div key={tool.name} className="flex items-center gap-2">
                <Wrench size={14} className="text-primary shrink-0" />
                <span className="text-xs font-medium text-text">{tool.name}</span>
                <span className="text-[11px] text-text-muted">— {tool.description}</span>
              </div>
            ))}
            {!config && (
              <>
                <div className="flex items-center gap-2">
                  <Wrench size={14} className="text-primary" />
                  <span className="text-xs font-medium text-text">search_papers</span>
                  <span className="text-[11px] text-text-muted">— Search academic papers</span>
                </div>
                <div className="flex items-center gap-2">
                  <Wrench size={14} className="text-primary" />
                  <span className="text-xs font-medium text-text">write_code</span>
                  <span className="text-[11px] text-text-muted">— Write code to file system</span>
                </div>
              </>
            )}
          </div>
          <div className="h-px bg-border mb-4" />
          <p className="text-[10px] font-semibold text-text-muted tracking-wide mb-3">SKILLS</p>
          <div className="space-y-2.5">
            {(config?.capabilities.skills ?? []).map((skill) => (
              <div key={skill.name} className="flex items-center gap-2">
                <Zap size={14} className="text-[#D89575] shrink-0" />
                <span className="text-xs font-medium text-text">{skill.name}</span>
                <span className="text-[11px] text-text-muted">— {skill.description}</span>
              </div>
            ))}
            {!config && (
              <>
                <div className="flex items-center gap-2">
                  <Zap size={14} className="text-[#D89575]" />
                  <span className="text-xs font-medium text-text">research</span>
                  <span className="text-[11px] text-text-muted">— keywords: paper, search, cite</span>
                </div>
                <div className="flex items-center gap-2">
                  <Zap size={14} className="text-[#D89575]" />
                  <span className="text-xs font-medium text-text">coding</span>
                  <span className="text-[11px] text-text-muted">— keywords: implement, code, build</span>
                </div>
              </>
            )}
          </div>
        </Card>

        {/* Engine Hooks & Session Adapter */}
        <Card title="Engine Hooks & Session Adapter">
          <p className="text-[10px] font-semibold text-text-muted tracking-wide mb-3">SESSION ADAPTER</p>
          <Row label="Adapter Mode">
            <Tag variant="orange">sessionResolver + consolidateFn</Tag>
          </Row>
          <Row label="ConsolidateFn">
            <StatusDot color="#4D9B6A" label="Configured" />
          </Row>
          <Row label="IntegrateFn">
            <StatusDot color="#4D9B6A" label="Configured" />
          </Row>
          <Row label="ConfirmProtocol">
            <StatusDot color="#4D9B6A" label="Injected" />
          </Row>

          <div className="h-px bg-border my-4" />
          <p className="text-[10px] font-semibold text-text-muted tracking-wide mb-3">REGISTERED HOOKS</p>
          <div className="space-y-2.5">
            <div className="flex items-center gap-2">
              <Webhook size={14} className="text-purple" />
              <span className="text-xs font-medium text-text">onRoundEnd</span>
              <Tag variant="purple">scheduler</Tag>
              <Tag variant="orange">user</Tag>
            </div>
            <div className="flex items-center gap-2">
              <Webhook size={14} className="text-purple" />
              <span className="text-xs font-medium text-text">onSessionLeave</span>
              <Tag variant="purple">scheduler</Tag>
            </div>
            <div className="flex items-center gap-2">
              <Webhook size={14} className="text-purple" />
              <span className="text-xs font-medium text-text">onSessionArchive</span>
              <Tag variant="purple">scheduler</Tag>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}
