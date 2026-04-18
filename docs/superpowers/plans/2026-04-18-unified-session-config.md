# Unified SessionConfig Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一 Stello session 配置模型：引入 `SessionConfig` / `MainSessionConfig`，清理 `SessionMeta`，迁移 `sourceSessionId` 到 `TopologyNode`，重写 fork 合成链，改 resolver 为 loader。

**Spec:** `docs/rfcs/unified-session-config.md`

**Architecture:** 一套字段（`SessionConfig`），三个入口（`sessionDefaults` / `ForkProfile` / `EngineForkOptions`）。合成链 `sessionDefaults → 父 frozen config → ForkProfile → EngineForkOptions`，session 创建时结算并固化。`MainSessionConfig` 独立，不参与 fallback。

**Tech Stack:** TypeScript strict, pnpm workspace, Vitest, tsup, PG for server storage.

---

## 约定

- 所有新 interface 需 JSDoc；函数一行中文注释
- 不允许 `any`
- 每个 task 结束：相关包 `pnpm -F <pkg> typecheck && pnpm -F <pkg> test` 通过；最后一次合并测试前允许跨包未同步
- commit 格式：`<type>(模块名): 简短中文描述`
- 测试先行：每 task 先改/写 test，红 → 实现 → 绿 → commit

---

## Phase 1 — Foundation Types

### Task 1: 新建 `SessionConfig` / `MainSessionConfig` 类型文件

**Files:**
- Create: `packages/core/src/types/session-config.ts`
- Modify: `packages/core/src/types.ts` (re-export)

- [ ] **Step 1: 写新类型**

```typescript
// packages/core/src/types/session-config.ts
import type { LLMAdapter, LLMCompleteOptions } from '@stello-ai/session'
import type {
  SessionCompatibleConsolidateFn,
  SessionCompatibleCompressFn,
  SessionCompatibleIntegrateFn,
} from '../adapters/session-runtime'

/** 普通 session 的配置字段集。固化后写入存储，不可变。 */
export interface SessionConfig {
  systemPrompt?: string
  llm?: LLMAdapter
  tools?: LLMCompleteOptions['tools']
  /** skill 白名单。undefined=继承全局；[]=禁用 activate_skill；['a','b']=仅允许指定 skill */
  skills?: string[]
  consolidateFn?: SessionCompatibleConsolidateFn
  compressFn?: SessionCompatibleCompressFn
}

/** Main session 的配置字段集。独立，不参与 fallback 链。 */
export interface MainSessionConfig {
  systemPrompt?: string
  llm?: LLMAdapter
  tools?: LLMCompleteOptions['tools']
  skills?: string[]
  integrateFn?: SessionCompatibleIntegrateFn
  compressFn?: SessionCompatibleCompressFn
}
```

- [ ] **Step 2: 在 `packages/core/src/types.ts` 末尾加 re-export**

```typescript
export type { SessionConfig, MainSessionConfig } from './types/session-config'
```

- [ ] **Step 3: `pnpm -F @stello-ai/core typecheck`**

- [ ] **Step 4: commit**

```bash
git add packages/core/src/types/session-config.ts packages/core/src/types.ts
git commit -m "feat(core): 引入 SessionConfig 与 MainSessionConfig 类型"
```

### Task 2: 清理 `SessionMeta` + 扩展 `TopologyNode.sourceSessionId`

**Files:**
- Modify: `packages/core/src/types/session.ts`
- Modify: `packages/session/src/types/session.ts`（如存在同名字段需同步）
- Modify: `packages/core/src/session/__tests__/session-tree.test.ts`
- Modify: `packages/core/src/session/session-tree.ts` (StoredMeta + 投影)
- Modify: `packages/server/src/storage/pg-session-tree.ts` (row 投影)
- Modify: `packages/server/src/__tests__/pg-session-tree.test.ts`

- [ ] **Step 1: 先改测试 (FS)**

将 `session-tree.test.ts` 中所有 `scope`/`tags`/`metadata` 引用删除；把原本靠 `metadata.sourceSessionId` 断言的改为直接断言 `TopologyNode.sourceSessionId` 一等字段。

- [ ] **Step 2: 跑测试确认红**

`pnpm -F @stello-ai/core test -- session-tree`

- [ ] **Step 3: 改 types/session.ts**

```typescript
export interface SessionMeta {
  readonly id: string
  label: string
  status: SessionStatus
  turnCount: number
  createdAt: string
  updatedAt: string
  lastActiveAt: string
}

export interface TopologyNode {
  readonly id: string
  parentId: string | null
  children: string[]
  refs: string[]
  depth: number
  index: number
  label: string
  /** fork 时的上下文来源 session ID（topologyParentId 被覆盖时 ≠ parentId） */
  sourceSessionId?: string
}

export interface CreateSessionOptions {
  parentId: string
  label: string
  /** 新增：显式 fork 上下文来源 session */
  sourceSessionId?: string
}

// updateMeta 的 Pick 集合同步删 scope/tags/metadata
```

- [ ] **Step 4: 同步 `session-tree.ts` 的 `StoredMeta`/`createRoot`/`createChild`/`updateMeta`**

`metadata` 字段仍保留在存储层（向后兼容未迁移数据），但 API 上不再暴露。`sourceSessionId` 作为 StoredMeta 一等字段持久化，不再走 `metadata.sourceSessionId`；旧数据读取时兼容从 `metadata.sourceSessionId` 回填一次。

- [ ] **Step 5: `pnpm -F @stello-ai/core test -- session-tree` 绿**

- [ ] **Step 6: 改 PG 存储 + 其测试**

`pg-session-tree.ts`：删除 `scope` 列写入；`sourceSessionId` 用独立列或保留 metadata 兼容读取，然后独立列为主。需要 DB migration（新列 `source_session_id TEXT`）。

- [ ] **Step 7: `pnpm -F @stello-ai/server test -- pg-session-tree` 绿**

- [ ] **Step 8: commit**

```bash
git commit -m "refactor(core,server): 清理 SessionMeta 冗余字段，sourceSessionId 升为 TopologyNode 一等字段"
```

### Task 3: 更新 `EngineForkOptions` extends `SessionConfig`

**Files:**
- Modify: `packages/core/src/types/engine.ts`

- [ ] **Step 1: 改签名**

```typescript
export interface EngineForkOptions extends SessionConfig {
  label: string
  prompt?: string
  topologyParentId?: string
  context?: 'none' | 'inherit' | ForkContextFn
  profile?: string
  profileVars?: Record<string, string>
}
```

删除 `scope` / `tags` / `metadata` 字段。`llm` / `tools` / `systemPrompt` / `consolidateFn` / `compressFn` / `skills` 继承自 `SessionConfig`。

- [ ] **Step 2: `pnpm -F @stello-ai/core typecheck`** — 预期会有一批下游错，在后续 task 中修复

- [ ] **Step 3: commit**

```bash
git commit -m "refactor(core): EngineForkOptions 继承 SessionConfig，砍 scope/tags/metadata"
```

### Task 4: 更新 `ForkProfile` extends `SessionConfig`

**Files:**
- Modify: `packages/core/src/engine/fork-profile.ts`

- [ ] **Step 1: 改签名**

```typescript
export interface ForkProfile extends SessionConfig {
  /** 动态 systemPrompt（优先于 SessionConfig.systemPrompt） */
  systemPromptFn?: (vars: Record<string, string>) => string
  /** systemPrompt 合成策略：'preset' | 'prepend'（默认） | 'append' */
  systemPromptMode?: 'preset' | 'prepend' | 'append'
  /** 上下文继承策略（与 EngineForkOptions 一致） */
  context?: 'none' | 'inherit' | ForkContextFn
  /** fork 后首条消息（profile 级默认） */
  prompt?: string
}
```

保留 `resolveSystemPrompt` 帮助函数语义，但读 `systemPromptFn` 优先，再读 `systemPrompt`。删除 `contextFn`（合并进 `context`）。

- [ ] **Step 2: `pnpm -F @stello-ai/core typecheck`**

- [ ] **Step 3: commit**

```bash
git commit -m "refactor(core): ForkProfile 继承 SessionConfig，扁平化上下文策略"
```

### Task 5: 更新 `SessionCompatibleForkOptions`

**Files:**
- Modify: `packages/core/src/adapters/session-runtime.ts`

- [ ] **Step 1: 删除 `tags` / `metadata`**（`SessionCompatibleForkOptions` 已不需要暴露这些）

- [ ] **Step 2: typecheck**

- [ ] **Step 3: commit**

```bash
git commit -m "refactor(core): SessionCompatibleForkOptions 同步清理冗余字段"
```

---

## Phase 2 — Fork Merge Logic

### Task 6: 新增 `mergeSessionConfig` 工具函数（测试先）

**Files:**
- Create: `packages/core/src/engine/merge-session-config.ts`
- Create: `packages/core/src/engine/__tests__/merge-session-config.test.ts`

- [ ] **Step 1: 写测试覆盖**

```typescript
describe('mergeSessionConfig', () => {
  it('后层字段覆盖前层', () => { /* defaults + profile + forkOpts */ })
  it('undefined 字段保留前层', () => { /* ... */ })
  it('systemPrompt 按 systemPromptMode 合成', () => {
    // preset / prepend / append 三种
  })
  it('skills 整数组覆盖（不合并）', () => { /* ... */ })
  it('空数组 skills=[] 明确禁用', () => { /* ... */ })
})
```

- [ ] **Step 2: 跑测试红**

- [ ] **Step 3: 实现**

```typescript
export interface MergeInput {
  defaults?: SessionConfig
  parent?: SessionConfig            // 父 regular session 固化配置；main fork 时传 undefined
  profile?: ForkProfile
  profileVars?: Record<string, string>
  forkOptions: EngineForkOptions
}

export function mergeSessionConfig(input: MergeInput): SessionConfig { /* ... */ }
```

合成顺序：`defaults → parent → profile → forkOptions`。`systemPrompt` 走 `systemPromptMode`（profile 层 vs forkOptions 层都可能提供 prompt，合并语义：profile.mode 决定 profile vs llmProvidedPrompt；forkOptions.systemPrompt 视作 "LLM 提供"）。

- [ ] **Step 4: 绿**

- [ ] **Step 5: commit**

```bash
git commit -m "feat(core): mergeSessionConfig 统一 fork 合成链"
```

### Task 7: `EngineForkOptions` + `createMainSession` 路径整合 merge

**Files:**
- Modify: `packages/core/src/engine/stello-engine.ts` — 在 `forkSession()` 入口调用 merge
- Modify: `packages/core/src/orchestrator/session-orchestrator.ts` — 传递 `sessionDefaults` + 父 frozen config

- [ ] **Step 1: 改测试**

更新 `stello-engine.test.ts` 里的 fork 测试，断言合并行为（父继承 / profile 覆盖 / forkOption 最终赢）

- [ ] **Step 2: 实现调用**

`forkSession()` 伪代码：
```
parentCfg = loadParentFrozenConfig(parentId)
merged = mergeSessionConfig({ defaults, parent: parentCfg, profile, profileVars, forkOptions })
persistFrozenConfig(childId, merged)
childSession = buildSessionFromConfig(merged)
```

- [ ] **Step 3: 绿**

- [ ] **Step 4: commit**

```bash
git commit -m "feat(core): fork 时调用 mergeSessionConfig 并固化子 session 配置"
```

---

## Phase 3 — Skills Migration

### Task 8: `DefaultEngineFactory` 改从固化 `SessionConfig.skills` 读

**Files:**
- Modify: `packages/core/src/orchestrator/default-engine-factory.ts`
- Modify: `packages/core/src/orchestrator/__tests__/default-engine-factory.test.ts`

- [ ] **Step 1: 改测试**

删除 `metadata: { _stello: { allowedSkills: [...] } }` fixture，改为 session 的 frozen config 直接带 `skills`。

- [ ] **Step 2: 跑测试红**

- [ ] **Step 3: 实现**

```typescript
/** 按 session 固化 SessionConfig.skills 过滤全局 SkillRouter */
private resolveSkillRouter(config: SessionConfig): SkillRouter {
  if (config.skills === undefined) return this.globalSkills
  return new FilteredSkillRouter(this.globalSkills, new Set(config.skills))
}
```

Factory 需要从存储拿到 session 的 frozen config — 新增一个 loader 依赖或扩展接口。

- [ ] **Step 4: 绿**

- [ ] **Step 5: commit**

```bash
git commit -m "refactor(core): DefaultEngineFactory 从固化 SessionConfig 读 skills 白名单"
```

### Task 9: `stello-engine.ts` `executeCreateSession` + `forkSession` 去掉 `metadata._stello.allowedSkills` 写入

**Files:**
- Modify: `packages/core/src/engine/stello-engine.ts`
- Modify: `packages/core/src/engine/__tests__/stello-engine.test.ts`

- [ ] **Step 1: 改测试**

原来断言 `metadata._stello.allowedSkills === [...]` 改为断言固化 `SessionConfig.skills === [...]`。

- [ ] **Step 2: 实现**

删除 `stelloMeta.allowedSkills = profile.skills` 写入；改为在 `mergeSessionConfig` 时 profile.skills 已落入合并结果。

同时：删除 `metadata.sourceSessionId` 写入，改为 `createChild({ sourceSessionId: this.session.id })` 传给 `SessionTree`。

- [ ] **Step 3: 绿**

- [ ] **Step 4: commit**

```bash
git commit -m "refactor(core): fork 不再写 metadata._stello，sourceSessionId 走 TopologyNode"
```

### Task 10: `session-orchestrator.ts` 接入 merge + sessionDefaults 传递

**Files:**
- Modify: `packages/core/src/orchestrator/session-orchestrator.ts`
- Modify: `packages/core/src/orchestrator/__tests__/session-orchestrator.test.ts`

- [ ] **Step 1: 改测试 — 新增 sessionDefaults fixture + 断言合并结果**

- [ ] **Step 2: 实现**

`SessionOrchestrator` 构造时接 `sessionDefaults`；fork 时把它传给 engine。

- [ ] **Step 3: 绿 + commit**

```bash
git commit -m "refactor(core): SessionOrchestrator 传递 sessionDefaults 进入 fork"
```

---

## Phase 4 — Storage Persistence of Frozen Config

### Task 11: 文件存储持久化 `SessionConfig`

**Files:**
- Modify: `packages/core/src/session/session-tree.ts`
- Modify: `packages/core/src/session/__tests__/session-tree.test.ts`

- [ ] **Step 1: 改 `StoredMeta`，新增 `config?: SerializedSessionConfig`**

`SerializedSessionConfig` 排除不可序列化字段（llm/tools/consolidateFn/compressFn 是函数/对象引用）。函数类字段**不持久化**，Agent 启动时按 session 的 `profileRef` / `configRef` 动态重新绑定——或者 frozen config 只存可序列化的 `systemPrompt` + `skills`，函数类走 runtime resolver 映射。

**决策点：** 函数类字段不持久化，frozen config 只存 `{ systemPrompt, skills }`。运行时从 `sessionDefaults` + （如有）parent config 的函数字段按相同合成链在内存重建。

- [ ] **Step 2: 更新 `createRoot` / `createChild` 接受并存储 `config` 字段**

- [ ] **Step 3: 新增方法 `getConfig(id): Promise<SerializedSessionConfig | null>` 与 `putConfig`**

- [ ] **Step 4: 测试覆盖 round-trip**

- [ ] **Step 5: commit**

```bash
git commit -m "feat(core): SessionTree 持久化 frozen SessionConfig（仅可序列化字段）"
```

### Task 12: PG 存储同步 + migration

**Files:**
- Modify: `packages/server/src/storage/pg-session-tree.ts`
- Create: `packages/server/migrations/XXXX_session_config_and_source.sql`
- Modify: `packages/server/src/__tests__/pg-session-tree.test.ts`

- [ ] **Step 1: migration** — 新增列 `config JSONB`, `source_session_id TEXT`（兼容回填 `metadata.sourceSessionId`）

- [ ] **Step 2: 读写逻辑同步**

- [ ] **Step 3: 测试绿（docker compose 起 PG）**

- [ ] **Step 4: commit**

```bash
git commit -m "feat(server): pg 存储支持 frozen SessionConfig + sourceSessionId 列"
```

---

## Phase 5 — Agent Config Refactor

### Task 13: `StelloAgentConfig` 新增 `sessionDefaults` + `mainSessionConfig`，改名 resolver → loader

**Files:**
- Modify: `packages/core/src/agent/stello-agent.ts`
- Modify: `packages/core/src/agent/__tests__/stello-agent.test.ts`

- [ ] **Step 1: 改测试 fixture**

测试里把 `sessionResolver: async id => loadSession(...)` 替换成 `sessionLoader + sessionDefaults`。

- [ ] **Step 2: 实现**

```typescript
interface StelloAgentConfig {
  // ...
  sessionDefaults?: SessionConfig
  mainSessionConfig?: MainSessionConfig
  session?: {
    sessionLoader?: (id: string) => Promise<{ config: SerializedSessionConfig; meta: SessionMeta } | null>
    mainSessionLoader?: () => Promise<{ config: SerializedMainSessionConfig; meta: SessionMeta } | null>
    serializeSendResult?: ...
    toolCallParser?: ...
  }
}
```

`resolveRuntimeResolver` 内部：用 `sessionLoader + sessionDefaults` 构造 Session 实例；沿用 `adaptSessionToEngineRuntime`。

- [ ] **Step 3: 绿 + commit**

```bash
git commit -m "refactor(core): StelloAgent 接入 sessionDefaults/mainSessionConfig，resolver 改 loader"
```

### Task 14: 新增 `agent.createMainSession()` API

**Files:**
- Modify: `packages/core/src/agent/stello-agent.ts`
- Modify: `packages/core/src/agent/__tests__/stello-agent.test.ts`

- [ ] **Step 1: 测试先 — 覆盖「显式创建 main session + 首次固化 config」**

- [ ] **Step 2: 实现**

```typescript
async createMainSession(options: { label?: string } = {}): Promise<TopologyNode> {
  const node = await this.sessions.createRoot(options.label)
  const frozen = serializeMainSessionConfig(this.config.mainSessionConfig)
  await this.sessions.putConfig(node.id, frozen)
  return node
}
```

- [ ] **Step 3: 绿 + commit**

```bash
git commit -m "feat(core): StelloAgent.createMainSession 显式入口"
```

---

## Phase 6 — Downstream Consumers

### Task 15: Server 包适配

**Files:**
- Modify: `packages/server/src/space/agent-pool.ts`
- Modify: `packages/server/src/http/routes/sessions.ts` (fork endpoint)
- Modify: `packages/server/src/ws/gateway.ts`
- Modify: `packages/server/src/__tests__/*.test.ts`

- [ ] **Step 1: 改测试 + 实现：** 不再传 scope/tags/metadata；agent 构造改用 sessionDefaults/mainSessionConfig/loader
- [ ] **Step 2: 绿 + commit**

```bash
git commit -m "refactor(server): 适配 sessionDefaults/mainSessionConfig 与新 fork 字段"
```

### Task 16: Devtools 适配

**Files:**
- Modify: `packages/devtools/src/server/routes.ts`
- Modify: `packages/devtools/src/server/ws-handler.ts`
- Modify: `packages/devtools/src/server/event-bus.ts`
- Modify: `packages/devtools/web/src/lib/api.ts`
- Modify: `packages/devtools/web/src/pages/Topology.tsx`
- Modify: `packages/devtools/web/src/pages/Conversation.tsx`
- Modify: `packages/devtools/src/__tests__/routes.test.ts`

- [ ] **Step 1: 把 `sourceSessionId` 的数据来源从 metadata 改为 TopologyNode 一等字段**
- [ ] **Step 2: 删除 fork endpoint 对 scope/tags/metadata 的处理**
- [ ] **Step 3: 绿 + commit**

```bash
git commit -m "refactor(devtools): sourceSessionId 改读 TopologyNode，砍冗余 fork 字段"
```

### Task 17: Demo 适配

**Files:**
- Modify: `demo/stello-agent-basic/demo.ts`
- Modify: `demo/stello-agent-chat/chat-devtools.ts`

- [ ] **Step 1: 改用 sessionDefaults/mainSessionConfig**
- [ ] **Step 2: `pnpm -F demo-* dev` 手动跑过**
- [ ] **Step 3: commit**

```bash
git commit -m "chore(demo): 适配 sessionDefaults 与新 fork 字段"
```

---

## Phase 7 — Verification

### Task 18: 全量构建 + 测试 + 类型检查

- [ ] **Step 1:** `pnpm -r typecheck`
- [ ] **Step 2:** `pnpm -r test`
- [ ] **Step 3:** `pnpm -r build`
- [ ] **Step 4:** 手测 `demo/stello-agent-basic`：根 session 创建 → fork → 子 session turn
- [ ] **Step 5:** skill docs 批量更新（扁平整理，放到后续 doc PR 或此 PR 末尾 squash）
- [ ] **Step 6:** 最终 commit

```bash
git commit -m "docs(skills): 更新 skills 反映 unified session config"
```

---

## 风险与回退

- **Task 11 序列化决策**：frozen config 只存 `{ systemPrompt, skills }`；函数类字段在 Agent 启动时从 `sessionDefaults` 重建。这是有意为之——函数不可靠序列化，且与 CLAUDE.md #4（回调一次性注入）兼容。
- **Task 12 迁移**：PG 列新增走 `IF NOT EXISTS`；`source_session_id` 从 `metadata->>sourceSessionId` 回填一次以兼容存量。
- **Task 16 前端**：如有历史数据仍把 `sourceSessionId` 放在 metadata，UI 读取做一次 fallback。

每阶段独立 commit；回退只需 `git revert <hash>`。
