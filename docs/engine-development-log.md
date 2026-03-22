# StelloEngine 开发日志

## 背景

这一轮工作的目标不是补底层 `Session` API 的真实实现，而是先把 **编排层** 搭起来。

原因很明确：

- 当前仓库里 `packages/session` 的 `send()` / `stream()` 还没有实现
- 但编排层的职责和边界已经在 `CLAUDE.md` 里定义清楚了
- 团队当前重点是编排层开发，所以可以先用 mock 驱动把编排逻辑做出来

本轮的原则是：

- 不等待底层 API 完成
- 不把真实 LLM / Session 实现耦合进来
- 先把 orchestration 的主入口、时序和测试模型定下来

---

## 这一轮做了什么

### 1. 新增 `TurnRunner`

文件：

- `packages/core/src/engine/turn-runner.ts`
- `packages/core/src/engine/__tests__/turn-runner.test.ts`

职责：

- 驱动单个 session 的一轮对话
- 调用 `session.send(input)`
- 如果模型返回 `toolCalls`，则逐个执行工具
- 把工具执行结果回灌给下一轮 `send()`
- 一直循环直到模型不再请求工具
- 超过最大 tool round 时安全终止

当前是 **纯编排层组件**，只依赖最小接口：

- `TurnRunnerSession`
- `TurnRunnerToolExecutor`

不依赖真实 Session 实现。

已覆盖测试：

- 无 tool call 时只调用一次 `send()`
- 单轮 tool call 后继续下一轮 `send()`
- 多个 tool call 按顺序执行
- tool 执行失败时把错误结果回灌
- 超过 `maxToolRounds` 时抛错

---

### 2. 新增 `Scheduler`

文件：

- `packages/core/src/engine/scheduler.ts`
- `packages/core/src/engine/__tests__/scheduler.test.ts`

职责：

- 决定什么时候触发 `consolidate`
- 决定什么时候触发 `integrate`

当前支持的策略：

- `manual`
- `everyNTurns`
- `afterConsolidate`
- `onSwitch`
- `onArchive`

当前支持的调度入口：

- `afterTurn()`
- `onSessionSwitch()`
- `onSessionArchive()`

这里的设计重点是：

- 调度逻辑独立于 `TurnRunner`
- 调度失败不阻断主路径
- 错误通过 `onError` 回调上报

---

### 3. 新增 `StelloEngineImpl`

文件：

- `packages/core/src/engine/stello-engine.ts`
- `packages/core/src/engine/__tests__/stello-engine.test.ts`

职责：

- 作为编排层 façade，对外提供统一入口
- 负责把 `TurnRunner`、`Scheduler`、`lifecycle`、`tools`、`sessionResolver`、`splitGuard` 组装起来

当前已经具备的入口：

- `turn(input)`
- `ingest(message)`
- `assemble()`
- `afterTurn(userMsg, assistantMsg)`
- `switchSession(targetId)`
- `switchSessionWithSchedule(targetId)`
- `archiveSession(sessionId?)`
- `forkSession(options)`
- `getToolDefinitions()`
- `executeTool(name, args)`

其中几条主线的意义：

- `turn()`：跑 tool loop，再触发 turn 后调度
- `switchSessionWithSchedule()`：切换 session，并触发 `onSwitch` 调度
- `archiveSession()`：归档 session，并触发 `onArchive` 调度
- `forkSession()`：先检查 `splitGuard`，再调用 `prepareChildSpawn()`，成功后记录 split

---

### 4. 导出编排层新接口

文件：

- `packages/core/src/index.ts`

已导出：

- `TurnRunner`
- `Scheduler`
- `StelloEngineImpl`
- `createStelloEngine`
- 对应的最小依赖类型和结果类型

这样后续迭代可以直接从 `@stello-ai/core` 入口继续往下接。

---

### 5. 新增最小集成示例

文件：

- `scripts/engine-smoke.ts`

用途：

- 用全 mock 的方式组装 `StelloEngine`
- 演示 `turn / ingest / fork / switch / archive`
- 给后续 Codex 或开发者一个最小可运行参考

根脚本增加了：

- `package.json` -> `smoke:engine`

注意：

- 在当前沙箱环境里，`pnpm smoke:engine` 可能因为 `tsx` IPC pipe 权限报错
- 实际验证时可使用：

```bash
node --import tsx scripts/engine-smoke.ts
```

---

## 当前设计意图

这轮不是为了“做完所有功能”，而是为了把编排层的结构先稳定下来。

现在的方向是：

- `TurnRunner` 负责一轮对话的 tool loop
- `Scheduler` 负责决定什么时候 consolidate / integrate
- `StelloEngineImpl` 负责作为 orchestration façade，把入口统一起来

这意味着后续继续迭代时，不应该再把新的编排逻辑散落进：

- `LifecycleManager`
- `AgentTools`
- 零散 smoke 脚本

更合理的方向是：

- 新增编排逻辑优先进 `StelloEngineImpl`
- `LifecycleManager` 更偏向旧版 memory/lifecycle 支撑层
- 后续逐步把旧逻辑往新 engine 收口

---

## 当前已知限制

### 1. 这套 engine 仍然是 mock-friendly 骨架，不是完整产品态

现在的 `StelloEngineImpl` 是编排层 façade，但还没有完整对接真实 Session 原语层。

目前依赖的仍然是最小接口，例如：

- `EngineRuntimeSession`
- `EngineLifecycle`
- `EngineTools`
- `EngineSessionResolver`
- `EngineSplitGuard`

这是有意为之，用来让编排层先独立成型。

### 2. `StelloEngine` 接口类型和实现类还没有完全统一

当前 `packages/core/src/types/engine.ts` 里的 `StelloEngine` 接口仍然是旧版接口形状。

`StelloEngineImpl` 已经有了更多方法，例如：

- `turn()`
- `switchSessionWithSchedule()`
- `archiveSession()`
- `forkSession()`

后续需要决定：

- 是更新 `types/engine.ts` 的公开接口
- 还是把这些方法作为扩展接口保留

目前代码可用，但类型层面还没有做最终收敛。

### 3. `LifecycleManager` 仍然是旧路径

现在 `StelloEngineImpl` 对下面这些能力仍然是委托旧 `lifecycle`：

- `assemble`
- `afterTurn`
- `onSessionSwitch`
- `prepareChildSpawn`

所以编排层已经开始成型，但内部仍然部分依赖旧实现。

### 4. `packages/session` 仍未落地真实 `send()/stream()`

这轮没有改 `packages/session`。

当前仍然成立：

- `packages/session` 定义了原语层接口
- `send()` / `stream()` 尚未实现
- 编排层现阶段通过 mock 来测试自己的行为

---

## 本轮新增文件

- `packages/core/src/engine/turn-runner.ts`
- `packages/core/src/engine/scheduler.ts`
- `packages/core/src/engine/stello-engine.ts`
- `packages/core/src/engine/__tests__/turn-runner.test.ts`
- `packages/core/src/engine/__tests__/scheduler.test.ts`
- `packages/core/src/engine/__tests__/stello-engine.test.ts`
- `scripts/engine-smoke.ts`

修改的文件：

- `packages/core/src/index.ts`
- `package.json`

---

## 本轮验证方式

已通过：

```bash
pnpm --filter @stello-ai/core typecheck
pnpm --filter @stello-ai/core test
node --import tsx scripts/engine-smoke.ts
```

当时全量测试结果：

- `@stello-ai/core` 共 18 个测试文件
- 共 139 个测试通过

---

## 下一位 Codex 建议从哪里继续

优先级建议如下。

### 方向 A：把 `types/engine.ts` 和 `StelloEngineImpl` 对齐

这是最应该尽快处理的一步。

当前实现已经有新的编排入口，但公开接口类型还没收口。建议：

- 重新定义 `StelloEngine` 公开接口
- 明确哪些方法是正式公开 API
- 明确哪些还只是内部实验性入口

### 方向 B：把更多旧 `LifecycleManager` 逻辑迁到 engine 路径

建议逐步减少 `LifecycleManager` 的“主入口”角色，让它更像底层支撑组件。

优先考虑：

- `onSwitch` 的行为最终是不是完全由 engine 控制
- `afterTurn` 是否要拆成更清晰的编排阶段
- `prepareChildSpawn` 是否需要继续作为 lifecycle 的一部分

### 方向 C：做一个半真实集成版本

当前 `engine-smoke.ts` 是全 mock。

下一步可以做一个“半真实”版本：

- 真实 `SessionTreeImpl`
- 真实 `LifecycleManager`
- 真实 `AgentTools`
- mock `EngineRuntimeSession.send()`

这样可以更清楚看到新 engine 和旧 core 的边界。

### 方向 D：最终接回 `packages/session`

等原语层 `send()/stream()` 有真实实现之后，再把 `TurnRunner` 真正接回 `packages/session`。

那时需要重点核对：

- tool loop 的输入/输出协议
- `send()` 返回 toolCalls 的格式
- `consolidate()` / `integrate()` 的调度契约

---

## 一句话总结

这一轮做的不是“把系统做完”，而是先把 **Stello 的编排层骨架** 独立出来：

- `TurnRunner` 管一轮对话
- `Scheduler` 管调度时机
- `StelloEngineImpl` 管统一编排入口

这样下一位 Codex 可以直接围绕 `StelloEngine` 继续收口，而不是继续在旧逻辑里打补丁。
