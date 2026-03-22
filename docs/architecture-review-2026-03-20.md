# Stello SDK 架构评审记录

**日期**：2026-03-20
**参与人**：uchouT、Claude
**议题**：现有 SDK 架构分析、与业界框架对比、未来架构方向讨论

---

## 一、现有 SDK 架构梳理

### 项目定位

Stello 是首个开源**对话拓扑引擎**，核心能力是让 AI Agent 将线性对话自动分裂为树状 Session，跨分支继承记忆，整个拓扑可渲染为可交互的星空图。

### 技术栈

- 语言：TypeScript（严格模式）
- 包管理：pnpm monorepo
- 两个包：`@stello-ai/core`（引擎）+ `@stello-ai/visualizer`（可视化）
- 测试：Vitest，154 个用例，全部通过

### 三层架构

```
Session 系统（结构层）— 管理对话空间结构
    ↕
记忆系统（内容层）— 管理每个 Session 的记忆
    ↕
文件系统（持久化层）— 管理数据存储
```

记忆系统分三层：
- **L1**：全局 `core.json`，schema 驱动，支持冒泡和确认协议
- **L2**：每 Session 独立的 `memory.md` / `scope.md` / `index.md`
- **L3**：每 Session 的 `records.jsonl`，追加写入

---

## 二、关键技术问题分析

### 持久化抽象的局限

现有 `FileSystemAdapter` 接口采用文件系统隐喻（9 个方法全为路径操作），切换到数据库后端存在三个结构性缺陷：

1. **N+1 查询**：`listAll()` 先 `listDirs`，再逐个 `readJSON`
2. **无事务支持**：`createChild()` 写 5 个文件，中途失败会导致状态不一致
3. **语义泄漏**：`mkdir()` 在数据库后端只能 no-op

> **uchouT**：这里的存储结构层 dataDir/ 是否有做抽象，持久化抽象，可以从本地文件切换为 Postgres 等数据库存储？

结论：抽象存在，但是"文件系统隐喻"的抽象，不是数据库友好的抽象。如需真正支持 Postgres，需将 `FileSystemAdapter` 升级为存储语义抽象（`StorageAdapter`），方法按业务实体拆分（`getSession` / `listSessions` / `appendRecord` 等），并增加事务支持。

> **uchouT**：等我把整个项目读完，再来统一设计

### LLM 接入方式

SDK 不直接调用任何大模型 API，通过依赖注入让开发者接入：

```typescript
callLLM: (prompt: string) => Promise<string>
```

框架内部在 4 个场景调用此函数（提炼 memory、检测 L1 变更、生成 scope.md、整理最终记忆）。这 4 次调用与应用主对话流程完全分离。

**当前局限**：
- `string → string` 无法支持流式输出
- 无 system prompt 分离
- 无参数控制（temperature 等）
- L1 检测依赖 LLM 输出合法 JSON，无结构化输出保障
- 工具调用循环未封装，需开发者自行实现

### 工具调用与流式

工具调用（function calling）可以流式返回——模型将参数 JSON 拆成 `partial_json` 片段逐步推送，客户端拼接后再执行。但工具执行本身必须等参数拼完，无法中途执行。

### SDK 使用体验现状

- 需手动组装 7 个模块才能启动，无工厂函数
- 对话主循环（含工具调用来回）未封装
- 仅支持 TypeScript / JavaScript，无跨语言能力
- `flushBubbles()` 需手动调用，容易遗漏

---

## 三、业界框架对比

对 Letta、Mem0、Zep、LangGraph Platform、OpenAI Assistants 进行调研，关键发现：

| 框架 | 部署模式 | 多租户方案 | 存储 | SDK 语言 |
|---|---|---|---|---|
| Letta | HTTP 服务（自托管或云） | Org → User → Agent 三级 | PostgreSQL | Python、TS |
| Mem0 | 嵌入式库或 HTTP 服务 | 纯参数隔离（user_id） | 22+ 可插拔 | Python、TS |
| Zep | HTTP 服务 / 嵌入式 | User → Session → Group | Neo4j 图数据库 | Python、TS、**Go** |
| LangGraph | HTTP 服务（包裹嵌入引擎） | Auth 中间件 + thread_id | PostgreSQL + Redis | Python、TS |
| OpenAI Assistants | 纯 SaaS | Project 级隔离 | 黑盒 | Python、TS |

**共同规律**：
- 生产级存储全部收敛到 PostgreSQL
- 没有"每租户一个进程"，全部是共享进程 + 数据库行级隔离
- 除 LangGraph 外均不支持 cron / 离线任务
- 大多数框架主要面向网页 SaaS，本地 AI 应用支持不足

---

## 四、架构方向讨论

### 当前设计的根本问题

> **uchouT**：我的框架预期是可以做成网页账号体系，也可以做成本地 Agent 应用，先从这个层面上来看，当前的 SDK 设计是否不合适？

当前 SDK 是"嵌入式库"模型，存在以下缺陷：
- 无用户/workspace 概念
- 存储绑定本地机器
- 仅 TypeScript
- 无并发保护

### Protocol-First 架构方案

将 Stello 从嵌入式库演进为"带客户端 SDK 的服务"（类比 Stripe / Supabase）：

```
OpenAPI 规范（语言无关契约）
    ↓
Stello Server（@stello-ai/server）
    ↓ HTTP
多语言客户端 SDK
```

两种部署场景复用同一套 Server：

| | 本地应用 | 网页 SaaS |
|---|---|---|
| 存储 | SQLite / 本地文件 | PostgreSQL |
| 认证 | 无（本地信任） | JWT / OAuth |
| 多用户 | 否 | 是 |
| LLM | 用户本地配置 | 平台 API Key |

### Letta 的参考实现

Letta 本地和云跑的是同一份代码，切换靠配置：

```
本地：SQLite + 无认证 + localhost
云：PostgreSQL + JWT + 公网
```

一个进程服务所有用户，通过 `WHERE user_id = ?` 实现数据隔离。

---

## 五、最终架构方向（uchouT 决策）

> **uchouT**：我现在的想法是，提供组件式库，服务于本地，然后再提供一个多租户实现的 SaaS 服务，然后提供多语言 SDK API。这样用户可以同时用组件库自己搭建本地应用，也可以直接复用 SaaS。

**三层结构**：

```
组件库（@stello-ai/core）         ← 本地嵌入，TypeScript 开发者直接用
    ↑ 内部使用
SaaS 服务（@stello-ai/server）    ← 多租户，云或本地部署
    ↑ HTTP 调用
多语言 SDK                        ← @stello-ai/client / stello-py / ...
```

**用户选择路径**：

| 用户类型 | 使用方式 |
|---|---|
| TypeScript 本地应用开发者 | 直接用组件库 |
| 网页 SaaS 开发者 | 部署 SaaS 服务 + 多语言 SDK |
| Python / Go 本地开发者 | 本地跑 SaaS 服务（SQLite 配置）+ SDK |
| 不想自托管的开发者 | 直接用 Stello 云服务 + SDK |

**执行前提条件**（需先完成）：

1. **升级存储抽象**：将 `FileSystemAdapter` 重设计为 `StorageAdapter`（存储语义接口），消除 N+1 查询和事务缺失问题，使 SaaS 层可以接入 Postgres
2. **升级 LLM 接口**：`callLLM` 需支持流式，以便 SaaS 场景将 LLM 输出推送到客户端

**评估**：方向与 Mem0 分层模型一致，是业界验证过的设计。核心风险在执行顺序——**先稳定组件库基础接口，再搭 SaaS 层**，避免两层之间反复撕裂。

---

## 六、待办事项

- [ ] 重新设计 `StorageAdapter` 接口（存储语义抽象，支持事务）
- [ ] 重新设计 LLM 接口（支持流式、system prompt、结构化输出）
- [ ] 设计 OpenAPI 规范（SaaS 层的语言无关契约）
- [ ] 设计多租户模型（workspace / userId 概念引入）
- [ ] 确定多语言 SDK 优先级（TypeScript → Python → Go）

---

## 七、记忆系统深度设计讨论

### afterTurn 机制详解

`afterTurn(userMsg, assistantMsg)` 是每轮对话结束后的**知识同步点**，触发三层独立写入：

```
L3 路径（纯 IO，不调 LLM）
  appendRecord(userMsg) + appendRecord(assistantMsg) → records.jsonl 追加

L2 路径（1 次 LLM）
  读当前 memory.md → callLLM(提炼 prompt) → 整体覆盖写入 memory.md

L1 路径（1 次 LLM + 冒泡）
  读 core.json → callLLM(检测变更 prompt) → 解析 JSON updates
  → BubbleManager.handleBubble(path, value)
  → 过滤非 bubbleable → debounce 500ms → writeCore → emit('change')
```

三层相互独立，某层失败只通过 `emitError` 通知，不中断其他层。
L1 写入是异步延迟的（debounce），`afterTurn` 返回时 core.json 可能尚未落盘，需手动调 `flushBubbles()`。

三层认知粒度：
- **L3 = 事实层**：what was literally said（verbatim）
- **L2 = 理解层**：this session is about what（session 级理解）
- **L1 = 认知层**：what the agent knows globally（跨 session 的持久认知）

---

### Main Session 概念设计

**来源**：PM 文档《Stello 意识架构》2026-03-19

#### 定位

> "Main Session = 意识体的自我意识层。不处理具体问题，做整合、协调、发现全局 pattern、做跨领域判断。"

- 子 Session 是**专家**：深入某个具体方向，拥有该方向的详细认知
- Main Session 是**意识**：拥有所有方向的概要认知 + 跨方向整合能力

#### 数据模型扩展

`SessionMeta` 新增字段（uchouT 确认）：

```typescript
role?: 'standard' | 'main'  // 默认 'standard'
```

Main Session 在标准 Session 文件基础上额外维护：
- `conflicts.md` — 跨分支矛盾记录
- `insights.md` — 跨分支洞察
- `plan.md` — 全局行动计划

#### 整合循环（Integration Cycle）

事件驱动，不定时轮询：

| 触发条件 | 整合深度 |
|---|---|
| 用户进入 Main Session | 全量整合 |
| core.json 冒泡变更 | 局部检查 |
| 子 Session 创建/归档 | 更新 index.md + plan.md |
| 子 Session afterTurn 累计 N 轮 | 增量整合 |

整合循环读取所有子 Session memory.md + 自己的全局文件 → 调用强模型（Sonnet/Opus）→ 输出结构化 JSON → 分别更新 conflicts / insights / plan / memory.md。

Token 消耗随子 Session 数量线性增长，约 3000–8000 token input，因此需要定义上限规则（如每个 memory.md 只取前 N token，或只读最近活跃的 M 个 Session）。

需要新增生命周期钩子：
```typescript
triggerIntegration?(
  sessionId: string,
  depth: 'full' | 'incremental',
  changedSessionIds?: string[]
): Promise<IntegrationResult>
```

#### 子 Session 在 Main Session 框架下的上下文

```
子 Session assemble() 输出（不变）：
  core.json（L1）
  Main Session 的 memory.md（父的 memory，现在是全局整合摘要）
  自己的 memory.md
  自己的 scope.md

Main Session assemble() 输出（扩展）：
  core.json
  自己的 memory.md
  conflicts.md、insights.md、plan.md、index.md（额外注入）
```

子 Session 通过继承链间接受益于全局整合，但不直接感知 conflicts/insights/plan。

---

### 记忆架构三方案对比

**uchouT 提出新方案**，与 v0.1 和 PM 文档形成三路对比：

#### v0.1 方案

```
信息流：子 Session → L3（per turn）→ L2（per turn LLM 提炼）→ L1 bubble
子 Session 看到：自己 L2 + 父链 L2（继承策略）+ L1 core.json
横向感知：无，只有纵向继承
每轮 LLM 开销：2 次（L2 提炼 + L1 检测）
```

#### PM 文档方案

```
信息流：子 Session → L3/L2（per turn）→ 冒泡 → Main Session 整合循环
子 Session 看到：自己 L2 + Main Session memory.md（继承）+ L1 core.json
横向感知：通过继承 Main Session 综合 memory 间接感知（广播式）
每轮 LLM 开销：2 次 + 定期整合循环
```

#### uchouT 新方案

```
信息流：
  对话中 → 只写 L3（零 LLM）
  session 结束后 → L2 consolidation（1 次 LLM）
  Main Session → 读所有 L2 → 综合为 L1 → 定向 push 到相关子 Session

子 Session 看到：自己 L2/L3 + Main Session 定向推送的内容（main_insights.md）
横向感知：只通过 Main 的定向 push，主动投递而非被动继承
每轮 LLM 开销：0 次（对话中）
```

#### 三方案对比表

| 维度 | v0.1 | PM 文档 | uchouT 新方案 |
|---|---|---|---|
| 横向感知方式 | 无 | 被动继承（均等广播） | 主动定向 push（精准投递）|
| 每轮 LLM 开销 | 2 次 | 2 次 + 整合循环 | **0 次**（对话中）|
| L2 更新时机 | 每轮增量 | 每轮增量 | session 结束后批量 |
| 子 Session 隔离性 | 弱（继承链）| 中（继承 Main memory）| **强**（只看自己 + push）|
| Main Session 实时性 | 不存在 | 强（per turn）| 弱（依赖 L2 已构建）|
| L1 结构化能力 | 强（schema）| 强 | 需额外设计保留 |

---

### uchouT 新方案的评估

**优势**：
1. **定向 push 优于广播继承**：Main Session 主动判断哪个洞察对哪个子 Session 有用，精准投递而非全员广播
2. **零对话中 LLM 开销**：对话体验更流畅，成本更低
3. **子 Session 认知空间干净**：只知道自己的历史 + Main 告诉它的事

**需要解决的问题**：

1. **"session 结束"的定义**：Session 是持久的，无天然"结束"事件。
   建议：**onSessionSwitch 触发 + 每 N 轮批量整合**结合，防止 L3 堆积过久。

2. **对话中 Main Session 是盲的**：L2 在 session 结束前不存在，Main Session 无法感知正在进行的 session。这是有意为之的取舍（追求低成本和干净隔离），需在文档中显式说明。

3. **L1 结构化能力丢失风险**：uchouT 新方案将 L1 重定义为"Main Session 的综合记忆"（非结构化文本），会失去 v0.1 core.json 的 schema 驱动、类型校验、requireConfirm 等能力。
   **解决方案**：L1 保持两部分：
   ```
   L1-structured：开发者定义的 core.json（保留 v0.1 设计）
   L1-emergent：Main Session 综合 L2 的自由文本记忆
   ```
   结构化应用数据与涌现全局认知分开管理。

---

## 八、更新后的待办事项

### 基础接口（优先级最高，影响所有上层）

- [ ] 重新设计 `StorageAdapter` 接口（存储语义抽象，消除文件系统隐喻，支持事务）
- [ ] 重新设计 LLM 接口（支持消息数组、流式、结构化输出、多级 callLLM 配置）

### Main Session 设计（v0.2）

- [ ] `SessionMeta` 新增 `role: 'standard' | 'main'` 字段
- [ ] Main Session 额外文件：conflicts.md / insights.md / plan.md 的读写接口
- [ ] 新增 `triggerIntegration` 生命周期钩子
- [ ] 整合循环触发条件的状态追踪（存 metadata 中：lastIntegrationAt 等）
- [ ] `assemble()` 感知 role，Main Session 注入额外文件

### uchouT 新记忆方案（待进一步设计）

- [ ] 明确 L2 consolidation 触发时机（onSessionSwitch + 每 N 轮批量）
- [ ] 设计 `main_insights.md`（Main Session 定向推送空间）的数据结构和更新机制
- [ ] 确认 L1 双层设计（L1-structured core.json + L1-emergent Main memory）
- [ ] 明确 Main Session 对进行中 session 的"盲区"取舍，写入设计文档

### SaaS / 多语言（后续）

- [ ] 设计 OpenAPI 规范（SaaS 层语言无关契约）
- [ ] 设计多租户模型（workspace / userId）
- [ ] 确定多语言 SDK 优先级（TypeScript → Python → Go）
