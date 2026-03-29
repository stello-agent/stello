# Stello SDK v0.2 全新架构设计文档

> 本文档是 v0.2 重构实现的唯一参考。所有已确认的设计决策在此记录，不再在实现过程中重新讨论。
>
> 状态：**设计完成，待实现**（2026-03-21）

---

## 目录

1. [设计背景与目标](#1-设计背景与目标)
2. [核心理念 — 技能隐喻](#2-核心理念--技能隐喻)
3. [新三层记忆模型](#3-新三层记忆模型)
4. [三层组件架构](#4-三层组件架构)
5. [StorageAdapter — 存储语义抽象](#5-storageadapter--存储语义抽象)
6. [LLMAdapter — LLM 接口](#6-llmadapter--llm-接口)
7. [执行周期与回调设计](#7-执行周期与回调设计)
8. [Session 上下文构成规则](#8-session-上下文构成规则)
9. [Main Session 机制](#9-main-session-机制)
10. [ConsolidateFn / IntegrateFn 设计](#10-consolidatefn--integratefn-设计)
11. [引擎配置接口（应用层视角）](#11-引擎配置接口应用层视角)
12. [使用示例 — 留学申请助手](#12-使用示例--留学申请助手)
13. [与 v0.1 的对比](#13-与-v01-的对比)
14. [设计决策记录 & 待实现项](#14-设计决策记录--待实现项)

---

## 1. 设计背景与目标

### v0.1 的已知问题

v0.1 在功能层面已经跑通，但架构上存在以下明确问题：

| 问题 | 描述 |
|------|------|
| **FS 隐喻泄漏** | `FileSystemAdapter` 暴露文件路径语义（`readJSON(path)`、`readFile(path)`），DB 实现难以做到自然映射 |
| **`callLLM: string→string`** | 接口过于简陋，不支持消息数组、工具调用、流式输出，无法适配现代 LLM API |
| **每轮 2 次 LLM 开销** | `afterTurn` 在每轮对话中同步调用 LLM 更新 L2，带来不必要的延迟和成本 |
| **无 Main Session** | 没有全局意识层，多个子 Session 之间完全隔离，无法感知跨任务的依赖和冲突 |
| **无跨语言支持** | 纯 TS 嵌入式，Python、Go 等语言无法使用 |
| **仅 TS 嵌入式** | 无 SaaS 路径，无法支持多租户、服务端托管等部署模式 |

### v0.2 的核心目标

1. **零对话中 LLM 开销** — 用户对话期间不触发任何后台 LLM 调用，保持流畅体验
2. **双部署模式** — 支持本地嵌入（TS 直接使用）和 SaaS 多租户（HTTP 层包裹编排层）
3. **跨语言 SDK** — 通过 SaaS HTTP 层，Python / Go 等语言客户端可使用完整功能
4. **极高可扩展性** — L2 格式、整合策略、触发时机全部由应用层定义，框架无感知
5. **Main Session 作为全局意识层** — 能读取所有子 Session 的技能描述，发现跨任务的依赖和冲突

---

## 2. 核心理念 — 技能隐喻

v0.2 的根本设计理念是把每个子 Session 看作一个**技能（Skill）**，把 Main Session 看作**技能调用方（Orchestrator）**。

```
子 Session = Skill（技能）
  L3 = 技能的详细知识体（skill 内部消费，该 Session 的 LLM 直接读取）
  L2 = 技能的 description（外部接口，Main Session 消费）

Main Session = Skill 调用方（Orchestrator）
  读所有子 Session 的 L2 = 知道自己有哪些技能、每个能做什么
  有自己的 L3         = 自己的对话历史
  synthesis (L1-emergent) = 对整体拓扑的综合认知
```

这个隐喻决定了所有关键的设计约束：

**约束 1：L2 对子 Session 自身不可见**

L2 是"从外部看这个 Session 的描述"，不是给 Session 自己用的。
子 Session 的 LLM 永远不会在 system prompt 里看到自己的 L2。

**约束 2：Main Session 只读 L2，不读子 Session 的 L3**

Main Session 是 Orchestrator，它需要知道每个 Skill 的能力描述（L2），
不需要也不应该直接读取每个 Skill 的内部对话细节（L3）。

**约束 3：子 Session 对其他 Session 完全不感知**

子 Session 看不到其他子 Session 的存在。唯一的跨 Session 信息来源是
Main Session 通过 integration cycle 定向推送的 insights。

这三个约束共同实现了清晰的信息边界：技能自治，Orchestrator 统筹，定向通信。

---

## 3. 新三层记忆模型

### 层级定义

与 v0.1 的核心差别在于 L2 的语义彻底改变：

| 层 | v0.1 语义 | v0.2 语义 | 消费者 |
|----|-----------|-----------|--------|
| **L3** | 原始对话记录（JSONL） | 原始对话记录（不变） | 该 Session 自身的 LLM |
| **L2** | Session 工作记忆（per turn 更新） | Session 技能描述（会话结束后批量生成） | Main Session 的 LLM |
| **L1-structured** | 全局 core.json（schema 驱动） | 保留不变 | 应用层直接读写 |
| **L1-emergent** | 不存在 | Main Session 对所有 L2 的综合提炼 | Main Session 自身 |

**L2 语义变化的含义**：

- v0.1 的 L2 是"我记得我做了什么"（自用工作记忆），每轮更新，子 Session 自己读
- v0.2 的 L2 是"我能做什么、做到了哪一步"（技能描述），结束后批量生成，Main Session 读

格式完全由应用层定义。可以是 Markdown 摘要，也可以是结构化 JSON（见第 12 节示例）。

### LLM 开销对比

| 时机 | v0.1 | v0.2 |
|------|------|------|
| 对话中（per turn） | **2 次 LLM**（L2 更新 + L1 提取） | **0 次** |
| Session 结束/切换后 | 无 | **1 次**（L2 consolidation） |
| Main Session 整合时 | 不存在 | **1 次**（integration cycle） |

对话中零 LLM 开销是 v0.2 最重要的特性，直接影响用户体验。

---

## 4. 三层组件架构

### 职责分层

核心思想：职责按"原语 / 编排 / 应用"三层严格分离，每层只向下依赖。

```
┌─────────────────────────────────────────────────────────────┐
│  应用层（Application Layer）                                  │
│                                                               │
│  开发者提供：                                                 │
│  · StorageAdapter 实例（文件系统或数据库）                    │
│  · LLMAdapter 实例（OpenAI、Anthropic 等）                    │
│  · system prompt（全局，所有 Session 共享）                   │
│  · ConsolidateFn（L3 → L2 的转换逻辑）                       │
│  · IntegrateFn（all L2s → synthesis + insights）              │
│  · 触发时机配置（onSwitch / everyNTurns / manual 等）         │
├─────────────────────────────────────────────────────────────┤
│  编排层（Orchestration Layer）                                │
│                                                               │
│  框架提供，管理执行周期：                                     │
│  · turn() — 完整的对话轮次处理                               │
│  · 触发时机判断（shouldConsolidate / shouldIntegrate）        │
│  · 回调执行（fire-and-forget）                               │
│  · Main Session 感知与路由                                    │
│  · SplitPolicy 检查与提案                                     │
│  · 事件发射（error / splitProposal / coreChange）             │
├─────────────────────────────────────────────────────────────┤
│  Session 层（Session Layer）                                  │
│                                                               │
│  框架提供，管理存储原语：                                     │
│  · Session CRUD（getSession / putSession / listSessions）     │
│  · L3 记录读写（appendRecord / listRecords）                  │
│  · L2 记忆读写（getMemory / putMemory）                       │
│  · Per-session 文档读写（getDoc / putDoc）                    │
│  · 全局状态读写（getGlobal / putGlobal）                      │
└─────────────────────────────────────────────────────────────┘
                         ↑ 依赖注入
          ┌──────────────────────┐  ┌──────────────────────┐
          │   StorageAdapter     │  │    LLMAdapter        │
          │  （应用层实现）       │  │  （应用层实现）       │
          └──────────────────────┘  └──────────────────────┘
```

### SaaS 部署模型

```
Session Layer + Orchestration Layer = @stello-ai/core（本地嵌入，TS 直接使用）
                     ↓ 编排层之上包 HTTP 服务
             @stello-ai/server（SaaS，多租户，Postgres StorageAdapter）
                     ↓ HTTP API（REST / WebSocket）
        多语言客户端 SDK（TypeScript / Python / Go）
```

关键点：编排层本身与存储无关，包裹 HTTP 层后天然实现跨语言支持。

---

## 5. StorageAdapter — 存储语义抽象

### 设计原则

`StorageAdapter` 替代 v0.1 的 `FileSystemAdapter`，核心改变是从**文件路径语义**改为**业务语义**。

v0.1 的问题：
```typescript
// ❌ FS 语义泄漏：DB 实现需要假装自己是文件系统
adapter.readJSON('sessions/abc123/meta.json')
adapter.readFile('sessions/abc123/memory.md')
```

v0.2 的改变：
```typescript
// ✅ 业务语义：DB 实现直接映射到表字段
storage.getSession('abc123')
storage.getMemory('abc123')
storage.getDoc('abc123', 'scope')
```

### 完整接口（伪代码）

**Session 实体操作**

```
getSession(id: string): Promise<SessionMeta | null>
putSession(session: SessionMeta): Promise<void>
listSessions(filter?: {
  parentId?: string | null
  role?: 'standard' | 'main'
  status?: 'active' | 'archived'
  tags?: string[]
  limit?: number
}): Promise<SessionMeta[]>
```

**L3 对话记录**

```
appendRecord(sessionId: string, record: TurnRecord): Promise<void>
listRecords(sessionId: string, options?: {
  limit?: number
  fromTurn?: number
}): Promise<TurnRecord[]>
```

**L2 记忆**（独立于 getDoc，便于 DB 层优化索引）

```
getMemory(sessionId: string): Promise<string | null>
putMemory(sessionId: string, content: string): Promise<void>
```

**Per-session 文档**（语义键，非文件名）

```
getDoc(sessionId: string, key: string): Promise<string | null>
putDoc(sessionId: string, key: string, content: string): Promise<void>
```

内置 key 常量：

```
DOC_KEYS = {
  SCOPE:    'scope',     // 对话边界定义
  INSIGHTS: 'insights',  // Main Session 推送的洞察
  INDEX:    'index',     // 子节点目录（框架自动维护）
}
```

**关键说明**：`getDoc` 的 key 是业务语义标识符，不是文件名。
`'scope'` 而非 `'scope.md'`。DB 实现对应 `session_docs(session_id, key, content)` 表，
文件系统实现内部自行拼接路径（如 `sessions/{id}/scope.md`），上层不感知。

**全局状态**（L1-structured，对应 v0.1 的 core.json）

```
getGlobal(key: string): Promise<unknown>
putGlobal(key: string, value: unknown): Promise<void>
```

**事务**

```
transaction<T>(fn: (tx: StorageAdapter) => Promise<T>): Promise<T>
```

事务在 DB 实现中映射为数据库事务；文件系统实现可提供 best-effort 语义（不强制原子性）。

---

## 6. LLMAdapter — LLM 接口

### 接口定义（伪代码）

**基础类型**

```
LLMMessage:
  role: 'system' | 'user' | 'assistant'
  content: string

ToolCall:
  id: string
  name: string
  arguments: Record<string, unknown>

LLMRequest:
  messages: LLMMessage[]
  tools?: ToolDefinition[]        // function calling / tool use
  temperature?: number
  maxTokens?: number
  expectJSON?: boolean            // 提示 LLM 输出 JSON，便于 consolidateFn 解析

LLMResponse:
  content: string | null
  toolCalls?: ToolCall[]
  usage?: { promptTokens: number, completionTokens: number }
```

**适配器接口**

```
LLMAdapter:
  complete(request: LLMRequest): Promise<LLMResponse>
  stream?(request: LLMRequest): AsyncIterable<LLMStreamChunk>  // 可选，SaaS 场景
```

**多 tier 配置**

```
LLMConfig:
  default: LLMAdapter    // 通用（子 Session 对话、工具调用）
  fast?: LLMAdapter      // L2 consolidation（省略则用 default）
  strong?: LLMAdapter    // Main Session integration（省略则用 default）
```

tier 路由由编排层负责：调 consolidateFn 时传入 fast tier，调 integrateFn 时传入 strong tier。
应用层不需要自己判断 tier 选择。

---

## 7. 执行周期与回调设计

### turn() 完整执行流程

```
turn(sessionId: string, input: string): Promise<TurnResult>
  │
  ├─ 1. 组装上下文（规则见第 8 节）
  │
  ├─ 2. LLM 完整调用（含 tool call 循环，直到无 tool call 为止）
  │
  ├─ 3. 写入 L3（appendRecord，同步）
  │
  ├─ 4. 触发 afterTurn 回调（fire-and-forget）
  │       └─ 应用层可在此做轻量日志、统计等
  │
  ├─ 5. 检查 consolidation 时机
  │       └─ shouldConsolidate(session) → true
  │             → 启动 consolidation（fire-and-forget）
  │                  → consolidateFn(session, records, prevMemory, fastLLM)
  │                  → putMemory(sessionId, result)
  │                  → emit('consolidate', { sessionId })
  │
  ├─ 6. 检查 integration 时机
  │       └─ shouldIntegrate() → true
  │             → 启动 integration（fire-and-forget）
  │                  → integrateFn(mainSession, subSessions, prevSynthesis, strongLLM)
  │                  → putMemory(mainId, synthesis)
  │                  → foreach insights: putDoc(targetId, 'insights', content)
  │                  → emit('integrate', { mainSessionId })
  │
  └─ 7. 返回 TurnResult { content, toolCalls?, sessionId }
```

### 回调分类

| 类型 | 示例 | 特性 |
|------|------|------|
| **Fire-and-forget 回调** | afterTurn、consolidateFn、integrateFn | 异步副作用，不阻塞 turn() 返回 |
| **决策回调（同步）** | shouldConsolidate、shouldIntegrate | 轻量判断，同步执行 |
| **Awaited 回调** | 无 | 所有记忆操作均为异步副作用 |

### 触发时机配置

编排层内置时机类型，应用层选择配置：

```
consolidateTrigger:
  'onSwitch'              // 切换离开此 Session 时
  { type: 'everyNTurns', n: number }  // 每 N 轮
  'onArchive'             // 归档时
  'manual'                // 不自动触发，应用层手动调用

integrateTrigger:
  'onL2Update'            // 任何子 Session 的 L2 更新后
  'onSwitch'              // 切换到 Main Session 时
  { type: 'everyNTurns', n: number }
  'manual'
```

### 错误处理

**原则**：回调失败不中断对话周期，只降低记忆质量。

```
回调抛出异常
  → emit('error', { source: 'consolidate' | 'integrate' | 'afterTurn', error })
  → 编排层继续正常执行
  → 下次触发时重试（或 manual 重试）
```

对话永远不会因为记忆系统的问题崩溃。

### 回调注入方式

回调在引擎创建时**一次性注入**（immutable config）：

```typescript
const engine = createEngine({
  consolidate: { trigger: 'onSwitch', fn: myConsolidateFn },
  mainSession: { integrate: { trigger: 'onSwitch', fn: myIntegrateFn } },
  // ...
})
```

选择一次性注入的原因：设计简单，无运行时状态变化，测试容易。
未来如需动态配置（如 A/B 测试），可以加 setter，这是加法操作，不破坏现有接口。

---

## 8. Session 上下文构成规则

v0.2 去掉了 `assemble()` 钩子，改为**固定规则 + 可配置参数**。规则明确，消除了 v0.1 中
钩子行为不透明的问题。

### 子 Session 的 LLM 输入

```
messages: [
  {
    role: 'system',
    content:
      全局 system prompt（应用层提供，所有 Session 共享）
      + （如有）main_insights：Main Session 推送给此 Session 的洞察
  },
  // 最近 N 轮 L3 记录（N 可配置，默认 20）
  { role: 'user', content: '...' },
  { role: 'assistant', content: '...' },
  ...当前输入
]
```

**不包含**：
- 该 Session 自己的 L2（L2 是外部描述，子 Session 永远看不到）
- 父 Session 的 memory.md（v0.1 的"父链继承"在 v0.2 中去掉，改为 Main Session 定向推送）
- 其他子 Session 的任何信息

### Main Session 的 LLM 输入

```
messages: [
  {
    role: 'system',
    content:
      全局 system prompt
      + 所有子 Session 的 L2（技能清单，仅包含已完成 consolidation 的 Session）
      + synthesis（L1-emergent，上次 integration 的综合认知）
  },
  // Main Session 自己的最近 N 轮 L3 记录
  { role: 'user', content: '...' },
  { role: 'assistant', content: '...' },
  ...当前输入
]
```

子 Session L2 的 token budget 由 integrateFn 内部管理（integrateFn 知道 L2 格式，
知道如何截断或摘要），编排层不介入。

### 关键设计决策

**"进行中 Session 对 Main Session 是盲的"**

Integration 时，只有已完成 consolidation 的 Session 才有 L2。正在进行中的 Session 没有 L2，
对 Main Session 暂时不可见。

这是有意为之的取舍：**换取零对话中 LLM 开销**。接受这个盲区，意味着 Main Session 看到的
是每个 Skill 上一次总结后的状态，而不是实时状态。对绝大多数应用场景，这个延迟是可以接受的。

---

## 9. Main Session 机制

### 角色标记

`SessionMeta` 新增字段：

```
role: 'standard' | 'main'   // 默认 'standard'
consolidatedTurn: number     // 最后一次 consolidation 时的 turnCount，用于增量整合
```

一个拓扑只允许一个 `role: 'main'` 的 Session。

### Main Session 的存储槽位

Main Session 使用与子 Session 相同的存储接口，但语义不同：

| 槽位 | 存储调用 | 内容 |
|------|----------|------|
| L3（自身对话记录） | `appendRecord(mainId, ...)` | Main Session 与用户的对话历史 |
| synthesis（L1-emergent） | `getMemory(mainId)` / `putMemory(mainId, ...)` | Integration 的输出，综合认知 |
| insights（无） | 不存在 | Main Session 没有更高层向它推送 |

注意：synthesis 存在 `getMemory(mainId)` 槽，与子 Session 的 L2 使用相同接口，
但语义是"Main Session 自己的综合认知"，不是"Main Session 的技能描述"。

### Integration Cycle 详细流程

```
integrateFn 输入：
  mainSession: SessionMeta
  subSessions: Array<{
    meta: SessionMeta
    memory: string    // 子 Session 的 L2（仅包含已有 L2 的 Session）
  }>
  previousSynthesis: string | null
  llm: LLMAdapter（strong tier）

integrateFn 输出：
  synthesis: string              → putMemory(mainId, synthesis)
  insights: Array<{
    targetSessionId: string
    content: string              → putDoc(targetId, DOC_KEYS.INSIGHTS, content)
  }>
```

**insights 更新策略：替换（不追加）**

每次 integration 输出最新完整判断，旧 insights 自动过期被覆盖。
理由：旧洞察基于旧状态，随时间失效；新洞察总是最新的完整视角。

---

## 10. ConsolidateFn / IntegrateFn 设计

### ConsolidateFn（L3 → L2）

```
type ConsolidateFn = (params: {
  session: SessionMeta
  records: TurnRecord[]          // 待整合的 L3（可全量或增量，取决于 consolidatedTurn）
  previousMemory: string | null  // 上一份 L2（增量整合时用于保持连续性）
  llm: LLMAdapter                // 编排层注入 fast tier
}) => Promise<string>            // 返回新的 L2 内容，格式由应用定义
```

### IntegrateFn（all L2s → synthesis + insights）

```
type IntegrateFn = (params: {
  mainSession: SessionMeta
  subSessions: Array<{ meta: SessionMeta, memory: string }>
  previousSynthesis: string | null
  llm: LLMAdapter                // 编排层注入 strong tier
}) => Promise<{
  synthesis: string
  insights: Array<{ targetSessionId: string, content: string }>
}>
```

### 配对函数约束

**ConsolidateFn 和 IntegrateFn 是配对函数**，共享对 L2 格式的理解：
- ConsolidateFn 输出某种格式的 L2
- IntegrateFn 读取并解析该格式的 L2

两者均由应用层提供，框架对 L2 内容格式**完全无感知**。
框架提供内置默认实现（Markdown 摘要格式），开发者可完全替换为自己的实现。

### 增量整合

当 `consolidateTrigger: { type: 'everyNTurns', n: 5 }` 时，
编排层传入 `records` 为自上次 consolidation 以来的新记录（通过 `consolidatedTurn` 追踪），
同时传入 `previousMemory`。ConsolidateFn 可选择增量追加或重新全量生成。

---

## 11. 引擎配置接口（应用层视角）

```
StelloEngineConfig:

  // ─── 必须 ───
  storage: StorageAdapter
  llm: LLMAdapter | { default: LLMAdapter, fast?: LLMAdapter, strong?: LLMAdapter }
  systemPrompt: string | (() => Promise<string>)

  // ─── 记忆策略 ───
  consolidate:
    trigger:
      'onSwitch'
      | { type: 'everyNTurns', n: number }
      | 'onArchive'
      | 'manual'
    fn?: ConsolidateFn          // 不提供则用内置 Markdown 摘要实现

  // ─── Main Session（不配置则无 Main Session） ───
  mainSession?:
    sessionId?: string          // 指定已有 Session 作为 Main Session
    auto?: { label: string }    // 不指定则自动创建（二选一）
    integrate:
      trigger:
        'onL2Update'
        | 'onSwitch'
        | { type: 'everyNTurns', n: number }
        | 'manual'
      fn?: IntegrateFn

  // ─── 拆分策略 ───
  splitPolicy?:
    minTurns?: number           // 默认 3
    cooldownTurns?: number      // 默认 5
    evaluate?: (session: SessionMeta, proposal: SplitProposal) => Promise<boolean>

  // ─── L1-structured（保留 v0.1 core.json 能力） ───
  coreSchema?: CoreSchemaField[]

  // ─── 上下文窗口 ───
  contextWindow?:
    maxTurns?: number           // 默认 20
```

---

## 12. 使用示例 — 留学申请助手

本节是文档最重要的章节，完整演示所有机制在真实场景中如何协作。
每个机制点都能在前面的架构章节中找到对应设计。

### 场景描述

用户正在规划美国 CS PhD 申请，需要同时处理选校、文书、推荐信、时间规划等多个并行任务。
每个任务有独立的深度对话 Session，Main Session 作为整体规划师，
发现跨任务的时间冲突和依赖关系。

### Session 拓扑

```
Main Session: "留学申请规划师"
├── Session A: "选校方向讨论"
├── Session B: "个人陈述润色"
├── Session C: "推荐信管理"
└── Session D: "时间规划与 DDL"
```

### 应用定义的 L2 格式

针对此场景，应用层定义 JSON 结构的 L2（Planner 专用格式）：

```json
{
  "focus": "Session 的核心主题",
  "status": "分析中 | 进行中 | 待确认 | 完成",
  "key_deadlines": [
    { "item": "SOP初稿", "date": "2026-11-15" }
  ],
  "blocking": "当前阻塞原因（如有，否则 null）",
  "dependencies": ["Session A 的选校结果"],
  "key_decisions": ["决定申请 CS PhD，不考虑 Master"]
}
```

### 各 Session 的 L2 内容（consolidation 后）

**Session A（选校方向）**：
```json
{
  "focus": "CS PhD选校策略",
  "status": "分析中",
  "key_deadlines": [{ "item": "提交申请", "date": "2026-12-01" }],
  "blocking": null,
  "dependencies": [],
  "key_decisions": ["倾向top10 CS项目，以研究方向匹配为主要标准"]
}
```

**Session B（个人陈述）**：
```json
{
  "focus": "SOP撰写与润色",
  "status": "进行中",
  "key_deadlines": [{ "item": "SOP初稿", "date": "2026-11-15" }],
  "blocking": "等待选校方向最终确认",
  "dependencies": ["Session A 的选校结果"],
  "key_decisions": []
}
```

**Session C（推荐信）**：
```json
{
  "focus": "推荐信跟进与管理",
  "status": "待确认",
  "key_deadlines": [{ "item": "推荐信提交", "date": "2026-11-30" }],
  "blocking": "B教授尚未回复确认意愿",
  "dependencies": [],
  "key_decisions": ["已联系3位潜在推荐人"]
}
```

**Session D（时间规划）**：
```json
{
  "focus": "申请时间轴与DDL管理",
  "status": "进行中",
  "key_deadlines": [
    { "item": "选校确认", "date": "2026-11-08" },
    { "item": "SOP初稿", "date": "2026-11-15" },
    { "item": "推荐信提交", "date": "2026-11-30" },
    { "item": "提交申请", "date": "2026-12-01" }
  ],
  "blocking": null,
  "dependencies": [],
  "key_decisions": []
}
```

### ConsolidateFn 实现（示意）

```typescript
const studyAbroadConsolidateFn: ConsolidateFn = async ({
  session, records, previousMemory, llm
}) => {
  const response = await llm.complete({
    messages: [
      {
        role: 'system',
        content: `分析以下对话，以 JSON 格式输出这个 session 的关键信息。
字段说明：
- focus: 核心讨论主题（一句话）
- status: "分析中" | "进行中" | "待确认" | "完成"
- key_deadlines: 提到的截止日期列表（item + date）
- blocking: 当前阻塞原因，无则 null
- dependencies: 依赖哪些其他 session 的结论（字符串列表）
- key_decisions: 已做的关键决策（字符串列表）

${previousMemory ? `上次总结供参考：\n${previousMemory}\n` : ''}`,
      },
      {
        role: 'user',
        content: `对话记录：\n${records.map(r => `[${r.role}]: ${r.content}`).join('\n')}`,
      },
    ],
    expectJSON: true,
  })
  return response.content ?? '{}'
}
```

### IntegrateFn 触发场景

用户从 Session B（文书）切换回 Main Session 时，触发 integration。

**步骤 1**：编排层收集所有已有 L2 的子 Session，调用 integrateFn。

**步骤 2**：Main Session 的 LLM（strong tier）分析所有 L2，发现：
- Session B 的 `blocking: "等待选校方向"` + Session A 的 `status: "分析中"` — 存在阻塞链
- Session C 的推荐信 DDL（11/30）逻辑上需要 Session B 文书先完成选校定制（11/15），
  而 Session A 的选校需要在 11/08 前确认才能保障后续流程
- B 教授未回复，推荐信存在不确定性风险

**步骤 3**：integrateFn 输出：

```typescript
const studyAbroadIntegrateFn: IntegrateFn = async ({
  mainSession, subSessions, previousSynthesis, llm
}) => {
  const subL2Summary = subSessions
    .map(s => `=== ${s.meta.label} ===\n${s.memory}`)
    .join('\n\n')

  const response = await llm.complete({
    messages: [
      {
        role: 'system',
        content: `你是留学申请规划助手。分析各个对话 session 的状态，
输出：
1. synthesis: 对整体申请进度的综合判断（重点关注风险和阻塞）
2. insights: 给每个 session 的定向建议（session_id + 内容）

以 JSON 格式输出。

${previousSynthesis ? `上次综合判断供参考：\n${previousSynthesis}\n` : ''}`,
      },
      { role: 'user', content: subL2Summary },
    ],
    expectJSON: true,
  })

  // 解析 JSON 输出
  const result = JSON.parse(response.content ?? '{}')
  return {
    synthesis: result.synthesis,
    insights: result.insights,
  }
}
```

**integrateFn 实际输出示例**：

```json
{
  "synthesis": "选校分析未完成，直接阻塞文书定制化进展（B阻塞A）。推荐信存在不确定风险（B教授未回复）。各DDL整体可行，但选校决策必须在11月8日前完成，否则11月15日的SOP初稿DDL将无法满足。关键路径：A→B→提交申请。",

  "insights": [
    {
      "targetSessionId": "session-a",
      "content": "注意：文书Session（SOP初稿DDL: 11/15）正等待选校结果，当前是关键瓶颈。按倒推时间轴，选校决策最晚需在11/8前完成，请优先推进。"
    },
    {
      "targetSessionId": "session-b",
      "content": "选校仍在分析中（预计11/8前完成）。建议现在先完成SOP通用框架部分，预留1周时间做定制化调整。"
    },
    {
      "targetSessionId": "session-c",
      "content": "B教授推荐信尚无确认，建议本周内跟进并同步考虑备选推荐人。时间规划Session已将此标注为风险项。"
    },
    {
      "targetSessionId": "session-d",
      "content": "建议在时间轴中明确标注选校决策节点（11/8），这是当前整个申请流程的关键依赖点。"
    }
  ]
}
```

### 用户与 Main Session 对话示例

```
[用户] → Main Session: "我的申请进展怎么样？最大的风险是什么？"
```

Main Session 的 LLM 看到的 system context：

```
[system]
你是一个专注于美国CS研究生申请的规划助手，帮助学生系统地规划和推进申请流程。

--- 当前各任务状态 ---
=== 选校方向讨论 ===
{ "focus": "CS PhD选校策略", "status": "分析中", ... }

=== 个人陈述润色 ===
{ "focus": "SOP撰写与润色", "status": "进行中", "blocking": "等待选校方向最终确认", ... }

=== 推荐信管理 ===
{ "focus": "推荐信跟进与管理", "status": "待确认", "blocking": "B教授尚未回复", ... }

=== 时间规划与 DDL ===
{ "focus": "申请时间轴与DDL管理", "status": "进行中", ... }

--- 综合判断 ---
选校分析未完成，直接阻塞文书定制化进展...
```

Main Session LLM 回复：

```
目前申请整体方向清晰，但有两个需要立刻关注的风险：

1. **选校决策是当前关键瓶颈**（最高优先级）
   SOP那边在等你确定学校才能做定制化，按截止日期倒推，
   选校需要在11月8日前完成，还有约6周时间。

2. **B教授推荐信不确定**
   目前B教授还没有回复确认意愿，推荐信截止是11月30日，
   建议这周就跟进，并准备一个备选推荐人方案。

其他方面进展正常。你想先深入讨论选校的决策框架，还是先把推荐信的问题处理掉？
```

### 子 Session 收到 insights 后的对话示例

用户切换到 Session A（选校），继续讨论：

```
[用户] → Session A（选校）: "我在 MIT 和 Stanford 之间很纠结，不知道怎么选"
```

Session A 的 LLM 看到的 system context：

```
[system]
你是一个专注于美国CS研究生申请的规划助手，帮助学生系统地规划和推进申请流程。

--- 来自规划师的提示 ---
注意：文书Session（SOP初稿DDL: 11/15）正等待选校结果，当前是关键瓶颈。
按倒推时间轴，选校决策最晚需在11/8前完成，请优先推进。
```

Session A LLM 回复：

```
MIT 和 Stanford 都是顶尖选择，这个纠结完全正常。

需要提醒一下时间方面：文书那边目前在等你的选校决定，
按截止日期推算，我们这边大约有6周时间，建议3-4周内完成决策，
留出足够时间给SOP做定制化。

我们可以从几个维度来系统比较：研究方向匹配度、导师匹配情况、校园文化偏好...
你最看重哪个方面？
```

### 完整引擎配置代码

```typescript
import { createEngine, FileSystemStorageAdapter } from '@stello-ai/core'
import { OpenAIAdapter } from '@stello-ai/adapters'

const engine = createEngine({
  storage: new FileSystemStorageAdapter('./study-abroad-data'),
  llm: {
    default: new OpenAIAdapter('gpt-4o'),
    strong: new OpenAIAdapter('o1'),          // integration 用 o1 做深度推理
  },
  systemPrompt:
    '你是一个专注于美国CS研究生申请的规划助手，帮助学生系统地规划和推进申请流程。',

  consolidate: {
    trigger: 'onSwitch',                      // 切换离开时整合 L2
    fn: studyAbroadConsolidateFn,             // 输出 JSON 格式 L2
  },

  mainSession: {
    auto: { label: '留学申请规划师' },         // 自动创建 Main Session
    integrate: {
      trigger: 'onSwitch',                    // 切换到 Main Session 时触发 integration
      fn: studyAbroadIntegrateFn,             // 理解 JSON L2，检测冲突，生成 insights
    },
  },

  splitPolicy: {
    minTurns: 3,
    cooldownTurns: 5,
  },

  contextWindow: {
    maxTurns: 30,
  },
})
```

---

## 13. 与 v0.1 的对比

| 维度 | v0.1 | v0.2 |
|------|------|------|
| **记忆模型** | L2 是 Session 自用工作记忆（per turn 更新） | L2 是技能描述（外部视角，结束后生成） |
| **对话中 LLM 开销** | 每轮 2 次 LLM | **0 次** |
| **子 Session 上下文** | L3 + L2（自用）+ 父链继承 + core.json | L3 + main_insights（干净隔离） |
| **Main Session** | 不存在 | 全局意识层，可直接对话 |
| **横向感知** | 无 | Main → 定向 push insights |
| **存储抽象** | `FileSystemAdapter`（FS 路径语义） | `StorageAdapter`（业务语义，支持事务） |
| **LLM 接口** | `callLLM: string → string` | `LLMAdapter`（消息数组、工具调用、流式） |
| **扩展性** | `LifecycleHooks`（部分可覆盖） | 三层回调（全部可自定义，格式无感知） |
| **跨语言** | 否（TS 嵌入式） | SaaS HTTP 层 + 多语言客户端 SDK |
| **部署模式** | 本地嵌入 | 本地嵌入 + SaaS 多租户 |

### v0.1 痛点如何被 v0.2 解决

| v0.1 痛点 | v0.2 解决方案 |
|-----------|--------------|
| 每轮 2 次 LLM 开销 | L2 改为 consolidation 时批量生成，对话中零 LLM 开销 |
| FS 语义泄漏难以适配 DB | StorageAdapter 使用业务语义 key，DB 实现直接映射到表字段 |
| `callLLM: string→string` 过于简陋 | LLMAdapter 支持消息数组、工具调用、流式、多 tier |
| 无全局意识层 | Main Session 作为 Orchestrator，读取所有子 Session L2 |
| 无跨 Session 感知 | Integration cycle + 定向 insights push |
| 仅 TS 嵌入式 | Session Layer + Orchestration Layer 可包 HTTP 服务，实现跨语言 |

---

## 14. 设计决策记录 & 待实现项

### 已确认的设计决策（不再讨论）

以下决策在本轮架构讨论中已经确认，实现时直接遵循，不需要重新评估：

1. **L2 对子 Session 自身不可见** — L2 是外部描述，子 Session 永远看不到自己的 L2
2. **Main Session 只读 L2，不读子 Session 的 L3** — 技能调用方只看接口，不看实现细节
3. **insights 采用替换策略（不追加）** — 每次 integration 给出最新完整判断，旧洞察自动过期
4. **回调一次性注入（immutable config）** — 简单无状态，测试友好，需动态配置时后续加 setter
5. **turn() 在编排层，SaaS server 调编排层** — 编排层与存储无关，天然支持包 HTTP
6. **consolidate/integrate 均 fire-and-forget** — 不阻塞对话，接受记忆质量异步更新
7. **错误处理：emit error，不中断对话周期** — 记忆降级但对话不崩溃
8. **"进行中 Session 对 Main Session 盲区"是有意为之的取舍** — 换取零对话中 LLM 开销

### 待实现项（按优先级排序）

以下是从当前 v0.1 代码到 v0.2 架构需要完成的具体实现任务，
对应 `packages/core/src/types/` 目录下的现有文件：

| 优先级 | 任务 | 涉及文件 | 说明 |
|--------|------|----------|------|
| 1 | 更新 `SessionMeta`：新增 `role`、`consolidatedTurn` | `types/session.ts` | 影响所有下游接口 |
| 2 | 定义 `StorageAdapter` 完整接口 | `types/storage.ts`（新建） | 替换 `types/fs.ts` |
| 3 | 实现 `FileSystemStorageAdapter` | `fs/`（重构） | 业务语义适配层 |
| 4 | 定义 `LLMAdapter` 完整接口 | `types/llm.ts`（新建） | 替换 `callLLM: string→string` |
| 5 | 定义 `ConsolidateFn` / `IntegrateFn` 签名 | `types/callbacks.ts`（新建） | 配对函数，含内置默认实现 |
| 6 | 重构 `StelloConfig` → `StelloEngineConfig` | `types/engine.ts` | 使用新接口，去掉 FS 字段 |
| 7 | 重构 `LifecycleManager` → `OrchestrationEngine` | `lifecycle/`（重构） | 引入回调机制，实现 turn() |
| 8 | 重写 Session 记忆模块 | `memory/`（重构） | 去掉 per-turn L2 更新，加 consolidation |
| 9 | 实现 Main Session integration cycle | `lifecycle/integration.ts`（新建） | 第 9 节的完整实现 |
| 10 | 编写迁移层（v0.1 → v0.2 向后兼容过渡） | `compat/`（新建，可选） | 降低升级成本 |
| 11 | 更新 154 个测试用例适配新接口 | `packages/core/src/__tests__/` | 接口变化后必须更新 |

### v0.1 降级项（仍然不实现）

以下项目在 v0.2 中同样不实现：

- L3 全文搜索
- compact 压缩逻辑（接口保留，实现留空）
- embedding 漂移检测（v0.2 去掉 embedder 依赖）
- scope 横向召回
- Canvas 动画
- Skill Pipeline 权限
- 时间轴回溯
- 多布局模式
