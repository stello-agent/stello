# DevTools TODO

> 当前状态：五个页面（Topology / Conversation / Inspector / Events / Settings）已完成，数据已打通真实 Agent。
> Settings 页面为只读展示，PATCH /config 已移除。

---

## ~~Phase 1：配置热更新~~ ✅

> 已完成：core 三组件 updateConfig + StelloAgent.updateConfig 门面 + PATCH /config + 前端可编辑 + 导入导出

---

## ~~Phase 2：对话过程可观测~~ ✅

> 已完成：流式 tool call 事件 + 折叠式卡片 / highlight.js 代码高亮 / Events label 自动刷新

---

## ~~Phase 3：Topology 交互增强~~ ✅

> 已完成：右键菜单（Enter/Fork/Archive/Inspector）+ 面板导航修复 + Fork/Archive 按钮 + WS 实时更新 + 新节点 pop-in 动画
> 3.2 节点间过渡动画评估后不做（投入产出比低），保持现有 fadeIn

---

## ~~Phase 4：Inspector 增强~~ ✅

> 已完成：L3 搜索/过滤 + URL session 参数 + JSON 可折叠树 viewer + Session Meta/Scope JSON 高亮

---

## ~~Phase 5：工程化~~ ✅（部分）

> 5.2 已完成：删除 ws.ts 全局单例
> 5.1 独立包发布暂不实施（待项目整体稳定后统一处理）

---

## 已完成

- [x] Topology 星空图（Canvas, pan/zoom/drag, BFS layout, breathing pulse）
- [x] Conversation 页面（NDJSON streaming, Markdown rendering, think tag filtering）
- [x] Inspector 页面（L3 records, L2 memory, scope, session meta）
- [x] Events 页面（WS real-time + history buffer, color-coded badges, filters）
- [x] Settings 页面（只读配置面板，完整展示所有 AgentConfig 字段）
- [x] 后端 REST routes + WS handler + EventBus
- [x] 真实数据打通（文件持久化 MemoryEngine, session 恢复）
- [x] Scheduler.getConfig() / SplitGuard.getConfig() 序列化方法
- [x] 清理 debug log / 无用 import / 空壳 PATCH
- [x] docs/stello-agent-config-reference.md 配置完全参考文档
- [x] Phase 1 配置热更新（idleTtlMs / Scheduler / SplitGuard + PATCH /config + 前端编辑 + 导入导出）
- [x] Phase 2 对话过程可观测（tool call 卡片 + highlight.js 代码高亮 + Events label 自动刷新）
- [x] Phase 3 Topology 交互增强（右键菜单 + 面板修复 + WS 实时更新 + pop-in 动画）
- [x] Phase 4 Inspector 增强（L3 搜索/过滤 + URL session 参数 + JSON tree viewer）
- [x] Phase 5.2 清理遗留（删除 ws.ts 全局单例）
