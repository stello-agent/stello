# @stello-ai/core

## 0.2.2

### Patch Changes

- 100dd33: fix(stello): 修复近期稳定性与 devtools 交互问题
  - 修复 OpenAI 兼容适配器在推理模型下的默认输出上限问题
  - 修复 integration 中 insight 回写与 sessionId 校验问题
  - 修复 devtools 的历史工具调用展示、拓扑 fork 来源显示和节点拖拽位置持久化
  - 修复 server/core 对 fork 来源展示信息的透传

- Updated dependencies [100dd33]
  - @stello-ai/session@0.2.3

## 0.2.1

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

- Updated dependencies [8ac4436]
  - @stello-ai/session@0.2.2

## 0.2.0

### Minor Changes

- # v0.2.0 Release

  ## @stello-ai/core

  ### 新增功能
  - 新增 StelloAgent 门面对象，提供统一的编排入口
  - 新增 SessionOrchestrator，支持多 Session 树管理
  - 新增 DefaultEngineFactory 和 DefaultEngineRuntimeManager
  - 新增 StelloEngine 执行周期管理器
  - 新增 TurnRunner 和 Scheduler，支持 tool call 循环和任务调度
  - 与 @stello-ai/session@0.2.0 完全集成

  ### 改进
  - 简化 API 接口，降低使用门槛
  - 完善生命周期钩子
  - 新增大量测试覆盖

  ## @stello-ai/devtools

  ### 新增功能
  - 首次发布开发者工具包
  - 支持 HTTP/WebSocket 服务器
  - 提供可视化调试界面（拓扑图、对话记录、事件监控）
  - 支持实时配置编辑
  - 支持多语言界面（中英文）

  ## @stello-ai/server

  ### 新增功能
  - 首次发布服务器包
  - 支持 HTTP REST API 和 WebSocket 实时通信
  - 支持 PostgreSQL 持久化存储
  - 支持多租户（Space 管理）
  - 内置 Agent Pool 和连接管理

  ### 特性
  - 开箱即用的 Docker Compose 配置
  - 完整的数据库迁移脚本
  - RESTful API 设计
