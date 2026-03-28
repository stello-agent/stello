---
"@stello-ai/session": patch
"@stello-ai/devtools": patch
"@stello-ai/core": patch
"@stello-ai/server": patch
---

feat(session): 上下文压缩、createClaude/createGPT 工厂、fork 重构、create-session-tool

- 实现 token 预算模式的上下文自动压缩
- 新增 createClaude / createGPT 高层工厂函数
- 重构 fork() 支持上下文继承和选项覆盖
- 新增 create-session-tool 工具调用创建 Session
- 支持工具调用结果回放与 assistant 开场消息

feat(devtools): Inspector 增强与状态持久化

- Inspector 支持 per-session consolidate/integrate prompt 编辑
- 添加状态持久化功能
- 优化工具/技能展示

fix(core): 修正 memory 类型定义

fix(server): pg-session-storage 适配与 agent-pool 修复
