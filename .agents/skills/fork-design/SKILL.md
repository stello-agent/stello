---
name: fork-design
description: Fork 机制完整说明。覆盖 ForkProfile 与 EngineForkOptions 的字段对齐、四层 fallback 合成链（sessionDefaults → parent → profile → forkOptions）、systemPrompt 合成三种模式、skills 三态语义、持久化边界（SerializableSessionConfig 只固化 systemPrompt/skills）。任何涉及 fork / profile / stello_create_session / 配置合成 的工作都应读这个。
---

# Fork — 子 Session 创建机制

## 定位

Fork 是 Stello 创建子 Session 的唯一路径。编排层（Engine）负责完整编排：

1. 校验 profile 存在性
2. SplitGuard 拦截（可选）
3. 读取 sourceSession 的固化配置
4. 按四层链合成最终 SessionConfig
5. 创建拓扑节点（topology-first，先拿 ID）
6. 将可序列化子集固化入存储
7. 调用 `session.fork({ id, ... })` 创建 Session 实例
8. 触发 `onSessionFork` 事件

调用方不感知内部顺序。两条触发路径（LLM / 代码）共用这整套流程。

---

## 触发路径

| 触发者 | 入口 | 典型场景 |
|--------|------|---------|
| LLM | 内置 tool `stello_create_session` | LLM 判断当前任务需要拆分为子任务 |
| 应用层代码 | `agent.forkSession(sourceId, options)` | 代码驱动的主动编排（UI 按钮、策略脚本） |

两条路径汇聚到同一个 `forkSession(options: EngineForkOptions)`。LLM 路径只是在前面加了一层 JSON Schema 校验 + tool args → EngineForkOptions 映射。

---

## 类型体系

三个类型层层叠加，**共享同一个基座**。

### 基座：`SessionConfig`（6 字段）

所有 Session 运行时可配置项。由 `sessionDefaults`、父 session 固化 config、ForkProfile、EngineForkOptions 共同描述，`mergeSessionConfig` 输出也是这个形状。

| 字段 | 类型 | 说明 |
|------|------|------|
| `systemPrompt` | `string` | Session 的 system prompt |
| `llm` | `LLMAdapter` | LLM 适配器 |
| `tools` | `LLMCompleteOptions['tools']` | 用户 tool 定义 |
| `skills` | `string[]` | skill 白名单（三态语义见下文） |
| `consolidateFn` | `SessionCompatibleConsolidateFn` | L3→L2 提炼函数 |
| `compressFn` | `SessionCompatibleCompressFn` | 上下文压缩函数 |

### `ForkProfile extends SessionConfig`

预注册的 fork 配置模板，注册期定义。在 6 个基座字段之上新增 4 个 fork 专属字段：

| 新增字段 | 类型 | 说明 |
|---------|------|------|
| `systemPromptFn` | `(vars) => string` | 动态模板，**优先于** `systemPrompt` 字段 |
| `systemPromptMode` | `'preset' \| 'prepend' \| 'append'` | 合成策略，默认 `'prepend'` |
| `context` | `'none' \| 'inherit' \| ForkContextFn` | 上下文继承策略（默认值） |
| `prompt` | `string` | fork 后的开场消息（默认值） |

### `EngineForkOptions extends SessionConfig`

运行时每次 fork 传入的参数。在 6 个基座字段之上新增 6 个运行时字段：

| 新增字段 | 类型 | 说明 |
|---------|------|------|
| `label` | `string`（必填） | 子 session 显示名 |
| `prompt` | `string` | fork 后的开场消息 |
| `context` | `'none' \| 'inherit' \| ForkContextFn` | 上下文继承（覆盖 profile 默认值） |
| `topologyParentId` | `string` | 显式指定拓扑父节点（不传 = 当前 sessionId） |
| `profile` | `string` | 引用预注册的 ForkProfile 名 |
| `profileVars` | `Record<string, string>` | `systemPromptFn` 的模板变量 |

### 字段对齐矩阵

| 字段 | SessionConfig | ForkProfile | EngineForkOptions |
|------|:---:|:---:|:---:|
| systemPrompt | ✓ | ✓（静态） | ✓ |
| llm / tools / skills | ✓ | ✓ | ✓ |
| consolidateFn / compressFn | ✓ | ✓ | ✓ |
| systemPromptFn | — | ✓ | — |
| systemPromptMode | — | ✓ | — |
| context | — | ✓（默认） | ✓（覆盖） |
| prompt | — | ✓（默认） | ✓（覆盖） |
| label | — | — | ✓ 必填 |
| topologyParentId | — | — | ✓ |
| profile / profileVars | — | — | ✓ |

Profile 和 Options 的差异都是职责驱动的：profile 是模板（不能自引用 profile，不需要 label），options 是运行时参数（需要 label 每次给出，需要引用 profile 入口）。

---

## 四层 Fallback 合成链

所有 fork 最终都要合成一份完整的 SessionConfig 交给 `session.fork()`。合成输入有四层：

```
sessionDefaults → parent（固化 config） → profile → forkOptions
低优先级                                       高优先级
```

**字段级覆盖规则**：后层非 `undefined` 的字段覆盖前层；`undefined` 永不覆盖（保留前层值）。

### 普通字段（llm / tools / skills / consolidateFn / compressFn）

直接走 later-wins 链。每层独立决定某字段是否贡献。

### `systemPrompt` 特殊合成

分有无 profile 两种情况：

**情况 A — 有 profile**：

1. 先求 profile 的 promptSource：`profile.systemPromptFn?.(profileVars) ?? profile.systemPrompt`
2. 按 `profile.systemPromptMode`（默认 `'prepend'`）合成 promptSource 与 `forkOptions.systemPrompt`：

| Mode | 结果 |
|------|------|
| `'preset'` | 仅用 profilePrompt；forkOptions 的 systemPrompt 被忽略 |
| `'prepend'`（默认） | `{profilePrompt}\n\n{forkOptionsPrompt}` |
| `'append'` | `{forkOptionsPrompt}\n\n{profilePrompt}` |

3. 若 profile + forkOptions 都未贡献 prompt（如 preset 模式两者皆空），**回落到 parent → defaults** 的普通 later-wins 链。

**情况 B — 无 profile**：

走 `[defaults, parent, forkOptions]` 的普通 later-wins 链。

### `skills` 三态语义

`skills` 不做合并，整数组替换。三种取值：

| 取值 | 含义 |
|------|------|
| `undefined` | 未配置，本层不贡献 — 继承下层值；若所有层皆 undefined，运行时继承全局 SkillRouter（无白名单） |
| `[]` | 显式禁用 — 该 session 的 `activate_skill` 看不到任何 skill，**可覆盖下层非空值** |
| `['a', 'b']` | 白名单 — 只允许这几个 skill 可见 |

显式 `[]` 覆盖下层 `['a','b']` 是标准行为（"undefined 不覆盖"不阻止显式空数组生效）。

### 实战场景

| 场景 | 合成链贡献 |
|------|----------|
| 从 main session fork | parent 层 = undefined（main 不参与合成链） |
| 从 regular session fork | parent 层 = 该 session 的 `SerializableSessionConfig`（只有 systemPrompt/skills） |
| 无 profile 的普通 fork | profile 层 = undefined |
| Profile + options 都提供 llm | 结果取 options 的 llm |
| Profile 提供 llm，options 不提供 | 结果取 profile 的 llm |

---

## 持久化边界

**`SerializableSessionConfig` 只固化两个字段**：`systemPrompt`、`skills`。

原因：其余四个字段（`llm / tools / consolidateFn / compressFn`）本质是运行时引用（函数、适配器、闭包），不可安全序列化。

### 持久化时机

`forkSession()` 完成合成后：

1. 从合成结果挑 `systemPrompt` 和 `skills` 两字段打包为 `SerializableSessionConfig`
2. 若两字段都是 `undefined`（空对象），**跳过 `putConfig` 写入**，避免给存储层制造噪声
3. 否则写入 `sessions.putConfig(childId, serializable)`

### 运行时重建时的后果

Engine 重新装配某 session 的 runtime config 时：

- `systemPrompt` / `skills` 从固化存储重放
- `llm` / `tools` / `consolidateFn` / `compressFn` **不来自父 session 的持久化**，而是每次 fork 时从 `sessionDefaults → profile → forkOptions` 现场合成

**实际语义**：嵌套 fork（子再 fork 孙）时，孙 session 的 llm 不会自动继承子 session 的 llm。孙 session 的 llm 来自 `sessionDefaults`（或孙 fork 时显式指定的 profile/options）。要让某条分支始终用特殊 llm，需在每次 fork 时显式传入、或通过 profile 固化。

---

## Fork 专属行为

### `topologyParentId` vs `sourceSessionId`

两者分离是编排层的关键设计：

| 概念 | 含义 | 来源 |
|------|------|------|
| `sourceSessionId` | 上下文来源 session（系统提示词、历史继承的对象） | 总是 = 当前 session.id |
| `topologyParentId` | 拓扑父节点（星空图上挂靠位置） | options 显式给出，默认 = sourceSessionId |

不传 `topologyParentId` 时两者相等。`MainSessionFlatStrategy` 等策略可能让它们不同——例如总是挂回根节点（`topologyParentId = root`），但上下文继承仍来自当前 session（`sourceSessionId = current`）。

### `context` 继承策略

| 值 | 含义 |
|---|------|
| `'none'`（默认） | 子 session 以空对话历史启动 |
| `'inherit'` | 拷贝父 session 全部 L3 记录 |
| `ForkContextFn` | 自定义函数，接收父消息数组返回继承子集 |

`options.context` 优先级高于 `profile.context`。

### `prompt` 开场消息

Fork 后写入子 session 的首条 assistant 消息，用户进入子 session 时首先看到。`options.prompt` 优先于 `profile.prompt`。

---

## LLM 侧暴露 — `stello_create_session`

Engine 构造时自动注入此内置 tool。参数 schema 随 `ForkProfileRegistry` 状态动态变化：

**基础参数**（始终存在）：`label`（必填）、`systemPrompt`、`prompt`、`context`（enum: `'none' | 'inherit'`）

**条件参数**（仅当有 profile 注册时追加）：
- `profile`：enum，取值为所有已注册 profile 名
- `vars`：object，键值对字符串，传给 `systemPromptFn`

LLM 调用后，Engine 把 tool args 映射为 `EngineForkOptions`，走和代码路径完全相同的 `forkSession()` 流程。

---

## Profile 注册模式

### 固定角色（静态 prompt）

```typescript
profiles.register('poet', {
  systemPrompt: '你是一位诗人，所有回复用诗歌形式。',
  systemPromptMode: 'preset',
})
```

`preset` 模式让 LLM 传入的 systemPrompt 被忽略，保证角色不被覆盖。

### 动态模板（基于变量）

```typescript
profiles.register('region-expert', {
  systemPromptFn: (vars) => `你是${vars.region}地区的留学专家。`,
  systemPromptMode: 'preset',
  skills: ['search', 'summarize'],
})
```

调用方传 `profileVars: { region: '北美' }` 生成具体 prompt。

### 基础约束（允许追加）

```typescript
profiles.register('researcher', {
  systemPrompt: '你是研究助手，善于深入分析。',
  systemPromptMode: 'prepend',   // 允许 fork options 追加具体研究主题
  context: 'inherit',
})
```

LLM 在 prepend 模式下可通过 `systemPrompt` 参数补充具体任务约束，合成结果为 `{profile}\n\n{task-specific}`。

---

## 设计不变量（不会改的决策）

1. **三类型同根** — SessionConfig / ForkProfile / EngineForkOptions 共享 6 字段基座；职责驱动的差异字段独立声明
2. **四层顺序固定** — defaults → parent → profile → forkOptions，不允许调换或插入新层
3. **undefined 不覆盖** — 保证"某层不传"等价于"使用下层值"的直觉
4. **skills 显式 `[]` 能生效** — 与 undefined 区分，让"禁用"成为可表达的意图
5. **只固化 systemPrompt + skills** — 可序列化字段有限，其余字段每次 fork 现场合成
6. **从 main session fork 不继承 main 的配置** — main 不参与 regular session 的合成链
7. **topologyParentId 与 sourceSessionId 分离** — 编排层的拓扑策略和上下文继承是两个独立维度
