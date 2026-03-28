import { useCallback, useEffect, useState } from 'react'
import {
  GitBranch,
  Clock,
  Wrench,
  Zap,
  Webhook,
  Shield,
  Database,
  Cpu,
  Layers,
  Lock,
  Loader2,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  Download,
  Upload,
  Pencil,
  Info,
  Sparkles,
  FileText,
  RotateCcw,
} from 'lucide-react'
import { fetchConfig, patchConfig, fetchLLMConfig, patchLLMConfig, fetchPrompts, patchPrompts, fetchTools, toggleTool, fetchSkills, toggleSkill, resetRuntime, type AgentConfig, type HotConfigPatch, type LLMConfig, type PromptsConfig, type ToolWithStatus, type SkillWithStatus } from '@/lib/api'
import { useI18n } from '@/lib/i18n'
import { useToast } from '@/lib/toast'
import { EditDialog, type EditField } from '@/components/EditDialog'
import { ConfirmDialog } from '@/components/ConfirmDialog'

/** 配置卡片 */
function Card({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="bg-card rounded-xl p-5 shadow-sm border border-border/50">
      <div className="flex items-center gap-2 mb-3">
        <Icon size={15} className="text-primary" />
        <h3 className="text-sm font-semibold text-text">{title}</h3>
      </div>
      <div className="h-px bg-border mb-4" />
      {children}
    </div>
  )
}

/** 键值行 */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-xs font-medium text-text-muted">{label}</span>
      {children}
    </div>
  )
}

/** 只读值显示 */
function Value({ children }: { children: React.ReactNode }) {
  return <span className="text-xs font-medium text-text">{children}</span>
}

/** 布尔状态指示器 */
function StatusDot({ configured, label }: { configured: boolean; label?: string }) {
  const { t } = useI18n()
  return (
    <div className="flex items-center gap-1.5">
      {configured
        ? <CheckCircle2 size={12} className="text-success" />
        : <XCircle size={12} className="text-text-muted" />
      }
      <span className={`text-xs font-medium ${configured ? 'text-success' : 'text-text-muted'}`}>
        {label ?? (configured ? t('common.configured') : t('common.notSet'))}
      </span>
    </div>
  )
}

/** Immutable 标记 */
function ImmutableBadge() {
  const { t } = useI18n()
  return (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-warning/10 rounded text-[9px] font-medium text-warning" title="Immutable — set at construction, change via code">
      <Lock size={8} />
      {t('common.immutable')}
    </span>
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

/** 可折叠区域 */
function Collapsible({ title, count, defaultOpen, children }: { title: string; count: number; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen ?? false)
  return (
    <div>
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1.5 w-full text-left py-1">
        {open ? <ChevronDown size={12} className="text-text-muted" /> : <ChevronRight size={12} className="text-text-muted" />}
        <span className="text-[10px] font-semibold text-text-muted tracking-wide">{title}</span>
        <span className="text-[10px] text-text-muted">({count})</span>
      </button>
      {open && <div className="mt-1 space-y-2">{children}</div>}
    </div>
  )
}

/** 可点击编辑的值按钮 */
function ClickToEdit({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-text bg-primary/5 hover:bg-primary/15 border border-primary/20 hover:border-primary/40 rounded cursor-pointer transition-colors group"
    >
      {children}
      <Pencil size={9} className="text-text-muted group-hover:text-primary transition-colors" />
    </button>
  )
}

const CONSOLIDATION_TRIGGERS = ['manual', 'everyNTurns', 'onSwitch', 'onArchive', 'onLeave']
const INTEGRATION_TRIGGERS = ['manual', 'afterConsolidate', 'everyNTurns', 'onSwitch', 'onArchive', 'onLeave']

interface SettingsSnapshotV1 {
  version: 1
  exportedAt: string
  config: AgentConfig
  llm: LLMConfig | null
  prompts: PromptsConfig | null
  tools: { configured: boolean; tools: ToolWithStatus[] }
  skills: { configured: boolean; skills: SkillWithStatus[] }
}

/** Settings 配置页面 */
export function SettingsPage() {
  const { t } = useI18n()
  const { showToast, persistToast } = useToast()
  const [config, setConfig] = useState<AgentConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [llmConfig, setLlmConfig] = useState<LLMConfig | null>(null)
  const [promptsConfig, setPromptsConfig] = useState<PromptsConfig | null>(null)
  const [toolsList, setToolsList] = useState<{ configured: boolean; tools: ToolWithStatus[] }>({ configured: false, tools: [] })
  const [skillsList, setSkillsList] = useState<{ configured: boolean; skills: SkillWithStatus[] }>({ configured: false, skills: [] })
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogTitle, setDialogTitle] = useState('')
  const [dialogFields, setDialogFields] = useState<EditField[]>([])
  const [dialogSaveFn, setDialogSaveFn] = useState<(values: Record<string, string | number>) => Promise<void>>(() => async () => {})
  const [resetOpen, setResetOpen] = useState(false)
  const [resetting, setResetting] = useState(false)

  /** 刷新设置页所有数据 */
  const refreshAll = useCallback(async () => {
    const [nextConfig, nextLlm, nextPrompts, nextTools, nextSkills] = await Promise.all([
      fetchConfig(),
      fetchLLMConfig().catch(() => null),
      fetchPrompts().catch(() => null),
      fetchTools().catch(() => ({ configured: false, tools: [] as ToolWithStatus[] })),
      fetchSkills().catch(() => ({ configured: false, skills: [] as SkillWithStatus[] })),
    ])

    setConfig(nextConfig)
    setLlmConfig(nextLlm)
    setPromptsConfig(nextPrompts)
    setToolsList(nextTools)
    setSkillsList(nextSkills)
  }, [])

  /** 打开编辑 Dialog */
  const openEdit = useCallback((title: string, fields: EditField[], saveFn: (values: Record<string, string | number>) => Promise<void>) => {
    setDialogTitle(title)
    setDialogFields(fields)
    setDialogSaveFn(() => saveFn)
    setDialogOpen(true)
  }, [])

  useEffect(() => {
    refreshAll()
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [refreshAll])

  /** 通用 patch 并刷新 state */
  const handlePatch = useCallback(async (patch: HotConfigPatch) => {
    try {
      const result = await patchConfig(patch)
      setConfig(result.config)
      showToast('success', t('common.updateSuccess'))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      showToast('error', e instanceof Error ? e.message : String(e))
    }
  }, [showToast, t])

  /** 导出配置 JSON */
  const handleExport = useCallback(() => {
    if (!config) return
    const snapshot: SettingsSnapshotV1 = {
      version: 1,
      exportedAt: new Date().toISOString(),
      config,
      llm: llmConfig,
      prompts: promptsConfig,
      tools: toolsList,
      skills: skillsList,
    }
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `stello-settings-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [config, llmConfig, promptsConfig, toolsList, skillsList])

  /** 导入配置 JSON */
  const handleImport = useCallback(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        const text = await file.text()
        const json = JSON.parse(text) as Record<string, unknown>

        const importedConfig = (
          json.config && typeof json.config === 'object'
            ? json.config
            : json
        ) as Partial<AgentConfig>

        const patch: HotConfigPatch = {}
        if (importedConfig.runtime?.idleTtlMs !== undefined) {
          patch.runtime = { idleTtlMs: importedConfig.runtime.idleTtlMs }
        }
        if (importedConfig.scheduling) {
          patch.scheduling = importedConfig.scheduling
        }
        if (importedConfig.splitGuard) {
          patch.splitGuard = importedConfig.splitGuard
        }
        if (Object.keys(patch).length > 0) {
          await patchConfig(patch)
          showToast('success', t('common.importSuccess'))
        }

        const importedLlm = (json.llm && typeof json.llm === 'object') ? json.llm as Partial<LLMConfig> : null
        if (importedLlm?.configured) {
          await patchLLMConfig({
            model: importedLlm.model,
            baseURL: importedLlm.baseURL,
            apiKey: importedLlm.apiKey,
            temperature: importedLlm.temperature,
            maxTokens: importedLlm.maxTokens,
          })
        }

        const importedPrompts = (json.prompts && typeof json.prompts === 'object') ? json.prompts as Partial<PromptsConfig> : null
        if (importedPrompts?.configured) {
          await patchPrompts({
            consolidate: importedPrompts.consolidate,
            integrate: importedPrompts.integrate,
          })
        }

        const importedTools = (json.tools && typeof json.tools === 'object') ? json.tools as { configured?: boolean; tools?: ToolWithStatus[] } : null
        if (importedTools?.configured && importedTools.tools) {
          for (const tool of importedTools.tools) {
            await toggleTool(tool.name, tool.enabled)
          }
        }

        const importedSkills = (json.skills && typeof json.skills === 'object') ? json.skills as { configured?: boolean; skills?: SkillWithStatus[] } : null
        if (importedSkills?.configured && importedSkills.skills) {
          for (const skill of importedSkills.skills) {
            await toggleSkill(skill.name, skill.enabled)
          }
        }
        await refreshAll()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Invalid JSON file')
        showToast('error', e instanceof Error ? e.message : 'Invalid JSON file')
      }
    }
    input.click()
  }, [refreshAll, showToast, t])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-surface">
        <Loader2 size={24} className="text-primary animate-spin" />
      </div>
    )
  }

  if (error || !config) {
    return (
      <div className="flex items-center justify-center h-full bg-surface">
        <div className="bg-card border border-error/30 rounded-lg px-6 py-4 max-w-md text-center">
          <p className="text-sm font-semibold text-error mb-1">Failed to load config</p>
          <p className="text-xs text-text-muted">{error}</p>
          {config && (
            <button onClick={() => setError(null)} className="mt-2 text-xs text-primary hover:underline">
              Dismiss
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between h-13 px-6 border-b border-border shrink-0">
        <h2 className="text-[15px] font-semibold text-text">{t('settings.title')}</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-text-secondary hover:text-text bg-surface border border-border rounded hover:border-primary transition-colors"
          >
            <Download size={12} />
            {t('common.export')}
          </button>
          <button
            onClick={handleImport}
            className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-text-secondary hover:text-text bg-surface border border-border rounded hover:border-primary transition-colors"
          >
            <Upload size={12} />
            {t('common.import')}
          </button>
          <Tag variant="green">{t('common.live')}</Tag>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-surface p-6 space-y-5">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Tag variant="green">{t('common.live')}</Tag>
            <h3 className="text-[13px] font-semibold text-text">{t('settings.live.title')}</h3>
          </div>
          <p className="text-[11px] text-text-muted">{t('settings.live.desc')}</p>
        </div>

        {/* LLM Provider */}
        <Card title={t('settings.llm.title')} icon={Sparkles}>
          {llmConfig?.configured ? (
              <>
                <Row label={t('settings.llm.model')}>
                  <ClickToEdit onClick={() => openEdit(t('settings.llm.title'), [
                    { key: 'model', label: t('settings.llm.model'), type: 'text', value: llmConfig.model ?? '', placeholder: 'gpt-4o' },
                    { key: 'baseURL', label: t('settings.llm.baseUrl'), type: 'text', value: llmConfig.baseURL ?? '', placeholder: 'https://api.openai.com/v1' },
                    { key: 'apiKey', label: t('settings.llm.apiKey'), type: 'password', value: llmConfig.apiKey ?? '', placeholder: 'sk-...' },
                    { key: 'temperature', label: t('settings.llm.temperature'), type: 'number', value: llmConfig.temperature ?? 0.7, min: 0, max: 2, step: 0.1 },
                    { key: 'maxTokens', label: t('settings.llm.maxTokens'), type: 'number', value: llmConfig.maxTokens ?? 1024, min: 1 },
                  ], async (v) => {
                    const result = await patchLLMConfig({ model: String(v.model), baseURL: String(v.baseURL), apiKey: String(v.apiKey), temperature: Number(v.temperature), maxTokens: Number(v.maxTokens) })
                    setLlmConfig(result)
                    showToast('success', t('common.updateSuccess'))
                  })}>
                    {llmConfig.model}
                  </ClickToEdit>
                </Row>
                <Row label={t('settings.llm.baseUrl')}>
                  <code className="text-[11px] font-mono text-text-secondary max-w-[200px] truncate block" title={llmConfig.baseURL}>{llmConfig.baseURL}</code>
                </Row>
                <Row label={t('settings.llm.apiKey')}>
                  <span className="text-xs text-text-muted">{llmConfig.apiKey ? '••••••' + llmConfig.apiKey.slice(-4) : '—'}</span>
                </Row>
                <Row label={t('settings.llm.temperature')}>
                  <span className="text-xs font-medium text-text">{llmConfig.temperature ?? '—'}</span>
                </Row>
                <Row label={t('settings.llm.maxTokens')}>
                  <span className="text-xs font-medium text-text">{llmConfig.maxTokens ?? '—'}</span>
                </Row>
              </>
          ) : (
            <div className="flex items-center gap-2 px-3 py-2 bg-warning/5 rounded-lg border border-warning/15">
              <Info size={12} className="text-warning shrink-0" />
              <p className="text-[10px] text-text-muted">
                {t('settings.llm.hint')}
              </p>
            </div>
          )}
        </Card>

        {/* Consolidation / Integration Prompts */}
        <Card title={t('settings.prompts.title')} icon={FileText}>
          {promptsConfig?.configured ? (
              <div className="space-y-3 group relative">
                <div>
                  <p className="text-[10px] font-semibold text-text-muted tracking-wide mb-1">{t('settings.prompts.consolidateLabel')}</p>
                  <p className="text-[11px] text-text-secondary leading-relaxed line-clamp-3">{promptsConfig.consolidate}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-text-muted tracking-wide mb-1">{t('settings.prompts.integrateLabel')}</p>
                  <p className="text-[11px] text-text-secondary leading-relaxed line-clamp-3">{promptsConfig.integrate}</p>
                </div>
                <button
                  onClick={() => openEdit(t('settings.prompts.title'), [
                    { key: 'consolidate', label: t('settings.prompts.consolidate'), type: 'textarea', value: promptsConfig.consolidate ?? '' },
                    { key: 'integrate', label: t('settings.prompts.integrate'), type: 'textarea', value: promptsConfig.integrate ?? '' },
                  ], async (v) => {
                    const result = await patchPrompts({ consolidate: String(v.consolidate), integrate: String(v.integrate) })
                    setPromptsConfig(result)
                    showToast('success', t('common.updateSuccess'))
                  })}
                  className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 p-1 bg-surface rounded border border-border hover:border-primary transition-all"
                >
                  <Pencil size={10} className="text-text-muted hover:text-primary" />
                </button>
              </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-2 bg-warning/5 rounded-lg border border-warning/15">
              <Info size={12} className="text-warning shrink-0" />
              <p className="text-[10px] text-text-muted">
                {t('settings.prompts.hint')}
              </p>
            </div>
          )}
        </Card>

        {/* Orchestration */}
        <Card title={t('settings.orch.title')} icon={GitBranch}>
          <Row label={t('settings.orch.strategy')}>
            <div className="flex items-center gap-2">
              <ImmutableBadge />
              <code className="text-[11px] font-mono bg-surface px-2 py-0.5 rounded border border-border text-primary-dark">{config.orchestration.strategy}</code>
            </div>
          </Row>
          <Row label="MainSession">
            <StatusDot configured={config.orchestration.hasMainSession} />
          </Row>
          <Row label="TurnRunner">
            <StatusDot configured={config.orchestration.hasTurnRunner} />
          </Row>
        </Card>

        {/* Scheduling */}
        <Card title={t('settings.sched.title')} icon={Clock}>
          {!config.scheduling.hasScheduler && (
            <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-warning/5 rounded-lg border border-warning/15">
              <Info size={12} className="text-warning shrink-0" />
              <p className="text-[10px] text-text-muted">
                {t('settings.sched.noScheduler')}
              </p>
            </div>
          )}
          <div className="bg-surface rounded-lg p-3 mb-3">
            <p className="text-[11px] text-text-secondary leading-relaxed">
              <span className="font-semibold text-text">{t('settings.sched.consolidationDesc')}</span>{t('settings.sched.consolidationDetail')}
              <span className="font-semibold text-text">{t('settings.sched.integrationDesc')}</span>{t('settings.sched.integrationDetail')}
            </p>
          </div>
          <Row label={t('settings.sched.consolidationTrigger')}>
            {config.scheduling.hasScheduler ? (
              <ClickToEdit onClick={() => openEdit(t('settings.sched.consolidationTrigger'), [
                { key: 'conTrigger', label: t('settings.sched.consolidationTrigger'), type: 'select', value: config.scheduling.consolidation.trigger, options: CONSOLIDATION_TRIGGERS },
                { key: 'conEveryN', label: t('settings.sched.consolidationEveryN'), type: 'number', value: config.scheduling.consolidation.everyNTurns ?? 3, min: 1 },
              ], async (v) => {
                await handlePatch({
                  scheduling: {
                    consolidation: {
                      trigger: String(v.conTrigger),
                      everyNTurns: Number(v.conEveryN),
                    },
                  },
                })
              })}>
                {config.scheduling.consolidation.trigger}
              </ClickToEdit>
            ) : (
              <code className="text-[11px] font-mono bg-surface px-2 py-0.5 rounded border border-border text-primary-dark">{config.scheduling.consolidation.trigger}</code>
            )}
          </Row>
          {(config.scheduling.consolidation.trigger === 'everyNTurns') && (
            <Row label={t('settings.sched.consolidationEveryN')}>
              <Value>{config.scheduling.consolidation.everyNTurns} turns</Value>
            </Row>
          )}
          <Row label={t('settings.sched.integrationTrigger')}>
            {config.scheduling.hasScheduler ? (
              <ClickToEdit onClick={() => openEdit(t('settings.sched.integrationTrigger'), [
                { key: 'intTrigger', label: t('settings.sched.integrationTrigger'), type: 'select', value: config.scheduling.integration.trigger, options: INTEGRATION_TRIGGERS },
                { key: 'intEveryN', label: t('settings.sched.integrationEveryN'), type: 'number', value: config.scheduling.integration.everyNTurns ?? 3, min: 1 },
              ], async (v) => {
                await handlePatch({
                  scheduling: {
                    integration: {
                      trigger: String(v.intTrigger),
                      everyNTurns: Number(v.intEveryN),
                    },
                  },
                })
              })}>
                {config.scheduling.integration.trigger}
              </ClickToEdit>
            ) : (
              <code className="text-[11px] font-mono bg-surface px-2 py-0.5 rounded border border-border text-primary-dark">{config.scheduling.integration.trigger}</code>
            )}
          </Row>
          {(config.scheduling.integration.trigger === 'everyNTurns') && (
            <Row label={t('settings.sched.integrationEveryN')}>
              <Value>{config.scheduling.integration.everyNTurns} turns</Value>
            </Row>
          )}
        </Card>

        {/* Split Guard */}
        <Card title={t('settings.guard.title')} icon={Shield}>
          {config.splitGuard ? (
            <>
              <Row label={t('settings.guard.minTurns')}>
                <ClickToEdit onClick={() => openEdit(t('settings.guard.title'), [
                  { key: 'minTurns', label: t('settings.guard.minTurns'), type: 'number', value: config.splitGuard!.minTurns, min: 0 },
                  { key: 'cooldownTurns', label: t('settings.guard.cooldown'), type: 'number', value: config.splitGuard!.cooldownTurns, min: 0 },
                ], async (v) => { await handlePatch({ splitGuard: { minTurns: Number(v.minTurns), cooldownTurns: Number(v.cooldownTurns) } }) })}>
                  {config.splitGuard.minTurns}
                </ClickToEdit>
              </Row>
              <Row label={t('settings.guard.cooldown')}>
                <Value>{config.splitGuard.cooldownTurns}</Value>
              </Row>
            </>
          ) : (
            <div className="flex items-center gap-2 px-3 py-2 bg-warning/5 rounded-lg border border-warning/15">
              <Info size={12} className="text-warning shrink-0" />
              <p className="text-[10px] text-text-muted">
                {t('settings.guard.hint')}
              </p>
            </div>
          )}
        </Card>

        {/* Runtime */}
        <Card title={t('settings.runtime.title')} icon={Cpu}>
          <Row label={t('settings.runtime.idleTtl')}>
            <ClickToEdit onClick={() => openEdit(t('settings.runtime.idleTtl'), [
              { key: 'idleTtlMs', label: t('settings.runtime.idleTtl'), type: 'number', value: config.runtime.idleTtlMs, min: 0 },
            ], async (v) => { await handlePatch({ runtime: { idleTtlMs: Number(v.idleTtlMs) } }) })}
            >
              {config.runtime.idleTtlMs} ms
            </ClickToEdit>
          </Row>
          <Row label={t('settings.runtime.resolver')}>
            <StatusDot configured={config.runtime.hasResolver} label={config.runtime.hasResolver ? t('common.custom') : t('settings.runtime.auto')} />
          </Row>
        </Card>

        <div className="pt-2 space-y-1">
          <div className="flex items-center gap-2">
            <ImmutableBadge />
            <h3 className="text-[13px] font-semibold text-text">{t('settings.bootstrap.title')}</h3>
          </div>
          <p className="text-[11px] text-text-muted">{t('settings.bootstrap.desc')}</p>
        </div>

        {/* Session Adapter */}
        <Card title={t('settings.session.title')} icon={Database}>
          <p className="text-[10px] font-semibold text-text-muted tracking-wide mb-2">{t('settings.session.resolvers')}</p>
          <Row label="sessionResolver">
            <StatusDot configured={config.session.hasSessionResolver} />
          </Row>
          <Row label="mainSessionResolver">
            <StatusDot configured={config.session.hasMainSessionResolver} />
          </Row>
          <div className="h-px bg-border my-3" />
          <p className="text-[10px] font-semibold text-text-muted tracking-wide mb-2">{t('settings.session.lifecycle')}</p>
          <Row label="consolidateFn">
            <StatusDot configured={config.session.hasConsolidateFn} />
          </Row>
          <Row label="integrateFn">
            <StatusDot configured={config.session.hasIntegrateFn} />
          </Row>
          <Row label="serializeSendResult">
            <StatusDot configured={config.session.hasSerializeSendResult} label={config.session.hasSerializeSendResult ? t('common.custom') : t('settings.session.defaultJson')} />
          </Row>
          <Row label="toolCallParser">
            <StatusDot configured={config.session.hasToolCallParser} label={config.session.hasToolCallParser ? t('common.custom') : t('common.default')} />
          </Row>
          {config.session.options && (
            <>
              <div className="h-px bg-border my-3" />
              <p className="text-[10px] font-semibold text-text-muted tracking-wide mb-2">{t('settings.session.options')}</p>
              <pre className="text-[10px] font-mono bg-surface rounded-lg p-2 border border-border text-text-secondary overflow-x-auto">
                {JSON.stringify(config.session.options, null, 2)}
              </pre>
            </>
          )}
        </Card>

        {/* Capabilities */}
        <Card title={t('settings.cap.title')} icon={Layers}>
          <Row label={t('settings.cap.lifecycle')}>
            <StatusDot configured={config.capabilities.hasLifecycle} />
          </Row>
          <Row label={t('settings.cap.confirm')}>
            <StatusDot configured={config.capabilities.hasConfirm} />
          </Row>

          <div className="h-px bg-border my-3" />
          <Collapsible title={t('settings.cap.tools')} count={config.capabilities.tools.length} defaultOpen={config.capabilities.tools.length <= 5}>
            {(toolsList.configured ? toolsList.tools : config.capabilities.tools.map((t) => ({ ...t, enabled: true }))).map((tool) => (
              <div key={tool.name} className="flex items-center gap-2 pl-2 py-0.5">
                <Wrench size={12} className={`shrink-0 ${tool.enabled ? 'text-primary' : 'text-text-muted'}`} />
                <div className="flex-1 min-w-0">
                  <span className={`text-xs font-medium ${tool.enabled ? 'text-text' : 'text-text-muted line-through'}`}>{tool.name}</span>
                  <p className="text-[10px] text-text-muted truncate">{tool.description}</p>
                </div>
                {toolsList.configured && (
                  <button
                    onClick={async () => {
                      const result = await toggleTool(tool.name, !tool.enabled)
                      setToolsList((prev) => ({ ...prev, tools: result.tools }))
                      showToast('success', t('common.toggleSuccess'))
                    }}
                    className={`shrink-0 w-8 h-4 rounded-full transition-colors relative ${tool.enabled ? 'bg-primary' : 'bg-border'}`}
                  >
                    <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${tool.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </button>
                )}
              </div>
            ))}
            {config.capabilities.tools.length === 0 && (
              <p className="text-[11px] text-text-muted italic pl-2">{t('settings.cap.noTools')}</p>
            )}
          </Collapsible>

          <div className="h-px bg-border my-3" />
          <Collapsible title={t('settings.cap.skills')} count={config.capabilities.skills.length} defaultOpen={config.capabilities.skills.length <= 5}>
            {(skillsList.configured ? skillsList.skills : config.capabilities.skills.map((s) => ({ ...s, enabled: true }))).map((skill) => (
              <div key={skill.name} className="flex items-center gap-2 pl-2 py-0.5">
                <Zap size={12} className={`shrink-0 ${skill.enabled ? 'text-[#D89575]' : 'text-text-muted'}`} />
                <div className="flex-1 min-w-0">
                  <span className={`text-xs font-medium ${skill.enabled ? 'text-text' : 'text-text-muted line-through'}`}>{skill.name}</span>
                  <p className="text-[10px] text-text-muted truncate">{skill.description}</p>
                </div>
                {skillsList.configured && (
                  <button
                    onClick={async () => {
                      const result = await toggleSkill(skill.name, !skill.enabled)
                      setSkillsList((prev) => ({ ...prev, skills: result.skills }))
                      showToast('success', t('common.toggleSuccess'))
                    }}
                    className={`shrink-0 w-8 h-4 rounded-full transition-colors relative ${skill.enabled ? 'bg-primary' : 'bg-border'}`}
                  >
                    <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${skill.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </button>
                )}
              </div>
            ))}
            {config.capabilities.skills.length === 0 && (
              <p className="text-[11px] text-text-muted italic pl-2">{t('settings.cap.noSkills')}</p>
            )}
          </Collapsible>
        </Card>

        {/* Hooks */}
        <Card title={t('settings.hooks.title')} icon={Webhook}>
          {config.hooks.length > 0 ? (
            <div className="space-y-2">
              {config.hooks.map((hook) => (
                <div key={hook} className="flex items-center gap-2">
                  <Webhook size={12} className="text-purple shrink-0" />
                  <span className="text-xs font-medium text-text">{hook}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-text-muted italic">{t('settings.hooks.none')}</p>
          )}
        </Card>

        <Card title={t('settings.reset.title')} icon={RotateCcw}>
          <div className="space-y-3">
            <p className="text-[11px] text-text-muted leading-relaxed">{t('settings.reset.desc')}</p>
            <div className="flex items-start gap-2 px-3 py-2 bg-[#FFF1F1] border border-[#F1C3C3] rounded-lg">
              <XCircle size={14} className="text-[#C84B4B] shrink-0 mt-0.5" />
              <p className="text-[11px] leading-relaxed text-[#9F2F2F]">{t('settings.reset.warning')}</p>
            </div>
            <button
              onClick={() => setResetOpen(true)}
              className="inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold text-white bg-[#C84B4B] border border-[#B54242] rounded-lg hover:bg-[#B54242] transition-colors shadow-sm"
            >
              <RotateCcw size={13} />
              {t('settings.reset.button')}
            </button>
          </div>
        </Card>
      </div>

      <EditDialog
        open={dialogOpen}
        title={dialogTitle}
        fields={dialogFields}
        onSave={dialogSaveFn}
        onClose={() => setDialogOpen(false)}
      />
      <ConfirmDialog
        open={resetOpen}
        title={t('settings.reset.confirmTitle')}
        description={t('settings.reset.confirmBody')}
        confirmLabel={resetting ? t('settings.reset.running') : t('settings.reset.button')}
        destructive
        loading={resetting}
        onClose={() => setResetOpen(false)}
        onConfirm={async () => {
          setResetting(true)
          try {
            await resetRuntime()
            persistToast('success', t('common.resetSuccess'))
            window.location.href = '/conversation'
          } finally {
            setResetting(false)
          }
        }}
      />
    </div>
  )
}
