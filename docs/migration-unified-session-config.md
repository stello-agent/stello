# 迁移指南：Unified SessionConfig

> 对应 RFC：`docs/rfcs/unified-session-config.md`
> 合入版本：2026-04-18（`feat/unified-session-config` 分支）

---

## 概览

本次变更统一了 session 配置的三处分散入口，清理了 `SessionMeta` 冗余字段，并重命名了 `StelloAgentSessionConfig` 的核心 API。**对已有代码的影响集中在以下五个点**：

| 变更点 | 类型 | 影响范围 |
|--------|------|---------|
| `sessionResolver` → `sessionLoader` | 重命名 + 返回值变化 | `createStelloAgent` 配置 |
| `mainSessionResolver` → `mainSessionLoader` | 重命名 + 返回值变化 | `createStelloAgent` 配置 |
| `SessionMeta` 删除 `scope / tags / metadata` | 破坏性删除 | 所有引用 `SessionMeta` 的地方 |
| `EngineForkOptions` 删除 `scope / tags / metadata` | 破坏性删除 | `forkSession()` 调用 |
| `compressFn` 从 `session` 迁移到 `sessionDefaults` | 字段移动 | 使用 compressFn 的配置 |

---

## 1. `sessionResolver` → `sessionLoader`

### 旧写法

```typescript
createStelloAgent({
  session: {
    sessionResolver: async (sessionId) => {
      const session = await loadSession(sessionId, { storage, llm })
      if (!session) throw new Error(`Session not found: ${sessionId}`)
      return session  // 直接返回 session 实例
    },
  },
})
```

### 新写法

```typescript
createStelloAgent({
  session: {
    sessionLoader: async (sessionId) => {
      const session = await loadSession(sessionId, { storage, llm })
      if (!session) throw new Error(`Session not found: ${sessionId}`)
      return { session, config: null }  // 包装为 {session, config} tuple
    },
  },
})
```

**变化说明**：
- 函数名从 `sessionResolver` 改为 `sessionLoader`
- 返回值从 `SessionCompatible` 改为 `{ session: SessionCompatible; config: SerializableSessionConfig | null }`
- `config` 目前传 `null` 即可；将来框架会用它覆盖 `sessionDefaults` 中的可序列化字段

---

## 2. `mainSessionResolver` → `mainSessionLoader`

### 旧写法

```typescript
createStelloAgent({
  session: {
    mainSessionResolver: async () => ({
      async integrate() { /* ... */ }
    }),
  },
})
```

### 新写法

```typescript
createStelloAgent({
  session: {
    mainSessionLoader: async () => ({
      session: {
        async integrate() { /* ... */ }
      },
      config: null,  // 包装为 {session, config} tuple
    }),
  },
})
```

**变化说明**：
- 函数名从 `mainSessionResolver` 改为 `mainSessionLoader`
- 返回值从 `MainSessionCompatible | null` 改为 `{ session: MainSessionCompatible; config: SerializableMainSessionConfig | null } | null`

---

## 3. `SessionMeta` 删除了 `scope / tags / metadata`

### 受影响的代码

所有通过 `SessionMeta` 对象读取或写入这三个字段的地方：

```typescript
// ❌ 不再存在
meta.scope
meta.tags
meta.metadata
meta.metadata._stello
meta.metadata.sourceSessionId
```

### 迁移策略

| 原用途 | 新方法 |
|--------|--------|
| `scope` — 约束 LLM 行为 | 改用 `systemPrompt` 或 `ForkProfile.systemPrompt` |
| `tags` — 分类标记 | 应用层自行维护（框架不提供） |
| `metadata` — 自定义键值 | 应用层自行维护（框架不提供） |
| `metadata._stello.allowedSkills` | 改用固化 `SessionConfig.skills`（fork 时通过 `EngineForkOptions.skills` 或 `ForkProfile.skills` 传入） |
| `metadata.sourceSessionId` | 改读 `TopologyNode.sourceSessionId`（现在是一等字段） |

**新 `SessionMeta` 只剩**：

```typescript
interface SessionMeta {
  readonly id: string
  label: string
  status: 'active' | 'archived'
  turnCount: number
  createdAt: string
  updatedAt: string
  lastActiveAt: string
}
```

---

## 4. `EngineForkOptions` 删除了 `scope / tags / metadata`

### 旧写法

```typescript
await agent.forkSession(sessionId, {
  label: '市场分析',
  scope: 'market',          // ❌ 已删除
  tags: ['research'],       // ❌ 已删除
  metadata: { key: 'val' }, // ❌ 已删除
})
```

### 新写法

```typescript
await agent.forkSession(sessionId, {
  label: '市场分析',
  systemPrompt: '你专注于市场分析...',  // 用 systemPrompt 替代 scope 的行为约束用途
})
```

同样适用于 `ConfirmProtocol.confirmSplit` 中的 `proposal.suggestedScope`：

```typescript
// 旧
confirmSplit: async (proposal) => {
  return agentRef.forkSession(proposal.parentId, {
    label: proposal.suggestedLabel,
    scope: proposal.suggestedScope,  // ❌
  })
}

// 新
confirmSplit: async (proposal) => {
  return agentRef.forkSession(proposal.parentId, {
    label: proposal.suggestedLabel,
    // suggestedScope 已不在 proposal 中，如需约束 LLM 行为改传 systemPrompt
  })
}
```

---

## 5. `compressFn` 从 `session` 迁移到 `sessionDefaults`

### 旧写法

```typescript
createStelloAgent({
  session: {
    compressFn: myCompressFn,  // ❌ 已不存在
    sessionResolver: async (id) => { /* ... */ },
  },
})
```

### 新写法

```typescript
createStelloAgent({
  sessionDefaults: {
    compressFn: myCompressFn,  // ✅ 移到 sessionDefaults
  },
  session: {
    sessionLoader: async (id) => { /* ... */ },
  },
})
```

---

## 新增能力（可选使用）

### `sessionDefaults` — Regular Session 的 Agent 级默认

```typescript
createStelloAgent({
  sessionDefaults: {
    llm: defaultLlm,
    consolidateFn: defaultConsolidateFn,
    compressFn: defaultCompressFn,
  },
})
```

- 是所有 regular session 的配置基线（合成链最低优先级）
- `ForkProfile` 和 `EngineForkOptions` 的同名字段可逐级覆盖

### `mainSessionConfig` — Main Session 的独立配置

```typescript
createStelloAgent({
  mainSessionConfig: {
    systemPrompt: '你是全局协调者...',
    llm: mainLlm,
    integrateFn: myIntegrateFn,
  },
})
```

- 独立配置，不参与 regular session 的 fork 合成链
- Main session 使用 `integrateFn` 而非 `consolidateFn`

### `agent.createMainSession()` — 显式创建根节点

```typescript
// 旧：直接调用底层
const root = await agent.sessions.createRoot('Main')

// 新：推荐路径，会用 mainSessionConfig 固化配置
const root = await agent.createMainSession({ label: 'Main' })
```

### Fork 配置合成链

`forkSession` 时，`systemPrompt` / `llm` / `tools` / `consolidateFn` / `compressFn` / `skills` 按以下优先级合成（后者覆盖前者）：

```
sessionDefaults → 父 session 的固化 config → ForkProfile → EngineForkOptions
```

从 main session fork 时，不继承 main session 的配置（类型不同），只从 `sessionDefaults` 开始。

### `skills` 白名单（替代 `metadata._stello.allowedSkills`）

```typescript
// fork 时指定该子 session 只能用特定 skill
await agent.forkSession(sessionId, {
  label: '研究助手',
  skills: ['search', 'summarize'],  // 白名单
  // skills: []                      // 禁用所有 skill
  // skills: undefined               // 继承全局 SkillRouter（默认）
})

// 或通过 ForkProfile 预设
forkProfiles.register('researcher', {
  skills: ['search', 'summarize'],
  systemPrompt: '你是研究助手...',
})
```

### `ForkProfile` 扁平化

`ForkProfile` 现在继承 `SessionConfig`，不再重复定义字段：

```typescript
// 旧：ForkProfile 有自己的 systemPrompt/llm/tools/consolidateFn/compressFn 字段
// 新：ForkProfile extends SessionConfig，全部字段通过继承获得

forkProfiles.register('expert', {
  // SessionConfig 字段（直接写，不再有命名空间）
  systemPrompt: '你是专家...',
  llm: expertLlm,
  consolidateFn: expertConsolidateFn,
  skills: ['search'],

  // ForkProfile 专属字段
  systemPromptFn: (vars) => `你是${vars.region}地区的专家...`,  // 优先于 systemPrompt
  systemPromptMode: 'prepend',  // 默认值
  context: 'inherit',
  prompt: '请先做自我介绍',
})
```

---

## `TopologyNode.sourceSessionId`

`sourceSessionId` 从 `SessionMeta.metadata.sourceSessionId` 升为 `TopologyNode` 的一等字段：

```typescript
// 旧（从 metadata 读）
const node = await agent.sessions.get(sessionId)
const sourceId = node.metadata?.sourceSessionId  // ❌

// 新（从 TopologyNode 读）
const node = await agent.sessions.getNode(sessionId)  // 返回 TopologyNode
const sourceId = node.sourceSessionId  // ✅
```

**语义**：fork 时的上下文来源 session ID。当 `topologyParentId` 被显式覆盖时，拓扑父节点和上下文来源可以不同，两者均被保留。

---

## 已删除

- `packages/server`（整包删除，相关 PG 适配器和 HTTP 层随之移除）
- `SessionMeta.scope`
- `SessionMeta.tags`
- `SessionMeta.metadata`
- `EngineForkOptions.scope`
- `EngineForkOptions.tags`
- `EngineForkOptions.metadata`
- `StelloAgentSessionConfig.compressFn`
- `StelloAgentSessionConfig.sessionResolver`（改名为 `sessionLoader`）
- `StelloAgentSessionConfig.mainSessionResolver`（改名为 `mainSessionLoader`）
