# @stello-ai/core

## 0.9.0

### Changed

- `TurnRunner` now executes all tool calls within a single turn in parallel via `Promise.allSettled` (previously sequential). Per-call `onToolCall` / `onToolResult` hooks still fire in input order so external observers see the same sequence as before; concurrency safety is delegated to each tool. A failed tool becomes `success=false` in the result payload — sibling tools are not aborted. Aligns with the protocol-level intent of multi-block tool_use responses.
- `SessionTreeImpl.createChild` and `addRef` are now serialized through an internal write-lock to prevent parent-RMW races when multiple `stello_create_session` calls run concurrently within a single turn (lost children / lost refs were previously possible under the new parallel executor).

## 0.8.0

### Added

- AbortSignal threading across the turn lifecycle (closes part B of #60). `TurnRunnerOptions.signal`, `TurnRunnerSession.send/stream` and `EngineRuntimeSession.send/stream` accept `{ signal? }`; `ToolExecutionContext.signal` lets individual tools opt-in to honoring cancellation. The runner calls `throwIfAborted()` at every round boundary, before each tool call, and after each tool result is collected (suppresses phantom `onToolResult` after cancel). `Engine.turn/stream`, `Orchestrator` and `StelloAgent` forward the signal end-to-end via `TurnRunnerOptions` spread.

## 0.7.2

### Added
- `stello_create_session` tool schema: `context.enum` gains `'compress'` (surfaces existing engine capability); new `skills` field with three-state semantics (undefined=inherit / `[]`=disable / `['a','b']`=whitelist).

### Changed
- `stello_create_session` tool: parameter `vars` renamed to `profileVars` for parity with `EngineForkOptions.profileVars`. The internal `mapArgsToForkOptions` mapping helper is removed (execute now does direct conditional passthrough). Wire-level only — no consumer code references the old name.

## 0.7.1

### Patch Changes

- `activateSkillTool`: omit the `enum` field on `name` parameter when no skills are registered. Empty enum arrays are rejected by strict JSON-Schema validators (e.g. Moonshot returns "enum array cannot be empty"). `execute()` already validates unknown skill names at runtime, so dropping the constraint is safe.

## 0.7.0

### Major Changes

- **Built-in tools redesign**: `stello_create_session` and `activate_skill` are now factory-produced `ToolRegistryEntry` objects (`createSessionTool()`, `activateSkillTool(skills)` exported from `@stello-ai/core`). Users explicitly register what they want to expose to the LLM via `capabilities.tools`. Engine no longer auto-injects.
- **Bug fix**: built-in tool descriptions now actually reach the LLM (previously absent in all production configs because the engine never pushed its composite registry into the session).
- **Breaking — `ToolRegistryEntry.execute` now requires a `ctx: ToolExecutionContext` parameter** providing `agent`, `sessionId`, `toolCallId?`, `toolName`. All tools (built-in and user) are isomorphic.
- **`EngineRuntimeSession` gains `tools` getter + `setTools(tools)`** (also added to `Session` and `MainSession` in `@stello-ai/session`). Adapter forwards to underlying `Session.setTools`.
- Engine pushes `union(session.tools, capabilities.tools)` to session at construction and after every `forkSession()`.
- New `unionByName` helper at `@stello-ai/core/tool/union`.
- New `ForkProfileRegistry.has(name)` method for runtime profile validation.

### Removed

- `createBuiltinToolEntries`, `CompositeToolRuntime` (no longer needed; engine does not composite tools)
- `engine/builtin-tools.ts` (schema generation moved to factory)
- `Engine.executeCreateSession` private method (logic now lives in the `createSessionTool` factory)
- Re-export of `createSessionTool` from `@stello-ai/session` (the legacy duplicate; the new `createSessionTool` exported from `@stello-ai/core` is the replacement)

### Migration

Users should update their tool setup to explicitly opt-in to built-in tools:

```diff
- tools: new ToolRegistryImpl()  // built-ins were auto-injected (broken)
+ tools: new ToolRegistryImpl([
+   createSessionTool(),         // opt-in
+   activateSkillTool(skills),   // opt-in
+ ])
```

User tool `execute` signature must now accept context parameter:

```diff
- execute: async (args) => ({ success: true, data: ... })
+ execute: async (args, _ctx) => ({ success: true, data: ... })
```

## 0.5.2

### Patch Changes

- fix(core): 从 main session fork 不再继承 main 的配置（#55）
  - Engine `forkSession` 在 `sourceSessionId === MAIN_SESSION_ID` 时跳过 `sessions.getConfig`，避免 main 的 `systemPrompt` / `skills` 通过四层合成链泄漏到子 session（违反 fork-design invariant #6）
  - `SessionTreeImpl.createRoot` 使用固定 ID `MAIN_SESSION_ID = 'main'`，并在 main 已存在时幂等返回现有节点、不覆写数据
  - 新增导出 `MAIN_SESSION_ID` 常量

### ⚠️ Soft breaking — 自行实现 `SessionTree` 的宿主需同步

内置 `SessionTreeImpl` 的宿主不受影响。若自行实现 `SessionTree`，`createRoot` 必须返回 `id === MAIN_SESSION_ID` 的 TopologyNode，否则 fork-from-main 的保护逻辑无法生效。

已使用旧版本（UUID 作为 main session id）创建过 main session 的 installs 不会自动迁移：升级后下一次 `createMainSession` 调用会创建 id=`'main'` 的新根，旧 UUID 根将成为孤儿。宿主需要迁移请自行处理。

## 0.3.0

### Minor Changes

- feat(core): ToolRegistry 工具注册表 — 内置 tool 与用户 tool 统一走 ToolRegistryEntry + CompositeToolRuntime
- feat(core): ForkProfile 系统 — 预注册 fork 配置模板，支持 systemPrompt 三种合成策略、prompt 字段、skills 白名单
- feat(core): fork 支持 per-session consolidateFn/compressFn 继承链
- feat(core): Skills 系统 — Skill 重定义为 prompt 片段，skill-tool 自动注册，FilteredSkillRouter 白名单过滤
- feat(core): Engine 内置 stello_create_session tool，统一 fork 链路
- feat(core): FileSystemMemoryEngine
- refactor(core): Engine.forkSession() 使用 session.fork()，移除 resolver.create

### Patch Changes

- fix(core): Orchestrator 层接入 Scheduler.onSessionSwitch 调度
- fix(core): normalize readCore missing key to null，guard corrupt JSONL lines
- fix(core): TurnRunner 通过 Engine 执行 tool call
- chore: 补全 session re-export（SessionArchivedError、ForkOptions、ToolAnnotations 等）
- Updated dependencies
  - @stello-ai/session@0.3.0

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
