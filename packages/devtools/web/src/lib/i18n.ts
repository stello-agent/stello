import { createContext, useContext, useState, useCallback } from 'react'

export type Locale = 'en' | 'zh'

/** 翻译字典 */
const dict: Record<string, Record<Locale, string>> = {
  // ─── 侧边栏 ───
  'nav.map': { en: 'Map', zh: '拓扑' },
  'nav.chat': { en: 'Chat', zh: '对话' },
  'nav.inspect': { en: 'Inspect', zh: '检查' },
  'nav.events': { en: 'Events', zh: '事件' },
  'nav.settings': { en: 'Settings', zh: '设置' },

  // ─── 通用 ───
  'common.save': { en: 'Save', zh: '保存' },
  'common.cancel': { en: 'Cancel', zh: '取消' },
  'common.apply': { en: 'Apply', zh: '应用' },
  'common.export': { en: 'Export', zh: '导出' },
  'common.import': { en: 'Import', zh: '导入' },
  'common.restart': { en: 'Start Over', zh: '从头开始' },
  'common.live': { en: 'Live', zh: '实时' },
  'common.active': { en: 'Active', zh: '活跃' },
  'common.archived': { en: 'Archived', zh: '已归档' },
  'common.configured': { en: 'Configured', zh: '已配置' },
  'common.notSet': { en: 'Not set', zh: '未设置' },
  'common.immutable': { en: 'Immutable', zh: '不可变' },
  'common.none': { en: 'None', zh: '无' },
  'common.loading': { en: 'Loading...', zh: '加载中...' },
  'common.empty': { en: 'Empty', zh: '空' },
  'common.turns': { en: 'turns', zh: '轮' },
  'common.custom': { en: 'Custom', zh: '自定义' },
  'common.default': { en: 'Default', zh: '默认' },
  'common.readOnly': { en: 'Read-only', zh: '只读' },
  'common.updateSuccess': { en: 'Configuration updated', zh: '配置更新成功' },
  'common.resetSuccess': { en: 'Data cleared successfully', zh: '数据清空成功' },
  'common.importSuccess': { en: 'Configuration imported', zh: '配置导入成功' },
  'common.toggleSuccess': { en: 'Status updated', zh: '状态更新成功' },

  // ─── Topology ───
  'topo.title': { en: 'Session Topology', zh: '会话拓扑' },
  'topo.sessions': { en: 'sessions', zh: '个会话' },
  'topo.legend.main': { en: 'Main Session', zh: '主会话' },
  'topo.legend.active': { en: 'Active', zh: '活跃' },
  'topo.legend.leaf': { en: 'Leaf', zh: '叶节点' },
  'topo.legend.archived': { en: 'Archived', zh: '已归档' },
  'topo.legend.crossRef': { en: 'Cross-ref', zh: '跨引用' },
  'topo.loadFailed': { en: 'Failed to load sessions', zh: '加载会话失败' },
  'topo.loadingHint': { en: 'Loading sessions...', zh: '正在加载会话...' },
  'topo.ctx.enter': { en: 'Enter Session', zh: '进入会话' },
  'topo.ctx.inspect': { en: 'View in Inspector', zh: '在检查器中查看' },
  'topo.ctx.fork': { en: 'Fork', zh: '分叉' },
  'topo.ctx.archive': { en: 'Archive', zh: '归档' },
  'topo.panel.status': { en: 'Status', zh: '状态' },
  'topo.panel.turns': { en: 'Turns', zh: '轮次' },
  'topo.panel.l2': { en: 'L2 Memory', zh: 'L2 记忆' },
  'topo.panel.children': { en: 'Children', zh: '子节点' },
  'topo.panel.consolidated': { en: 'Consolidated', zh: '已整理' },
  'topo.panel.l2Summary': { en: 'L2 SUMMARY', zh: 'L2 摘要' },
  'topo.panel.openIn': { en: 'OPEN IN', zh: '打开至' },
  'topo.panel.conversation': { en: 'Conversation', zh: '对话' },
  'topo.panel.inspector': { en: 'Inspector', zh: '检查器' },

  // ─── Conversation ───
  'conv.sessions': { en: 'Sessions', zh: '会话列表' },
  'conv.filterSessions': { en: 'Filter sessions...', zh: '筛选会话...' },
  'conv.noMessages': { en: 'No messages yet. Start a conversation below.', zh: '暂无消息，在下方开始对话。' },
  'conv.sendPlaceholder': { en: 'Send a message...', zh: '发送消息...' },
  'conv.loadFailed': { en: 'Failed to load sessions', zh: '加载会话失败' },
  'conv.noSession': { en: 'No session', zh: '未选择会话' },
  'conv.context': { en: 'Context', zh: '上下文' },
  'conv.processing': { en: 'Processing request...', zh: '正在处理请求...' },
  'conv.thinking': { en: 'Reasoning', zh: '内部推理' },
  'conv.thinkingDone': { en: 'Reasoning complete', zh: '思考完成' },
  'conv.arguments': { en: 'ARGUMENTS', zh: '参数' },
  'conv.result': { en: 'RESULT', zh: '结果' },
  'conv.toolRound': { en: 'tool round', zh: '次工具轮' },
  'conv.toolRounds': { en: 'tool rounds', zh: '次工具轮' },
  'conv.toolCall': { en: 'tool call', zh: '次工具调用' },
  'conv.toolCalls': { en: 'tool calls', zh: '次工具调用' },
  'conv.skills': { en: 'Skills', zh: '技能' },
  'conv.tools': { en: 'Tools', zh: '工具' },
  // Context panel
  'conv.l3History': { en: 'L3 HISTORY', zh: 'L3 历史' },
  'conv.records': { en: 'RECORDS', zh: '条记录' },
  'conv.noRecords': { en: 'No records yet', zh: '暂无记录' },
  'conv.l2Memory': { en: 'L2 MEMORY', zh: 'L2 记忆' },
  'conv.generating': { en: 'Generating...', zh: '生成中...' },
  'conv.regenerate': { en: 'Regenerate', zh: '重新生成' },
  'conv.generateL2': { en: 'Generate L2', zh: '生成 L2' },
  'conv.consolidated': { en: 'consolidated', zh: '已整理' },
  'conv.noL2': { en: 'No L2 memory yet. Click Generate to create from conversation history.', zh: '尚未生成 L2 记忆。点击生成按钮从对话历史中提取。' },
  'conv.insightsScope': { en: 'INSIGHTS / SCOPE', zh: '洞察 / 范围' },
  'conv.fromMain': { en: 'from Main', zh: '来自主会话' },
  'conv.noInsights': { en: 'No insights received', zh: '暂无洞察' },
  'conv.sessionInfo': { en: 'SESSION INFO', zh: '会话信息' },
  'conv.selectSession': { en: 'Select a session to view info', zh: '选择会话查看信息' },
  'conv.id': { en: 'ID', zh: '标识' },
  'conv.label': { en: 'Label', zh: '标签' },
  'conv.status': { en: 'Status', zh: '状态' },
  'conv.created': { en: 'Created', zh: '创建时间' },

  // ─── Inspector ───
  'insp.title': { en: 'Inspector', zh: '检查器' },
  'insp.editMode': { en: 'Edit Mode', zh: '编辑模式' },
  'insp.l3Title': { en: 'L3 — Conversation Records', zh: 'L3 — 对话记录' },
  'insp.l2Title': { en: 'L2 — Memory', zh: 'L2 — 记忆' },
  'insp.insightsTitle': { en: 'Insights / Scope', zh: '洞察 / 范围' },
  'insp.sysPromptTitle': { en: 'System Prompt', zh: '系统提示词' },
  'insp.metaTitle': { en: 'Session Meta', zh: '会话元数据' },
  'insp.injectRecord': { en: '+ Inject Record', zh: '+ 注入记录' },
  'insp.consolidate': { en: 'Consolidate', zh: '整理' },
  'insp.integrate': { en: 'Integrate', zh: '整合' },
  'insp.inject': { en: 'Inject', zh: '注入' },
  'insp.searchRecords': { en: 'Search records...', zh: '搜索记录...' },
  'insp.noRecords': { en: 'No records yet', zh: '暂无记录' },
  'insp.noMatching': { en: 'No matching records', zh: '无匹配记录' },
  'insp.showing': { en: 'Showing', zh: '显示' },
  'insp.of': { en: 'of', zh: '/' },
  'insp.consolidated': { en: 'consolidated', zh: '已整理' },
  'insp.pending': { en: 'pending', zh: '待处理' },
  'insp.noL2': { en: 'No L2 memory consolidated yet', zh: '尚未整理 L2 记忆' },
  'insp.fromMain': { en: 'from Main', zh: '来自主会话' },
  'insp.noInsights': { en: 'No insights received', zh: '暂无洞察' },
  'insp.sysPromptHint': { en: 'Pass sessionAccess to startDevtools() to enable', zh: '传入 sessionAccess 到 startDevtools() 以启用' },
  'insp.consolidatePromptTitle': { en: 'Consolidate Prompt', zh: '整理提示词' },
  'insp.integratePromptTitle': { en: 'Integrate Prompt', zh: '整合提示词' },
  'insp.promptHint': { en: 'Pass sessionAccess with prompt methods to enable', zh: '传入含提示词方法的 sessionAccess 以启用' },
  'insp.promptDefault': { en: 'Using global default', zh: '使用全局默认' },
  'insp.promptCustom': { en: 'Custom', zh: '自定义' },
  'insp.selectSession': { en: 'Select a session', zh: '选择一个会话' },
  'insp.msgPlaceholder': { en: 'Message content...', zh: '消息内容...' },
  'insp.insightsPlaceholder': { en: 'Insights content...', zh: '洞察内容...' },

  // ─── Events ───
  'events.title': { en: 'Event Stream', zh: '事件流' },
  'events.live': { en: 'Live', zh: '在线' },
  'events.offline': { en: 'Offline', zh: '离线' },
  'events.all': { en: 'All', zh: '全部' },
  'events.turn': { en: 'Turn', zh: '轮次' },
  'events.consolidation': { en: 'Consolidation', zh: '整理' },
  'events.integration': { en: 'Integration', zh: '整合' },
  'events.fork': { en: 'Fork', zh: '分叉' },
  'events.error': { en: 'Error', zh: '错误' },

  // ─── Settings ───
  'settings.title': { en: 'Agent Configuration', zh: 'Agent 配置' },
  'settings.live.title': { en: 'Live Runtime', zh: '运行时热更新' },
  'settings.live.desc': { en: 'These controls apply to the current running agent immediately.', zh: '这一组设置会直接作用于当前运行中的 agent。' },
  'settings.bootstrap.title': { en: 'Read-only Bootstrap', zh: '启动时配置只读区' },
  'settings.bootstrap.desc': { en: 'These values describe how the agent was wired at startup. They are for inspection, not live editing.', zh: '这一组展示的是 agent 启动时的接线和能力状态，用于观察，不用于热更新。' },
  'settings.llm.title': { en: 'LLM Provider', zh: 'LLM 提供者' },
  'settings.llm.model': { en: 'Model', zh: '模型' },
  'settings.llm.baseUrl': { en: 'Base URL', zh: '接口地址' },
  'settings.llm.apiKey': { en: 'API Key', zh: 'API 密钥' },
  'settings.llm.temperature': { en: 'Temperature', zh: '温度' },
  'settings.llm.maxTokens': { en: 'Max Tokens', zh: '最大 Token' },
  'settings.llm.hint': { en: 'Pass llm option to startDevtools() to enable LLM switching.', zh: '传入 llm 到 startDevtools() 以启用 LLM 切换。' },
  'settings.prompts.title': { en: 'Consolidation / Integration Prompts', zh: '整理 / 整合提示词' },
  'settings.prompts.consolidate': { en: 'CONSOLIDATE PROMPT (L3→L2)', zh: '整理提示词 (L3→L2)' },
  'settings.prompts.integrate': { en: 'INTEGRATE PROMPT (L2→synthesis+insights)', zh: '整合提示词 (L2→综合+洞察)' },
  'settings.prompts.consolidateLabel': { en: 'CONSOLIDATE', zh: '整理' },
  'settings.prompts.integrateLabel': { en: 'INTEGRATE', zh: '整合' },
  'settings.prompts.hint': { en: 'Pass prompts option to startDevtools() to enable prompt editing.', zh: '传入 prompts 到 startDevtools() 以启用提示词编辑。' },
  'settings.orch.title': { en: 'Orchestration', zh: '编排' },
  'settings.orch.strategy': { en: 'Strategy', zh: '策略' },
  'settings.sched.title': { en: 'Scheduling Policy', zh: '调度策略' },
  'settings.sched.consolidationTrigger': { en: 'Consolidation Trigger', zh: '整理触发' },
  'settings.sched.consolidationEveryN': { en: 'Consolidation Every N', zh: '整理间隔轮次' },
  'settings.sched.integrationTrigger': { en: 'Integration Trigger', zh: '整合触发' },
  'settings.sched.integrationEveryN': { en: 'Integration Every N', zh: '整合间隔轮次' },
  'settings.sched.noScheduler': { en: 'No Scheduler configured — fields are read-only. Pass scheduler: new Scheduler(...) in orchestration config to enable.', zh: '未配置调度器 — 字段只读。传入 scheduler: new Scheduler(...) 以启用。' },
  'settings.sched.consolidationDesc': { en: 'Consolidation', zh: '整理' },
  'settings.sched.consolidationDetail': { en: ' (L3→L2) summarizes conversation into memory.', zh: '（L3→L2）将对话记录提炼为摘要。' },
  'settings.sched.integrationDesc': { en: ' Integration', zh: ' 整合' },
  'settings.sched.integrationDetail': { en: ' synthesizes all child L2s into synthesis + insights.', zh: '综合所有子会话的 L2 生成 synthesis + insights。' },
  'settings.guard.title': { en: 'Split Guard', zh: '拆分保护' },
  'settings.guard.minTurns': { en: 'Min Turns Before Split', zh: '拆分最少轮次' },
  'settings.guard.cooldown': { en: 'Cooldown Turns', zh: '冷却轮次' },
  'settings.guard.hint': { en: 'No SplitGuard configured. Pass splitGuard: new SplitGuard(...) in orchestration config to enable.', zh: '未配置拆分保护。传入 splitGuard: new SplitGuard(...) 以启用。' },
  'settings.runtime.title': { en: 'Runtime', zh: '运行时' },
  'settings.runtime.idleTtl': { en: 'Idle Recycle Delay (ms)', zh: '空闲回收延迟 (ms)' },
  'settings.runtime.resolver': { en: 'Runtime Resolver', zh: '运行时解析器' },
  'settings.runtime.auto': { en: 'Auto (from sessionResolver)', zh: '自动（来自 sessionResolver）' },
  'settings.session.title': { en: 'Session Adapter', zh: '会话适配器' },
  'settings.session.resolvers': { en: 'RESOLVERS', zh: '解析器' },
  'settings.session.lifecycle': { en: 'LIFECYCLE FUNCTIONS', zh: '生命周期函数' },
  'settings.session.options': { en: 'SESSION OPTIONS', zh: '会话选项' },
  'settings.session.defaultJson': { en: 'Default (JSON)', zh: '默认 (JSON)' },
  'settings.cap.title': { en: 'Capabilities', zh: '能力' },
  'settings.cap.lifecycle': { en: 'Lifecycle Adapter', zh: '生命周期适配器' },
  'settings.cap.confirm': { en: 'Confirm Protocol', zh: '确认协议' },
  'settings.cap.tools': { en: 'TOOLS', zh: '工具' },
  'settings.cap.skills': { en: 'SKILLS', zh: '技能' },
  'settings.cap.noTools': { en: 'No tools registered', zh: '未注册工具' },
  'settings.cap.noSkills': { en: 'No skills registered', zh: '未注册技能' },
  'settings.hooks.title': { en: 'Engine Hooks', zh: '引擎钩子' },
  'settings.hooks.none': { en: 'No hooks registered', zh: '未注册钩子' },
  'settings.reset.title': { en: 'Start Over', zh: '从头开始' },
  'settings.reset.desc': { en: 'Clear all demo data and reinitialize the running app from scratch.', zh: '清空当前 demo 的全部数据，并重新初始化运行中的应用。' },
  'settings.reset.warning': { en: 'Danger zone: this will permanently delete all demo data under {dataDir}.', zh: '危险操作：这会永久删除目录 {dataDir} 下的全部 demo 数据。' },
  'settings.reset.button': { en: 'Delete all data and start over', zh: '清空全部数据并从头开始' },
  'settings.reset.confirmTitle': { en: 'Clear all data and start over?', zh: '确认清空数据并重新开始？' },
  'settings.reset.confirmBody': { en: 'This will delete all sessions, records, prompts, and runtime state under {dataDir}, then bootstrap a fresh demo.\n\nThis action cannot be undone.', zh: '这会删除目录 {dataDir} 中的全部会话、记录、提示词和运行时状态，然后重新初始化一个全新的 demo。\n\n此操作不可撤销。' },
  'settings.reset.running': { en: 'Reinitializing...', zh: '重新初始化中...' },
}

/** i18n 上下文值 */
export interface I18nContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (key: string, vars?: Record<string, string>) => string
}

/** 默认上下文 */
export const I18nContext = createContext<I18nContextValue>({
  locale: 'zh',
  setLocale: () => {},
  t: (key) => key,
})

/** 使用 i18n hook */
export function useI18n() {
  return useContext(I18nContext)
}

/** 创建 i18n provider 的 value */
export function useI18nProvider(): I18nContextValue {
  const [locale, setLocale] = useState<Locale>(() => {
    const saved = localStorage.getItem('stello-devtools-locale')
    return (saved === 'en' || saved === 'zh') ? saved : 'zh'
  })

  const setAndSave = useCallback((l: Locale) => {
    setLocale(l)
    localStorage.setItem('stello-devtools-locale', l)
  }, [])

  const t = useCallback((key: string, vars?: Record<string, string>): string => {
    const raw = dict[key]?.[locale] ?? key
    if (!vars) return raw
    return raw.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`)
  }, [locale])

  return { locale, setLocale: setAndSave, t }
}
