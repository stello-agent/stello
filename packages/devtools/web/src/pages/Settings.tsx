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
  Loader2,
} from 'lucide-react'
import { fetchConfig, patchConfig } from '@/lib/api'

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

/** 下拉选择器（真正可交互） */
function Select({ value, options, onChange }: { value: string; options: string[]; onChange?: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      className="px-2.5 py-1 bg-surface rounded-md border border-border text-xs font-medium text-text cursor-pointer outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-colors appearance-none pr-6"
      style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%239C9B99' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}
    >
      {options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
    </select>
  )
}

/** 数值输入框（真正可编辑） */
function NumberInput({ value, unit, onChange }: { value: string; unit?: string; onChange?: (v: string) => void }) {
  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        className="w-16 px-2.5 py-1 bg-surface rounded-md border border-border text-xs font-medium text-text text-center outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-colors"
      />
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
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle')

  /* 可编辑配置值 */
  const [consolidationTrigger, setConsolidationTrigger] = useState('onSwitch')
  const [integrationTrigger, setIntegrationTrigger] = useState('afterConsolidate')
  const [consolidationEveryN, setConsolidationEveryN] = useState('5')
  const [integrationEveryN, setIntegrationEveryN] = useState('3')
  const [idleTtlMs, setIdleTtlMs] = useState('30000')
  const [strategy, setStrategy] = useState('MainSessionFlat')
  const [minTurns, setMinTurns] = useState('3')
  const [cooldownTurns, setCooldownTurns] = useState('5')

  useEffect(() => {
    fetchConfig()
      .then((c) => {
        setConfig(c)
        if (c.orchestration.strategy) setStrategy(c.orchestration.strategy)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  /** 保存配置 */
  const handleSave = async () => {
    setSaving(true)
    setSaveStatus('idle')
    try {
      await patchConfig({
        consolidationTrigger,
        integrationTrigger,
        consolidationEveryN: Number(consolidationEveryN),
        integrationEveryN: Number(integrationEveryN),
        idleTtlMs: Number(idleTtlMs),
        strategy,
        minTurns: Number(minTurns),
        cooldownTurns: Number(cooldownTurns),
      })
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2000)
    } catch {
      setSaveStatus('error')
      setTimeout(() => setSaveStatus('idle'), 3000)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between h-13 px-6 border-b border-border shrink-0">
        <h2 className="text-[15px] font-semibold text-text">Settings</h2>
        <button
          onClick={handleSave}
          disabled={saving}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
            saveStatus === 'saved'
              ? 'bg-[#E8F5E9] text-success'
              : saveStatus === 'error'
                ? 'bg-[#FFEBEE] text-error'
                : 'bg-primary text-white hover:bg-primary/90'
          }`}
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : null}
          {saveStatus === 'saved' ? 'Saved' : saveStatus === 'error' ? 'Error' : 'Save Changes'}
        </button>
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
            <Select value={consolidationTrigger} options={['manual', 'everyNTurns', 'onSwitch', 'onArchive', 'onLeave']} onChange={setConsolidationTrigger} />
          </Row>
          <Row label="Integration Trigger">
            <Select value={integrationTrigger} options={['manual', 'afterConsolidate', 'everyNTurns', 'onSwitch', 'onArchive', 'onLeave']} onChange={setIntegrationTrigger} />
          </Row>
          <Row label="System Prompt">
            <div className="flex items-center gap-1 px-2.5 py-1 bg-primary-light rounded-md cursor-pointer">
              <Pencil size={10} className="text-primary" />
              <span className="text-[11px] font-medium text-primary">Edit</span>
            </div>
          </Row>
          <Row label="Consolidation Every N Turns">
            <NumberInput value={consolidationEveryN} onChange={setConsolidationEveryN} />
          </Row>
          <Row label="Integration Every N Turns">
            <NumberInput value={integrationEveryN} onChange={setIntegrationEveryN} />
          </Row>
        </Card>

        {/* Runtime & Orchestration */}
        <Card title="Runtime & Orchestration">
          <Row label="Idle Recycle Delay">
            <NumberInput value={idleTtlMs} unit="ms" onChange={setIdleTtlMs} />
          </Row>
          <Row label="Orchestration Strategy">
            <Select value={strategy} options={['MainSessionFlat', 'HierarchicalOkr']} onChange={setStrategy} />
          </Row>
        </Card>

        {/* Split Guard */}
        <Card title="Split Guard">
          <Row label="Min Turns Before Split">
            <NumberInput value={minTurns} onChange={setMinTurns} />
          </Row>
          <Row label="Cooldown Turns">
            <NumberInput value={cooldownTurns} onChange={setCooldownTurns} />
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
              <p className="text-[11px] text-text-muted italic">Loading...</p>
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
              <p className="text-[11px] text-text-muted italic">Loading...</p>
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
