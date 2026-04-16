# Per-Session Skills 白名单过滤 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 ForkProfile 支持 `skills?: string[]` 白名单，fork 出的 session 只能 activate_skill 白名单内的 skills。

**Architecture:** 新增 `FilteredSkillRouter`（只读视图），ForkProfile 扩展 `skills` 字段。fork 时将白名单写入 `SessionMeta.metadata._stello`，`DefaultEngineFactory` 读取后创建过滤后的 SkillRouter 注入 Engine。

**Tech Stack:** TypeScript strict · Vitest · pnpm monorepo

**Spec:** `docs/superpowers/specs/2026-04-07-per-session-skills-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/core/src/skill/filtered-skill-router.ts` | Create | 白名单过滤的 SkillRouter 只读视图 |
| `packages/core/src/skill/__tests__/filtered-skill-router.test.ts` | Create | FilteredSkillRouter 单元测试 |
| `packages/core/src/engine/fork-profile.ts` | Modify | 加 `skills?: string[]` 字段 |
| `packages/core/src/engine/__tests__/fork-profile.test.ts` | Modify | 验证 skills 字段透传 |
| `packages/core/src/types/session.ts` | Modify | SessionMeta.metadata JSDoc 标注 `_stello` 保留前缀 |
| `packages/core/src/engine/stello-engine.ts` | Modify | `executeCreateSession()` 写入 `_stello.allowedSkills` |
| `packages/core/src/engine/__tests__/stello-engine.test.ts` | Modify | 验证 profile.skills → metadata 写入 |
| `packages/core/src/orchestrator/default-engine-factory.ts` | Modify | `create()` 读 metadata 并创建 FilteredSkillRouter |
| `packages/core/src/orchestrator/__tests__/default-engine-factory.test.ts` | Modify | 验证 skills 过滤集成 |

---

### Task 1: FilteredSkillRouter — 测试

**Files:**
- Create: `packages/core/src/skill/__tests__/filtered-skill-router.test.ts`

- [ ] **Step 1: 写 FilteredSkillRouter 测试**

```typescript
import { describe, it, expect } from 'vitest'
import { FilteredSkillRouter } from '../filtered-skill-router'
import { SkillRouterImpl } from '../skill-router'
import type { Skill } from '../../types/lifecycle'

/** 创建测试用 Skill */
function makeSkill(name: string): Skill {
  return {
    name,
    description: `${name} 描述`,
    content: `# ${name}\n使用指南`,
  }
}

describe('FilteredSkillRouter', () => {
  it('getAll 只返回白名单内的 skills', () => {
    const source = new SkillRouterImpl()
    source.register(makeSkill('research'))
    source.register(makeSkill('coding'))
    source.register(makeSkill('translate'))

    const filtered = new FilteredSkillRouter(source, new Set(['research', 'coding']))
    const all = filtered.getAll()

    expect(all).toHaveLength(2)
    expect(all.map(s => s.name)).toEqual(expect.arrayContaining(['research', 'coding']))
  })

  it('get 返回白名单内的 skill', () => {
    const source = new SkillRouterImpl()
    source.register(makeSkill('research'))

    const filtered = new FilteredSkillRouter(source, new Set(['research']))
    expect(filtered.get('research')?.name).toBe('research')
  })

  it('get 对白名单外的 skill 返回 undefined', () => {
    const source = new SkillRouterImpl()
    source.register(makeSkill('research'))

    const filtered = new FilteredSkillRouter(source, new Set(['coding']))
    expect(filtered.get('research')).toBeUndefined()
  })

  it('get 对不存在的 skill 返回 undefined', () => {
    const source = new SkillRouterImpl()
    const filtered = new FilteredSkillRouter(source, new Set(['research']))
    expect(filtered.get('nonexistent')).toBeUndefined()
  })

  it('空白名单时 getAll 返回空数组', () => {
    const source = new SkillRouterImpl()
    source.register(makeSkill('research'))

    const filtered = new FilteredSkillRouter(source, new Set())
    expect(filtered.getAll()).toEqual([])
  })

  it('register 抛出错误（只读视图）', () => {
    const source = new SkillRouterImpl()
    const filtered = new FilteredSkillRouter(source, new Set())
    expect(() => filtered.register(makeSkill('x'))).toThrow('Cannot register skills on a filtered view')
  })
})
```

- [ ] **Step 2: 运行测试，确认全部失败**

Run: `cd packages/core && pnpm vitest run src/skill/__tests__/filtered-skill-router.test.ts`
Expected: FAIL — `filtered-skill-router` 模块不存在

---

### Task 2: FilteredSkillRouter — 实现

**Files:**
- Create: `packages/core/src/skill/filtered-skill-router.ts`

- [ ] **Step 1: 创建 FilteredSkillRouter**

```typescript
// ─── 白名单过滤的 SkillRouter 视图 ───

import type { Skill, SkillRouter } from '../types/lifecycle'

/**
 * 白名单过滤的 SkillRouter 只读视图
 *
 * 只暴露 allowedNames 中的 skills，register 不可用。
 */
export class FilteredSkillRouter implements SkillRouter {
  constructor(
    private readonly source: SkillRouter,
    private readonly allowedNames: Set<string>,
  ) {}

  /** 只读视图，不允许注册 */
  register(): void {
    throw new Error('Cannot register skills on a filtered view')
  }

  /** 按名称查找，仅白名单内可见 */
  get(name: string): Skill | undefined {
    if (!this.allowedNames.has(name)) return undefined
    return this.source.get(name)
  }

  /** 返回白名单内的所有 skills */
  getAll(): Skill[] {
    return this.source.getAll().filter(s => this.allowedNames.has(s.name))
  }
}
```

- [ ] **Step 2: 运行测试，确认全部通过**

Run: `cd packages/core && pnpm vitest run src/skill/__tests__/filtered-skill-router.test.ts`
Expected: 6 tests PASS

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/skill/filtered-skill-router.ts packages/core/src/skill/__tests__/filtered-skill-router.test.ts
git commit -m "feat(core): 新增 FilteredSkillRouter 白名单过滤只读视图"
```

---

### Task 3: ForkProfile 扩展 + SessionMeta JSDoc

**Files:**
- Modify: `packages/core/src/engine/fork-profile.ts:9-27` — 加 `skills` 字段
- Modify: `packages/core/src/types/session.ts:23-24` — metadata JSDoc 加 `_stello` 保留前缀说明

- [ ] **Step 1: 给 ForkProfile 加 skills 字段**

在 `packages/core/src/engine/fork-profile.ts` 的 `ForkProfile` interface 中，`contextFn` 字段后面加：

```typescript
  /**
   * 可用 skill 白名单
   *
   * - `undefined`（不传）：继承全局所有 skills
   * - `['a', 'b']`：只能 activate_skill 白名单内的 skills
   * - `[]`（空数组）：完全禁用 activate_skill 工具
   */
  skills?: string[]
```

- [ ] **Step 2: 更新 SessionMeta.metadata JSDoc**

在 `packages/core/src/types/session.ts` 中，把 `metadata` 字段的注释从：

```typescript
  /** 开发者自定义元数据 */
  metadata: Record<string, unknown>;
```

改为：

```typescript
  /** 开发者自定义元数据（`_stello` 为框架保留前缀，请勿覆盖） */
  metadata: Record<string, unknown>;
```

- [ ] **Step 3: 运行现有测试确认无破坏**

Run: `cd packages/core && pnpm vitest run src/engine/__tests__/fork-profile.test.ts`
Expected: 全部 PASS（新字段是可选的，不影响现有测试）

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/engine/fork-profile.ts packages/core/src/types/session.ts
git commit -m "feat(core): ForkProfile 新增 skills 白名单字段"
```

---

### Task 4: executeCreateSession 写入 _stello.allowedSkills — 测试

**Files:**
- Modify: `packages/core/src/engine/__tests__/stello-engine.test.ts`

- [ ] **Step 1: 在 stello_create_session 内置拦截 describe 块末尾加测试**

在 `stello-engine.test.ts` 的 `describe('stello_create_session 内置拦截')` 块中，在最后一个 `it` 之后加：

```typescript
    it('profile.skills 写入 metadata._stello.allowedSkills', async () => {
      const profileRegistry = new ForkProfileRegistryImpl()
      profileRegistry.register('research', {
        systemPrompt: '你是研究助手',
        skills: ['search', 'summarize'],
      })

      const createChild = vi.fn().mockResolvedValue({
        id: 'c1', parentId: 's1', children: [], refs: [],
        depth: 1, index: 0, label: '研究',
      })
      const sessionFork = vi.fn().mockResolvedValue({
        id: 'c1', meta: { id: 'c1', turnCount: 0, status: 'active' },
        turnCount: 0, send: vi.fn(), consolidate: vi.fn(),
      })

      const engine = new StelloEngineImpl({
        session: {
          id: 's1',
          meta: { id: 's1', turnCount: 0, status: 'active' as const },
          turnCount: 0,
          send: vi.fn(),
          consolidate: vi.fn(),
          fork: sessionFork,
        },
        sessions: { ...sessions, createChild } as unknown as SessionTree,
        memory, skills, confirm,
        lifecycle: { bootstrap: vi.fn(), afterTurn: vi.fn() },
        tools: { getToolDefinitions: vi.fn().mockReturnValue([]), executeTool: vi.fn() },
        profiles: profileRegistry,
      })

      await engine.executeTool('stello_create_session', {
        label: '研究',
        profile: 'research',
      })

      expect(sessionFork).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            _stello: { allowedSkills: ['search', 'summarize'] },
          }),
        }),
      )
    })

    it('profile 无 skills 时 metadata 不包含 _stello', async () => {
      const profileRegistry = new ForkProfileRegistryImpl()
      profileRegistry.register('basic', {
        systemPrompt: '基础',
      })

      const createChild = vi.fn().mockResolvedValue({
        id: 'c1', parentId: 's1', children: [], refs: [],
        depth: 1, index: 0, label: 'test',
      })
      const sessionFork = vi.fn().mockResolvedValue({
        id: 'c1', meta: { id: 'c1', turnCount: 0, status: 'active' },
        turnCount: 0, send: vi.fn(), consolidate: vi.fn(),
      })

      const engine = new StelloEngineImpl({
        session: {
          id: 's1',
          meta: { id: 's1', turnCount: 0, status: 'active' as const },
          turnCount: 0,
          send: vi.fn(),
          consolidate: vi.fn(),
          fork: sessionFork,
        },
        sessions: { ...sessions, createChild } as unknown as SessionTree,
        memory, skills, confirm,
        lifecycle: { bootstrap: vi.fn(), afterTurn: vi.fn() },
        tools: { getToolDefinitions: vi.fn().mockReturnValue([]), executeTool: vi.fn() },
        profiles: profileRegistry,
      })

      await engine.executeTool('stello_create_session', {
        label: 'test',
        profile: 'basic',
      })

      const calledMeta = sessionFork.mock.calls[0]![0].metadata
      expect(calledMeta).not.toHaveProperty('_stello')
    })
```

- [ ] **Step 2: 运行测试，确认新测试失败、旧测试通过**

Run: `cd packages/core && pnpm vitest run src/engine/__tests__/stello-engine.test.ts`
Expected: 2 new tests FAIL（_stello 还没写入 metadata）

---

### Task 5: executeCreateSession 写入 _stello.allowedSkills — 实现

**Files:**
- Modify: `packages/core/src/engine/stello-engine.ts:342-384`

- [ ] **Step 1: 修改 executeCreateSession**

在 `stello-engine.ts` 的 `executeCreateSession` 方法中，找到现有的 `forkSession` 调用：

```typescript
      const child = await this.forkSession({
        label: args.label as string,
        systemPrompt,
        prompt: args.prompt as string | undefined,
        context,
        llm: profile?.llm,
        tools: profile?.tools,
        metadata: { sourceSessionId: this.session.id },
      });
```

替换为：

```typescript
      // 构建框架内部 metadata
      const stelloMeta: Record<string, unknown> = {}
      if (profile?.skills) {
        stelloMeta.allowedSkills = profile.skills
      }

      const child = await this.forkSession({
        label: args.label as string,
        systemPrompt,
        prompt: args.prompt as string | undefined,
        context,
        llm: profile?.llm,
        tools: profile?.tools,
        metadata: {
          sourceSessionId: this.session.id,
          ...(Object.keys(stelloMeta).length > 0 ? { _stello: stelloMeta } : {}),
        },
      });
```

- [ ] **Step 2: 运行测试，确认全部通过**

Run: `cd packages/core && pnpm vitest run src/engine/__tests__/stello-engine.test.ts`
Expected: 全部 PASS

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/engine/stello-engine.ts packages/core/src/engine/__tests__/stello-engine.test.ts
git commit -m "feat(core): executeCreateSession 将 profile.skills 写入 metadata._stello"
```

---

### Task 6: DefaultEngineFactory 读取并过滤 — 测试

**Files:**
- Modify: `packages/core/src/orchestrator/__tests__/default-engine-factory.test.ts`

- [ ] **Step 1: 在 describe 块末尾加测试**

在 `default-engine-factory.test.ts` 的 `describe('DefaultEngineFactory')` 块末尾加：

```typescript
  it('session metadata 有 _stello.allowedSkills 时，engine 使用过滤后的 skills', async () => {
    const runtimeSession = makeSession()
    const globalSkills = {
      get: vi.fn((name: string) => ({ name, description: `${name} desc`, content: `${name} content` })),
      register: vi.fn(),
      getAll: vi.fn().mockReturnValue([
        { name: 'research', description: 'research desc', content: 'research content' },
        { name: 'coding', description: 'coding desc', content: 'coding content' },
        { name: 'translate', description: 'translate desc', content: 'translate content' },
      ]),
    } as unknown as SkillRouter

    const opts = baseOptions()
    const factory = new DefaultEngineFactory({
      ...opts,
      skills: globalSkills,
      sessions: {
        ...opts.sessions,
        get: vi.fn().mockResolvedValue({
          id: 's1', label: 'test', scope: null, status: 'active',
          turnCount: 0, tags: [], createdAt: '', updatedAt: '', lastActiveAt: '',
          metadata: { _stello: { allowedSkills: ['research', 'coding'] } },
        }),
      } as unknown as SessionTree,
      sessionRuntimeResolver: {
        resolve: vi.fn().mockResolvedValue(runtimeSession),
      },
    })

    const engine = await factory.create('s1')
    const defs = engine.getToolDefinitions()
    const skillTool = defs.find(d => d.name === 'activate_skill')

    // activate_skill 应存在，且 description 中只列出 research 和 coding
    expect(skillTool).toBeDefined()
    expect(skillTool!.description).toContain('research')
    expect(skillTool!.description).toContain('coding')
    expect(skillTool!.description).not.toContain('translate')
  })

  it('session metadata 有 _stello.allowedSkills: [] 时，activate_skill 工具不出现', async () => {
    const runtimeSession = makeSession()
    const globalSkills = {
      get: vi.fn(),
      register: vi.fn(),
      getAll: vi.fn().mockReturnValue([
        { name: 'research', description: 'research desc', content: 'research content' },
      ]),
    } as unknown as SkillRouter

    const opts = baseOptions()
    const factory = new DefaultEngineFactory({
      ...opts,
      skills: globalSkills,
      sessions: {
        ...opts.sessions,
        get: vi.fn().mockResolvedValue({
          id: 's1', label: 'test', scope: null, status: 'active',
          turnCount: 0, tags: [], createdAt: '', updatedAt: '', lastActiveAt: '',
          metadata: { _stello: { allowedSkills: [] } },
        }),
      } as unknown as SessionTree,
      sessionRuntimeResolver: {
        resolve: vi.fn().mockResolvedValue(runtimeSession),
      },
    })

    const engine = await factory.create('s1')
    const defs = engine.getToolDefinitions()
    expect(defs.find(d => d.name === 'activate_skill')).toBeUndefined()
  })

  it('session metadata 无 _stello 时，使用全局 skills（不过滤）', async () => {
    const runtimeSession = makeSession()
    const globalSkills = {
      get: vi.fn(),
      register: vi.fn(),
      getAll: vi.fn().mockReturnValue([
        { name: 'research', description: 'research desc', content: 'research content' },
      ]),
    } as unknown as SkillRouter

    const opts = baseOptions()
    const factory = new DefaultEngineFactory({
      ...opts,
      skills: globalSkills,
      sessions: {
        ...opts.sessions,
        get: vi.fn().mockResolvedValue({
          id: 's1', label: 'test', scope: null, status: 'active',
          turnCount: 0, tags: [], createdAt: '', updatedAt: '', lastActiveAt: '',
          metadata: { sourceSessionId: 'root' },
        }),
      } as unknown as SessionTree,
      sessionRuntimeResolver: {
        resolve: vi.fn().mockResolvedValue(runtimeSession),
      },
    })

    const engine = await factory.create('s1')
    const defs = engine.getToolDefinitions()
    const skillTool = defs.find(d => d.name === 'activate_skill')
    expect(skillTool).toBeDefined()
    expect(skillTool!.description).toContain('research')
  })
```

- [ ] **Step 2: 运行测试，确认新测试失败**

Run: `cd packages/core && pnpm vitest run src/orchestrator/__tests__/default-engine-factory.test.ts`
Expected: 3 new tests FAIL（factory 还没有 resolveSkillRouter 逻辑）

---

### Task 7: DefaultEngineFactory 读取并过滤 — 实现

**Files:**
- Modify: `packages/core/src/orchestrator/default-engine-factory.ts`

- [ ] **Step 1: 添加 import**

在 `default-engine-factory.ts` 顶部添加：

```typescript
import { FilteredSkillRouter } from '../skill/filtered-skill-router'
```

- [ ] **Step 2: 修改 create() 方法**

把现有 `create` 方法：

```typescript
  async create(sessionId: string): Promise<OrchestratorEngine> {
    const session = await this.options.sessionRuntimeResolver.resolve(sessionId);
    const userHooks = this.resolveHooks(sessionId);
    const schedulerHooks = this.buildSchedulerHooks(session);
    const mergedHooks = this.mergeHooks(userHooks, schedulerHooks);

    return new StelloEngineImpl({
      session,
      sessions: this.options.sessions,
      memory: this.options.memory,
      skills: this.options.skills,
      confirm: this.options.confirm,
      lifecycle: this.options.lifecycle,
      tools: this.options.tools,
      splitGuard: this.options.splitGuard,
      profiles: this.options.profiles,
      turnRunner: this.options.turnRunner,
      hooks: mergedHooks,
    });
  }
```

替换为：

```typescript
  async create(sessionId: string): Promise<OrchestratorEngine> {
    const session = await this.options.sessionRuntimeResolver.resolve(sessionId);
    const userHooks = this.resolveHooks(sessionId);
    const schedulerHooks = this.buildSchedulerHooks(session);
    const mergedHooks = this.mergeHooks(userHooks, schedulerHooks);
    const skills = await this.resolveSkillRouter(sessionId);

    return new StelloEngineImpl({
      session,
      sessions: this.options.sessions,
      memory: this.options.memory,
      skills,
      confirm: this.options.confirm,
      lifecycle: this.options.lifecycle,
      tools: this.options.tools,
      splitGuard: this.options.splitGuard,
      profiles: this.options.profiles,
      turnRunner: this.options.turnRunner,
      hooks: mergedHooks,
    });
  }
```

- [ ] **Step 3: 添加 resolveSkillRouter 方法**

在 `DefaultEngineFactory` 类中，`resolveHooks` 方法之前加：

```typescript
  /** 按 session metadata 中的 _stello.allowedSkills 创建过滤后的 SkillRouter */
  private async resolveSkillRouter(sessionId: string): Promise<SkillRouter> {
    const meta = await this.options.sessions.get(sessionId)
    const stelloMeta = meta?.metadata?._stello

    if (
      !stelloMeta
      || typeof stelloMeta !== 'object'
      || !('allowedSkills' in stelloMeta)
      || !Array.isArray((stelloMeta as Record<string, unknown>).allowedSkills)
    ) {
      return this.options.skills
    }

    return new FilteredSkillRouter(
      this.options.skills,
      new Set((stelloMeta as { allowedSkills: string[] }).allowedSkills),
    )
  }
```

- [ ] **Step 4: 运行测试，确认全部通过**

Run: `cd packages/core && pnpm vitest run src/orchestrator/__tests__/default-engine-factory.test.ts`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/orchestrator/default-engine-factory.ts packages/core/src/orchestrator/__tests__/default-engine-factory.test.ts
git commit -m "feat(core): DefaultEngineFactory 按 metadata._stello.allowedSkills 过滤 skills"
```

---

### Task 8: 全量验证

- [ ] **Step 1: 运行 core 包全部测试**

Run: `cd packages/core && pnpm vitest run`
Expected: 全部 PASS

- [ ] **Step 2: 运行 TypeScript 类型检查**

Run: `cd packages/core && pnpm tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 构建**

Run: `pnpm -r build`
Expected: 全部成功

- [ ] **Step 4: Commit（如有 lint 修复）**

```bash
git add -A
git commit -m "chore(core): per-session skills 全量验证通过"
```
