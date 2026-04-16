# Consolidate / Integrate 机制重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** fn 从"调用时传入"改为"创建时绑定"，删除 Scheduler，新增 StelloAgent 一等 consolidate/integrate API。

**Architecture:** Session 层的 consolidate()/integrate() 变无参方法，fn 在 loadSession/createSession 时通过 options 绑定。Core 层删除 Scheduler 类，everyNTurns 自动 consolidation 内联到 Factory hook。StelloAgent 新增 consolidateSession()/integrate() 作为手动触发的一等 API。

**Tech Stack:** TypeScript strict, Vitest, pnpm monorepo, tsup

**Spec:** `docs/rfcs/consolidate-integrate-redesign.md`

> **注意：RFC 中 Section 9 写的是"Scheduler 不删除，但降级为可选辅助"。经讨论后决定完全删除 Scheduler，只保留 everyNTurns 内联到 Factory hook。这是对 RFC 的有意偏离。**

---

## Task 1: Session 层 — consolidate() 变无参，fn 在创建时绑定

**Files:**
- Modify: `packages/session/src/types/functions.ts` — CreateSessionOptions/LoadSessionOptions 新增 `consolidateFn?`
- Modify: `packages/session/src/types/session-api.ts:62` — Session.consolidate() 移除 fn 参数
- Modify: `packages/session/src/types/session.ts:34-50` — ForkOptions 新增 `consolidateFn?`, `compressFn?`
- Modify: `packages/session/src/create-session.ts` — buildSession 绑定 consolidateFn，consolidate() 使用绑定的 fn；fork() 传递 consolidateFn/compressFn
- Test: `packages/session/src/__tests__/memory.test.ts`
- Test: `packages/session/src/__tests__/lifecycle.test.ts`

- [ ] **Step 1: 更新类型 — Options 新增 consolidateFn，ForkOptions 新增 consolidateFn/compressFn**

`packages/session/src/types/functions.ts`:
- `CreateSessionOptions` 新增 `consolidateFn?: ConsolidateFn`
- `LoadSessionOptions` 新增 `consolidateFn?: ConsolidateFn`

`packages/session/src/types/session.ts`:
- ForkOptions 新增 `consolidateFn?: ConsolidateFn` 和 `compressFn?: CompressFn`
- 需要从 `./functions.js` import ConsolidateFn 和 CompressFn

`packages/session/src/types/session-api.ts:62`:
- 改为 `consolidate(): Promise<void>`，移除 `fn: ConsolidateFn` 参数
- 移除顶部 `ConsolidateFn` import

- [ ] **Step 2: 更新 memory.test.ts — 测试创建时绑定 consolidateFn**

所有 `session.consolidate(fn)` 改为创建时绑定 fn + `session.consolidate()`：
```typescript
const fn: ConsolidateFn = async () => 'Summarized memory'
const session = await createSession({ storage, llm, consolidateFn: fn })
await session.consolidate()  // 不传 fn
```

- [ ] **Step 3: 运行测试，确认失败**

Run: `cd packages/session && pnpm test -- --run src/__tests__/memory.test.ts`
Expected: FAIL

- [ ] **Step 4: 更新 buildSession — 绑定 consolidateFn，consolidate() 无参**

`packages/session/src/create-session.ts` buildSession 内部：

```typescript
async consolidate(): Promise<void> {
  if (currentMeta.status === 'archived') {
    throw new SessionArchivedError(currentMeta.id)
  }
  if (!options.consolidateFn) {
    throw new Error('No consolidateFn configured for this session')
  }
  const currentMemory = await storage.getMemory(currentMeta.id)
  const messages = await storage.listRecords(currentMeta.id)
  const newMemory = await options.consolidateFn(currentMemory, messages)
  await storage.putMemory(currentMeta.id, newMemory)
},
```

同时更新 fork() 传递 consolidateFn/compressFn：
```typescript
const childOptions = {
  ...options,
  ...(forkOptions.llm && { llm: forkOptions.llm }),
  ...(forkOptions.tools && { tools: forkOptions.tools }),
  ...(forkOptions.consolidateFn && { consolidateFn: forkOptions.consolidateFn }),
  ...(forkOptions.compressFn && { compressFn: forkOptions.compressFn }),
}
```

- [ ] **Step 5: 运行测试，确认 memory.test.ts 通过**

Run: `cd packages/session && pnpm test -- --run src/__tests__/memory.test.ts`
Expected: PASS

- [ ] **Step 6: 更新 lifecycle.test.ts — 补充 fork 继承 consolidateFn 测试**

新增测试：
1. fork 未指定 consolidateFn 时继承父的
2. fork 指定 consolidateFn 时使用新的

- [ ] **Step 7: 运行全部 session 测试**

Run: `cd packages/session && pnpm test -- --run`
Expected: PASS（检查所有调用 `consolidate(fn)` 的地方是否都已更新）

- [ ] **Step 8: Commit**

```
feat(session): consolidate() 变无参，fn 在创建时绑定
```

---

## Task 2: Session 层 — integrate() 变无参，fn 在创建时绑定

**Files:**
- Modify: `packages/session/src/types/functions.ts` — CreateMainSessionOptions/LoadMainSessionOptions 新增 `integrateFn?`
- Modify: `packages/session/src/types/main-session-api.ts:37` — MainSession.integrate() 移除 fn 参数
- Modify: `packages/session/src/create-main-session.ts` — buildMainSession 绑定 integrateFn，integrate() 无参；fork() 传递 consolidateFn
- Test: `packages/session/src/__tests__/main-session.test.ts`

- [ ] **Step 1: 更新类型 — Options 新增 integrateFn，接口移除 fn 参数**

`functions.ts`:
- `CreateMainSessionOptions` 新增 `integrateFn?: IntegrateFn`
- `LoadMainSessionOptions` 新增 `integrateFn?: IntegrateFn`

`main-session-api.ts:37`:
- 改为 `integrate(): Promise<IntegrateResult>`
- 移除顶部 `IntegrateFn` import（保留 `IntegrateResult`）

- [ ] **Step 2: 更新 main-session.test.ts — 测试创建时绑定 integrateFn**

所有 `main.integrate(fn)` 改为创建时绑定 fn + `main.integrate()`。

- [ ] **Step 3: 运行测试，确认失败**

Run: `cd packages/session && pnpm test -- --run src/__tests__/main-session.test.ts`
Expected: FAIL

- [ ] **Step 4: 更新 buildMainSession — 绑定 integrateFn，integrate() 无参**

`create-main-session.ts` integrate() 改为：
```typescript
async integrate(): Promise<IntegrateResult> {
  if (currentMeta.status === 'archived') {
    throw new SessionArchivedError(currentMeta.id)
  }
  if (!options.integrateFn) {
    throw new Error('No integrateFn configured for this main session')
  }
  // ...其余逻辑不变，只是 fn 改为 options.integrateFn
}
```

同时更新 MainSession.fork()（`create-main-session.ts:362-398`）传递 consolidateFn：
```typescript
const child = await createSession({
  id: childId,
  storage,
  llm: forkOptions.llm ?? options.llm!,
  label: forkOptions.label,
  systemPrompt: ...,
  tools: forkOptions.tools ?? options.tools,
  tags: forkOptions.tags,
  metadata: forkOptions.metadata,
  consolidateFn: forkOptions.consolidateFn,  // 新增
  compressFn: forkOptions.compressFn,        // 新增
})
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `cd packages/session && pnpm test -- --run src/__tests__/main-session.test.ts`
Expected: PASS

- [ ] **Step 6: 运行全部 session 测试**

Run: `cd packages/session && pnpm test -- --run`
Expected: PASS

- [ ] **Step 7: Commit**

```
feat(session): integrate() 变无参，fn 在创建时绑定
```

---

## Task 3: Core 适配层 — SessionCompatible/adapter 去参数化

**Files:**
- Modify: `packages/core/src/adapters/session-runtime.ts` — 接口和 adapter 简化
- Test: `packages/core/src/adapters/__tests__/session-runtime.test.ts`

- [ ] **Step 1: 更新 session-runtime.test.ts**

关键改动：
1. `SessionCompatible` mock 的 `consolidate` 改为无参
2. `adaptSessionToEngineRuntime` 不再需要 `consolidateFn` 选项（`SessionRuntimeAdapterOptions` 只剩 `compressFn?` 和 `serializeResult?`）
3. fork 相关 consolidateFn 继承链测试简化：adapter 不再中转 fn，session.fork 自己处理
4. 删除 `adaptMainSessionToSchedulerMainSession` 相关测试
5. 删除 consolidateFn 继承链嵌套 fork 测试（已下沉到 session 层）

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd packages/core && pnpm test -- --run src/adapters/__tests__/session-runtime.test.ts`
Expected: FAIL

- [ ] **Step 3: 更新 session-runtime.ts**

1. `SessionCompatible.consolidate()` 移除 fn 参数：`consolidate(): Promise<void>`
2. `MainSessionCompatible.integrate()` 移除 fn 参数：`integrate(): Promise<unknown>`
3. `SessionRuntimeAdapterOptions` 移除 `consolidateFn`（变为可选接口，只剩 `compressFn?` 和 `serializeResult?`）
4. 删除 `MainSessionAdapterOptions` 接口
5. 删除 `adaptMainSessionToSchedulerMainSession` 函数
6. `adaptSessionToEngineRuntime` 中 `consolidate()` 改为 `await session.consolidate()`
7. fork 时不再在 adapter 层中转 consolidateFn — `SessionCompatibleForkOptions` 中的 `consolidateFn`/`compressFn` 直接透传给 session.fork

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd packages/core && pnpm test -- --run src/adapters/__tests__/session-runtime.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```
refactor(core): 适配层去参数化，consolidateFn/integrateFn 不再中转
```

---

## Task 4: Core 层 — 删除 Scheduler，清理 Orchestrator

**Files:**
- Delete: `packages/core/src/engine/scheduler.ts`
- Delete: `packages/core/src/engine/__tests__/scheduler.test.ts`
- Modify: `packages/core/src/engine/stello-engine.ts` — EngineRuntimeSession 自包含（不再 extends SchedulerSession）；StelloEngineImpl 移除 schedulerSession getter
- Modify: `packages/core/src/orchestrator/session-orchestrator.ts` — 移除 OrchestratorSchedulingOptions / scheduling / lastActiveSessionId / triggerSwitchScheduling；OrchestratorEngine 移除 schedulerSession
- Modify: `packages/core/src/orchestrator/__tests__/session-orchestrator.test.ts` — 删除 onSwitch 调度测试
- Modify: `packages/core/src/index.ts` — 移除所有 Scheduler 相关导出和 adaptMainSessionToSchedulerMainSession / MainSessionAdapterOptions / OrchestratorSchedulingOptions

- [ ] **Step 1: 删除 scheduler.ts 和 scheduler.test.ts**

- [ ] **Step 2: 更新 stello-engine.ts**

`EngineRuntimeSession` 改为自包含（不再 `extends SchedulerSession`）：
```typescript
export interface EngineRuntimeSession {
  id: string;
  meta: { id: string; turnCount: number; status: 'active' | 'archived' };
  turnCount: number;
  send(input: string): Promise<string>;
  stream?(input: string): AsyncIterable<string> & { result: Promise<string> };
  fork?(options: SessionCompatibleForkOptions): Promise<EngineRuntimeSession>;
  consolidate(): Promise<void>;
}
```

移除 `StelloEngineImpl` 的 `schedulerSession` getter（约 line 170-173）。移除 `SchedulerSession` import。

- [ ] **Step 3: 更新 session-orchestrator.ts**

1. 移除 `Scheduler`, `SchedulerMainSession`, `SchedulerSession` imports
2. 删除 `OrchestratorSchedulingOptions` 接口
3. `OrchestratorEngine` 接口移除 `readonly schedulerSession: SchedulerSession`
4. `SessionOrchestrator` 构造函数移除第 4 个参数 `scheduling`
5. 删除 `lastActiveSessionId` 属性
6. 删除 `triggerSwitchScheduling` 方法
7. `enterSession` 中移除 switch 检测逻辑（删除 oldSessionId 判断），只保留 `requireSession` + `withRuntime`

- [ ] **Step 4: 更新 session-orchestrator.test.ts — 删除 onSwitch 调度测试**

删除整个 `describe('onSwitch 调度', ...)` block（约 line 358-492）。

- [ ] **Step 5: 更新 index.ts — 移除所有 Scheduler 和废弃 adapter 导出**

移除：
- `Scheduler` class 导出
- `ConsolidationTrigger`, `IntegrationTrigger`, `SchedulerSession`, `SchedulerMainSession`, `ConsolidationPolicy`, `IntegrationPolicy`, `SchedulerConfig`, `SchedulerResult`, `SchedulerContext` 类型导出
- `adaptMainSessionToSchedulerMainSession` 函数导出
- `MainSessionAdapterOptions` 类型导出
- `OrchestratorSchedulingOptions` 类型导出

- [ ] **Step 6: 运行 core 测试，修复编译错误**

Run: `cd packages/core && pnpm test -- --run`
预期可能有 Factory/Agent 测试引用 Scheduler 的编译错误。如有，记录需在 Task 5/6 修复的内容。

- [ ] **Step 7: Commit**

```
refactor(core): 删除 Scheduler，清理 Orchestrator 调度逻辑
```

---

## Task 5: Core 层 — Factory 简化，内联 everyNTurns

**Files:**
- Modify: `packages/core/src/orchestrator/default-engine-factory.ts` — 用 `consolidateEveryNTurns` 替代 Scheduler
- Test: `packages/core/src/orchestrator/__tests__/default-engine-factory.test.ts`

- [ ] **Step 1: 更新 default-engine-factory.test.ts**

删除所有 Scheduler 相关测试（引用 `scheduler.afterTurn` / `scheduler.onSessionLeave` / `scheduler.onSessionArchive`）。替换为：
1. `consolidateEveryNTurns > 0 时 onRoundEnd 到达阈值自动触发 consolidate`
2. `未达阈值时不触发`
3. `未配置 consolidateEveryNTurns 时无自动 consolidation`
4. `用户 hooks 和自动 consolidation hook 合并后都能触发`

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd packages/core && pnpm test -- --run src/orchestrator/__tests__/default-engine-factory.test.ts`
Expected: FAIL

- [ ] **Step 3: 更新 DefaultEngineFactory**

`DefaultEngineFactoryOptions`:
- 移除 `scheduler?: Scheduler` 和 `mainSession?: SchedulerMainSession | null`
- 新增 `consolidateEveryNTurns?: number`

`buildSchedulerHooks` 改为 `buildAutoConsolidateHook`：
```typescript
private buildAutoConsolidateHook(session: EngineRuntimeSession): Partial<EngineHooks> {
  const n = this.options.consolidateEveryNTurns;
  if (!n || n <= 0) return {};
  return {
    onRoundEnd: () => {
      const next = session.turnCount + 1;
      this.options.sessions.updateMeta(session.id, { turnCount: next }).catch(() => {});
      if (next % n === 0) {
        session.consolidate().catch(() => {});
      }
    },
  };
}
```

`create()` 方法中调用 `buildAutoConsolidateHook` 替代 `buildSchedulerHooks`。

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd packages/core && pnpm test -- --run src/orchestrator/__tests__/default-engine-factory.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```
refactor(core): Factory 内联 everyNTurns，替代 Scheduler
```

---

## Task 6: Core 层 — StelloAgent 简化 + 新增一等 API

**Files:**
- Modify: `packages/core/src/agent/stello-agent.ts`
- Modify: `packages/core/src/orchestrator/session-orchestrator.ts` — 新增 `consolidateSession()` 公共方法
- Test: `packages/core/src/agent/__tests__/stello-agent.test.ts`

- [ ] **Step 1: 在 SessionOrchestrator 新增 consolidateSession()**

`session-orchestrator.ts` 新增公共方法，使 StelloAgent 能调用：
```typescript
async consolidateSession(sessionId: string): Promise<void> {
  await this.requireSession(sessionId);
  return this.withRuntime(sessionId, async (engine) => {
    // engine.session 是 private，直接加一个 consolidate() 代理到 StelloEngineImpl
    await engine.consolidate();
  });
}
```

对应地，在 `OrchestratorEngine` 接口新增 `consolidate(): Promise<void>`。

在 `StelloEngineImpl` 新增：
```typescript
async consolidate(): Promise<void> {
  await this.session.consolidate();
}
```

- [ ] **Step 2: 更新 stello-agent.test.ts**

1. 删除 `Scheduler` import 和 `updateConfig scheduler` 相关测试
2. 删除 `updateConfig scheduling` 相关代码（包括 `updateConfig 可热更新 scheduler 和 runtime 配置` 测试中的 scheduler 部分）
3. `session.sessionResolver + consolidateFn` 接入测试改为只需 `session.sessionResolver`（不再要求 consolidateFn）
4. 新增 `consolidateSession()` 测试：mock session 有 consolidate 方法，调 `agent.consolidateSession(id)` 验证被调用
5. 新增 `integrate()` 测试：mock mainSessionResolver，调 `agent.integrate()` 验证 mainSession.integrate() 被调用

- [ ] **Step 3: 运行测试，确认失败**

Run: `cd packages/core && pnpm test -- --run src/agent/__tests__/stello-agent.test.ts`
Expected: FAIL

- [ ] **Step 4: 更新 StelloAgentSessionConfig 和 StelloAgentOrchestrationConfig**

`StelloAgentSessionConfig`:
- 移除 `consolidateFn` 和 `integrateFn`

`StelloAgentOrchestrationConfig`:
- 移除 `scheduler`
- `mainSession` 类型从 `SchedulerMainSession` 改为简单接口 `{ integrate(): Promise<unknown> }` 或移除（改到 session config 里统一用 mainSessionResolver）
- 新增 `consolidateEveryNTurns?: number`

- [ ] **Step 5: 更新 resolveRuntimeResolver — 不再要求 consolidateFn**

```typescript
function resolveRuntimeResolver(config: StelloAgentConfig): SessionRuntimeResolver {
  if (config.runtime?.resolver) return config.runtime.resolver;
  if (config.session?.sessionResolver) {
    const adaptOptions = {
      compressFn: config.session.compressFn,
      serializeResult: config.session.serializeSendResult ?? serializeSessionSendResult,
    };
    return {
      resolve: async (sessionId: string) => {
        const session = await config.session!.sessionResolver!(sessionId);
        return adaptSessionToEngineRuntime(session, adaptOptions);
      },
    };
  }
  throw new Error('StelloAgentConfig 缺少 runtime.resolver 或 session.sessionResolver');
}
```

- [ ] **Step 6: 新增 StelloAgent.consolidateSession() 和 integrate()**

```typescript
async consolidateSession(sessionId: string): Promise<void> {
  return this.orchestrator.consolidateSession(sessionId);
}

async integrate(): Promise<unknown> {
  const mainSessionResolver = this.config.session?.mainSessionResolver;
  if (!mainSessionResolver) {
    throw new Error('No mainSessionResolver configured');
  }
  const mainSession = await mainSessionResolver();
  if (!mainSession) {
    throw new Error('MainSession not found');
  }
  return mainSession.integrate();
}
```

- [ ] **Step 7: 更新 StelloAgentHotConfig — 移除 scheduling**

移除 `scheduling` 字段。同时删除 `updateConfig` 方法中 `patch.scheduling` 相关代码（约 line 292-294）。

- [ ] **Step 8: 更新 constructor — 传 consolidateEveryNTurns 给 Factory，移除 scheduler**

```typescript
const engineFactory = new DefaultEngineFactory({
  // ...不变的
  consolidateEveryNTurns: config.orchestration?.consolidateEveryNTurns,
  // 删除: scheduler, mainSession
});
```

同时删除 `scheduling` 传给 `SessionOrchestrator` 的第 4 个参数。

- [ ] **Step 9: 运行测试，确认通过**

Run: `cd packages/core && pnpm test -- --run src/agent/__tests__/stello-agent.test.ts`
Expected: PASS

- [ ] **Step 10: 运行 core 全量测试**

Run: `cd packages/core && pnpm test -- --run`
Expected: ALL PASS

- [ ] **Step 11: Commit**

```
feat(core): StelloAgent 新增 consolidateSession/integrate 一等 API，移除 Scheduler 依赖
```

---

## Task 7: Devtools 包 — routes.ts 适配

**Files:**
- Modify: `packages/devtools/src/server/routes.ts` — 移除 Scheduler 引用，使用新 API
- Test: `packages/devtools/src/__tests__/routes.test.ts`

- [ ] **Step 1: 更新 routes.ts**

关键改动：
1. `serializeConfig()` 中移除 `scheduling` 节（Scheduler 已删）。移除 `session.hasConsolidateFn` / `session.hasIntegrateFn`（字段不再存在）
2. `serializeHotConfig()` 中移除 `scheduling` 字段
3. `CONSOLIDATION_TRIGGERS` / `INTEGRATION_TRIGGERS` 常量删除
4. `PATCH /config` 路由中移除 `scheduling` 校验和处理
5. `POST /sessions/:id/consolidate` 路由：改用 `agent.consolidateSession(id)` 替代手动调 consolidateFn
```typescript
app.post('/sessions/:id/consolidate', async (c) => {
  const id = c.req.param('id')
  onEvent?.({ type: 'consolidate.start', sessionId: id })
  await agent.consolidateSession(id)
  onEvent?.({ type: 'consolidate.done', sessionId: id })
  return c.json({ ok: true })
})
```
6. `POST /integrate` 路由可改用 `agent.integrate()`（如果 integrationProvider 是可选回退）

- [ ] **Step 2: 更新 routes.test.ts**

适配新的配置序列化格式和 API 调用。

- [ ] **Step 3: 运行 devtools 测试**

Run: `cd packages/devtools && pnpm test -- --run`
Expected: PASS

- [ ] **Step 4: Commit**

```
refactor(devtools): 适配 Scheduler 删除和新 consolidate/integrate API
```

---

## Task 8: 全量构建 + 类型检查

- [ ] **Step 1: 全量测试**

Run: `pnpm -r test -- --run`
Expected: ALL PASS

- [ ] **Step 2: 类型检查 + 构建**

Run: `pnpm -r run build`
Expected: 无类型错误，构建成功

- [ ] **Step 3: Commit（如有遗漏修复）**

---

## Task 9: 更新 Skills 文档

**Files:**
- Modify: `.agents/skills/scheduler-design/SKILL.md` — 重写或删除
- Modify: `.agents/skills/engine-design/SKILL.md` — 移除 Scheduler 描述
- Modify: `.agents/skills/stello-agent-creation/SKILL.md` — 更新配置示例
- Modify: `.agents/skills/stello-usage/SKILL.md` — 更新接入描述
- Modify: `.agents/skills/session-usage/SKILL.md` — 更新 consolidate/integrate 描述

- [ ] **Step 1: 更新 scheduler-design SKILL.md**

重写为描述 `consolidateEveryNTurns` 便捷配置。或删除此 skill（Scheduler 不再是独立概念）。

- [ ] **Step 2: 更新 engine-design SKILL.md**

移除"Engine 与 Scheduler 解耦"描述，更新 EngineRuntimeSession 不再 extends SchedulerSession。

- [ ] **Step 3: 更新 stello-agent-creation SKILL.md**

更新配置示例：
- 移除 `consolidateFn`/`integrateFn` 从 session config
- 新增 `consolidateEveryNTurns` 示例
- 展示 `agent.consolidateSession()` / `agent.integrate()` 手动触发

- [ ] **Step 4: 更新 stello-usage / session-usage SKILL.md**

- `stello-usage`: 移除 `consolidateFn`/`integrateFn` 从 StelloAgentSessionConfig 描述
- `session-usage`: 更新 `consolidate(fn)` → `consolidate()` 和 `integrate(fn)` → `integrate()`

- [ ] **Step 5: Commit**

```
docs: 更新 skills 文档，反映 Scheduler 删除和 API 变更
```
