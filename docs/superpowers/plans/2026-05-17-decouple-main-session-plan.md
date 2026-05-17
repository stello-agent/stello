# Main Session 解耦实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从 Stello 中彻底删除 Main Session 概念（类型、工厂、配置、存储）。统一为单一 Session；对话起点是 root session（普通 session，`parentId === null`）。原 Main 承担的跨 Session 综合 / insights 推送外包给外部 orchestrator，框架仅暴露纯数据 SDK API。

**Architecture:** 改动横跨 `@stello-ai/session` 与 `@stello-ai/core` 两个 package。Session 层只剩一种 Session 接口与一个 `SessionStorage` 接口；Core 层把 `SessionTree` 三个工厂收敛为 `createSession`，删 `MAIN_SESSION_ID` 常量与所有 `MainSessionConfig` / `mainSessionLoader` / `integrate()` 配套。新增的 SDK 方法挂在 `StelloAgent`，依赖一个新的顶层 `storage: SessionStorage` 注入点。

**Tech Stack:** TypeScript 严格模式 / pnpm monorepo / Vitest / tsup。Spec 在 `docs/superpowers/specs/2026-05-16-decouple-main-session-design.md`。

**设计选择（已与用户对齐）：**
- Storage 注入点：顶层 `StelloAgentConfig.storage`
- `getTopology()` 形态：`SessionTreeNode[]` 森林数组
- 实现与测试改动放在同一个任务内（同一 commit）
- 不留 deprecated alias / 不写迁移工具（spec §7.3）
- demo / devtools / visualizer 不在本计划范围（spec §7.2）

**总体顺序：**

```
A. Session 包 bottom-up           B. Core 包 types 层
   1  SessionMeta 瘦身                5  MAIN_SESSION_ID 删除
   2  SessionStorage 收敛              6  MainSessionConfig 类型清理
   3  MainSession 工厂删除             7  Adapter MainSession 类型清理
   4  Session index 导出收敛           8  llm/defaults integrate 删除

C. Core 包 SessionTree + Engine + Agent     D. SDK API
   9  SessionTree 重写多 root                  12  topology / list SDK
   10 Engine fork main 分支删除                13  data-IO SDK + storage 注入
   11 StelloAgent main 配套删除

E. 收尾
   14 core/types.ts 与 core/index.ts 导出收敛
   15 全量 typecheck + test + CHANGELOG
```

每个任务结束都跑一次 `pnpm typecheck` 和包内 `pnpm test`，保证下一任务起点是绿的。**所有任务全部完成前不要 release / 不要打 tag**。

---

## Task 1: 删除 SessionMeta 上的 role / tags / metadata 字段

**目标：** Session 元数据只保留 `id / label / status / createdAt / updatedAt`，对外语义统一。

**Files:**
- Modify: `packages/session/src/types/session.ts`
- Modify: `packages/session/src/types/storage.ts:1` (drop unused `SessionFilter` import path)
- Modify: `packages/session/src/create-session.ts:387-396, 442-451, 482-493`
- Modify: `packages/session/src/create-main-session.ts:353-365, 437-448`（仅过渡兼容；Task 3 整体删除该文件）
- Modify: `packages/session/src/mocks/in-memory-storage.ts:27-40`
- Modify: `packages/session/src/__tests__/meta.test.ts`
- Modify: `packages/session/src/__tests__/lifecycle.test.ts:15-16, 26-28, 64-90`
- Modify: `packages/session/src/__tests__/abort.test.ts:175-185`

- [ ] **Step 1: 改 `types/session.ts` 内 SessionMeta / SessionMetaUpdate / SessionFilter**

将 `packages/session/src/types/session.ts` 内的相关类型替换为：

```ts
/** Session 元数据，描述一个独立对话单元 */
export interface SessionMeta {
  readonly id: string
  label: string
  status: 'active' | 'archived'
  createdAt: string
  updatedAt: string
}

/** 可更新的 SessionMeta 字段子集 */
export interface SessionMetaUpdate {
  label?: string
}

/** 列举 Session 时的过滤条件 */
export interface SessionFilter {
  status?: 'active' | 'archived'
}
```

`ForkOptions` 内不要删 `tags` / `metadata`——因为本任务暂时还允许 fork API 传它们以保持向下兼容；等 Task 3 把 createMainSession 一起删时再清。**但** `ForkOptions.tags` 和 `ForkOptions.metadata` 不再写入 SessionMeta；create-session.ts 里要忽略它们（见下一步）。

实际上，本任务直接把 `ForkOptions.tags` / `ForkOptions.metadata` 一起删干净更省事。改 `ForkOptions` 同步删除这两个字段。

- [ ] **Step 2: 改 `create-session.ts` 三处使用点**

定位 `packages/session/src/create-session.ts:387-396`（`fork` 内的 childMeta 构造）：

```ts
const childMeta: SessionMeta = {
  id: childId,
  label: forkOptions.label,
  status: 'active',
  createdAt: now,
  updatedAt: now,
}
```

`packages/session/src/create-session.ts:438-451`（`updateMeta` 实现）只剩 label 分支：

```ts
async updateMeta(updates: SessionMetaUpdate): Promise<void> {
  if (currentMeta.status === 'archived') {
    throw new SessionArchivedError(currentMeta.id)
  }
  const updatedMeta: SessionMeta = {
    ...currentMeta,
    ...(updates.label !== undefined && { label: updates.label }),
    updatedAt: new Date().toISOString(),
  }
  await storage.putSession(updatedMeta)
  currentMeta = updatedMeta
},
```

`packages/session/src/create-session.ts:482-493`（`createSession` 工厂初始化）：

```ts
const meta: SessionMeta = {
  id,
  label: options.label ?? 'New Session',
  status: 'active',
  createdAt: now,
  updatedAt: now,
}
```

同步删除 `CreateSessionOptions.tags` / `CreateSessionOptions.metadata` 字段（`packages/session/src/types/functions.ts:42-46`）。

- [ ] **Step 3: 改 `create-main-session.ts` 等价位置**

`createMainSession` 整个文件会在 Task 3 删掉，但为了保证本任务 typecheck 通过：把 `packages/session/src/create-main-session.ts:353-365` 的 `updateMeta` 实现里 `tags` / `metadata` 分支去掉；把 `packages/session/src/create-main-session.ts:368-406` 的 `fork` 里传给 `createSession` 的 `tags` / `metadata` 去掉；把 `packages/session/src/create-main-session.ts:437-448` 的 meta 构造内的 `role: 'main'`、`tags`、`metadata` 字段去掉。

注意：先保留 `role: 'main'` 字段实际上没法保留——SessionMeta 接口已经没有这个字段了。**必须删掉**。同步把 `loadMainSession` 的 `if (!meta || meta.role !== 'main') return null` 改为 `if (!meta) return null`。

- [ ] **Step 4: 改 `mocks/in-memory-storage.ts:27-40` 的 listSessions filter**

```ts
async listSessions(filter?: SessionFilter): Promise<SessionMeta[]> {
  const all = Array.from(this.sessions.values())
  if (!filter) return all
  return all.filter((s) => {
    if (filter.status !== undefined && s.status !== filter.status) return false
    return true
  })
}
```

`getAllSessionL2s` 中 `session.role !== 'standard'` 这一过滤改为只剩 `session.status !== 'active'`（暂时如此；Task 3 会把整个 `getAllSessionL2s` 删掉）。

- [ ] **Step 5: 改测试 — `meta.test.ts`**

去掉 `tags: ['a', 'b'], metadata: { foo: 'bar' }`、`expect(m.role).toBe('standard')`、`expect(m.tags).toEqual(...)`、`expect(m.metadata).toEqual(...)` 等断言。`updateMeta` 测试只测 label 字段。`createSession 默认 role 为 standard` 这一条用例整条删除。

- [ ] **Step 6: 改测试 — `lifecycle.test.ts`**

定位 `await session.updateMeta({ tags: ['tag1', 'tag2'] })` 行（line ~15）：用 `await session.updateMeta({ label: 'Renamed' })` 替代；断言改为 `expect(session.meta.label).toBe('Renamed')`。

`await makeSession({ label: 'Keep', tags: ['keep'] })` 行（line ~26）：去掉 `tags: ['keep']` 参数；断言改为只校验 label。

`fork` 用例（line ~75-90）中 `tags: ['forked']` 与 `expect(child.meta.tags).toEqual(['forked'])` 一起删；保留对 `child.meta.label / status` 的断言；删除 `expect(child.meta.role).toBe('standard')` 这一行。

- [ ] **Step 7: 改测试 — `abort.test.ts:175-185`**

abort 测试里手工构造 `SessionMeta` 对象的地方（`role: 'standard'`、`tags: []` 字段），改为新形状：

```ts
{
  id: 'abort-session',
  label: 'Abort Session',
  status: 'active',
  createdAt: now,
  updatedAt: now,
}
```

- [ ] **Step 8: typecheck + 包内测试**

```bash
pnpm --filter @stello-ai/session typecheck && pnpm --filter @stello-ai/session test
```

Expected: 全绿。如果 main-session.test.ts 失败（因为它读 meta.role），**允许暂时失败**：本任务的下一个任务（Task 3）就会删整个 main-session 测试文件。可以临时给该文件加 `it.skip` 或 vitest 的 `describe.skip` 包住整个文件，commit message 注明"will be removed in Task 3"。

- [ ] **Step 9: Commit**

```bash
git add packages/session/src/types/session.ts \
        packages/session/src/types/functions.ts \
        packages/session/src/create-session.ts \
        packages/session/src/create-main-session.ts \
        packages/session/src/mocks/in-memory-storage.ts \
        packages/session/src/__tests__/meta.test.ts \
        packages/session/src/__tests__/lifecycle.test.ts \
        packages/session/src/__tests__/abort.test.ts
git commit -m "refactor(session): drop role/tags/metadata from SessionMeta"
```

---

## Task 2: 合并 MainStorage 到 SessionStorage，删除拓扑/全局键值/批量 L2 等冗余方法

**目标：** SessionStorage 单一接口，只剩 SessionMeta CRUD + L3 + system prompt + insight + memory + transaction；删除 `MainStorage` 接口、`TopologyNode`（迁到 core 的责任）、`getAllSessionL2s`、`listSessions`、`putNode / getChildren / removeNode`、`getGlobal / putGlobal`。

**Files:**
- Modify: `packages/session/src/types/storage.ts`
- Modify: `packages/session/src/mocks/in-memory-storage.ts`
- Modify: `packages/session/src/__tests__/main-session.test.ts`（仅去掉用到 storage 已删方法的部分；整个文件下一任务再删）

- [ ] **Step 1: 重写 `types/storage.ts`**

```ts
import type { SessionMeta, SessionFilter } from './session.js'
import type { Message } from './llm.js'

/** 列举消息记录时的选项 */
export interface ListRecordsOptions {
  limit?: number
  offset?: number
  /** 只返回指定 role 的消息 */
  role?: Message['role']
}

/**
 * SessionStorage — Session 数据操作接口
 *
 * 所有 Session（含 root）共用同一个接口。
 * 拓扑节点 CRUD 由 core SessionTree 持有，不在此接口职责内。
 */
export interface SessionStorage {
  /** 读取 Session 元数据，不存在返回 null */
  getSession(id: string): Promise<SessionMeta | null>
  /** 写入或更新 Session 元数据 */
  putSession(session: SessionMeta): Promise<void>
  /** 列举 Session（按状态过滤） */
  listSessions(filter?: SessionFilter): Promise<SessionMeta[]>

  /** 追加一条对话记录（L3） */
  appendRecord(sessionId: string, record: Message): Promise<void>
  /** 读取对话记录列表（L3） */
  listRecords(sessionId: string, options?: ListRecordsOptions): Promise<Message[]>
  /** 裁剪旧 L3 记录，仅保留最近 keepRecent 条 */
  trimRecords(sessionId: string, keepRecent: number): Promise<void>

  /** 读取 Session 的 system prompt */
  getSystemPrompt(sessionId: string): Promise<string | null>
  /** 写入 Session 的 system prompt */
  putSystemPrompt(sessionId: string, content: string): Promise<void>

  /** 读取 Session 的 insight，一次性，send 消费后调用 clearInsight */
  getInsight(sessionId: string): Promise<string | null>
  /** 写入 Session 的 insight */
  putInsight(sessionId: string, content: string): Promise<void>
  /** 清除 Session 的 insight */
  clearInsight(sessionId: string): Promise<void>

  /** 读取 Session 的持久 memory（原 L2 / 原 synthesis 统一槽位） */
  getMemory(sessionId: string): Promise<string | null>
  /** 写入 Session 的 memory */
  putMemory(sessionId: string, content: string): Promise<void>

  /** 事务（内存实现可直接执行 fn） */
  transaction<T>(fn: (tx: SessionStorage) => Promise<T>): Promise<T>
}
```

> 注：`MainStorage` 接口完全删除；`TopologyNode` 也从本文件搬走（拓扑节点是 core 的责任）。
> 保留 `listSessions` 在 `SessionStorage` 上是为了让 SDK 层 `agent.listSessions` 可以直接代理过去（spec §6.1 标记 listSessions 为类别确定）。

- [ ] **Step 2: 改 `mocks/in-memory-storage.ts`**

```ts
import type { SessionStorage, ListRecordsOptions } from '../types/storage.js'
import type { SessionMeta, SessionFilter } from '../types/session.js'
import type { Message } from '../types/llm.js'

export class InMemoryStorageAdapter implements SessionStorage {
  private sessions = new Map<string, SessionMeta>()
  private records = new Map<string, Message[]>()
  private memories = new Map<string, string>()
  private systemPrompts = new Map<string, string>()
  private insights = new Map<string, string>()

  async getSession(id: string): Promise<SessionMeta | null> {
    return this.sessions.get(id) ?? null
  }

  async putSession(session: SessionMeta): Promise<void> {
    this.sessions.set(session.id, { ...session })
  }

  async listSessions(filter?: SessionFilter): Promise<SessionMeta[]> {
    const all = Array.from(this.sessions.values())
    if (!filter) return all
    return all.filter((s) => {
      if (filter.status !== undefined && s.status !== filter.status) return false
      return true
    })
  }

  async appendRecord(sessionId: string, record: Message): Promise<void> {
    const list = this.records.get(sessionId) ?? []
    list.push({ ...record })
    this.records.set(sessionId, list)
  }

  async listRecords(sessionId: string, options?: ListRecordsOptions): Promise<Message[]> {
    let list = this.records.get(sessionId) ?? []
    if (options?.role) list = list.filter((m) => m.role === options.role)
    const offset = options?.offset ?? 0
    list = list.slice(offset)
    if (options?.limit !== undefined) list = list.slice(0, options.limit)
    return list.map((m) => ({ ...m }))
  }

  async trimRecords(sessionId: string, keepRecent: number): Promise<void> {
    if (keepRecent <= 0) {
      this.records.set(sessionId, [])
      return
    }
    const list = this.records.get(sessionId) ?? []
    if (list.length > keepRecent) {
      this.records.set(sessionId, list.slice(-keepRecent))
    }
  }

  async getSystemPrompt(sessionId: string): Promise<string | null> {
    return this.systemPrompts.get(sessionId) ?? null
  }
  async putSystemPrompt(sessionId: string, content: string): Promise<void> {
    this.systemPrompts.set(sessionId, content)
  }

  async getInsight(sessionId: string): Promise<string | null> {
    return this.insights.get(sessionId) ?? null
  }
  async putInsight(sessionId: string, content: string): Promise<void> {
    this.insights.set(sessionId, content)
  }
  async clearInsight(sessionId: string): Promise<void> {
    this.insights.delete(sessionId)
  }

  async getMemory(sessionId: string): Promise<string | null> {
    return this.memories.get(sessionId) ?? null
  }
  async putMemory(sessionId: string, content: string): Promise<void> {
    this.memories.set(sessionId, content)
  }

  async transaction<T>(fn: (tx: SessionStorage) => Promise<T>): Promise<T> {
    return fn(this)
  }
}
```

- [ ] **Step 3: 暂时把 `create-main-session.ts` 内 `storage.getAllSessionL2s()` 调用注释或抛错**

`createMainSession` 在下个任务整体删除。本任务里为了 typecheck 通过，把 `packages/session/src/create-main-session.ts:322` 那行
```ts
const childSummaries = await storage.getAllSessionL2s()
```
临时改为 `const childSummaries: never[] = []` 并加一行注释 `// Task 3 will delete this file`。同时把 `storage` 的类型从 `MainStorage` 改为 `SessionStorage`（顶部 import 同步）。

- [ ] **Step 4: typecheck + 包内测试**

```bash
pnpm --filter @stello-ai/session typecheck && pnpm --filter @stello-ai/session test
```

- [ ] **Step 5: Commit**

```bash
git add packages/session/src/types/storage.ts \
        packages/session/src/mocks/in-memory-storage.ts \
        packages/session/src/create-main-session.ts
git commit -m "refactor(session): merge MainStorage into SessionStorage"
```

---

## Task 3: 删除 MainSession 接口、工厂、上下文组装、专属测试

**目标：** 彻底移除 `MainSession` 类型 / `createMainSession` / `loadMainSession` / `assembleMainSessionContext` / `IntegrateFn` / `IntegrateResult` / `ChildL2Summary` / `CreateMainSessionOptions` / `LoadMainSessionOptions`，以及对应的测试。

**Files:**
- Delete: `packages/session/src/types/main-session-api.ts`
- Delete: `packages/session/src/create-main-session.ts`
- Delete: `packages/session/src/__tests__/main-session.test.ts`
- Modify: `packages/session/src/types/functions.ts`（删 Integrate / MainSession 相关类型）
- Modify: `packages/session/src/context-utils.ts`（删 `assembleMainSessionContext`）
- Modify: `packages/session/src/__tests__/integration-llm.test.ts`（替换为单 session 上下文测试或删除 Main 相关用例）
- Modify: `packages/session/src/__tests__/context-compress.test.ts`（删 Main 相关用例）

- [ ] **Step 1: 删除 `main-session-api.ts` 与 `create-main-session.ts`**

```bash
rm packages/session/src/types/main-session-api.ts \
   packages/session/src/create-main-session.ts
```

- [ ] **Step 2: 删除 `main-session.test.ts`**

```bash
rm packages/session/src/__tests__/main-session.test.ts
```

- [ ] **Step 3: 改 `types/functions.ts`**

删除以下类型导出与定义：
- `ChildL2Summary` interface
- `IntegrateResult` interface
- `IntegrateFn` type
- `CreateMainSessionOptions` interface
- `LoadMainSessionOptions` interface

保留：`ConsolidateFn` / `CompressFn` / `CreateSessionOptions` / `LoadSessionOptions` / `SendResult` / `StreamResult`。

文件末尾不留任何 Main 相关 import 路径。

- [ ] **Step 4: 改 `context-utils.ts`**

删除 `assembleMainSessionContext` 函数（line 290-369）。整个文件 OK。`assembleSessionContext` 是唯一的上下文组装函数，对 root / 子 Session 同构。

- [ ] **Step 5: 改 `integration-llm.test.ts`**

打开 `packages/session/src/__tests__/integration-llm.test.ts`。逐 it 块判断：

- 顶部 `import { createMainSession } from '../create-main-session.js'` 这行删掉。
- 凡是 `await createMainSession(...)` 的调用，改为 `await createSession({ storage, llm, label: 'Test Root', ... })`，并把后续断言 `main.synthesis()` 改为 `root.memory()`。
- 凡是测 `main.integrate()` 的 it 块——integrate 已不存在——整体 `it.skip`，并加注释 `// removed in main-session decouple; integration is orchestrator-side now`。本任务之后这些用例可在后续 cleanup task 中删除；但为减少范围，先 skip 即可。

执行检查：再次跑 `pnpm --filter @stello-ai/session test` 时这些 `it.skip` 显示为 skipped，**不**显示为 failed。

- [ ] **Step 6: 改 `context-compress.test.ts`**

打开 `packages/session/src/__tests__/context-compress.test.ts`：搜 `assembleMainSessionContext` / `createMainSession`；用 `assembleSessionContext` / `createSession` 替换；root 在替换后等于普通 session，行为应相同。

- [ ] **Step 7: typecheck + 包内测试**

```bash
pnpm --filter @stello-ai/session typecheck && pnpm --filter @stello-ai/session test
```

Expected: 全绿。

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(session): remove MainSession interface, factory, and tests"
```

---

## Task 4: 收敛 `@stello-ai/session` 的 index.ts 导出

**目标：** 删掉所有 Main 相关 export，保留单一 Session 类型与函数。

**Files:**
- Modify: `packages/session/src/index.ts`

- [ ] **Step 1: 改 `index.ts`**

```ts
// 类型导出 — Session
export type { SessionMeta, SessionMetaUpdate, SessionFilter, ForkOptions, ForkContextFn } from './types/session.js'
export type { SessionStorage, ListRecordsOptions } from './types/storage.js'
export type {
  Message, ToolCall, LLMCompleteOptions, LLMResult, LLMChunk, LLMAdapter,
} from './types/llm.js'
export type {
  Session,
  MessageQueryOptions,
  SessionSendOptions,
} from './types/session-api.js'
export {
  SessionArchivedError,
  NotImplementedError,
} from './types/session-api.js'

// 类型导出 — 函数签名与选项
export type {
  CompressFn,
  ConsolidateFn,
  CreateSessionOptions,
  LoadSessionOptions,
  SendResult,
  StreamResult,
} from './types/functions.js'

// 工具工厂
export type { Tool, CallToolResult, ToolAnnotations } from './tool.js'
export { tool } from './tool.js'

// Session 工厂函数
export { createSession, loadSession } from './create-session.js'

// LLM Adapter — 高层工厂
export type { ClaudeModel, ClaudeOptions } from './adapters/claude.js'
export { createClaude } from './adapters/claude.js'
export type { GPTModel, GPTOptions } from './adapters/gpt.js'
export { createGPT } from './adapters/gpt.js'

// LLM Adapter — 底层工厂
export type { OpenAICompatibleOptions } from './adapters/openai-compatible.js'
export { createOpenAICompatibleAdapter } from './adapters/openai-compatible.js'
export type { AnthropicAdapterOptions } from './adapters/anthropic.js'
export { createAnthropicAdapter } from './adapters/anthropic.js'

// Mock 实现（用于测试）
export { InMemoryStorageAdapter } from './mocks/in-memory-storage.js'
```

注意：`TopologyNode` 不再从 session 包导出（它属于 core 的拓扑层）。

- [ ] **Step 2: typecheck + 包内测试 + 构建产物**

```bash
pnpm --filter @stello-ai/session typecheck && \
pnpm --filter @stello-ai/session test && \
pnpm --filter @stello-ai/session build
```

Expected: 全绿，dist 文件输出正常。

- [ ] **Step 3: Commit**

```bash
git add packages/session/src/index.ts
git commit -m "refactor(session): consolidate index.ts exports after Main removal"
```

> 至此 `@stello-ai/session` 全包改完。下面进入 `@stello-ai/core`。

---

## Task 5: 删除 `MAIN_SESSION_ID` 并简化核心 SessionMeta / CreateSessionOptions

**目标：** 在 core 包内删 `MAIN_SESSION_ID` 常量与所有引用；把 `CreateSessionOptions` 改为 `{ parentId?, label?, sourceSessionId? }`，多 root 合法。

**Files:**
- Modify: `packages/core/src/types/session.ts`
- Modify: `packages/core/src/session/session-tree.ts`（仅删去 import `MAIN_SESSION_ID`，工厂方法改造在 Task 9）
- Modify: `packages/core/src/engine/stello-engine.ts`（仅去 import；Task 10 删 branch）
- Modify: `packages/core/src/engine/__tests__/stello-engine.test.ts`（删 `MAIN_SESSION_ID` import 与用例）
- Modify: `packages/core/src/session/__tests__/session-tree.test.ts`（删 `MAIN_SESSION_ID` import）
- Modify: `packages/core/src/index.ts`（删 `MAIN_SESSION_ID` 重导出）

- [ ] **Step 1: 改 `packages/core/src/types/session.ts`**

整体替换为：

```ts
// ─── Session 系统类型定义 ───

import type { SerializableSessionConfig } from './session-config';

/** Session 状态 */
export type SessionStatus = 'active' | 'archived';

/**
 * Session 元数据
 *
 * Session 是 Stello 的原子单元——一个独立对话空间。
 * 不包含树结构信息，Session 不感知自己在拓扑中的位置。
 */
export interface SessionMeta {
  readonly id: string;
  label: string;
  status: SessionStatus;
  turnCount: number;
  createdAt: string;
  updatedAt: string;
  lastActiveAt: string;
}

/**
 * 拓扑节点
 *
 * 树结构信息，独立于 Session 维护。id 与 SessionMeta.id 对应。
 * `parentId === null` 即为 root。多 root 合法。
 */
export interface TopologyNode {
  readonly id: string;
  parentId: string | null;
  children: string[];
  refs: string[];
  depth: number;
  index: number;
  label: string;
  sourceSessionId?: string;
}

/** 递归树节点（API 返回用） */
export interface SessionTreeNode {
  id: string;
  label: string;
  sourceSessionId?: string;
  status: SessionStatus;
  turnCount: number;
  children: SessionTreeNode[];
}

/**
 * 创建 Session 的参数（纯拓扑信息）
 *
 * `parentId` 为空则为新 root；非空挂在该节点下。
 */
export interface CreateSessionOptions {
  /** 父节点 ID；为空建 root */
  parentId?: string;
  /** 显示名称 */
  label?: string;
  /** fork 时的上下文来源 session（不传默认语义 = parentId 或 undefined） */
  sourceSessionId?: string;
}

/**
 * Session 树操作接口
 *
 * 管理对话的空间结构。支持多 root（森林）。
 */
export interface SessionTree {
  /**
   * 创建 Session 拓扑节点。
   * - `options.parentId` 为空：创建新 root（`parentId === null`）
   * - 非空：挂在该节点下作为子节点
   * - **不**继承父 Session 上下文 / 配置（需要继承走 forkSession）
   */
  createSession(options?: CreateSessionOptions): Promise<TopologyNode>;
  /** 获取单个 Session 元数据 */
  get(id: string): Promise<SessionMeta | null>;
  /** 列出所有 Session */
  listAll(): Promise<SessionMeta[]>;
  /** 列出所有 root（parentId === null） */
  listRoots(): Promise<TopologyNode[]>;
  /** 归档 Session（不连带子节点） */
  archive(id: string): Promise<void>;
  /** 创建跨分支引用 */
  addRef(fromId: string, toId: string): Promise<void>;
  /** 更新 Session 元数据 */
  updateMeta(
    id: string,
    updates: Partial<Pick<SessionMeta, 'label' | 'turnCount'>>,
  ): Promise<SessionMeta>;
  /** 获取单个拓扑节点 */
  getNode(id: string): Promise<TopologyNode | null>;
  /** 获取完整拓扑（森林） */
  getTree(): Promise<SessionTreeNode[]>;
  /** 获取所有祖先节点 */
  getAncestors(id: string): Promise<TopologyNode[]>;
  /** 获取同级兄弟节点 */
  getSiblings(id: string): Promise<TopologyNode[]>;
  /** 读取 Session 固化配置 */
  getConfig(id: string): Promise<SerializableSessionConfig | null>;
  /** 写入 Session 固化配置 */
  putConfig(id: string, config: SerializableSessionConfig): Promise<void>;
}
```

`MAIN_SESSION_ID` 常量、`createRoot`、`createChild`、`getRoot` 三个方法全部从接口移除。

- [ ] **Step 2: 去 `session-tree.ts` 顶部 import**

把 `packages/core/src/session/session-tree.ts:10`
```ts
import { MAIN_SESSION_ID } from '../types/session';
```
直接删掉。然后把 `createRoot` 等方法的 body 中所有 `MAIN_SESSION_ID` 替换为常量字符串 `'root'`（仅为 Task 9 重构前过渡用）。本 task 不重写 SessionTreeImpl 实质行为；Task 9 才正式重写。

实操：把 `session-tree.ts:117-148` 内 `createRoot` 方法里的 `MAIN_SESSION_ID` 替换为局部常量 `const ROOT_ID = 'root'`，整体逻辑保留。仅追求本 task 内 typecheck 通过。

- [ ] **Step 3: 去 `stello-engine.ts:2` import**

```ts
import type { SessionTree } from '../types/session';
// 删除：import { MAIN_SESSION_ID } from '../types/session';
```

Engine `forkSession` 内 `sourceSessionId === MAIN_SESSION_ID` 判断改为：

```ts
const parentFrozen = await this.sessions.getConfig(sourceSessionId);
const parent: SessionConfig = parentFrozen ?? {};
```

整段 `if (sourceSessionId === MAIN_SESSION_ID) { ... } else { ... }` 逻辑塌缩为直接 `await this.sessions.getConfig(sourceSessionId)`。Task 10 的"删 fork-from-main 分支" 这里就完成了；后续 Task 10 只剩测试调整。

- [ ] **Step 4: 删 `core/index.ts` 内 `MAIN_SESSION_ID` 导出**

```ts
// 删除：
// export { MAIN_SESSION_ID } from './types/session';
```

- [ ] **Step 5: 删测试内 `MAIN_SESSION_ID` import**

- `packages/core/src/session/__tests__/session-tree.test.ts:7` — 删 import。`createRoot 返回固定的 MAIN_SESSION_ID 作为 id` 这条用例（line 47-50）整体删除；其它 `createRoot` 调用本 task 保留（Task 9 才整体重写测试）。
- `packages/core/src/engine/__tests__/stello-engine.test.ts:7` — 删 import；`describe('forkSession from main session (issue #55)')` 整个 describe 块（Task 12 会再清理）暂时改为用 `'root'` 字面量替代 `MAIN_SESSION_ID`，测试逻辑保留以便能跑通。

- [ ] **Step 6: typecheck + 包内测试**

```bash
pnpm --filter @stello-ai/core typecheck && pnpm --filter @stello-ai/core test
```

Expected: 全绿。

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/types/session.ts \
        packages/core/src/session/session-tree.ts \
        packages/core/src/engine/stello-engine.ts \
        packages/core/src/index.ts \
        packages/core/src/session/__tests__/session-tree.test.ts \
        packages/core/src/engine/__tests__/stello-engine.test.ts
git commit -m "refactor(core): remove MAIN_SESSION_ID constant and inline fork-from-main branch"
```

---

## Task 6: 删除 `MainSessionConfig` / `SerializableMainSessionConfig` 类型

**目标：** core 内 session-config.ts 只剩 `SessionConfig` / `SerializableSessionConfig`。

**Files:**
- Modify: `packages/core/src/types/session-config.ts`
- Modify: `packages/core/src/types.ts`（删导出）

- [ ] **Step 1: 改 `session-config.ts`**

把 `packages/core/src/types/session-config.ts` 整体替换为：

```ts
// ─── Session 统一配置类型定义 ───

import type { LLMAdapter, LLMCompleteOptions } from '@stello-ai/session';
import type {
  SessionCompatibleConsolidateFn,
  SessionCompatibleCompressFn,
} from '../adapters/session-runtime';

/**
 * Session 配置字段集
 *
 * 固化后写入存储。覆盖单个 Session 在上下文组装、LLM 调用、
 * tool 调度、L3→L2 提炼、上下文压缩等环节所需的可配置项。
 */
export interface SessionConfig {
  systemPrompt?: string;
  llm?: LLMAdapter;
  tools?: LLMCompleteOptions['tools'];
  skills?: string[];
  consolidateFn?: SessionCompatibleConsolidateFn;
  compressFn?: SessionCompatibleCompressFn;
}

/**
 * SessionConfig 的可序列化子集
 */
export interface SerializableSessionConfig {
  systemPrompt?: string;
  skills?: string[];
}
```

`MainSessionConfig` / `SerializableMainSessionConfig` 类型整体删除。`SessionCompatibleIntegrateFn` 也不再被 import。

- [ ] **Step 2: 改 `core/types.ts`**

把 `packages/core/src/types.ts:43-49` 改为：

```ts
// Session 统一配置
export type {
  SessionConfig,
  SerializableSessionConfig,
} from './types/session-config';
```

去掉 `MainSessionConfig` / `SerializableMainSessionConfig` 两个 export。

- [ ] **Step 3: typecheck**

```bash
pnpm --filter @stello-ai/core typecheck
```

> 此时 `stello-agent.ts` 等仍 import `MainSessionConfig`，会报错。下一个 task 修复。先继续做本 task 的 commit 准备：把当前未编译通过的状态保留为 WIP，Task 11 一起验证。

实际操作：本 task 先把 `stello-agent.ts` 顶部 import 里 `MainSessionConfig` 和 `SerializableMainSessionConfig` 也删掉，并把 body 内引用同步处理（用 `// removed in main-session decouple` 临时占位删除相关方法体里的引用——Task 11 时整体重写）。具体：
  - `stello-agent.ts:32-36` import 去掉 `MainSessionConfig` / `SerializableMainSessionConfig` / `SerializableMainSessionConfig`。
  - `stello-agent.ts:102-103`（`mainSessionConfig?: MainSessionConfig`）字段先注释 `// removed in Task 11`。
  - `stello-agent.ts:136-143`（`serializeMainSessionConfig` 函数）整体保留不动，Task 11 删。

> 这一 task 收尾时**允许 typecheck 红**——下游 Task 7/8/11 会陆续把 stello-agent.ts 改干净。如果 executor 偏好每个 task 都绿，可以在本 task 把 `stello-agent.ts` 内 `mainSessionConfig` / `serializeMainSessionConfig` 等用法直接删除（合并 Task 11 的内容）。

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/types/session-config.ts \
        packages/core/src/types.ts \
        packages/core/src/agent/stello-agent.ts
git commit -m "refactor(core): drop MainSessionConfig types"
```

---

## Task 7: 删除 `MainSessionCompatible` 与 `SessionCompatibleIntegrateFn` adapter 类型

**目标：** `adapters/session-runtime.ts` 内不再有 MainSession / integrate 相关类型。

**Files:**
- Modify: `packages/core/src/adapters/session-runtime.ts`
- Modify: `packages/core/src/agent/stello-agent.ts`（删 import）
- Modify: `packages/core/src/index.ts`（删 export）

- [ ] **Step 1: 改 `adapters/session-runtime.ts`**

定位：
- `SessionCompatibleIntegrateFn` 类型（line 38-45）整体删除
- `MainSessionCompatible` 接口（line 92-95）整体删除

`SessionCompatible` 内已经没有 integrate 方法，保留不变。

- [ ] **Step 2: 改 `core/index.ts`**

`packages/core/src/index.ts:65-80` 内：
- 删除 `MainSessionCompatible` export
- 删除 `SessionCompatibleIntegrateFn` export

```ts
export type {
  SessionRuntimeAdapterOptions,
  SessionCompatible,
  SessionCompatibleToolCall,
  SessionCompatibleSendResult,
  SessionCompatibleConsolidateFn,
  SessionCompatibleCompressFn,
  SessionCompatibleForkOptions,
} from './adapters/session-runtime';
```

同步删除 `core/index.ts:166`（`Session, MainSession, SendResult, StreamResult` re-export）中的 `MainSession` 名字。

同步删除 `core/index.ts:177-178` 内 `CreateMainSessionOptions, LoadMainSessionOptions` re-export。

同步删除 `core/index.ts:176`（`IntegrateFn, IntegrateResult, ChildL2Summary`）。

最终该段 export 应为：
```ts
// 函数签名
CompressFn, ConsolidateFn,
CreateSessionOptions as SessionCreateOptions,
LoadSessionOptions,
```

- [ ] **Step 3: 改 `stello-agent.ts` import**

`packages/core/src/agent/stello-agent.ts:20-24`：把 `MainSessionCompatible` 从 import 中去掉。

```ts
import {
  adaptSessionToEngineRuntime,
  serializeSessionSendResult,
  sessionSendResultParser,
  type SessionCompatible,
  type SessionCompatibleSendResult,
} from '../adapters/session-runtime';
```

- [ ] **Step 4: typecheck + 测试**

```bash
pnpm --filter @stello-ai/core typecheck && pnpm --filter @stello-ai/core test
```

> Task 11 之前 stello-agent 还有 `mainSessionLoader` 引用 `MainSessionCompatible`——如果 Task 6 没顺便清，这里需要把 `mainSessionLoader` 字段的返回类型先用 `unknown` 兜住，下个任务再清。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/adapters/session-runtime.ts \
        packages/core/src/agent/stello-agent.ts \
        packages/core/src/index.ts
git commit -m "refactor(core): drop MainSessionCompatible/SessionCompatibleIntegrateFn"
```

---

## Task 8: 删除 `createDefaultIntegrateFn` 与 `DEFAULT_INTEGRATE_PROMPT`

**目标：** core 不再提供 integrate 默认实现（外包给 orchestrator client）。

**Files:**
- Modify: `packages/core/src/llm/defaults.ts`
- Modify: `packages/core/src/llm/__tests__/defaults.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: 改 `defaults.ts`**

删除 `DEFAULT_INTEGRATE_PROMPT` 常量（line 37-51）与 `createDefaultIntegrateFn` 函数（line 98-132）。

`import type { SessionCompatibleIntegrateFn ... }` 去掉。

- [ ] **Step 2: 改测试**

打开 `packages/core/src/llm/__tests__/defaults.test.ts`，凡是测 `createDefaultIntegrateFn` / `DEFAULT_INTEGRATE_PROMPT` 的用例整体删除。

- [ ] **Step 3: 改 `core/index.ts`**

`packages/core/src/index.ts:137-145`：

```ts
export {
  createDefaultConsolidateFn,
  createDefaultCompressFn,
  DEFAULT_CONSOLIDATE_PROMPT,
  DEFAULT_COMPRESS_PROMPT,
} from './llm/defaults';
export type { LLMCallFn, DefaultFnOptions } from './llm/defaults';
```

- [ ] **Step 4: typecheck + 测试**

```bash
pnpm --filter @stello-ai/core typecheck && pnpm --filter @stello-ai/core test
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/llm/defaults.ts \
        packages/core/src/llm/__tests__/defaults.test.ts \
        packages/core/src/index.ts
git commit -m "refactor(core): drop createDefaultIntegrateFn and DEFAULT_INTEGRATE_PROMPT"
```

---

## Task 9: 重写 SessionTreeImpl 支持多 root，统一 createSession 入口

**目标：** `SessionTreeImpl` 实现新接口：`createSession({ parentId?, label?, sourceSessionId? })` 同时支持建 root（parentId 缺省）和挂子节点。新增 `listRoots()`。`getTree()` 返回 `SessionTreeNode[]` 森林。删除 `createRoot` / `createChild` / `getRoot`。

**Files:**
- Modify: `packages/core/src/session/session-tree.ts`
- Modify: `packages/core/src/session/__tests__/session-tree.test.ts`

- [ ] **Step 1: 重写 `session-tree.ts` 关键方法**

整体保留文件骨架（StoredMeta / metaPath / configPath / now / resolveSourceSessionId / toSessionMeta / toTopologyNode），重写以下方法：

```ts
/**
 * 创建 Session 拓扑节点：parentId 缺省即建 root，非空挂在该父节点下。
 *
 * - root：parentId 为 null，depth = 0
 * - 子：从父读取并 push 进父的 children 列表，串行化在 writeLock 内
 *
 * 多 root 合法：不再要求第一个 root 持有固定 ID；每次都生成 randomUUID。
 */
async createSession(options: CreateSessionOptions = {}): Promise<TopologyNode> {
  return this.withWriteLock(async () => {
    const ts = now();
    const id = randomUUID();

    if (!options.parentId) {
      const stored: StoredMeta = {
        id,
        parentId: null,
        children: [],
        refs: [],
        label: options.label ?? 'Root',
        index: 0,
        status: 'active',
        depth: 0,
        turnCount: 0,
        createdAt: ts,
        updatedAt: ts,
        lastActiveAt: ts,
      };
      if (options.sourceSessionId !== undefined) {
        stored.sourceSessionId = options.sourceSessionId;
      }
      await this.fs.writeJSON(metaPath(id), stored);
      await this.initSessionFiles(id);
      // 初始化 core.json（首次任何 root 触发）
      const coreExisting = await this.fs.readJSON('core.json');
      if (coreExisting === null) {
        await this.fs.writeJSON('core.json', {});
      }
      return toTopologyNode(stored);
    }

    const parent = await this.requireStored(options.parentId);
    const stored: StoredMeta = {
      id,
      parentId: parent.id,
      children: [],
      refs: [],
      label: options.label ?? 'Session',
      index: parent.children.length,
      status: 'active',
      depth: parent.depth + 1,
      turnCount: 0,
      createdAt: ts,
      updatedAt: ts,
      lastActiveAt: ts,
    };
    if (options.sourceSessionId !== undefined) {
      stored.sourceSessionId = options.sourceSessionId;
    }
    await this.fs.writeJSON(metaPath(id), stored);
    await this.initSessionFiles(id);
    parent.children.push(id);
    parent.updatedAt = now();
    await this.fs.writeJSON(metaPath(parent.id), parent);
    return toTopologyNode(stored);
  });
}

/** 列出所有 root（parentId === null） */
async listRoots(): Promise<TopologyNode[]> {
  const all = await this.listAllStored();
  return all.filter((s) => s.parentId === null).map(toTopologyNode);
}

/** 获取完整拓扑（森林） */
async getTree(): Promise<SessionTreeNode[]> {
  const all = await this.listAllStored();
  const map = new Map(all.map((s) => [s.id, s]));
  const roots = all.filter((s) => s.parentId === null);

  const buildNode = (stored: StoredMeta): SessionTreeNode => {
    const source = resolveSourceSessionId(stored);
    const node: SessionTreeNode = {
      id: stored.id,
      label: stored.label,
      status: stored.status,
      turnCount: stored.turnCount,
      children: stored.children
        .map((childId) => map.get(childId))
        .filter((c): c is StoredMeta => c !== undefined)
        .map(buildNode),
    };
    if (source !== undefined) node.sourceSessionId = source;
    return node;
  };

  return roots.map(buildNode);
}
```

**删除**：`createRoot()` / `createChild()` / `getRoot()` 三个方法。
**新增**：`private async initSessionFiles(id)`：把原 `createRoot` / `createChild` 里写 memory.md / scope.md / index.md 的 3 行 `writeFile` 抽到此处。

- [ ] **Step 2: 重写 `session-tree.test.ts`**

按下列要点重新组织测试（保留同类覆盖，但用新 API）：

```ts
describe('SessionTreeImpl', () => {
  // ─── createSession（无 parentId = root） ───
  it('createSession 无 parentId 时建 root，parentId 为 null，depth=0', async () => {
    const root = await tree.createSession({ label: '根' });
    expect(root.parentId).toBeNull();
    expect(root.depth).toBe(0);
    expect(root.label).toBe('根');
  });

  it('createSession 无 label 时默认 "Root"（root 路径）', async () => {
    const root = await tree.createSession();
    expect(root.label).toBe('Root');
  });

  it('多 root 合法：listRoots 返回所有 root', async () => {
    const r1 = await tree.createSession({ label: 'R1' });
    const r2 = await tree.createSession({ label: 'R2' });
    const roots = await tree.listRoots();
    expect(roots.map((r) => r.id).sort()).toEqual([r1.id, r2.id].sort());
  });

  // ─── createSession（带 parentId = child） ───
  it('createSession 带 parentId 时挂在父下，depth = parent.depth + 1', async () => {
    const root = await tree.createSession({ label: '根' });
    const child = await tree.createSession({ parentId: root.id, label: '子' });
    expect(child.parentId).toBe(root.id);
    expect(child.depth).toBe(1);
  });

  it('createSession 持久化 sourceSessionId 字段', async () => {
    const root = await tree.createSession({ label: '根' });
    const child = await tree.createSession({
      parentId: root.id, label: '子', sourceSessionId: 'src-x',
    });
    const node = await tree.getNode(child.id);
    expect(node?.sourceSessionId).toBe('src-x');
  });

  // ─── getTree 森林 ───
  it('getTree 返回多 root 的森林', async () => {
    const r1 = await tree.createSession({ label: 'R1' });
    const r2 = await tree.createSession({ label: 'R2' });
    await tree.createSession({ parentId: r1.id, label: 'C1' });
    const forest = await tree.getTree();
    expect(forest).toHaveLength(2);
    expect(forest.find((n) => n.id === r1.id)?.children).toHaveLength(1);
    expect(forest.find((n) => n.id === r2.id)?.children).toHaveLength(0);
  });

  it('getTree 空森林返回空数组', async () => {
    const forest = await tree.getTree();
    expect(forest).toEqual([]);
  });

  // ─── 旧 API 用例搬迁 ───
  // 把所有原本调 createRoot() 的用例替换为 await tree.createSession({ label: 'X' })
  // 把原本调 createChild({ parentId, label }) 的用例替换为 await tree.createSession({ parentId, label })
  // 删除：`createRoot 返回固定的 MAIN_SESSION_ID 作为 id`、`getRoot 返回根节点的 SessionMeta`、
  //       `createRoot 幂等：第二次调用返回现有节点` 三条用例。
});
```

执行：把原 487 行测试里 `await tree.createRoot(label)` 全文替换为 `await tree.createSession({ label })`；`await tree.createChild({ parentId, label })` 替换为 `await tree.createSession({ parentId, label })`；`await tree.getRoot()` 用例删除（root 现在不唯一，没有 getRoot 概念）。

- [ ] **Step 3: typecheck + 测试**

```bash
pnpm --filter @stello-ai/core typecheck && pnpm --filter @stello-ai/core test
```

Expected: 全绿。

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/session/session-tree.ts \
        packages/core/src/session/__tests__/session-tree.test.ts
git commit -m "refactor(core): unify SessionTree under createSession with multi-root support"
```

---

## Task 10: Engine 测试清理 fork-from-main 用例

**目标：** Task 5 已经在 `stello-engine.ts` 内删了 `MAIN_SESSION_ID` 判断。本任务把测试里的 `describe('forkSession from main session (issue #55)')` 整段移除或调整为通用 fork 测试。

**Files:**
- Modify: `packages/core/src/engine/__tests__/stello-engine.test.ts:480-553`

- [ ] **Step 1: 删除 describe('forkSession from main session (issue #55)') 整段**

`packages/core/src/engine/__tests__/stello-engine.test.ts:480-553` 整个 describe 块删除。原本测的"main 跳过父配置"语义在新模型下不存在——root 是普通 session，其配置应被子 fork 继承。

如果想保留 root 的 fork 行为覆盖，可在原位置加一条用例：

```ts
it('从 root session fork 时正常读取 root 的 getConfig 并继承', async () => {
  const getConfig = vi.fn().mockResolvedValue({ systemPrompt: 'root sys' });
  const createSession = vi.fn().mockResolvedValue({
    id: 'child-1', parentId: 'root-id', children: [], refs: [],
    depth: 1, index: 0, label: 'UI',
  });
  const sessionFork = vi.fn().mockResolvedValue({
    id: 'child-1', meta: { id: 'child-1', turnCount: 0, status: 'active' },
    turnCount: 0, send: vi.fn(), consolidate: vi.fn(), setTools: vi.fn(),
  });

  const engine = new StelloEngineImpl({
    session: {
      id: 'root-id',
      meta: { id: 'root-id', turnCount: 0, status: 'active' as const },
      turnCount: 0, send: vi.fn(), consolidate: vi.fn(),
      messages: vi.fn().mockResolvedValue([]),
      setTools: vi.fn(),
      fork: sessionFork,
    },
    sessions: { ...sessions, createSession, getConfig, putConfig: vi.fn() } as unknown as SessionTree,
    memory, skills, confirm, agent: {} as never,
    lifecycle: { bootstrap: vi.fn(), afterTurn: vi.fn() },
    tools: { getToolDefinitions: vi.fn().mockReturnValue([]), executeTool: vi.fn() },
  });

  await engine.forkSession({ label: 'UI' });

  expect(getConfig).toHaveBeenCalledWith('root-id');
  expect(sessionFork).toHaveBeenCalledWith(expect.objectContaining({
    systemPrompt: 'root sys',
  }));
});
```

注意：本测试用到的 `sessions.createChild` 现在叫 `sessions.createSession`。Engine 内部调用也要从 `createChild` 改为 `createSession`——Task 9 后 SessionTree 接口上没有 `createChild` 方法。

- [ ] **Step 2: 改 Engine `forkSession` 内部调用方法名**

`packages/core/src/engine/stello-engine.ts:393-398`：

```ts
const child = await this.sessions.createSession({
  parentId: topologyParentId,
  label: options.label,
  sourceSessionId,
});
```

把 `createChild` → `createSession`。

- [ ] **Step 3: typecheck + 测试**

```bash
pnpm --filter @stello-ai/core typecheck && pnpm --filter @stello-ai/core test
```

Expected: 全绿。

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/engine/stello-engine.ts \
        packages/core/src/engine/__tests__/stello-engine.test.ts
git commit -m "refactor(core): replace SessionTree.createChild with createSession in engine"
```

---

## Task 11: 删除 StelloAgent 上的 createMainSession / integrate / mainSessionConfig / mainSessionLoader；新增 createSession

**目标：** StelloAgent 顶层 API 收敛。新增统一入口 `createSession({ parentId?, label? })`。删除所有 Main 相关方法 / 配置 / loader。

**Files:**
- Modify: `packages/core/src/agent/stello-agent.ts`
- Modify: `packages/core/src/agent/__tests__/stello-agent.test.ts`

- [ ] **Step 1: 改 `stello-agent.ts` — 删除 Main 相关 import / 类型字段**

去掉 Main 相关 import：`MainSessionConfig` / `SerializableMainSessionConfig` / `MainSessionCompatible`。

`StelloAgentSessionConfig` 内删除 `mainSessionLoader` 字段：

```ts
export interface StelloAgentSessionConfig {
  sessionLoader?: (sessionId: string) => Promise<{
    session: SessionCompatible;
    config: SerializableSessionConfig | null;
  }>;
  serializeSendResult?: (result: SessionCompatibleSendResult) => string;
  toolCallParser?: ToolCallParser;
  options?: Record<string, unknown>;
}
```

`StelloAgentConfig` 内删除 `mainSessionConfig` 字段：

```ts
export interface StelloAgentConfig {
  sessions: SessionTree;
  memory: MemoryEngine;
  sessionDefaults?: SessionConfig;
  session?: StelloAgentSessionConfig;
  capabilities: StelloAgentCapabilitiesConfig;
  runtime?: StelloAgentRuntimeConfig;
  orchestration?: StelloAgentOrchestrationConfig;
}
```

删除 `serializeMainSessionConfig` 函数（line 136-143）。

- [ ] **Step 2: 改 `stello-agent.ts` — 替换 createMainSession 为 createSession**

定位 `StelloAgent.createMainSession`（line 217-222），整体替换为：

```ts
/**
 * 创建一个新的 Session 拓扑节点。
 *
 * - `parentId` 为空：建 root（parentId === null）
 * - 非空：挂在该节点下作为子节点（**不**继承父 Session 上下文 / 配置）
 *
 * 需要继承上下文（systemPrompt / L3 / 合成配置）应走 `forkSession`。
 */
async createSession(options?: {
  parentId?: string;
  label?: string;
}): Promise<TopologyNode> {
  return this.sessions.createSession({
    parentId: options?.parentId,
    label: options?.label,
  });
}
```

- [ ] **Step 3: 改 `stello-agent.ts` — 删除 integrate 方法**

定位 `StelloAgent.integrate`（line 290-301），整段删除。

- [ ] **Step 4: 改 `stello-agent.ts` — 调整 DefaultEngineFactory 构造参数**

`packages/core/src/agent/stello-agent.ts:190-205` 构造 DefaultEngineFactory 时不再需要传 `mainSessionConfig`（本来也没传），保持原样即可。

- [ ] **Step 5: 改测试 — `stello-agent.test.ts`**

删除整段 `describe('createMainSession')`（line 464-594）。
删除 `it('会保留 mainSessionConfig 独立配置（不参与 fork 合成链）')` 用例（line 330-342）。
删除 `it('integrate 调用 mainSession.integrate')`（line 385-396）与 `it('integrate 未配置 mainSessionLoader 时抛错')`（line 398-401）。

新增 `describe('createSession')` 块覆盖：

```ts
describe('createSession', () => {
  it('createSession 无 parentId 时建 root', async () => {
    const createSession = vi.fn().mockResolvedValue({
      id: 'root-id', parentId: null, children: [], refs: [],
      depth: 0, index: 0, label: 'My Root',
    });
    const agent = createStelloAgent(
      baseConfig({ sessions: { createSession } as unknown as SessionTree }),
    );
    const node = await agent.createSession({ label: 'My Root' });
    expect(createSession).toHaveBeenCalledWith({ parentId: undefined, label: 'My Root' });
    expect(node.parentId).toBeNull();
  });

  it('createSession 带 parentId 时挂在父下', async () => {
    const createSession = vi.fn().mockResolvedValue({
      id: 'child-id', parentId: 'root-id', children: [], refs: [],
      depth: 1, index: 0, label: 'Child',
    });
    const agent = createStelloAgent(
      baseConfig({ sessions: { createSession } as unknown as SessionTree }),
    );
    const node = await agent.createSession({ parentId: 'root-id', label: 'Child' });
    expect(createSession).toHaveBeenCalledWith({ parentId: 'root-id', label: 'Child' });
    expect(node.parentId).toBe('root-id');
  });

  it('createSession 不接受 mainSessionConfig 这类配置（接口收敛）', () => {
    // 类型层断言：StelloAgentConfig 已无 mainSessionConfig 字段
    const cfg = baseConfig();
    // @ts-expect-error - mainSessionConfig 已删除
    cfg.mainSessionConfig = { systemPrompt: 'X' };
  });
});
```

检查 `baseConfig` helper 是否有 `mainSessionConfig` 字段（位于测试文件顶部）；有则删该字段。同样 `mainSessionLoader: vi.fn(...)` 出现的地方一律删。

- [ ] **Step 6: typecheck + 测试**

```bash
pnpm --filter @stello-ai/core typecheck && pnpm --filter @stello-ai/core test
```

Expected: 全绿。

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/agent/stello-agent.ts \
        packages/core/src/agent/__tests__/stello-agent.test.ts
git commit -m "refactor(core): remove createMainSession/integrate/mainSessionConfig from StelloAgent"
```

---

## Task 12: 新增 orchestrator-facing 拓扑 / 列举 SDK 方法

**目标：** 在 `StelloAgent` 上挂 4 个不依赖 storage 的纯拓扑/元数据方法：`listSessions(filter?)` / `getTopology()` / `listRoots()` / `getTopologyNode(id)`。这些方法全部代理给已注入的 `sessions: SessionTree`。

**Files:**
- Modify: `packages/core/src/agent/stello-agent.ts`
- Modify: `packages/core/src/agent/__tests__/stello-agent.test.ts`

- [ ] **Step 1: 改 `stello-agent.ts` 新增方法**

在 `StelloAgent` 类内、`createSession` 方法之后插入：

```ts
/** 列出所有 Session（按状态过滤） */
listSessions(filter?: { status?: 'active' | 'archived' }): Promise<SessionMeta[]> {
  // 走 SessionTree.listAll；过滤在内存做（拓扑量级小，不下沉到 storage）
  if (!filter) return this.sessions.listAll();
  return this.sessions.listAll().then((all) =>
    all.filter((s) => (filter.status === undefined ? true : s.status === filter.status)),
  );
}

/** 列出所有 root（parentId === null） */
listRoots(): Promise<TopologyNode[]> {
  return this.sessions.listRoots();
}

/** 获取完整拓扑（森林） */
getTopology(): Promise<SessionTreeNode[]> {
  return this.sessions.getTree();
}

/** 获取单个拓扑节点 */
getTopologyNode(id: string): Promise<TopologyNode | null> {
  return this.sessions.getNode(id);
}
```

顶部 import 同步添加：

```ts
import type {
  SessionTree, TopologyNode, SessionTreeNode, SessionMeta,
} from '../types/session';
```

- [ ] **Step 2: 改测试 — `stello-agent.test.ts`**

```ts
describe('orchestrator-facing topology SDK', () => {
  it('listSessions 代理 sessions.listAll', async () => {
    const listAll = vi.fn().mockResolvedValue([
      { id: 'a', label: 'A', status: 'active', turnCount: 0, createdAt: '', updatedAt: '', lastActiveAt: '' },
      { id: 'b', label: 'B', status: 'archived', turnCount: 0, createdAt: '', updatedAt: '', lastActiveAt: '' },
    ]);
    const agent = createStelloAgent(
      baseConfig({ sessions: { listAll } as unknown as SessionTree }),
    );
    expect(await agent.listSessions()).toHaveLength(2);
    expect(await agent.listSessions({ status: 'active' })).toEqual([
      expect.objectContaining({ id: 'a' }),
    ]);
  });

  it('listRoots 代理 sessions.listRoots', async () => {
    const listRoots = vi.fn().mockResolvedValue([
      { id: 'r1', parentId: null, children: [], refs: [], depth: 0, index: 0, label: 'R1' },
    ]);
    const agent = createStelloAgent(
      baseConfig({ sessions: { listRoots } as unknown as SessionTree }),
    );
    const roots = await agent.listRoots();
    expect(roots).toHaveLength(1);
    expect(roots[0]!.parentId).toBeNull();
  });

  it('getTopology 代理 sessions.getTree', async () => {
    const getTree = vi.fn().mockResolvedValue([
      { id: 'r1', label: 'R1', status: 'active', turnCount: 0, children: [] },
    ]);
    const agent = createStelloAgent(
      baseConfig({ sessions: { getTree } as unknown as SessionTree }),
    );
    const forest = await agent.getTopology();
    expect(forest).toHaveLength(1);
    expect(forest[0]!.id).toBe('r1');
  });

  it('getTopologyNode 代理 sessions.getNode', async () => {
    const getNode = vi.fn().mockResolvedValue({
      id: 'x', parentId: null, children: [], refs: [], depth: 0, index: 0, label: 'X',
    });
    const agent = createStelloAgent(
      baseConfig({ sessions: { getNode } as unknown as SessionTree }),
    );
    const node = await agent.getTopologyNode('x');
    expect(node?.id).toBe('x');
  });
});
```

- [ ] **Step 3: typecheck + 测试**

```bash
pnpm --filter @stello-ai/core typecheck && pnpm --filter @stello-ai/core test
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/agent/stello-agent.ts \
        packages/core/src/agent/__tests__/stello-agent.test.ts
git commit -m "feat(core): add orchestrator-facing topology SDK on StelloAgent"
```

---

## Task 13: 新增 data-IO SDK 方法 + 顶层 storage 注入

**目标：** 在 `StelloAgentConfig` 上新增 `storage: SessionStorage` 字段。在 `StelloAgent` 上挂数据 IO SDK：`getSessionMetadata(id)` / `listSessionDigests(filter?)` / `listMessages(id, opts?)` / `putMemory(id, content)` / `putInsight(id, content)` / `clearInsight(id)`。所有调用直接走注入的 storage，框架不感知 memory / insight 语义。

**Files:**
- Modify: `packages/core/src/agent/stello-agent.ts`
- Modify: `packages/core/src/agent/__tests__/stello-agent.test.ts`
- Modify: `packages/core/src/index.ts`（重新导出 `SessionMetadataView` / `SessionDigest`）

- [ ] **Step 1: 在 `stello-agent.ts` 顶部加 storage 类型 import 与新类型**

```ts
import type {
  SessionStorage, ListRecordsOptions, Message,
} from '@stello-ai/session';

/** 单 Session 的外部数据视图（memory + insight 聚合） */
export interface SessionMetadataView {
  memory: string | null;
  insight: string | null;
}

/** Session digest：批量视图条目（取代旧 getAllSessionL2s） */
export interface SessionDigest {
  id: string;
  label: string;
  status: 'active' | 'archived';
  memory: string | null;
  insight: string | null;
}
```

- [ ] **Step 2: 改 `StelloAgentConfig` 添加 storage 字段**

```ts
export interface StelloAgentConfig {
  sessions: SessionTree;
  memory: MemoryEngine;
  /**
   * Session 数据存储（L3 / system prompt / insight / memory）。
   *
   * 用于 orchestrator-facing SDK（getSessionMetadata / listMessages / putMemory / ...）。
   * 应用层应保证 sessions（拓扑） 与 storage（内容） 指向同一份持久化后端。
   */
  storage?: SessionStorage;
  sessionDefaults?: SessionConfig;
  session?: StelloAgentSessionConfig;
  capabilities: StelloAgentCapabilitiesConfig;
  runtime?: StelloAgentRuntimeConfig;
  orchestration?: StelloAgentOrchestrationConfig;
}
```

- [ ] **Step 3: 改 `StelloAgent` 类，加 storage 字段与方法**

```ts
export class StelloAgent {
  readonly config: StelloAgentConfig;
  readonly sessions: StelloAgentConfig['sessions'];
  readonly memory: StelloAgentConfig['memory'];
  /** 注入的数据存储；data-IO SDK 方法依赖该字段 */
  readonly storage?: SessionStorage;

  // ... 现有构造逻辑
  constructor(config: StelloAgentConfig) {
    // ... 原有代码
    this.storage = config.storage;
  }

  // ─── data-IO SDK ───

  /** 读取单个 Session 的 memory / insight 视图 */
  async getSessionMetadata(id: string): Promise<SessionMetadataView> {
    const storage = this.requireStorage('getSessionMetadata');
    const [memory, insight] = await Promise.all([
      storage.getMemory(id),
      storage.getInsight(id),
    ]);
    return { memory, insight };
  }

  /**
   * 列出所有 Session 的 digest（id / label / status / memory / insight）。
   *
   * 取代旧 `MainStorage.getAllSessionL2s()`：调用方自行根据 memory 字段做 reflection。
   */
  async listSessionDigests(filter?: { status?: 'active' | 'archived' }): Promise<SessionDigest[]> {
    const storage = this.requireStorage('listSessionDigests');
    const metas = await this.sessions.listAll();
    const filtered = filter?.status
      ? metas.filter((m) => m.status === filter.status)
      : metas;
    return Promise.all(
      filtered.map(async (m) => {
        const [memory, insight] = await Promise.all([
          storage.getMemory(m.id),
          storage.getInsight(m.id),
        ]);
        return { id: m.id, label: m.label, status: m.status, memory, insight };
      }),
    );
  }

  /** 读取指定 Session 的 L3 消息 */
  listMessages(id: string, options?: ListRecordsOptions): Promise<Message[]> {
    const storage = this.requireStorage('listMessages');
    return storage.listRecords(id, options);
  }

  /** 写入指定 Session 的 memory（持久；每次 send 注入） */
  putMemory(id: string, content: string): Promise<void> {
    const storage = this.requireStorage('putMemory');
    return storage.putMemory(id, content);
  }

  /** 写入指定 Session 的 insight（一次性；被 send 消费后清除） */
  putInsight(id: string, content: string): Promise<void> {
    const storage = this.requireStorage('putInsight');
    return storage.putInsight(id, content);
  }

  /** 清除指定 Session 的 insight */
  clearInsight(id: string): Promise<void> {
    const storage = this.requireStorage('clearInsight');
    return storage.clearInsight(id);
  }

  private requireStorage(method: string): SessionStorage {
    if (!this.storage) {
      throw new Error(
        `StelloAgent.${method} 需要 StelloAgentConfig.storage；请在创建 agent 时注入 SessionStorage`,
      );
    }
    return this.storage;
  }
}
```

- [ ] **Step 4: 改 `core/index.ts` 重新导出新类型**

```ts
export type {
  StelloAgentConfig,
  StelloAgentHotConfig,
  StelloAgentSessionConfig,
  StelloAgentCapabilitiesConfig,
  StelloAgentRuntimeConfig,
  StelloAgentOrchestrationConfig,
  SessionMetadataView,
  SessionDigest,
} from './agent/stello-agent';
```

- [ ] **Step 5: 改测试 — `stello-agent.test.ts`**

```ts
describe('orchestrator-facing data-IO SDK', () => {
  function storageMock() {
    return {
      getMemory: vi.fn().mockResolvedValue('mem-x'),
      putMemory: vi.fn().mockResolvedValue(undefined),
      getInsight: vi.fn().mockResolvedValue('ins-x'),
      putInsight: vi.fn().mockResolvedValue(undefined),
      clearInsight: vi.fn().mockResolvedValue(undefined),
      listRecords: vi.fn().mockResolvedValue([{ role: 'user', content: 'hi' }]),
    } as unknown as SessionStorage;
  }

  it('未注入 storage 时数据 IO 抛错', async () => {
    const agent = createStelloAgent(baseConfig());
    await expect(agent.getSessionMetadata('x')).rejects.toThrow(
      'StelloAgent.getSessionMetadata 需要 StelloAgentConfig.storage',
    );
  });

  it('getSessionMetadata 聚合 memory + insight', async () => {
    const storage = storageMock();
    const agent = createStelloAgent({ ...baseConfig(), storage });
    expect(await agent.getSessionMetadata('s1')).toEqual({ memory: 'mem-x', insight: 'ins-x' });
  });

  it('listSessionDigests 走 sessions.listAll 并对每个 Session 取 memory/insight', async () => {
    const storage = storageMock();
    const listAll = vi.fn().mockResolvedValue([
      { id: 'a', label: 'A', status: 'active', turnCount: 0, createdAt: '', updatedAt: '', lastActiveAt: '' },
      { id: 'b', label: 'B', status: 'archived', turnCount: 0, createdAt: '', updatedAt: '', lastActiveAt: '' },
    ]);
    const agent = createStelloAgent({
      ...baseConfig({ sessions: { listAll } as unknown as SessionTree }),
      storage,
    });
    const digests = await agent.listSessionDigests({ status: 'active' });
    expect(digests).toEqual([
      { id: 'a', label: 'A', status: 'active', memory: 'mem-x', insight: 'ins-x' },
    ]);
  });

  it('listMessages 代理 storage.listRecords', async () => {
    const storage = storageMock();
    const agent = createStelloAgent({ ...baseConfig(), storage });
    expect(await agent.listMessages('s1', { limit: 10 })).toEqual([
      { role: 'user', content: 'hi' },
    ]);
    expect(storage.listRecords).toHaveBeenCalledWith('s1', { limit: 10 });
  });

  it('putMemory / putInsight / clearInsight 代理 storage', async () => {
    const storage = storageMock();
    const agent = createStelloAgent({ ...baseConfig(), storage });
    await agent.putMemory('s1', 'M');
    await agent.putInsight('s1', 'I');
    await agent.clearInsight('s1');
    expect(storage.putMemory).toHaveBeenCalledWith('s1', 'M');
    expect(storage.putInsight).toHaveBeenCalledWith('s1', 'I');
    expect(storage.clearInsight).toHaveBeenCalledWith('s1');
  });
});
```

- [ ] **Step 6: typecheck + 测试**

```bash
pnpm --filter @stello-ai/core typecheck && pnpm --filter @stello-ai/core test
```

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/agent/stello-agent.ts \
        packages/core/src/agent/__tests__/stello-agent.test.ts \
        packages/core/src/index.ts
git commit -m "feat(core): add storage injection and data-IO SDK on StelloAgent"
```

---

## Task 14: core/types.ts 与 core/index.ts 导出收敛

**目标：** 终极收敛 core 包对外类型 / 值导出。所有 Main 相关符号全部消失。re-export 中的 `MainSession` / `MainStorage` / `IntegrateFn` 等被 session 包删除的类型也清掉。

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: 改 `types.ts`**

整体重写为：

```ts
// ─── Stello 全量类型定义统一导出 ───

export type { SessionStatus, SessionMeta, TopologyNode, SessionTreeNode, CreateSessionOptions, SessionTree } from './types/session';

export type {
  InheritancePolicy,
  CoreSchemaField,
  CoreSchema,
  TurnRecord,
  AssembledContext,
  MemoryEngine,
} from './types/memory';

export type { FileSystemAdapter } from './types/fs';

export type {
  BootstrapResult,
  AfterTurnResult,
  Skill,
  SkillRouter,
  ToolDefinition,
  ToolExecutionResult,
  SplitProposal,
  UpdateProposal,
  ConfirmProtocol,
} from './types/lifecycle';

export type {
  SplitStrategy,
  CoreChangeEvent,
  StelloError,
  StelloEventMap,
  StelloEngine,
  EngineForkOptions,
  SessionRuntimeResolver,
} from './types/engine';

export type {
  SessionConfig,
  SerializableSessionConfig,
} from './types/session-config';
```

- [ ] **Step 2: 改 `core/index.ts` —— re-export 自 session 包的部分**

把 `packages/core/src/index.ts:147-181` 的 re-export 段重写为：

```ts
// Re-export @stello-ai/session 常用接口
export { createSession, loadSession } from '@stello-ai/session';
export { createClaude } from '@stello-ai/session';
export { createGPT } from '@stello-ai/session';
export { createOpenAICompatibleAdapter } from '@stello-ai/session';
export { createAnthropicAdapter } from '@stello-ai/session';
export { InMemoryStorageAdapter } from '@stello-ai/session';
export { tool } from '@stello-ai/session';
export { SessionArchivedError, NotImplementedError } from '@stello-ai/session';
export type {
  LLMAdapter, LLMResult, LLMChunk, LLMCompleteOptions, Message,
  ClaudeModel, ClaudeOptions,
  GPTModel, GPTOptions,
  OpenAICompatibleOptions,
  AnthropicAdapterOptions,
  Session, SendResult, StreamResult,
  MessageQueryOptions,
  SessionMetaUpdate, SessionFilter,
  ForkOptions, ForkContextFn,
  SessionStorage, ListRecordsOptions,
  CompressFn, ConsolidateFn,
  CreateSessionOptions as SessionCreateOptions,
  LoadSessionOptions,
  Tool, CallToolResult, ToolAnnotations,
} from '@stello-ai/session';
```

去掉所有：`createMainSession` / `loadMainSession` / `MainSession` / `MainStorage` / `CreateMainSessionOptions` / `LoadMainSessionOptions` / `IntegrateFn` / `IntegrateResult` / `ChildL2Summary`。

- [ ] **Step 3: typecheck + 测试 + 构建**

```bash
pnpm --filter @stello-ai/core typecheck && \
pnpm --filter @stello-ai/core test && \
pnpm --filter @stello-ai/core build
```

Expected: 全绿；构建出的 `dist/index.d.ts` 无 Main 相关符号。

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/index.ts
git commit -m "refactor(core): consolidate type exports after Main removal"
```

---

## Task 15: 全量验证 + CHANGELOG + 版本号

**目标：** 跨包跑全量 typecheck / test / build，更新 CHANGELOG，准备版本发布（不实际 publish，由用户决定时机）。

**Files:**
- Modify: `packages/session/CHANGELOG.md`
- Modify: `packages/core/CHANGELOG.md`
- Modify: `packages/session/package.json` (version bump)
- Modify: `packages/core/package.json` (version bump)
- Modify: `packages/core/src/index.ts:2`（VERSION 常量同步）

- [ ] **Step 1: 跨包跑 typecheck**

```bash
pnpm -r typecheck
```

Expected: 全部通过。`devtools` / `visualizer` / `demo` 不在范围内——它们极可能 fail，记录但不修。

- [ ] **Step 2: 跨包跑测试**

```bash
pnpm -r --filter @stello-ai/session --filter @stello-ai/core test
```

Expected: session / core 两包测试全绿。

- [ ] **Step 3: 跨包构建**

```bash
pnpm -r --filter @stello-ai/session --filter @stello-ai/core build
```

Expected: 两包均成功构建出 dist。

- [ ] **Step 4: 抓 grep 残留**

```bash
grep -rln "MAIN_SESSION_ID\|MainSession\|createMainSession\|loadMainSession\|mainSessionConfig\|mainSessionLoader\|MainStorage\|IntegrateFn\|getAllSessionL2s" packages/session/src packages/core/src 2>&1 | grep -v node_modules | grep -v dist
```

Expected: 输出**为空**。如果有残留，回到对应任务补干净。

- [ ] **Step 5: 写 CHANGELOG**

`packages/session/CHANGELOG.md` 头部加：

```markdown
## Unreleased — Main Session Decouple

### Breaking
- 删除 `MainSession` 接口、`createMainSession` / `loadMainSession` 工厂、`CreateMainSessionOptions` / `LoadMainSessionOptions` 选项
- 删除 `MainStorage` 接口；其能力或合并入 `SessionStorage`（`listSessions`）或由 core 拓扑层接管（`putNode` 等）；批量 L2 收集（`getAllSessionL2s`）转为 `StelloAgent.listSessionDigests`
- 删除 `IntegrateFn` / `IntegrateResult` / `ChildL2Summary` 类型
- `SessionMeta` 删除 `role` / `tags` / `metadata` 三个字段；`SessionFilter.role` / `SessionFilter.tags` 同步删除
- `ForkOptions` 删除 `tags` / `metadata` 两个字段
- `assembleMainSessionContext` 函数删除——所有 Session 同构走 `assembleSessionContext`
- 应用域字段建议通过应用层 wrapper Session 承载（spec §4.7）；Stello 不再模型化业务字段
```

`packages/core/CHANGELOG.md` 头部加：

```markdown
## Unreleased — Main Session Decouple

### Breaking
- 删除 `MAIN_SESSION_ID` 常量
- 删除 `MainSessionConfig` / `SerializableMainSessionConfig` 类型
- 删除 `MainSessionCompatible` / `SessionCompatibleIntegrateFn` 适配类型
- 删除 `DEFAULT_INTEGRATE_PROMPT` 与 `createDefaultIntegrateFn`（外包给 orchestrator client）
- `SessionTree` 接口收敛：删除 `createRoot` / `createChild` / `getRoot`；新增 `createSession({ parentId?, label?, sourceSessionId? })` 唯一入口、`listRoots()`；`getTree()` 改返回 `SessionTreeNode[]` 森林（多 root 合法）
- `StelloAgent` 删除：`createMainSession()` / `integrate()` / `StelloAgentConfig.mainSessionConfig` / `StelloAgentSessionConfig.mainSessionLoader`
- `StelloAgent` 新增：`createSession({ parentId?, label? })` 唯一会话创建入口
- Engine 在 `forkSession` 中删除 `sourceSessionId === MAIN_SESSION_ID` 跳过分支——root 配置正常被子 fork 继承

### Added (orchestrator-facing SDK)
- `StelloAgentConfig.storage?: SessionStorage`（顶层注入；data-IO SDK 依赖）
- `StelloAgent.listSessions(filter?)` / `listRoots()` / `getTopology()` / `getTopologyNode(id)`
- `StelloAgent.getSessionMetadata(id)` → `{ memory, insight }`
- `StelloAgent.listSessionDigests(filter?)` → 取代旧 `getAllSessionL2s`
- `StelloAgent.listMessages(id, opts?)`
- `StelloAgent.putMemory(id, content)` / `putInsight(id, content)` / `clearInsight(id)`

### Out of Scope
- demo / devtools / visualizer 暂不修，CHANGELOG 标注 breaking
- 旧 `'main'` 目录持久化数据不提供迁移工具（spec §7.3）
- `applyMetadataBatch` 批量原子写、未来 context 槽位（spec §6.1 标 "下轮再讨论"）
```

- [ ] **Step 6: 版本号**

按 spec §7.4，**直接发 minor，不发 deprecated alias**。把：

- `packages/session/package.json:version` 从 `0.7.x` 升到 `0.8.0`
- `packages/core/package.json:version` 从 `0.8.x` 升到 `0.9.0`
- `packages/core/src/index.ts:2`：`export const VERSION = '0.9.0';`

> 实际版本号根据 `git log` 上一个 release tag 微调；以上为示例。

- [ ] **Step 7: Commit**

```bash
git add packages/session/CHANGELOG.md packages/core/CHANGELOG.md \
        packages/session/package.json packages/core/package.json \
        packages/core/src/index.ts
git commit -m "chore(release): main-session decouple — session@0.8.0 + core@0.9.0"
```

- [ ] **Step 8: 推 branch + 开 PR**

```bash
git push -u origin refactor/decouple-main-session
gh pr create --title "refactor: decouple Main Session from Stello core" --body "$(cat <<'EOF'
## Summary
- 删除 Main Session 概念（类型、工厂、配置、存储）
- 统一为单一 Session；root = `parentId === null` 的普通 Session
- 跨 Session 综合 / insights 推送外包给外部 orchestrator
- 暴露 orchestrator-facing 数据 IO SDK（listSessionDigests / listMessages / put*）

## Breaking
见 `packages/session/CHANGELOG.md` 与 `packages/core/CHANGELOG.md`。

## Out of Scope
- demo / devtools / visualizer 暂不修
- 旧 'main' 目录持久化数据无自动迁移工具

## Test plan
- [x] `pnpm --filter @stello-ai/session typecheck && test && build`
- [x] `pnpm --filter @stello-ai/core typecheck && test && build`
- [x] grep 残留：`MAIN_SESSION_ID|MainSession|createMainSession|mainSessionConfig|mainSessionLoader|MainStorage|IntegrateFn|getAllSessionL2s` 在 src 下应为空
EOF
)"
```

---

## 任务完成总结

| 任务 | 范围 | 关键删除 / 新增 |
|---|---|---|
| 1 | session | SessionMeta 瘦身 |
| 2 | session | SessionStorage 收敛 |
| 3 | session | MainSession 工厂 / 类型 / 测试删除 |
| 4 | session | index.ts 导出收敛 |
| 5 | core types | MAIN_SESSION_ID 删除 |
| 6 | core types | MainSessionConfig 删除 |
| 7 | core adapter | MainSessionCompatible / IntegrateFn 删除 |
| 8 | core llm | DEFAULT_INTEGRATE_PROMPT / createDefaultIntegrateFn 删除 |
| 9 | core sessions | SessionTreeImpl 重写多 root |
| 10 | core engine | fork-from-main 分支删除 |
| 11 | core agent | createMainSession/integrate/mainSessionConfig 删除；createSession 新增 |
| 12 | core agent | topology SDK 新增 |
| 13 | core agent | data-IO SDK + storage 注入 |
| 14 | core types | 全量导出收敛 |
| 15 | release | CHANGELOG + 版本号 + PR |
