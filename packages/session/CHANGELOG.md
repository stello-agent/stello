# @stello-ai/session

## 0.2.3

### Patch Changes

- 100dd33: fix(stello): 修复近期稳定性与 devtools 交互问题
  - 修复 OpenAI 兼容适配器在推理模型下的默认输出上限问题
  - 修复 integration 中 insight 回写与 sessionId 校验问题
  - 修复 devtools 的历史工具调用展示、拓扑 fork 来源显示和节点拖拽位置持久化
  - 修复 server/core 对 fork 来源展示信息的透传

## 0.2.2

### Patch Changes

- 8ac4436: feat(session): 上下文压缩、createClaude/createGPT 工厂、fork 重构、create-session-tool
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

## 0.2.1

### Patch Changes

- 622bef8: test: 测试自动发布工作流
