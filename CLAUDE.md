# CLAUDE.md — Stello 架构参考

> 本文件描述 Stello 的核心设计理念和架构约束。内容应长期稳定，不含版本状态或文件路径。

---

## 项目定位

Stello 是开源对话拓扑引擎（TypeScript SDK）。让 AI Agent 把线性对话拆分为树状 Session 森林，对外暴露 orchestrator-facing 数据 SDK，跨分支的反思与洞察传递由应用层在 SDK 之上自行实现。整个拓扑可渲染为可交互的星空图。

**仓库**：`github.com/stello-agent/stello`
**协议**：Apache-2.0

---

## 核心模型 — 单一 Session

Stello 内部只有**一种** Session。对话起点是一个 `parentId === null` 的 root session，通过 `agent.createSession()` 创建；后续分支通过 `agent.forkSession()` 挂在父节点下。多 root 合法——同一 agent 下可以并存互相独立的森林。

Root 与 child 在运行时完全同构——唯一差异是 `TopologyNode.parentId`。所有 Session 共用：

- 同一份 `SessionStorage` 接口
- 同一套上下文组装规则
- 同一条 fork 合成链
- 同一个 `sessionLoader`

> 跨 Session 的"全局综合"不是框架职责，由应用层用 `agent.listSessionDigests` / `agent.putInsight` 自行实现。

---

## 三个上下文槽位

每个 Session 在 `SessionStorage` 中有三个独立内容槽位：

| 槽位 | 写入者 | send() 行为 | 生命周期 |
|------|--------|------------|---------|
| `systemPrompt` | fork 合成链固化 / 应用层 | 每次注入 | 持久 |
| `insight` | 应用层（`putInsight`） | 注入一次即 `clearInsight` | 一次性 inbox |
| `memory` | 应用层 / `consolidateFn` 产出 | **不进入 send 上下文** | 持久（供外部反思层消费） |

**关键不变量**：`memory` 不进入 Session 自身的 LLM 上下文。它是面向外部视角的描述——上层批量收集所有 Session 的 memory 做反思、规划、调度，再通过 `putInsight` 把派生的洞察定向回写给目标 Session。Session 自身不感知这个回路。

加上 L3 对话历史（`appendRecord / listRecords`），上下文按以下顺序组装（固定规则，不暴露扩展点）：

```
system prompt → session_identity(label) → insight(若有，消费后清除) → L3 历史 → 当前用户消息
```

当估算 token 数超过 `maxContextTokens * 0.8` 时，闭包注入的 `compressFn` 把历史段压缩为一段 system 摘要，与近期消息拼接。

---

## 四层架构

```
┌─────────────────────────────────────────────────────────┐
│  HTTP / SDK 层                                           │
│  REST / WebSocket 服务，多租户，跨语言客户端              │
├─────────────────────────────────────────────────────────┤
│  应用层（Application Layer）                              │
│  开发者提供：SessionStorage · SessionTree · LLMAdapter   │
│  · ConsolidateFn · CompressFn · 工具定义 · reflection 循环│
├─────────────────────────────────────────────────────────┤
│  编排层（Orchestration Layer）                            │
│  StelloAgent：orchestrator-facing 数据 SDK + Engine 调度  │
│  Engine：tool call 循环 · consolidation 调度 · fork 编排  │
│  · fire-and-forget 异步副作用 · 事件                       │
├─────────────────────────────────────────────────────────┤
│  Session 层                                              │
│  独立对话单元：send() 单次 LLM 调用 · consolidate()      │
│  · fork() · 不感知树结构 · 不做 tool call 循环            │
└─────────────────────────────────────────────────────────┘
         ↑ 依赖注入
  SessionStorage    SessionTree    LLMAdapter
```

### Session 层

Session 是**有记忆的对话单元**，与树结构完全解耦。

- **send()**：组装上下文 → 单次 LLM 调用 → 存 L3 → 返回响应
- **consolidate(fn)**：暴露给上层调度 L3 → memory 提炼
- **fork(options)**：按 `context: 'none' | 'inherit' | ForkContextFn` 一次性继承上下文，创建独立新 Session（id 由调用方传入，topology-first）
- **SessionMeta 不含 parentId / depth** — Session 不知道自己在树中的位置

### 编排层

`StelloAgent` 是面向使用者的最高层对象，提供两类能力：

1. **运行时编排**：`createSession / enterSession / turn / stream / forkSession / leaveSession / archiveSession / consolidateSession` 以及 runtime 引用计数管理（`attachSession / detachSession`）
2. **Orchestrator-facing 数据 SDK**：`listRoots / getTopology / listSessions / listSessionDigests / getSessionMetadata / listMessages / putMemory / putInsight / clearInsight`

Engine 在 `StelloAgent` 内部驱动 turn / tool call 循环 / consolidation 调度 / fork 编排，所有异步副作用 fire-and-forget，不阻塞 turn() 返回。

### HTTP / SDK 层

编排层之上的薄 HTTP 包装，实现跨语言和多租户。编排层本身与传输无关。

---

## 存储设计

存储职责切成两条独立的线，由应用层各自实现并注入：

| 接口 | 包 | 职责 |
|------|----|----|
| **SessionStorage** | `@stello-ai/session` | 单 Session 的内容数据：L3、systemPrompt、insight、memory；事务 |
| **SessionTree** | `@stello-ai/core` | 拓扑结构：节点关系（含 sourceSessionId）、固化 `SerializableSessionConfig`（仅 `systemPrompt` / `skills`）、跨树引用 |

两者通常共享同一份持久化后端，但接口分离让 Session 层（运行单条对话）与编排层（管理整棵森林）的职责互不耦合。两个接口的 `id` 必须语义一致——同一 Session 的 `SessionMeta.id === TopologyNode.id`。

`StelloAgent.listSessionDigests` 等批量 API 在 SDK 上组合两条线（`SessionTree.listAll()` × `SessionStorage.getMemory/getInsight`），存储层不需要专用方法。

---

## Fork 合成链

fork 时按顺序合成 `SessionConfig`，后者覆盖前者：

```
sessionDefaults → 父 session 固化 config → ForkProfile → EngineForkOptions
```

- **持久化边界**：合成结果只把 `systemPrompt` + `skills` 写入 `sessions.putConfig`。其余字段（llm / tools / consolidateFn / compressFn）是运行时引用，每次 fork 现场合成
- **`systemPrompt` 三种合成模式**：`preset` / `prepend`（默认）/ `append`，由 `ForkProfile.systemPromptMode` 控制
- **`skills` 三态语义**：`undefined`（继承下层）/ `[]`（显式禁用，可覆盖下层非空值）/ `['a','b']`（白名单）
- **`topologyParentId` 与 `sourceSessionId` 分离**：拓扑挂靠位置和上下文继承来源可独立指定

详见 skill `fork-design`。

---

## 外部注入点

| 注入 | 说明 |
|------|------|
| SessionStorage | 单 Session 数据持久化 |
| SessionTree | 拓扑与固化配置持久化 |
| LLMAdapter | LLM 接口（消息数组、tool use、可选 stream） |
| ConsolidateFn | L3 → memory 的转换逻辑；应用层定义 memory 格式，fn 自行选择 LLM tier |
| CompressFn | 超上下文阈值时的摘要压缩逻辑；fn 自行选择 LLM tier |
| sessionDefaults | 所有 Session 的 agent 级默认 SessionConfig，fork 合成链最低优先级 |
| ToolRegistry | 应用层工具注册；内置 tool（`createSessionTool()` / `activateSkillTool(skills)`）由应用层显式 opt-in 加入 |
| SkillRouter | Skill 注册表 |
| ForkProfileRegistry | 预注册的 fork 配置模板（systemPrompt 合成策略 + LLM/tools/context/skills 预设） |
| SessionRuntimeResolver / sessionLoader | Session 加载入口；所有 Session（含 root）走同一条路径 |

框架对 memory 内容格式完全无感知——`ConsolidateFn` 输出什么格式，应用层的 reflection 循环就消费什么格式。

---

## 设计决策（已确认，不再讨论）

1. memory 不进入 Session 自身上下文 — 它是外部视角的描述
2. 跨 Session 信息传播走 `insight` 一次性 inbox — 应用层通过 `putInsight` 定向回写
3. insights 替换策略（不追加）— 写入即覆盖上一次
4. 回调一次性注入（immutable config）
5. consolidate fire-and-forget — 不阻塞对话
6. 错误处理：emit error，不中断对话周期
7. Session 上下文组装为固定规则，不暴露 assembler 扩展点
8. fork 一次性继承后独立 — 跨 Session 通信靠 insight
9. Session 做单次 LLM 调用 — tool call 循环由编排层驱动
10. Session 与树结构解耦 — SessionMeta 无 parentId/depth，拓扑由 TopologyNode 独立维护
11. 单一 Session 模型 — root 与 child 同构，差异仅在 `parentId`
12. ConsolidateFn / CompressFn 不注入 LLM — 应用层通过闭包自行选择 tier
13. 内置 tool 由应用层显式 opt-in — `createSessionTool()` / `activateSkillTool(skills)` 作为 ToolRegistry 构造参数
14. Fork = 创建独立 Session + 添加拓扑节点 — `parentId` 只是拓扑关系元数据
15. Engine 编排 fork 两步 — `sessions.createSession({ parentId })` 拿到 ID + `session.fork({ id })` 创建 Session 实例
16. 全局 reflection 由应用层在 `listSessionDigests` / `putInsight` 之上实现 — 框架不持有跨 Session 状态
17. 层级依赖单向向下 — Engine 不 import Orchestrator，共享类型定义在 `types/` 层

---

## 代码规范

- 模块间只通过 interface 通信，不允许跨包 import 内部文件
- 文件需要合理模块化, 职责相关的放在一起, 否则独立
- 每个函数写一行中文注释说明用途
- 每个 interface 写 JSDoc 注释
- KISS 原则，不做过度抽象
- TypeScript 严格模式，**不允许 any**
- 所有公开接口必须有测试（正常路径 + 错误输入 + 边界条件）

## 技术栈

- TypeScript 严格模式 · pnpm monorepo · Vitest · tsup（ESM + CJS + DTS）

## Git 规范

- commit 格式：`feat/fix/docs/test/chore(模块名): 简短中文描述`
- push 前先 `git diff --stat` 确认改动范围

## Skills 持久化规则

项目级别的架构认知、设计决策等持久化知识，统一通过 `.claude/skills/` 目录管理（实际位置为 `.agents/skills/`，前者是符号链接）。

### 组织方式

- 每个主题一个 skill 目录，包含 `SKILL.md`（遵循标准 agent skills 格式）
- 遇到新的项目级认知 → 封装为 skill 或更新已有 skill
- 遇到与当前 skill 认知不匹配的理解 → **先与用户澄清**，确认后再更新对应 skill
- 不要在对话中默认自己的理解是正确的，skill 是唯一的认知基线

### 内容规范 — 只描述当前状态

Skills 是**方向指导**，不是代码文档，也不是迁移日志。核心原则：

**只写当前生效的设计**：
- 设计决策和背后的理由（why）
- 架构约束和不变量（invariants）
- 使用模式和推荐做法（how to use）
- 职责边界（做什么 / 不做什么）
- 与其他层的关系

**不写**：
- "X 已删除"、"不再有 Y"、"取代旧 Z"、"历史上 W" 等迁移叙述——删了的东西就不在 skill 里出现
- 具体方法签名、字段列表（读代码即可）
- 文件路径和目录结构（用 glob/grep 查找）
- Phase 进度状态、emoji 标记（用 git log）
- 测试数量（会随开发变化）
- 代码块（除非是展示用法的最小示例，且不会频繁变化）
- 依赖版本号

**判断标准：** 如果这条信息 3 个月后可能过时，不写。如果这条信息帮助理解"为什么这样设计"，写。迁移与变更历史属于 CHANGELOG / migration guide，不属于 skill。

## 降级项（不实现）

L3 全文搜索 / compact 压缩 / embedding 漂移检测 / scope 横向召回 / Canvas 动画 / Skill Pipeline 权限 / 时间轴回溯 / 多布局模式
