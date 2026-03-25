# DevTools TODO

> 当前状态：五个页面（Topology / Conversation / Inspector / Events / Settings）已完成，数据已打通真实 Agent。
> Settings 页面为只读展示，PATCH /config 已移除。

---

## Phase 1：配置热更新

### 1.1 idleTtlMs 真正热更新
- 唯一可动态修改的字段，做通整条链路
- 后端：恢复 PATCH /config 端点，实际写入 `RuntimeManager.recyclePolicy.idleTtlMs`
- 前端：Settings 页面 idleTtlMs 行加编辑控件 + Save 按钮
- 需要 `DefaultEngineRuntimeManager` 暴露 `setRecyclePolicy()` 或直接修改引用

### 1.2 Scheduler 参数热更新
- 给 `Scheduler` 加 `updateConfig(config: SchedulerConfig)` 方法
- 开放 4 个字段：consolidation.trigger / consolidation.everyNTurns / integration.trigger / integration.everyNTurns
- 前端对应行改为可编辑 Select/NumberInput
- 修改后调 PATCH /config 写入

### 1.3 SplitGuard 参数热更新
- 给 `SplitGuard` 加 `updateConfig({ minTurns, cooldownTurns })` 方法
- 开放 2 个字段：minTurns / cooldownTurns
- 前端对应行改为可编辑 NumberInput

### 1.4 配置导入 / 导出
- 导出：GET /config 的 JSON 快照下载为文件
- 导入：上传 JSON → 合并到当前 agent（仅值类型字段，函数类配置忽略）
- 前端 Settings header 加 Export / Import 按钮

---

## Phase 2：对话过程可观测

### 2.1 Conversation 工具调用展示
- 目前 tool call 过程不可见，只看到最终结果
- 流式输出中解析 tool call chunk，展示调用链：tool name → args → result → duration
- UI：折叠式 tool call 卡片，嵌套在 assistant 消息下方

### 2.2 Conversation 代码高亮
- 当前 Markdown 渲染没有语法高亮
- 接入 `shiki` 或 `highlight.js` 给代码块加语法着色

### 2.3 Events 页面增强
- session 列目前靠启动时拉一次列表建映射，新 session 不会自动更新映射
- fork.created 事件到来时自动刷新 session label 映射

---

## Phase 3：Topology 交互增强

### 3.1 右键菜单
- 节点右键弹出操作菜单：Enter Session / Fork / Archive / View in Inspector
- 调用对应 API 后刷新拓扑图

### 3.2 节点间过渡动画
- 从 Topology 点击节点跳转到 Conversation 时，加过渡动画（而非突兀切换）
- 考虑 shared layout animation 或 page transition

### 3.3 实时拓扑更新
- WS 接收 fork/archive 事件时自动重绘拓扑图
- 新节点出现时有 pop-in 动画

---

## Phase 4：Inspector 增强

### 4.1 L3 记录搜索 / 过滤
- 当前 Inspector 的 L3 records 是纯列表
- 加搜索框 + role 过滤器

### 4.2 JSON 语法高亮
- Session Meta / L2 / Scope 等 JSON 内容加语法高亮
- 可折叠的 JSON tree viewer

---

## Phase 5：工程化

### 5.1 DevTools 独立包发布
- 完善 package.json（description / keywords / repository）
- 写 README：安装方式、使用方法、截图
- 发布到 npm

### 5.2 清理遗留
- `ws.ts` 全局单例文件可能已无用（Conversation/Events 都用组件自管理 WS），确认后删除
- Topology 面板 children 展示优化

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
