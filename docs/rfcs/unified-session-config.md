# RFC: 统一 SessionConfig 设计

> 日期：2026-04-18

## 背景

当前 stello 的 session 配置分散在三个地方，互相重叠但职责不一致：

1. **`StelloAgentSessionConfig`**：名义上是"session 层接入配置"，实际上是 `@stello-ai/session` 包的适配层（resolver + serializer + parser），完全不含 `llm / systemPrompt / consolidateFn` 等 session 行为配置。
2. **`ForkProfile`**：命名模板，让 LLM 通过 `profile` 参数选择预设配置，含 `systemPrompt / llm / tools / consolidateFn / compressFn / skills`。
3. **`EngineForkOptions`**：fork 时逐个传入的配置，与 ForkProfile 字段大量重叠。

结果是：
- 根 session（即 main session）的 `llm / systemPrompt / consolidateFn` 只能在 `sessionResolver` / `mainSessionResolver` 的**闭包里手写构造**，不通过任何声明式配置。
- 当 fork 时不传某字段，其 fallback 是"继承父 session"——但"父 session 的配置"没有专属存储槽，而是藏在 resolver 闭包里。
- `scope / tags / metadata` 存在于 SessionMeta 但从未进入 LLM 上下文，框架保留字段（`_stello.allowedSkills`、`sourceSessionId`）混在用户 metadata 里。

---

## 核心设计

### 1. 统一字段集：`SessionConfig` 和 `MainSessionConfig`

**`SessionConfig`**（regular session 专用）：

```typescript
interface SessionConfig {
  systemPrompt?: string
  llm?: LLMAdapter
  tools?: LLMCompleteOptions['tools']
  skills?: string[]          // 白名单，空数组 = 禁用所有 skill
  consolidateFn?: SessionCompatibleConsolidateFn
  compressFn?: SessionCompatibleCompressFn
}
```

**`MainSessionConfig`**（main session 专用，独立，不参与 fallback 链）：

```typescript
interface MainSessionConfig {
  systemPrompt?: string
  llm?: LLMAdapter
  tools?: LLMCompleteOptions['tools']
  skills?: string[]
  integrateFn?: SessionCompatibleIntegrateFn
  compressFn?: SessionCompatibleCompressFn
}
```

两者的区别：regular session 有 `consolidateFn`，main session 有 `integrateFn`，互不相关。

### 2. 三个使用入口

**入口一：Agent 级默认（`sessionDefaults`）**

```typescript
createStelloAgent({
  sessionDefaults: {
    llm: defaultLlm,
    consolidateFn: defaultConsolidateFn,
  },
  mainSessionConfig: {
    llm: mainLlm,
    systemPrompt: '你是全局协调者...',
    integrateFn: myIntegrateFn,
  },
  // ...
})
```

- `sessionDefaults` 是所有 regular session 的配置基线
- `mainSessionConfig` 是 main session 的独立配置，不参与任何 fallback 链

**入口二：命名模板（`ForkProfile`）**

```typescript
ForkProfile = SessionConfig & {
  systemPromptMode?: 'preset' | 'prepend' | 'append'  // 默认 'prepend'
  context?: 'none' | 'inherit' | ForkContextFn
}
```

`systemPromptMode` 控制 profile 的 `systemPrompt` 如何与 fork option 提供的 `systemPrompt` 合成。

**入口三：Fork 时覆盖（`EngineForkOptions`）**

```typescript
EngineForkOptions = SessionConfig & {
  // fork 专属字段
  label: string                                       // 必填
  prompt?: string                                     // fork 后立即发送的首条消息
  topologyParentId?: string                           // 显式拓扑父节点
  context?: 'none' | 'inherit' | ForkContextFn       // 上下文继承策略
  // profile 引用
  profile?: string                                    // ForkProfile 名称
  profileVars?: Record<string, unknown>               // 模板变量
}
```

`context` 从 `SessionConfig` 移出，归入 fork 专属字段（根 session 没有父，该字段无意义）。

### 3. 配置合成（session 创建时结算，结果固化入存储）

**从 main session fork（产出 regular session）：**

```
sessionDefaults → ForkProfile → EngineForkOptions
```

不从 main session 继承配置——main session 与 regular session 类型不同（integrate vs consolidate）。

**从 regular session fork（产出 regular session）：**

```
sessionDefaults → 父 regular session 的固化 SessionConfig → ForkProfile → EngineForkOptions
```

字段级覆盖，后者赢。`systemPrompt` 的合成走 `systemPromptMode` 规则。

**固化语义**：session 创建时结算一次，写入存储。`sessionDefaults` 之后修改不影响已创建的 session。这与 CLAUDE.md 设计决策 #4（回调一次性注入）和 #8（fork 一次性继承后独立）一致。

---

## StelloAgentConfig 调整

### 新增字段

```typescript
interface StelloAgentConfig {
  sessions: SessionTree
  memory: MemoryEngine
  sessionDefaults?: SessionConfig          // 新增：regular session 的配置基线
  mainSessionConfig?: MainSessionConfig    // 新增：main session 独立配置
  capabilities: StelloAgentCapabilitiesConfig
  session?: StelloAgentSessionConfig       // 调整：见下
  runtime?: StelloAgentRuntimeConfig
  orchestration?: StelloAgentOrchestrationConfig
}
```

### `StelloAgentSessionConfig` 职责收窄

从"适配层（resolver + serializer + parser）"收窄为**纯 I/O 数据加载器**：

```typescript
// 旧
interface StelloAgentSessionConfig {
  sessionResolver?: (id: string) => Promise<SessionCompatible>  // 构造 + 加载
  mainSessionResolver?: () => Promise<MainSessionCompatible>    // 构造 + 加载
  compressFn?: SessionCompatibleCompressFn                      // 移到 sessionDefaults
  serializeSendResult?: (result) => string
  toolCallParser?: ToolCallParser
  options?: Record<string, unknown>
}

// 新
interface StelloAgentSessionConfig {
  sessionLoader?: (id: string) => Promise<{ config: SessionConfig; meta: SessionMeta }>
  mainSessionLoader?: () => Promise<{ config: MainSessionConfig; meta: SessionMeta } | null>
  serializeSendResult?: (result) => string
  toolCallParser?: ToolCallParser
}
```

`compressFn` 移到 `sessionDefaults` / `mainSessionConfig`。

框架在 `enterSession(id)` 时：
1. 调 `sessionLoader(id)` 读取固化 config + meta
2. 如果 session 不存在（首次），用 `sessionDefaults` 结算 config，写入存储
3. 用 config 构造 Session 实例（不再需要应用层在 resolver 闭包里手写构造）

---

## SessionMeta 清理

### 删除字段

| 字段 | 原因 |
|------|------|
| `scope` | 从未进入 LLM 上下文；应用层需要约束 LLM 行为应走 `systemPrompt` |
| `tags` | 无框架功能；纯存储元数据，应用层可自行管理 |
| `metadata` | 框架保留字段迁移后无剩余用途 |

### 框架保留字段迁移

| 原来 | 新位置 |
|------|--------|
| `metadata._stello.allowedSkills` | 固化 `SessionConfig.skills`，fork 时结算 |
| `metadata.sourceSessionId` | 升为 `TopologyNode.sourceSessionId` 一等字段 |

**`sourceSessionId` 的语义**：fork 时的上下文来源 session ID。当 `topologyParentId` 被显式覆盖时，拓扑父节点与上下文来源可以不同，两者均需保留。

### 新 SessionMeta

```typescript
interface SessionMeta {
  readonly id: string
  label: string
  status: SessionStatus
  turnCount: number
  createdAt: string
  updatedAt: string
  lastActiveAt: string
}
```

### TopologyNode 新增字段

```typescript
interface TopologyNode {
  id: string
  parentId: string | null
  children: string[]
  refs: string[]
  depth: number
  index: number
  label: string
  sourceSessionId?: string    // 新增：fork 时的上下文来源 session
}
```

---

## Main Session 生命周期

Main session 是 Agent 的起始节点，不通过 `forkSession` 创建，需要显式初始化：

```typescript
// 新 API：替代直接操作 sessions.createRoot()
const mainNode = await agent.createMainSession({ label: 'Main' })

// 之后正常使用
await agent.enterSession(mainNode.id)
await agent.turn(mainNode.id, '...')
```

框架在 `createMainSession` 时用 `mainSessionConfig` 结算 config 并固化。

---

## 与已有设计决策的关系

| CLAUDE.md 决策 | 对应 |
|----------------|------|
| #4 回调一次性注入，immutable config | Session 创建时固化，不可热更新 |
| #8 fork 一次性继承后独立 | fork 时结算，之后不追溯父变化 |
| #10 Session 与树结构解耦 | SessionMeta 不含 parentId/depth，拓扑由 TopologyNode 独立维护 |
| #13 内置 tool 统一走 CompositeToolRuntime | 不变，skills 白名单由固化 SessionConfig.skills 提供 |
| #14 Fork = 创建拓扑节点 + Session | 不变，sourceSessionId 升入 TopologyNode |

---

## 暂缓事项

**LLM 采样 / 推理参数归属**（见 issue #54）：`temperature / top_p / thinking / reasoning_effort` 等字段是放入 `SessionConfig` 还是 `LLMAdapter` 有待决策，本 RFC 暂不覆盖。
