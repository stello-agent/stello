# Per-Session Skills 白名单过滤

## 背景

当前 `SkillRouter` 是 Engine 级别的全局实例，所有 session 共享同一份 skills。ForkProfile 可以为 fork 出的 session 定制 `tools`、`llm`、`systemPrompt`，但无法控制 skills。

## 目标

让 ForkProfile 支持 `skills?: string[]` 白名单，fork 出的 session 只能 `activate_skill` 白名单内的 skills。不传则继承全局全部 skills，传空数组 `[]` 则完全禁用 `activate_skill` 工具。

## 设计

### 1. ForkProfile 扩展

```typescript
export interface ForkProfile {
  // ...existing fields...
  /**
   * 可用 skill 白名单
   *
   * - `undefined`（不传）：继承全局所有 skills
   * - `['a', 'b']`：只能 activate_skill 白名单内的 skills
   * - `[]`（空数组）：完全禁用 activate_skill 工具
   */
  skills?: string[]
}
```

### 2. FilteredSkillRouter

新建 `packages/core/src/skill/filtered-skill-router.ts`，实现 `SkillRouter` 接口。这是只读视图，不允许注册。

```typescript
/** 白名单过滤的 SkillRouter 只读视图 */
export class FilteredSkillRouter implements SkillRouter {
  constructor(
    private readonly source: SkillRouter,
    private readonly allowedNames: Set<string>,
  ) {}

  register(): void {
    throw new Error('Cannot register skills on a filtered view')
  }

  get(name: string): Skill | undefined {
    if (!this.allowedNames.has(name)) return undefined
    return this.source.get(name)
  }

  getAll(): Skill[] {
    return this.source.getAll().filter(s => this.allowedNames.has(s.name))
  }
}
```

`FilteredSkillRouter` 是内部实现细节，不从 `index.ts` 导出。

### 3. Skill 过滤信息持久化

Fork 时将 `allowedSkills` 写入 `SessionMeta.metadata`，使用 `_stello` 前缀隔离框架内部数据与用户数据。在 `SessionMeta.metadata` 的 JSDoc 中标注 `_stello` 为保留前缀。

`StelloEngineImpl.executeCreateSession()` 变更：

```typescript
// 在 forkSession() 调用时，合并 skill 过滤到 metadata
const stelloMeta: Record<string, unknown> = {}
if (profile?.skills) {
  stelloMeta.allowedSkills = profile.skills
}

const child = await this.forkSession({
  // ...existing fields...
  metadata: {
    sourceSessionId: this.session.id,
    // _stello 放最后，防止被用户 metadata 覆盖
    ...(Object.keys(stelloMeta).length > 0 ? { _stello: stelloMeta } : {}),
  },
})
```

### 4. DefaultEngineFactory 读取并过滤

`DefaultEngineFactory.create()` 变更：

```typescript
async create(sessionId: string): Promise<OrchestratorEngine> {
  const session = await this.options.sessionRuntimeResolver.resolve(sessionId)
  
  // 读取 session metadata，按需创建过滤后的 SkillRouter
  const skills = await this.resolveSkillRouter(sessionId)

  return new StelloEngineImpl({
    // ...existing fields...
    skills,  // 替换全局 skills
  })
}

private async resolveSkillRouter(sessionId: string): Promise<SkillRouter> {
  const meta = await this.options.sessions.get(sessionId)
  const stelloMeta = meta?.metadata?._stello
  
  if (
    !stelloMeta
    || typeof stelloMeta !== 'object'
    || !('allowedSkills' in stelloMeta)
    || !Array.isArray((stelloMeta as Record<string, unknown>).allowedSkills)
  ) {
    return this.options.skills  // 无过滤，用全局
  }
  
  return new FilteredSkillRouter(
    this.options.skills,
    new Set((stelloMeta as { allowedSkills: string[] }).allowedSkills),
  )
}
```

### 5. activate_skill 工具的自动隐藏

现有逻辑已经处理了这个情况 — `getToolDefinitions()` 中：

```typescript
if (this.skills.getAll().length > 0) {
  builtins.push(createSkillToolDefinition(this.skills))
}
```

当 `FilteredSkillRouter.getAll()` 返回空数组时（`skills: []`），`activate_skill` 工具自动不出现在 tool 列表中。无需额外修改。

## 变更文件清单

| 文件 | 变更 |
|------|------|
| `packages/core/src/engine/fork-profile.ts` | 加 `skills?: string[]` 字段 |
| `packages/core/src/skill/filtered-skill-router.ts` | 新建，FilteredSkillRouter 实现 |
| `packages/core/src/engine/stello-engine.ts` | `executeCreateSession()` 写入 `_stello.allowedSkills` |
| `packages/core/src/orchestrator/default-engine-factory.ts` | `create()` 读 metadata 并过滤 skills |
| `packages/core/src/types/session.ts` | `SessionMeta.metadata` JSDoc 标注 `_stello` 保留前缀 |

## 不变的

- SkillRouter 接口不变
- SkillRouterImpl 不变
- Session 层不感知 skills（skills 仍然是纯 Engine 层概念）
- TopologyNode 不变
- skill-tool.ts 不变（它接收 SkillRouter 接口，FilteredSkillRouter 实现了该接口）
- FilteredSkillRouter 不导出（内部实现细节）
