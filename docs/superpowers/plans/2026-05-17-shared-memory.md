# Shared Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a StelloAgent-level shared memory mechanism: a single per-agent store of `{ slug, summary, body }` entries, with an auto-injected index in every Session's context and three built-in tools (`stello_memory_recall` / `stello_memory_remember` / `stello_memory_forget`) for the agent to read/write. Expose four SDK methods on `StelloAgent` for application-level read/write. Delete the dead legacy `MemoryEngine` in the same release.

**Architecture:**
- New package surface in `@stello-ai/core`: `SharedMemoryStore` interface + `InMemorySharedMemoryStore` default implementation + index renderer + 3 builtin tool factories + 4 SDK methods on `StelloAgent`.
- `@stello-ai/session` extends `SessionSendOptions` with an optional `sharedMemoryIndex: string` and inserts it as a system message slot between `systemPrompt` and `session_identity`.
- `adaptSessionToEngineRuntime` (in `@stello-ai/core`) wraps `session.send` / `session.stream` to fetch the latest index from the agent's store before every call — agent writes via tools are visible to the next round automatically.
- Legacy `MemoryEngine` interface, `FileSystemMemoryEngine`, and all related plumbing in `Engine` / `DefaultEngineFactory` / `StelloAgent.memory` are deleted in the same release.

**Tech Stack:** TypeScript (strict), pnpm monorepo, Vitest, tsup. Follows existing patterns: factory + ctx tools (cf. `createSessionTool`), `writeLock`-style RMW serialization (cf. `SessionTreeImpl`), flat data-IO SDK methods on `StelloAgent` (cf. `putMemory` / `getSessionMetadata`).

**Spec:** `docs/superpowers/specs/2026-05-17-shared-memory-design.md`

---

## File Structure

**New files (13):**

| Path | Responsibility |
|---|---|
| `packages/core/src/shared-memory/types.ts` | `SharedMemoryEntry` type + `SharedMemoryStore` interface |
| `packages/core/src/shared-memory/in-memory-shared-memory-store.ts` | Default `InMemorySharedMemoryStore` implementation |
| `packages/core/src/shared-memory/render-index.ts` | `renderSharedMemoryIndex(store)` → string \| undefined |
| `packages/core/src/shared-memory/__tests__/in-memory-shared-memory-store.test.ts` | Tests: CRUD, FIFO ordering, writeLock serialization |
| `packages/core/src/shared-memory/__tests__/render-index.test.ts` | Tests: empty → undefined, non-empty → templated string |
| `packages/core/src/builtin-tools/memory-recall-tool.ts` | `memoryRecallTool()` factory |
| `packages/core/src/builtin-tools/memory-remember-tool.ts` | `memoryRememberTool()` factory |
| `packages/core/src/builtin-tools/memory-forget-tool.ts` | `memoryForgetTool()` factory |
| `packages/core/src/builtin-tools/__tests__/memory-recall-tool.test.ts` | Tests: known slug / unknown slug / store not configured |
| `packages/core/src/builtin-tools/__tests__/memory-remember-tool.test.ts` | Tests: upsert path / empty slug / store not configured |
| `packages/core/src/builtin-tools/__tests__/memory-forget-tool.test.ts` | Tests: remove existing / remove missing / store not configured |
| `packages/core/src/agent/__tests__/shared-memory-sdk.test.ts` | Tests: 4 SDK methods normal path + "not configured" errors |
| `packages/session/src/__tests__/shared-memory-index.test.ts` | Tests: slot inserted between system prompt and session_identity; undefined → not injected; replay path identical |
| `packages/core/src/__tests__/shared-memory-e2e.test.ts` | E2E: adapter injects current index on every send |

**Modified files (12):**

| Path | Change |
|---|---|
| `packages/session/src/types/session-api.ts` | Add `sharedMemoryIndex?: string` to `SessionSendOptions` |
| `packages/session/src/context-utils.ts` | `assembleSessionContext` accepts `sharedMemoryIndex` and injects as system message after `systemPrompt` |
| `packages/session/src/create-session.ts` | Forward `sharedMemoryIndex` from `SessionSendOptions` into both `assembleSessionContext` (normal path) and `assembleSessionReplayContext` (replay path); replay helper accepts the param and injects |
| `packages/core/src/adapters/session-runtime.ts` | `SessionCompatibleSendOptions` gains `sharedMemoryIndex?: string`; adapter accepts a `sharedMemoryIndexProvider` and merges its result into `sendOptions` before every `session.send` / `session.stream` |
| `packages/core/src/agent/stello-agent.ts` | Add `sharedMemory?: SharedMemoryStore` config; expose `agent.sharedMemory`; add 4 SDK methods; drop `memory: MemoryEngine` field/config; thread `sharedMemoryIndex` provider into `resolveRuntimeResolver` |
| `packages/core/src/engine/stello-engine.ts` | Remove `memory: MemoryEngine` field / option / constructor wiring |
| `packages/core/src/orchestrator/default-engine-factory.ts` | Remove `memory` factory option and engine-construction wiring |
| `packages/core/src/types/engine.ts` | Drop `MemoryEngine` re-export and field |
| `packages/core/src/types.ts` | Drop `MemoryEngine` re-export |
| `packages/core/src/index.ts` | Drop legacy memory exports (`MemoryEngine`, `FileSystemMemoryEngine`, etc.); add `SharedMemoryStore`, `SharedMemoryEntry`, `InMemorySharedMemoryStore`, three tool factories |
| `packages/core/src/builtin-tools/index.ts` | Export three new tool factories |
| `packages/core/src/agent/__tests__/stello-agent.test.ts` | Drop `memory: {} as MemoryEngine` placeholders in fixture configs |
| `packages/core/src/__tests__/builtin-tools-llm-exposure.test.ts` | Drop `memory: {} as MemoryEngine` placeholder |

**Deleted files (entire directory):**

- `packages/core/src/types/memory.ts`
- `packages/core/src/memory/file-system-memory-engine.ts`
- `packages/core/src/memory/__tests__/` (all contents)

---

## Test Commands

- `pnpm --filter @stello-ai/core test` — run core package tests
- `pnpm --filter @stello-ai/session test` — run session package tests
- `pnpm --filter @stello-ai/core test -- <pattern>` — run a single test file
- `pnpm --filter @stello-ai/core exec tsc --noEmit` — type-check only

---

## Task 1: Define `SharedMemoryStore` interface and `SharedMemoryEntry` type

**Files:**
- Create: `packages/core/src/shared-memory/types.ts`

- [ ] **Step 1: Write the types file**

```typescript
/**
 * 共享 memory 的单条记录。
 * slug: 主键 / summary: 出现在索引行的一句话 / body: recall 时返回的全文。
 */
export interface SharedMemoryEntry {
  slug: string
  summary: string
  body: string
}

/**
 * StelloAgent 级共享 memory 存储接口。
 *
 * - 一个 StelloAgent 实例对应一份 store；所有 Session 共享
 * - list() 按"插入顺序"返回；upsert 已存在 slug 时**不改变其顺序位置**
 * - 写操作（upsert / remove）由实现内部串行化（writeLock 范式），读操作允许脏读
 */
export interface SharedMemoryStore {
  /** 列举全部 entries（按插入顺序） */
  list(): Promise<SharedMemoryEntry[]>
  /** 读取单条 entry，不存在返回 null */
  get(slug: string): Promise<SharedMemoryEntry | null>
  /** 写入或覆盖一条 entry（不存在则追加到末尾，存在则覆盖 summary + body 并保持顺序） */
  upsert(slug: string, summary: string, body: string): Promise<void>
  /** 删除一条 entry；不存在为 no-op */
  remove(slug: string): Promise<void>
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `pnpm --filter @stello-ai/core exec tsc --noEmit`
Expected: PASS (no errors related to the new file)

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/shared-memory/types.ts
git commit -m "feat(core): define SharedMemoryStore interface and SharedMemoryEntry type"
```

---

## Task 2: Implement `InMemorySharedMemoryStore` (TDD)

**Files:**
- Create: `packages/core/src/shared-memory/__tests__/in-memory-shared-memory-store.test.ts`
- Create: `packages/core/src/shared-memory/in-memory-shared-memory-store.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/shared-memory/__tests__/in-memory-shared-memory-store.test.ts
import { describe, it, expect } from 'vitest'
import { InMemorySharedMemoryStore } from '../in-memory-shared-memory-store'

describe('InMemorySharedMemoryStore', () => {
  it('list returns [] when empty', async () => {
    const store = new InMemorySharedMemoryStore()
    expect(await store.list()).toEqual([])
  })

  it('upsert adds new entry and list returns it', async () => {
    const store = new InMemorySharedMemoryStore()
    await store.upsert('a', 'sum-a', 'body-a')
    expect(await store.list()).toEqual([{ slug: 'a', summary: 'sum-a', body: 'body-a' }])
  })

  it('get returns the entry by slug, null if missing', async () => {
    const store = new InMemorySharedMemoryStore()
    await store.upsert('a', 'sum-a', 'body-a')
    expect(await store.get('a')).toEqual({ slug: 'a', summary: 'sum-a', body: 'body-a' })
    expect(await store.get('missing')).toBeNull()
  })

  it('upsert preserves insertion order across multiple slugs', async () => {
    const store = new InMemorySharedMemoryStore()
    await store.upsert('a', 'sa', 'ba')
    await store.upsert('b', 'sb', 'bb')
    await store.upsert('c', 'sc', 'bc')
    expect((await store.list()).map(e => e.slug)).toEqual(['a', 'b', 'c'])
  })

  it('upsert on existing slug overwrites summary + body but keeps position', async () => {
    const store = new InMemorySharedMemoryStore()
    await store.upsert('a', 'sa', 'ba')
    await store.upsert('b', 'sb', 'bb')
    await store.upsert('a', 'sa2', 'ba2')
    expect(await store.list()).toEqual([
      { slug: 'a', summary: 'sa2', body: 'ba2' },
      { slug: 'b', summary: 'sb', body: 'bb' },
    ])
  })

  it('remove deletes the entry; subsequent list omits it', async () => {
    const store = new InMemorySharedMemoryStore()
    await store.upsert('a', 'sa', 'ba')
    await store.upsert('b', 'sb', 'bb')
    await store.remove('a')
    expect(await store.list()).toEqual([{ slug: 'b', summary: 'sb', body: 'bb' }])
  })

  it('remove on missing slug is a no-op', async () => {
    const store = new InMemorySharedMemoryStore()
    await store.upsert('a', 'sa', 'ba')
    await store.remove('missing')
    expect(await store.list()).toEqual([{ slug: 'a', summary: 'sa', body: 'ba' }])
  })

  it('serializes concurrent upserts to same slug (last value wins, no lost write)', async () => {
    const store = new InMemorySharedMemoryStore()
    await Promise.all([
      store.upsert('a', 's1', 'b1'),
      store.upsert('a', 's2', 'b2'),
      store.upsert('a', 's3', 'b3'),
    ])
    const entries = await store.list()
    expect(entries.length).toBe(1)
    expect(entries[0]!.slug).toBe('a')
    // 串行化保证最终状态是三个写之一，且结构完整
    expect(['s1', 's2', 's3']).toContain(entries[0]!.summary)
    expect(['b1', 'b2', 'b3']).toContain(entries[0]!.body)
  })

  it('serializes mixed concurrent upsert/remove without corruption', async () => {
    const store = new InMemorySharedMemoryStore()
    await store.upsert('a', 'sa', 'ba')
    await Promise.all([
      store.upsert('b', 'sb', 'bb'),
      store.remove('a'),
      store.upsert('c', 'sc', 'bc'),
    ])
    const entries = await store.list()
    // 无 a；包含 b 和 c
    expect(entries.find(e => e.slug === 'a')).toBeUndefined()
    expect(entries.find(e => e.slug === 'b')).toEqual({ slug: 'b', summary: 'sb', body: 'bb' })
    expect(entries.find(e => e.slug === 'c')).toEqual({ slug: 'c', summary: 'sc', body: 'bc' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @stello-ai/core test -- in-memory-shared-memory-store`
Expected: FAIL — cannot resolve `'../in-memory-shared-memory-store'`

- [ ] **Step 3: Write implementation**

```typescript
// packages/core/src/shared-memory/in-memory-shared-memory-store.ts
import type { SharedMemoryEntry, SharedMemoryStore } from './types'

/**
 * 内置 SharedMemoryStore — 基于 JS Map（天然保留插入顺序）。
 *
 * 所有写操作通过 writeLock 串行化（沿用 SessionTreeImpl 的范式），
 * 避免并发 upsert / remove 时读到中间状态。读操作不加锁，允许脏读。
 */
export class InMemorySharedMemoryStore implements SharedMemoryStore {
  private readonly entries = new Map<string, { summary: string; body: string }>()
  private writeLock: Promise<unknown> = Promise.resolve()

  /** 把 fn 排入写队列，串行执行 */
  private withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writeLock.then(fn, fn)
    this.writeLock = next.catch(() => undefined)
    return next
  }

  /** 列举全部 entries，按 Map 插入顺序 */
  async list(): Promise<SharedMemoryEntry[]> {
    return [...this.entries].map(([slug, { summary, body }]) => ({ slug, summary, body }))
  }

  /** 读取单条 entry */
  async get(slug: string): Promise<SharedMemoryEntry | null> {
    const v = this.entries.get(slug)
    return v ? { slug, summary: v.summary, body: v.body } : null
  }

  /** 写入或覆盖；JS Map.set 在已有 key 上不改变插入位置 */
  upsert(slug: string, summary: string, body: string): Promise<void> {
    return this.withWriteLock(async () => {
      this.entries.set(slug, { summary, body })
    })
  }

  /** 删除一条；不存在为 no-op */
  remove(slug: string): Promise<void> {
    return this.withWriteLock(async () => {
      this.entries.delete(slug)
    })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @stello-ai/core test -- in-memory-shared-memory-store`
Expected: PASS (all cases)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/shared-memory/in-memory-shared-memory-store.ts \
        packages/core/src/shared-memory/__tests__/in-memory-shared-memory-store.test.ts
git commit -m "feat(core): add InMemorySharedMemoryStore with writeLock serialization"
```

---

## Task 3: Add `renderSharedMemoryIndex` function (TDD)

**Files:**
- Create: `packages/core/src/shared-memory/__tests__/render-index.test.ts`
- Create: `packages/core/src/shared-memory/render-index.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/shared-memory/__tests__/render-index.test.ts
import { describe, it, expect } from 'vitest'
import { renderSharedMemoryIndex } from '../render-index'
import { InMemorySharedMemoryStore } from '../in-memory-shared-memory-store'

describe('renderSharedMemoryIndex', () => {
  it('returns undefined when store is undefined', async () => {
    expect(await renderSharedMemoryIndex(undefined)).toBeUndefined()
  })

  it('returns undefined when store has no entries', async () => {
    const store = new InMemorySharedMemoryStore()
    expect(await renderSharedMemoryIndex(store)).toBeUndefined()
  })

  it('renders entries inside <shared_memory_index> with hint footer', async () => {
    const store = new InMemorySharedMemoryStore()
    await store.upsert('prefer-concise', '用户偏好简短回答', 'body-1')
    await store.upsert('user-profile', '大三本科生 CS 专业', 'body-2')
    const out = await renderSharedMemoryIndex(store)
    expect(out).toContain('<shared_memory_index>')
    expect(out).toContain('- prefer-concise: 用户偏好简短回答')
    expect(out).toContain('- user-profile: 大三本科生 CS 专业')
    expect(out).toContain('</shared_memory_index>')
    expect(out).toMatch(/stello_memory_recall/)
    expect(out).toMatch(/stello_memory_remember/)
    expect(out).toMatch(/stello_memory_forget/)
  })

  it('preserves entry order in output', async () => {
    const store = new InMemorySharedMemoryStore()
    await store.upsert('a', 'sa', 'ba')
    await store.upsert('b', 'sb', 'bb')
    await store.upsert('c', 'sc', 'bc')
    const out = await renderSharedMemoryIndex(store)
    const aIdx = out!.indexOf('- a:')
    const bIdx = out!.indexOf('- b:')
    const cIdx = out!.indexOf('- c:')
    expect(aIdx).toBeGreaterThan(-1)
    expect(aIdx).toBeLessThan(bIdx)
    expect(bIdx).toBeLessThan(cIdx)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @stello-ai/core test -- render-index`
Expected: FAIL — cannot resolve `'../render-index'`

- [ ] **Step 3: Write implementation**

```typescript
// packages/core/src/shared-memory/render-index.ts
import type { SharedMemoryStore } from './types'

const HINT = `调用 stello_memory_recall 工具按 slug 查阅完整内容；
调用 stello_memory_remember / stello_memory_forget 工具维护此处条目。`

/**
 * 渲染共享 memory 索引段。
 * - store 为 undefined 或无 entry：返回 undefined（调用方应跳过注入）
 * - 否则返回 <shared_memory_index>…</shared_memory_index> + hint 文本
 */
export async function renderSharedMemoryIndex(
  store: SharedMemoryStore | undefined,
): Promise<string | undefined> {
  if (!store) return undefined
  const entries = await store.list()
  if (entries.length === 0) return undefined
  const lines = entries.map(e => `- ${e.slug}: ${e.summary}`).join('\n')
  return `<shared_memory_index>\n${lines}\n</shared_memory_index>\n\n${HINT}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @stello-ai/core test -- render-index`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/shared-memory/render-index.ts \
        packages/core/src/shared-memory/__tests__/render-index.test.ts
git commit -m "feat(core): add renderSharedMemoryIndex"
```

---

## Task 4: Wire `sharedMemory` into `StelloAgent` config + four SDK methods (TDD)

**Files:**
- Modify: `packages/core/src/agent/stello-agent.ts`
- Create: `packages/core/src/agent/__tests__/shared-memory-sdk.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/agent/__tests__/shared-memory-sdk.test.ts
import { describe, it, expect } from 'vitest'
import { StelloAgent } from '../stello-agent'
import { InMemorySharedMemoryStore } from '../../shared-memory/in-memory-shared-memory-store'
import { SkillRouterImpl } from '../../skill/skill-router'
import { ToolRegistryImpl } from '../../tool/tool-registry'
import type { StelloAgentConfig } from '../stello-agent'
import type { SessionTree } from '../../types/session'
import type { EngineLifecycleAdapter } from '../../engine/stello-engine'
import type { ConfirmProtocol } from '../../types/lifecycle'

// Minimal fixture; only SDK-method paths are exercised, runtime is not used.
function makeAgent(sharedMemory?: InMemorySharedMemoryStore): StelloAgent {
  const config: StelloAgentConfig = {
    sessions: {
      createSession: async () => ({ id: 'r', label: 'r', parentId: null, status: 'active' }),
      listRoots:     async () => [],
      getTree:       async () => [],
      getNode:       async () => null,
      listAll:       async () => [],
      get:           async () => null,
      archive:       async () => undefined,
      addRef:        async () => undefined,
      updateMeta:    async () => undefined,
      getAncestors:  async () => [],
      getSiblings:   async () => [],
      getConfig:     async () => null,
      putConfig:     async () => undefined,
    } as unknown as SessionTree,
    capabilities: {
      lifecycle: {} as EngineLifecycleAdapter,
      tools: new ToolRegistryImpl(),
      skills: new SkillRouterImpl(),
      confirm: {} as ConfirmProtocol,
    },
    runtime: { resolver: { resolve: async () => ({} as never) } },
    ...(sharedMemory ? { sharedMemory } : {}),
  }
  return new StelloAgent(config)
}

describe('StelloAgent shared memory SDK', () => {
  it('exposes agent.sharedMemory when configured', () => {
    const store = new InMemorySharedMemoryStore()
    const agent = makeAgent(store)
    expect(agent.sharedMemory).toBe(store)
  })

  it('listSharedMemory returns [] when store is empty', async () => {
    const agent = makeAgent(new InMemorySharedMemoryStore())
    expect(await agent.listSharedMemory()).toEqual([])
  })

  it('upsertSharedMemoryEntry + listSharedMemory round-trip', async () => {
    const agent = makeAgent(new InMemorySharedMemoryStore())
    await agent.upsertSharedMemoryEntry('a', 'sa', 'ba')
    await agent.upsertSharedMemoryEntry('b', 'sb', 'bb')
    expect(await agent.listSharedMemory()).toEqual([
      { slug: 'a', summary: 'sa', body: 'ba' },
      { slug: 'b', summary: 'sb', body: 'bb' },
    ])
  })

  it('getSharedMemoryEntry returns null when missing, entry when present', async () => {
    const agent = makeAgent(new InMemorySharedMemoryStore())
    expect(await agent.getSharedMemoryEntry('a')).toBeNull()
    await agent.upsertSharedMemoryEntry('a', 'sa', 'ba')
    expect(await agent.getSharedMemoryEntry('a')).toEqual({ slug: 'a', summary: 'sa', body: 'ba' })
  })

  it('removeSharedMemoryEntry deletes the entry', async () => {
    const agent = makeAgent(new InMemorySharedMemoryStore())
    await agent.upsertSharedMemoryEntry('a', 'sa', 'ba')
    await agent.removeSharedMemoryEntry('a')
    expect(await agent.getSharedMemoryEntry('a')).toBeNull()
  })

  it('throws "sharedMemory not configured" when store is absent', async () => {
    const agent = makeAgent(undefined)
    await expect(agent.listSharedMemory()).rejects.toThrow(/sharedMemory not configured/)
    await expect(agent.getSharedMemoryEntry('a')).rejects.toThrow(/sharedMemory not configured/)
    await expect(agent.upsertSharedMemoryEntry('a', 's', 'b')).rejects.toThrow(/sharedMemory not configured/)
    await expect(agent.removeSharedMemoryEntry('a')).rejects.toThrow(/sharedMemory not configured/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @stello-ai/core test -- shared-memory-sdk`
Expected: FAIL — `agent.sharedMemory` is undefined; SDK methods do not exist.

- [ ] **Step 3: Add the import to `stello-agent.ts`**

In `packages/core/src/agent/stello-agent.ts`, add this import alongside the existing imports near the top:

```typescript
import type { SharedMemoryEntry, SharedMemoryStore } from '../shared-memory/types'
```

- [ ] **Step 4: Add `sharedMemory` to `StelloAgentConfig`**

In `packages/core/src/agent/stello-agent.ts`, inside the `StelloAgentConfig` interface, add the field alongside `storage?: SessionStorage`:

```typescript
  /**
   * Agent 级共享 memory 存储。
   *
   * 注入后：四个 SDK 方法可用，索引段每次 send 前由 adapter 自动渲染并注入。
   * 未注入：四个 SDK 方法和三个内置 tool 抛 "sharedMemory not configured"，索引段不进入上下文。
   */
  sharedMemory?: SharedMemoryStore
```

- [ ] **Step 5: Add the field on the `StelloAgent` class**

After the `readonly storage?: SessionStorage` field, add:

```typescript
  /** 暴露 SharedMemoryStore，供 builtin tool / adapter / SDK 使用 */
  readonly sharedMemory?: SharedMemoryStore
```

After `this.storage = config.storage` in the constructor, add:

```typescript
    this.sharedMemory = config.sharedMemory
```

- [ ] **Step 6: Add a `requireSharedMemory` private helper**

Below the existing `requireStorage` private helper, add:

```typescript
  private requireSharedMemory(method: string): SharedMemoryStore {
    if (!this.sharedMemory) {
      throw new Error(
        `StelloAgent.${method} 需要 StelloAgentConfig.sharedMemory；请在创建 agent 时注入 SharedMemoryStore`,
      )
    }
    return this.sharedMemory
  }
```

- [ ] **Step 7: Add the four SDK methods**

Near the existing data-IO methods (`getSessionMetadata`, `putMemory`, etc.), add:

```typescript
  /** 列举全部共享 memory entries（按插入顺序） */
  listSharedMemory(): Promise<SharedMemoryEntry[]> {
    return this.requireSharedMemory('listSharedMemory').list()
  }

  /** 读取一条共享 memory entry；不存在返回 null */
  getSharedMemoryEntry(slug: string): Promise<SharedMemoryEntry | null> {
    return this.requireSharedMemory('getSharedMemoryEntry').get(slug)
  }

  /** 写入或覆盖一条共享 memory entry */
  upsertSharedMemoryEntry(slug: string, summary: string, body: string): Promise<void> {
    return this.requireSharedMemory('upsertSharedMemoryEntry').upsert(slug, summary, body)
  }

  /** 删除一条共享 memory entry；slug 不存在为 no-op */
  removeSharedMemoryEntry(slug: string): Promise<void> {
    return this.requireSharedMemory('removeSharedMemoryEntry').remove(slug)
  }
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm --filter @stello-ai/core test -- shared-memory-sdk`
Expected: PASS

Also verify no regressions in the existing agent tests:

Run: `pnpm --filter @stello-ai/core test -- stello-agent`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/agent/stello-agent.ts \
        packages/core/src/agent/__tests__/shared-memory-sdk.test.ts
git commit -m "feat(core): expose sharedMemory config and four SDK methods on StelloAgent"
```

---

## Task 5: Implement `memoryRecallTool` (TDD)

**Files:**
- Create: `packages/core/src/builtin-tools/__tests__/memory-recall-tool.test.ts`
- Create: `packages/core/src/builtin-tools/memory-recall-tool.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/builtin-tools/__tests__/memory-recall-tool.test.ts
import { describe, it, expect } from 'vitest'
import { memoryRecallTool } from '../memory-recall-tool'
import { InMemorySharedMemoryStore } from '../../shared-memory/in-memory-shared-memory-store'
import type { ToolExecutionContext } from '../../types/tool'
import type { StelloAgent } from '../../agent/stello-agent'

function fakeAgent(store: InMemorySharedMemoryStore | undefined): StelloAgent {
  return { sharedMemory: store } as unknown as StelloAgent
}

function ctx(agent: StelloAgent): ToolExecutionContext {
  return { agent, sessionId: 's1', toolName: 'stello_memory_recall' }
}

describe('memoryRecallTool', () => {
  it('returns ToolRegistryEntry named "stello_memory_recall"', () => {
    expect(memoryRecallTool().name).toBe('stello_memory_recall')
  })

  it('returns body for known slug', async () => {
    const store = new InMemorySharedMemoryStore()
    await store.upsert('a', 'sa', 'BODY-A')
    const r = await memoryRecallTool().execute({ slug: 'a' }, ctx(fakeAgent(store)))
    expect(r).toEqual({ success: true, data: { body: 'BODY-A' } })
  })

  it('returns error for unknown slug', async () => {
    const store = new InMemorySharedMemoryStore()
    const r = await memoryRecallTool().execute({ slug: 'nope' }, ctx(fakeAgent(store)))
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/slug.*nope/i)
  })

  it('returns error when slug is empty', async () => {
    const store = new InMemorySharedMemoryStore()
    const r = await memoryRecallTool().execute({ slug: '' }, ctx(fakeAgent(store)))
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/slug/i)
  })

  it('returns error when sharedMemory is not configured', async () => {
    const r = await memoryRecallTool().execute({ slug: 'a' }, ctx(fakeAgent(undefined)))
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/sharedMemory not configured/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @stello-ai/core test -- memory-recall-tool`
Expected: FAIL — cannot resolve `'../memory-recall-tool'`

- [ ] **Step 3: Write implementation**

```typescript
// packages/core/src/builtin-tools/memory-recall-tool.ts
import type { ToolRegistryEntry } from '../tool/tool-registry'

const DESCRIPTION = `按 slug 读取一条共享 memory 的完整内容。

参数：
- slug（必填）: 索引中列出的某条 entry 的 slug

何时使用：上下文里 <shared_memory_index> 出现了你需要详读的 slug 时调用。`

const PARAMETERS = {
  type: 'object',
  properties: {
    slug: { type: 'string', description: '索引中的 entry slug' },
  },
  required: ['slug'],
}

export function memoryRecallTool(): ToolRegistryEntry {
  return {
    name: 'stello_memory_recall',
    description: DESCRIPTION,
    parameters: PARAMETERS,
    execute: async (args, ctx) => {
      const slug = (args.slug as string | undefined)?.trim()
      if (!slug) return { success: false, error: 'slug is required and must be non-empty' }
      const store = ctx.agent.sharedMemory
      if (!store) return { success: false, error: 'sharedMemory not configured' }
      try {
        const entry = await store.get(slug)
        if (!entry) return { success: false, error: `slug "${slug}" not found` }
        return { success: true, data: { body: entry.body } }
      } catch (e) {
        return { success: false, error: `failed: ${e instanceof Error ? e.message : String(e)}` }
      }
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @stello-ai/core test -- memory-recall-tool`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/builtin-tools/memory-recall-tool.ts \
        packages/core/src/builtin-tools/__tests__/memory-recall-tool.test.ts
git commit -m "feat(core): add stello_memory_recall builtin tool"
```

---

## Task 6: Implement `memoryRememberTool` (TDD)

**Files:**
- Create: `packages/core/src/builtin-tools/__tests__/memory-remember-tool.test.ts`
- Create: `packages/core/src/builtin-tools/memory-remember-tool.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/builtin-tools/__tests__/memory-remember-tool.test.ts
import { describe, it, expect } from 'vitest'
import { memoryRememberTool } from '../memory-remember-tool'
import { InMemorySharedMemoryStore } from '../../shared-memory/in-memory-shared-memory-store'
import type { ToolExecutionContext } from '../../types/tool'
import type { StelloAgent } from '../../agent/stello-agent'

function fakeAgent(store: InMemorySharedMemoryStore | undefined): StelloAgent {
  return { sharedMemory: store } as unknown as StelloAgent
}

function ctx(agent: StelloAgent): ToolExecutionContext {
  return { agent, sessionId: 's1', toolName: 'stello_memory_remember' }
}

describe('memoryRememberTool', () => {
  it('returns ToolRegistryEntry named "stello_memory_remember"', () => {
    expect(memoryRememberTool().name).toBe('stello_memory_remember')
  })

  it('upserts a new entry', async () => {
    const store = new InMemorySharedMemoryStore()
    const r = await memoryRememberTool().execute(
      { slug: 'a', summary: 'sa', body: 'BODY' },
      ctx(fakeAgent(store)),
    )
    expect(r).toEqual({ success: true, data: { slug: 'a' } })
    expect(await store.get('a')).toEqual({ slug: 'a', summary: 'sa', body: 'BODY' })
  })

  it('overwrites existing entry', async () => {
    const store = new InMemorySharedMemoryStore()
    await store.upsert('a', 'sa', 'old')
    await memoryRememberTool().execute(
      { slug: 'a', summary: 'sa2', body: 'NEW' },
      ctx(fakeAgent(store)),
    )
    expect(await store.get('a')).toEqual({ slug: 'a', summary: 'sa2', body: 'NEW' })
  })

  it('returns error for empty slug', async () => {
    const store = new InMemorySharedMemoryStore()
    const r = await memoryRememberTool().execute(
      { slug: '', summary: 's', body: 'b' },
      ctx(fakeAgent(store)),
    )
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/slug/i)
  })

  it('returns error for missing summary', async () => {
    const store = new InMemorySharedMemoryStore()
    const r = await memoryRememberTool().execute(
      { slug: 'a', body: 'b' },
      ctx(fakeAgent(store)),
    )
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/summary/i)
  })

  it('returns error for missing body', async () => {
    const store = new InMemorySharedMemoryStore()
    const r = await memoryRememberTool().execute(
      { slug: 'a', summary: 's' },
      ctx(fakeAgent(store)),
    )
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/body/i)
  })

  it('returns error when sharedMemory is not configured', async () => {
    const r = await memoryRememberTool().execute(
      { slug: 'a', summary: 's', body: 'b' },
      ctx(fakeAgent(undefined)),
    )
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/sharedMemory not configured/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @stello-ai/core test -- memory-remember-tool`
Expected: FAIL — cannot resolve `'../memory-remember-tool'`

- [ ] **Step 3: Write implementation**

```typescript
// packages/core/src/builtin-tools/memory-remember-tool.ts
import type { ToolRegistryEntry } from '../tool/tool-registry'

const DESCRIPTION = `写入或覆盖一条共享 memory entry。所有 Session 共享同一份 store。

参数：
- slug（必填）: kebab-case 主键
- summary（必填）: 索引行展示的一句话
- body（必填）: 详情全文（recall 时返回）

何时使用：当你判断某个事实 / 偏好 / 背景对整个 agent 都有用，且未来对话需要复用时调用。
存在则覆盖，不存在则追加；不会改变 entry 的原有插入顺序。`

const PARAMETERS = {
  type: 'object',
  properties: {
    slug:    { type: 'string', description: 'kebab-case 主键' },
    summary: { type: 'string', description: '索引行的一句话' },
    body:    { type: 'string', description: '完整内容' },
  },
  required: ['slug', 'summary', 'body'],
}

export function memoryRememberTool(): ToolRegistryEntry {
  return {
    name: 'stello_memory_remember',
    description: DESCRIPTION,
    parameters: PARAMETERS,
    execute: async (args, ctx) => {
      const slug = (args.slug as string | undefined)?.trim()
      if (!slug) return { success: false, error: 'slug is required and must be non-empty' }
      const summary = args.summary as string | undefined
      if (summary === undefined || summary === null) {
        return { success: false, error: 'summary is required' }
      }
      const body = args.body as string | undefined
      if (body === undefined || body === null) {
        return { success: false, error: 'body is required' }
      }
      const store = ctx.agent.sharedMemory
      if (!store) return { success: false, error: 'sharedMemory not configured' }
      try {
        await store.upsert(slug, summary, body)
        return { success: true, data: { slug } }
      } catch (e) {
        return { success: false, error: `failed: ${e instanceof Error ? e.message : String(e)}` }
      }
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @stello-ai/core test -- memory-remember-tool`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/builtin-tools/memory-remember-tool.ts \
        packages/core/src/builtin-tools/__tests__/memory-remember-tool.test.ts
git commit -m "feat(core): add stello_memory_remember builtin tool"
```

---

## Task 7: Implement `memoryForgetTool` (TDD)

**Files:**
- Create: `packages/core/src/builtin-tools/__tests__/memory-forget-tool.test.ts`
- Create: `packages/core/src/builtin-tools/memory-forget-tool.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/builtin-tools/__tests__/memory-forget-tool.test.ts
import { describe, it, expect } from 'vitest'
import { memoryForgetTool } from '../memory-forget-tool'
import { InMemorySharedMemoryStore } from '../../shared-memory/in-memory-shared-memory-store'
import type { ToolExecutionContext } from '../../types/tool'
import type { StelloAgent } from '../../agent/stello-agent'

function fakeAgent(store: InMemorySharedMemoryStore | undefined): StelloAgent {
  return { sharedMemory: store } as unknown as StelloAgent
}

function ctx(agent: StelloAgent): ToolExecutionContext {
  return { agent, sessionId: 's1', toolName: 'stello_memory_forget' }
}

describe('memoryForgetTool', () => {
  it('returns ToolRegistryEntry named "stello_memory_forget"', () => {
    expect(memoryForgetTool().name).toBe('stello_memory_forget')
  })

  it('removes existing entry', async () => {
    const store = new InMemorySharedMemoryStore()
    await store.upsert('a', 'sa', 'ba')
    const r = await memoryForgetTool().execute({ slug: 'a' }, ctx(fakeAgent(store)))
    expect(r).toEqual({ success: true, data: { slug: 'a' } })
    expect(await store.get('a')).toBeNull()
  })

  it('returns success even when slug does not exist (no-op)', async () => {
    const store = new InMemorySharedMemoryStore()
    const r = await memoryForgetTool().execute({ slug: 'missing' }, ctx(fakeAgent(store)))
    expect(r).toEqual({ success: true, data: { slug: 'missing' } })
  })

  it('returns error for empty slug', async () => {
    const store = new InMemorySharedMemoryStore()
    const r = await memoryForgetTool().execute({ slug: '' }, ctx(fakeAgent(store)))
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/slug/i)
  })

  it('returns error when sharedMemory is not configured', async () => {
    const r = await memoryForgetTool().execute({ slug: 'a' }, ctx(fakeAgent(undefined)))
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/sharedMemory not configured/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @stello-ai/core test -- memory-forget-tool`
Expected: FAIL — cannot resolve `'../memory-forget-tool'`

- [ ] **Step 3: Write implementation**

```typescript
// packages/core/src/builtin-tools/memory-forget-tool.ts
import type { ToolRegistryEntry } from '../tool/tool-registry'

const DESCRIPTION = `删除一条共享 memory entry。

参数：
- slug（必填）: 要删除的 entry slug

何时使用：原 entry 已过时 / 错误 / 不再相关时调用。slug 不存在不报错（no-op）。`

const PARAMETERS = {
  type: 'object',
  properties: {
    slug: { type: 'string', description: '要删除的 entry slug' },
  },
  required: ['slug'],
}

export function memoryForgetTool(): ToolRegistryEntry {
  return {
    name: 'stello_memory_forget',
    description: DESCRIPTION,
    parameters: PARAMETERS,
    execute: async (args, ctx) => {
      const slug = (args.slug as string | undefined)?.trim()
      if (!slug) return { success: false, error: 'slug is required and must be non-empty' }
      const store = ctx.agent.sharedMemory
      if (!store) return { success: false, error: 'sharedMemory not configured' }
      try {
        await store.remove(slug)
        return { success: true, data: { slug } }
      } catch (e) {
        return { success: false, error: `failed: ${e instanceof Error ? e.message : String(e)}` }
      }
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @stello-ai/core test -- memory-forget-tool`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/builtin-tools/memory-forget-tool.ts \
        packages/core/src/builtin-tools/__tests__/memory-forget-tool.test.ts
git commit -m "feat(core): add stello_memory_forget builtin tool"
```

---

## Task 8: Extend `SessionSendOptions` and inject the slot in context assembly (TDD)

**Files:**
- Modify: `packages/session/src/types/session-api.ts`
- Modify: `packages/session/src/context-utils.ts`
- Modify: `packages/session/src/create-session.ts`
- Create: `packages/session/src/__tests__/shared-memory-index.test.ts`

- [ ] **Step 1: Add `sharedMemoryIndex` to `SessionSendOptions`**

In `packages/session/src/types/session-api.ts`, locate the `SessionSendOptions` interface (around line 19) and replace it with:

```typescript
/**
 * Session.send / Session.stream 的运行时选项
 *
 * 通过 signal 取消正在进行的 LLM 调用：abort 后 send() reject 为 AbortError，
 * stream() 的 result 同样 reject。被取消的调用不写入 L3（user msg 也不持久化）。
 */
export interface SessionSendOptions {
  /** AbortSignal — abort 后中断 LLM 调用并 reject 为 AbortError */
  signal?: AbortSignal
  /**
   * Agent 级共享 memory 索引段（已由编排层渲染好）。
   * 非空时插入到 systemPrompt 之后、session_identity 之前；为空 / undefined 时不注入。
   */
  sharedMemoryIndex?: string
}
```

- [ ] **Step 2: Extend `assembleSessionContext` signature and slot insertion**

In `packages/session/src/context-utils.ts`, replace the signature and the first few lines of `assembleSessionContext` (currently around line 172):

```typescript
export async function assembleSessionContext(
  sessionId: string,
  storage: SessionStorage,
  userContent: string,
  compress: CompressContext,
  label?: string,
  sharedMemoryIndex?: string,
): Promise<AssembleResult> {
  const prefixMessages: Message[] = []
  let insightConsumed = false

  // 1. system prompt
  const sysPrompt = await storage.getSystemPrompt(sessionId)
  if (sysPrompt) {
    prefixMessages.push({ role: 'system', content: sysPrompt })
  }

  // 2. shared memory index (agent-level)
  if (sharedMemoryIndex) {
    prefixMessages.push({ role: 'system', content: sharedMemoryIndex })
  }

  // 3. session identity (label)
  prefixMessages.push(...buildSessionIdentityMessages(label))

  // 4. insight
  const insightContent = await storage.getInsight(sessionId)
  if (insightContent) {
    prefixMessages.push({ role: 'system', content: insightContent })
    insightConsumed = true
  }
```

Leave the rest of the function (token estimation, compression branch) untouched.

- [ ] **Step 3: Extend `assembleSessionReplayContext` signature**

In `packages/session/src/create-session.ts`, locate `assembleSessionReplayContext` (around line 53) and replace its signature + body up through the insight push:

```typescript
async function assembleSessionReplayContext(
  sessionId: string,
  storage: CreateSessionOptions['storage'] | LoadSessionOptions['storage'],
  label?: string,
  sharedMemoryIndex?: string,
): Promise<{ messages: Message[]; insightConsumed: boolean }> {
  const messages: Message[] = []
  let insightConsumed = false

  const sysPrompt = await storage.getSystemPrompt(sessionId)
  if (sysPrompt) {
    messages.push({ role: 'system', content: sysPrompt })
  }

  if (sharedMemoryIndex) {
    messages.push({ role: 'system', content: sharedMemoryIndex })
  }

  messages.push(...buildSessionIdentityMessages(label))

  const insightContent = await storage.getInsight(sessionId)
  if (insightContent) {
    messages.push({ role: 'system', content: insightContent })
    insightConsumed = true
  }

  const memory = await storage.getMemory(sessionId)
  if (memory) {
    messages.push({ role: 'system', content: memory })
  }

  // 注意：此处刻意不调用 removeIncompleteToolCallGroups。
  // replay 路径会把"assistant(toolCalls) + 由 envelope 合成的 tool 消息"拼接成完整组，
  // 在加载阶段过早裁剪反而会把回灌目标删掉。完整组校验放在拼接后由调用方做。
  const history = await storage.listRecords(sessionId)
  messages.push(...history)
  return { messages, insightConsumed }
}
```

- [ ] **Step 4: Plumb `sharedMemoryIndex` through both send call sites**

In `packages/session/src/create-session.ts`, the `send` method (around line 150) and `stream` method (around line 223) both call `assembleSessionContext`. They also detect tool-result envelopes and call `assembleSessionReplayContext`. Update both call sites in **both methods** to forward `sendOptions?.sharedMemoryIndex`. Concretely:

```typescript
// Before (example — assembleSessionContext call)
const assembled = await assembleSessionContext(
  meta.id,
  storage,
  content,
  compressCtx,
  meta.label,
)

// After
const assembled = await assembleSessionContext(
  meta.id,
  storage,
  content,
  compressCtx,
  meta.label,
  sendOptions?.sharedMemoryIndex,
)
```

Apply the analogous fourth-positional update to every `assembleSessionReplayContext(meta.id, storage, meta.label)` call:

```typescript
// After
await assembleSessionReplayContext(meta.id, storage, meta.label, sendOptions?.sharedMemoryIndex)
```

- [ ] **Step 5: Write the integration test**

```typescript
// packages/session/src/__tests__/shared-memory-index.test.ts
import { describe, it, expect } from 'vitest'
import { createSession } from '../create-session'
import { InMemoryStorageAdapter } from '../mocks/in-memory-storage'
import type { LLMAdapter, Message } from '../types/llm'

function makeLLM(): { adapter: LLMAdapter; lastMessages: () => Message[] } {
  let captured: Message[] = []
  const adapter: LLMAdapter = {
    async complete(messages) {
      captured = messages
      return { content: 'ok' }
    },
  }
  return { adapter, lastMessages: () => captured }
}

describe('shared memory index injection', () => {
  it('inserts shared memory index between systemPrompt and session_identity', async () => {
    const storage = new InMemoryStorageAdapter()
    const { adapter, lastMessages } = makeLLM()
    const session = await createSession({
      id: 's1',
      label: 'child',
      storage,
      llm: adapter,
    })
    await session.setSystemPrompt('SYS')
    await session.send('hello', { sharedMemoryIndex: '<shared_memory_index>\n- a: x\n</shared_memory_index>' })

    const msgs = lastMessages()
    const sysIdx = msgs.findIndex(m => m.role === 'system' && m.content === 'SYS')
    const memIdx = msgs.findIndex(m => m.role === 'system' && m.content.includes('<shared_memory_index>'))
    const idIdx  = msgs.findIndex(m => m.role === 'system' && m.content.includes('<session_identity>'))

    expect(sysIdx).toBeGreaterThanOrEqual(0)
    expect(memIdx).toBeGreaterThan(sysIdx)
    expect(idIdx).toBeGreaterThan(memIdx)
  })

  it('omits the slot when sharedMemoryIndex is undefined', async () => {
    const storage = new InMemoryStorageAdapter()
    const { adapter, lastMessages } = makeLLM()
    const session = await createSession({
      id: 's1',
      label: 'child',
      storage,
      llm: adapter,
    })
    await session.setSystemPrompt('SYS')
    await session.send('hello') // no options

    const msgs = lastMessages()
    expect(msgs.find(m => m.content.includes('<shared_memory_index>'))).toBeUndefined()
  })

  it('omits the slot when sharedMemoryIndex is empty string', async () => {
    const storage = new InMemoryStorageAdapter()
    const { adapter, lastMessages } = makeLLM()
    const session = await createSession({
      id: 's1',
      label: 'child',
      storage,
      llm: adapter,
    })
    await session.send('hi', { sharedMemoryIndex: '' })

    const msgs = lastMessages()
    expect(msgs.find(m => m.content.includes('<shared_memory_index>'))).toBeUndefined()
  })
})
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @stello-ai/session test -- shared-memory-index`
Expected: PASS (all three cases)

Also run the full session test suite to verify no regressions:

Run: `pnpm --filter @stello-ai/session test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/session/src/types/session-api.ts \
        packages/session/src/context-utils.ts \
        packages/session/src/create-session.ts \
        packages/session/src/__tests__/shared-memory-index.test.ts
git commit -m "feat(session): add sharedMemoryIndex slot in context assembly"
```

---

## Task 9: Wire the index injection through the runtime adapter

**Files:**
- Modify: `packages/core/src/adapters/session-runtime.ts`
- Modify: `packages/core/src/agent/stello-agent.ts` (resolveRuntimeResolver hook)

- [ ] **Step 1: Extend `SessionCompatibleSendOptions`**

In `packages/core/src/adapters/session-runtime.ts`, replace the `SessionCompatibleSendOptions` interface:

```typescript
/** Session.send / Session.stream 的可选运行时参数（结构兼容 @stello-ai/session） */
export interface SessionCompatibleSendOptions {
  /** AbortSignal — abort 时底层 LLM 调用应被取消 */
  signal?: AbortSignal
  /** Agent 级共享 memory 索引段（已由编排层渲染） */
  sharedMemoryIndex?: string
}
```

- [ ] **Step 2: Accept a per-send index provider in adapter options**

In the same file, replace `SessionRuntimeAdapterOptions`:

```typescript
/** Session -> EngineRuntime 适配配置 */
export interface SessionRuntimeAdapterOptions {
  /** 上下文压缩函数（可选） */
  compressFn?: SessionCompatibleCompressFn
  /** 自定义 send() 结果序列化方式，默认转成 JSON 字符串 */
  serializeResult?: (result: SessionCompatibleSendResult) => string
  /**
   * 每次 send/stream 前调用，返回当前 agent 的共享 memory 索引段。
   * 返回 undefined / 空字符串则不注入。adapter 把结果合并进 sendOptions.sharedMemoryIndex。
   */
  sharedMemoryIndexProvider?: () => Promise<string | undefined>
}
```

- [ ] **Step 3: Use the provider in both send and stream wrappers**

In `adaptSessionToEngineRuntime`, replace the inner `send` definition:

```typescript
    async send(input: string, sendOptions?: SessionCompatibleSendOptions): Promise<string> {
      const sharedMemoryIndex = await options.sharedMemoryIndexProvider?.()
      const mergedOptions: SessionCompatibleSendOptions = {
        ...sendOptions,
        ...(sharedMemoryIndex ? { sharedMemoryIndex } : {}),
      }
      const result = await session.send(input, mergedOptions)
      turnCount += 1
      return (options.serializeResult ?? serializeSessionSendResult)(result)
    },
```

And the stream branch (replace the existing `stream` adapter inside the `...(session.stream ? { ... } : {})` block):

```typescript
    ...(session.stream
      ? {
          stream(input: string, sendOptions?: SessionCompatibleSendOptions) {
            const indexPromise = options.sharedMemoryIndexProvider?.() ?? Promise.resolve(undefined)
            const source = (async () => {
              const sharedMemoryIndex = await indexPromise
              const mergedOptions: SessionCompatibleSendOptions = {
                ...sendOptions,
                ...(sharedMemoryIndex ? { sharedMemoryIndex } : {}),
              }
              return session.stream!(input, mergedOptions)
            })()
            return {
              result: (async () => {
                const stream = await source
                const result = await stream.result
                turnCount += 1
                return (options.serializeResult ?? serializeSessionSendResult)(result)
              })(),
              async *[Symbol.asyncIterator]() {
                const stream = await source
                for await (const chunk of stream) yield chunk
              },
            }
          },
        }
      : {}),
```

- [ ] **Step 4: Plumb the provider from `StelloAgent`'s `resolveRuntimeResolver`**

In `packages/core/src/agent/stello-agent.ts`, add the import for the renderer near the top:

```typescript
import { renderSharedMemoryIndex } from '../shared-memory/render-index'
```

Locate `resolveRuntimeResolver` (around line 145) and update its signature + body:

```typescript
function resolveRuntimeResolver(config: StelloAgentConfig, agent: StelloAgent): SessionRuntimeResolver {
  if (config.runtime?.resolver) {
    return config.runtime.resolver
  }

  if (config.session?.sessionLoader) {
    const adaptOptions = {
      compressFn: config.sessionDefaults?.compressFn,
      serializeResult: config.session!.serializeSendResult ?? serializeSessionSendResult,
      sharedMemoryIndexProvider: () => renderSharedMemoryIndex(agent.sharedMemory),
    }
    return {
      resolve: async (sessionId: string) => {
        const { session } = await config.session!.sessionLoader!(sessionId)
        return adaptSessionToEngineRuntime(session, adaptOptions)
      },
    }
  }

  throw new Error(
    'StelloAgentConfig 缺少 runtime.resolver；若使用 session 配置接入，请提供 session.sessionLoader',
  )
}
```

(Note the added `agent` parameter so the provider closure captures `agent.sharedMemory`.)

Update the call site inside the `StelloAgent` constructor:

```typescript
      sessionRuntimeResolver: resolveRuntimeResolver(config, this),
```

- [ ] **Step 5: Verify the existing test suite still passes**

Run: `pnpm --filter @stello-ai/core test`
Expected: PASS (no regressions)

Run: `pnpm --filter @stello-ai/session test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/adapters/session-runtime.ts \
        packages/core/src/agent/stello-agent.ts
git commit -m "feat(core): inject sharedMemoryIndex on every session.send via adapter"
```

---

## Task 10: Remove the legacy `MemoryEngine` entirely

**Files (delete):**
- `packages/core/src/types/memory.ts`
- `packages/core/src/memory/file-system-memory-engine.ts`
- `packages/core/src/memory/__tests__/` (whole directory)

**Files (modify):**
- `packages/core/src/agent/stello-agent.ts`
- `packages/core/src/engine/stello-engine.ts`
- `packages/core/src/orchestrator/default-engine-factory.ts`
- `packages/core/src/types/engine.ts`
- `packages/core/src/types.ts`
- `packages/core/src/index.ts`
- `packages/core/src/agent/__tests__/stello-agent.test.ts`
- `packages/core/src/__tests__/builtin-tools-llm-exposure.test.ts`

- [ ] **Step 1: Delete the legacy memory directory + types file**

Run:

```bash
rm -rf packages/core/src/memory
rm packages/core/src/types/memory.ts
```

- [ ] **Step 2: Drop `memory` field/import in `StelloAgent`**

In `packages/core/src/agent/stello-agent.ts`:

1. Remove the import line: `import type { MemoryEngine } from '../types/memory';`
2. Remove the line `memory: MemoryEngine;` from `StelloAgentConfig`
3. Remove `readonly memory: StelloAgentConfig['memory'];` field
4. Remove `this.memory = config.memory;` from the constructor
5. Remove `memory: config.memory,` from the `DefaultEngineFactory` constructor call

- [ ] **Step 3: Drop `memory` from `StelloEngineImpl`**

In `packages/core/src/engine/stello-engine.ts`:

1. Remove the import: `import type { MemoryEngine, TurnRecord } from '../types/memory';`
2. Remove `memory: MemoryEngine;` from `StelloEngineOptions` (around line 97)
3. Remove `readonly memory: MemoryEngine;` from the class
4. Remove `this.memory = options.memory;` from the constructor
5. Search for any remaining references to `this.memory` or `options.memory` in this file and remove them (per pre-implementation grep there are none in active code paths)

- [ ] **Step 4: Drop `memory` from `DefaultEngineFactory`**

In `packages/core/src/orchestrator/default-engine-factory.ts`:

1. Remove the import: `import type { MemoryEngine } from '../types/memory';`
2. Remove `memory: MemoryEngine;` from `DefaultEngineFactoryOptions`
3. Remove `memory: this.options.memory,` from the `StelloEngineImpl` constructor call inside `create()`

- [ ] **Step 5: Drop from internal type re-exports**

In `packages/core/src/types/engine.ts`:
- Remove `MemoryEngine,` from the import list at the top
- Remove `readonly memory: MemoryEngine;` from any interface that declares it (around line 80)

In `packages/core/src/types.ts`:
- Remove `MemoryEngine,` from the `export type { ... }` block

- [ ] **Step 6: Drop from public package exports**

In `packages/core/src/index.ts`:
- Remove the entire `// 记忆系统` block (`InheritancePolicy`, `CoreSchemaField`, `CoreSchema`, `TurnRecord`, `AssembledContext`, `MemoryEngine`) from the `export type { ... }` block
- Remove the line: `export { FileSystemMemoryEngine } from './memory/file-system-memory-engine';`
- Keep `FileSystemAdapter` re-export (it's used elsewhere)

- [ ] **Step 7: Drop placeholder fixtures from existing tests**

In `packages/core/src/agent/__tests__/stello-agent.test.ts`, find every occurrence of:

```typescript
memory: {} as MemoryEngine,
```

(grep listed lines 43, 217, 400 in the pre-implementation snapshot) and delete those lines. Also remove the `import type { MemoryEngine } from '...';` at the top if present.

In `packages/core/src/__tests__/builtin-tools-llm-exposure.test.ts`:
- Line 80 currently has `memory: {} as MemoryEngine,` — delete the line and the matching import.

- [ ] **Step 8: Verify full test suite passes**

Run: `pnpm --filter @stello-ai/core test`
Expected: PASS — no remaining references to `MemoryEngine`

Run: `pnpm --filter @stello-ai/core exec tsc --noEmit`
Expected: PASS — no dangling imports

- [ ] **Step 9: Commit**

```bash
git add -A packages/core
git commit -m "refactor(core): drop legacy MemoryEngine and FileSystemMemoryEngine"
```

---

## Task 11: Update `@stello-ai/core` public exports for shared memory

**Files:**
- Modify: `packages/core/src/builtin-tools/index.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Export the three tool factories from builtin-tools**

Replace `packages/core/src/builtin-tools/index.ts` contents:

```typescript
export { createSessionTool } from './create-session-tool'
export { activateSkillTool } from './activate-skill-tool'
export { memoryRecallTool } from './memory-recall-tool'
export { memoryRememberTool } from './memory-remember-tool'
export { memoryForgetTool } from './memory-forget-tool'
```

- [ ] **Step 2: Export shared memory types + impl + tools from core package**

In `packages/core/src/index.ts`:

1. Update the builtin-tools re-export block:

```typescript
// 内置 tool 工厂（builtin-tools redesign）
export {
  createSessionTool,
  activateSkillTool,
  memoryRecallTool,
  memoryRememberTool,
  memoryForgetTool,
} from './builtin-tools';
```

2. Add a new dedicated block (after the `createStelloAgent` export block):

```typescript
// 共享 memory
export { InMemorySharedMemoryStore } from './shared-memory/in-memory-shared-memory-store';
export { renderSharedMemoryIndex } from './shared-memory/render-index';
export type { SharedMemoryEntry, SharedMemoryStore } from './shared-memory/types';
```

- [ ] **Step 3: Verify build**

Run: `pnpm --filter @stello-ai/core build`
Expected: PASS (tsup builds ESM + CJS + DTS without errors)

- [ ] **Step 4: Verify tests still pass**

Run: `pnpm --filter @stello-ai/core test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/builtin-tools/index.ts \
        packages/core/src/index.ts
git commit -m "feat(core): export SharedMemoryStore types, InMemorySharedMemoryStore, and three tool factories"
```

---

## Task 12: End-to-end smoke test (index visible across multiple sends)

**Files:**
- Create: `packages/core/src/__tests__/shared-memory-e2e.test.ts`

- [ ] **Step 1: Write the smoke test**

```typescript
// packages/core/src/__tests__/shared-memory-e2e.test.ts
import { describe, it, expect } from 'vitest'
import { adaptSessionToEngineRuntime } from '../adapters/session-runtime'
import { InMemorySharedMemoryStore } from '../shared-memory/in-memory-shared-memory-store'
import { renderSharedMemoryIndex } from '../shared-memory/render-index'
import type { SessionCompatible, SessionCompatibleSendOptions, SessionCompatibleSendResult } from '../adapters/session-runtime'

function makeFakeSession(): { session: SessionCompatible; capturedOptions: SessionCompatibleSendOptions[] } {
  const capturedOptions: SessionCompatibleSendOptions[] = []
  const session: SessionCompatible = {
    meta: { id: 'r', status: 'active' },
    async send(_input, options) {
      capturedOptions.push(options ?? {})
      const result: SessionCompatibleSendResult = { content: 'ok' }
      return result
    },
    async messages() { return [] },
    async consolidate() {},
    setTools() {},
  }
  return { session, capturedOptions }
}

describe('shared memory end-to-end', () => {
  it('adapter injects current index on every send', async () => {
    const store = new InMemorySharedMemoryStore()
    const { session, capturedOptions } = makeFakeSession()
    const runtime = await adaptSessionToEngineRuntime(session, {
      sharedMemoryIndexProvider: () => renderSharedMemoryIndex(store),
    })

    // first send — store empty, no index
    await runtime.send('hi', {})
    expect(capturedOptions[0]!.sharedMemoryIndex).toBeUndefined()

    // write one entry
    await store.upsert('a', 'sa', 'BODY')

    // second send — index present
    await runtime.send('hi again', {})
    expect(capturedOptions[1]!.sharedMemoryIndex).toContain('<shared_memory_index>')
    expect(capturedOptions[1]!.sharedMemoryIndex).toContain('- a: sa')

    // delete the entry
    await store.remove('a')

    // third send — back to undefined
    await runtime.send('hi once more', {})
    expect(capturedOptions[2]!.sharedMemoryIndex).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm --filter @stello-ai/core test -- shared-memory-e2e`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/__tests__/shared-memory-e2e.test.ts
git commit -m "test(core): add end-to-end test for shared memory index injection"
```

---

## Task 13: Final verification — full monorepo test + build

- [ ] **Step 1: Run full test suite across both packages**

Run: `pnpm --filter '@stello-ai/*' test`
Expected: PASS

- [ ] **Step 2: Run full build to confirm dist is clean**

Run: `pnpm --filter '@stello-ai/*' build`
Expected: PASS — both `core` and `session` produce ESM + CJS + DTS without errors

- [ ] **Step 3: Verify there are no remaining references to `MemoryEngine` / `FileSystemMemoryEngine`**

Run: `grep -rn "MemoryEngine\|FileSystemMemoryEngine" packages/core/src packages/session/src --include="*.ts"`
Expected: **no output** (zero matches)

- [ ] **Step 4: Verify the shared-memory exports are visible at the package root**

Run: `grep -n "SharedMemoryStore\|InMemorySharedMemoryStore\|memoryRecallTool" packages/core/src/index.ts`
Expected: at least three matches (the new export block + the tools re-export)

- [ ] **Step 5: If any of the previous checks failed, file a follow-up commit fixing the issue and re-run.**

(No commit if everything is green — Task 12 was the last functional change.)
