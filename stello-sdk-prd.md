# Stello SDK PRD

## 产品需求文档 v0.3 · 内部开发

> 更新时间：2026年3月17日

---

## 一、产品概述

**产品名称**：Stello
**形态**：开源 TypeScript SDK（npm 包）
**npm**：@stello-ai/core · @stello-ai/visualizer
**仓库**：github.com/stello-agent/stello

**定位**：首个开源对话拓扑引擎。让 AI Agent 自动将线性对话分裂为树状 Session，跨分支继承记忆，整个拓扑渲染为可交互的星空图。

**核心体验目标**：让终端用户获得一次深入、连贯、有结构的研究或咨询体验。不是"对话工具"，而是"思考空间"。

---

## 二、核心原则

1. **场景无关**：不含任何业务逻辑，留学/法律/研究/创作都是上层配置
2. **开发者定规则，框架管生命周期**：拆分规则、记忆结构、引导逻辑由开发者注册
3. **渐进式采用**：Session 系统、记忆系统、文件系统、可视化四个能力独立可用
4. **存储无关**：默认文件系统，可换 adapter
5. **可扩展**：Session 元数据、记忆字段、Skill 插槽全部开放

---

## 三、产品架构

Stello 由三个核心系统 + 一个可视化引擎组成：

```
┌─────────────────────────────────────────┐
│              @stello-ai/core               │
│                                         │
│   Session 系统（结构层）                 │
│   管理对话的空间结构：谁是谁的子节点     │
│         ↕                               │
│   记忆系统（内容层）                     │
│   管理每个 Session "知道什么"            │
│         ↕                               │
│   文件系统（持久化层）                   │
│   管理数据"存在哪、怎么存"              │
│                                         │
│   + Skill 插槽 + 生命周期钩子           │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│           @stello-ai/visualizer            │
│   星空图渲染 + React 组件（独立包）      │
└─────────────────────────────────────────┘
```

---

## 四、Session 系统

### 做什么

管理对话的空间结构。Session 是 Stello 的原子单元——一个独立的对话空间，内部可能有几十轮对话。Session 之间形成树状父子关系，支持跨分支横向引用。

### Session 元数据

**框架内置字段**

- `id`：唯一标识
- `parentId`：父 Session ID（null = 根）
- `children`：子 Session ID 列表
- `refs`：跨分支引用的 Session ID 列表
- `label`：显示名称
- `index`：在兄弟节点中的序号（排序用）
- `scope`：作用域标签（如 `us-application`），影响记忆系统的召回范围
- `status`：active / archived
- `depth`：层级深度（根 = 0）
- `turnCount`：对话轮次数
- `createdAt` / `updatedAt` / `lastActiveAt`

**开发者自定义字段**

- `metadata`：Record<string, any>，塞任何业务数据
- `tags`：string[]，自由标签

### Session 拆分（双路径）

Session 拆分有两条路径，可以同时生效：

**路径 A：embedding 自动检测（被动）**

- 框架每轮对话后用 embedding 计算话题漂移分数（0-1）
- 超过阈值 → 触发拆分建议（自动创建或先问用户，取决于 confirmMode）
- 适合：用户无意识聊偏了，Agent 提醒"要不要开个新分支"
- **可选**：开发者传入 `embedder` 函数才激活，不传则不做自动检测

**路径 B：Agent 主动判断（主动）**

- Agent 在对话中通过 Skill 引导提示或自身判断，主动调用 `stello_create_session` tool
- 不需要 embedding，不需要漂移分数，Agent 直接决定
- 适合：Agent 有明确的业务逻辑知道"聊到这个话题就该开新分支"

**最小启动**：开发者不传 embedder，只靠 Agent 主动调 tool 就能实现拆分。想要自动检测再传 embedder 开启。

**保护机制（两条路径共用）**

- 最少 N 轮才允许拆分（默认 3）
- 冷却期（默认 5 轮）
- 策略异常 → 不拆分，不影响对话

### 跨分支引用

- A 分支关联到 B 分支
- 不能引用自己或直系祖先/后代
- 星空图渲染为虚线

### 产品决策

- 不支持删除，只支持归档
- 归档不连带子 Session
- 层级深度和子节点数量可配置，默认不限

---

## 五、记忆系统

### 设计目标

让终端用户感受到：Agent 记得我说过什么，知道现在该给我什么信息，不会重复问，不会遗忘关键决策。

### 三层结构

| 层              | 存什么                          | 粒度              | 谁来更新                                    | 谁来读                       |
| --------------- | ------------------------------- | ----------------- | ------------------------------------------- | ---------------------------- |
| L1 核心档案     | 结构化数据，schema 由开发者定义 | 全局唯一          | Skill 写入 / 用户手动修改 / 子 Session 冒泡 | bootstrap 时注入所有 Session |
| L2 Session 摘要 | 关键结论、用户意图、待跟进事项  | 每个 Session 一份 | 每轮 afterTurn 自动提炼                     | bootstrap 时按继承策略注入   |
| L3 原始记录     | 完整对话记录                    | 每个 Session 一份 | 实时追加                                    | 按需检索，不主动注入         |

### scope 驱动的记忆召回

每个 Session 的 `scope` 直接影响 assemble 的行为：

```
进入 scope='cmu-mhci' 的 Session
    ↓
assemble 组装 context：
├── L1 核心档案 → 全量注入（全局共享）
├── 本 Session 的 L2 → 注入
├── 父 Session 的 L2 → 注入（继承）
├── 同 scope 兄弟的 L2 → 注入（横向召回）
└── 无关 scope 的 L2 → 不注入
```

scope 让记忆召回不只看父子关系，还按"领域相关性"横向关联。

### 向下继承（inheritancePolicy）

子 Session bootstrap 时：

- **必定注入**：L1 完整核心档案 + 父 Session 的 L2
- **可配置模式**：
  - `full`：所有祖先的 L2
  - `summary`：只父 Session 的 L2（默认）
  - `minimal`：只 L1
  - `scoped`：父 L2 + 同 scope 兄弟的 L2
- **不注入**：无关兄弟 Session 的上下文

### 向上冒泡（bubblePolicy）

子 Session 的重要信息写入 L1 的机制：

- **触发时机**：afterTurn 检测到 L1 字段变更 → 即时冒泡（默认），或 Session 归档时批量冒泡（可配置）
- **冒泡范围**：只有 schema 中标记为 `bubbleable` 的字段才冒泡
- **冲突处理**：默认 last-write-wins + L2 记录冲突历史，开发者可注册 conflictResolver

### L1 onChange

L1 任何字段变化（Skill 写入 / 用户手动改 / 冒泡），触发 onChange 事件：

- 上层 UI 刷新
- 当前活跃 Session 的 assemble 重新组装
- 开发者自定义副作用

### 记忆降权

L2 带时间戳，超过配置时长（默认 90 天）不主动注入，仍可手动检索。

### 边界条件

- L1 写入不符 schema → 拒绝，报错
- L2 提取失败 → 跳过，L3 正常追加
- 存储失败 → 报错，调用方决定降级
- bootstrap 超时 → 返回 minimal（只 L1）

---

## 六、文件系统

### 设计思路

Session = 文件夹，记忆 = 文件夹里的文件。这是 Stello 的持久化层，也是开发者最直观理解数据结构的方式。

### 目录结构

```
stello-data/                          ← 根目录（路径可配置）
├── core.json                         ← L1 核心档案（全局唯一）
└── sessions/                         ← 所有 Session 平铺存放
    ├── {session-id-1}/
    │   ├── meta.json                 ← Session 元数据
    │   ├── summary.json              ← L2 摘要
    │   └── records.jsonl             ← L3 原始记录
    ├── {session-id-2}/
    │   ├── meta.json
    │   ├── summary.json
    │   └── records.jsonl
    └── ...
```

### 为什么平铺不嵌套

树关系通过 meta.json 里的 `parentId` 维护，不靠物理目录嵌套。

| 操作             | 平铺                       | 嵌套              |
| ---------------- | -------------------------- | ----------------- |
| 找到某个 Session | `sessions/{id}/` 直达      | 要递归搜索        |
| 读祖先摘要       | 从 parentId 往上跳         | 一样要读 parentId |
| 跨分支引用       | 直接读 `sessions/{refId}/` | 要知道完整路径    |
| 移动 Session     | 改 meta.json 的 parentId   | 物理移动文件夹    |
| 列出所有 Session | `ls sessions/`             | 递归遍历          |

Agent 不在乎目录长什么样，在乎的是**一步能不能到**。平铺对 agent 最友好。

### 各文件说明

**core.json（L1 核心档案）**

- 全局唯一，所有 Session 共享
- schema 由开发者定义
- 支持点路径读写（如 `profile.gpa`）
- 变更触发 onChange 事件

**meta.json（Session 元数据）**

- 每个 Session 一份
- 包含：id、parentId、children、refs、label、scope、tags、index、status、depth、turnCount、时间戳
- 树关系的唯一真相来源

**summary.json（L2 摘要）**

- 每个 Session 一份
- 包含：关键结论、用户意图、待跟进事项、更新时间、TTL
- afterTurn 自动提炼更新

**records.jsonl（L3 原始记录）**

- 每个 Session 一份
- JSONL 格式：每行一条 turn（role + content + timestamp）
- 追加写入，不用读整个文件
- 大 Session 可能有几百轮对话，JSONL 比 JSON 数组高效

### 适配器模式

文件系统是 v0.1 的默认适配器。开发者可以换成任何存储：

- **默认**：FileSystemAdapter（直接读写磁盘文件，零依赖）
- **可选**：SQLiteAdapter、PostgresAdapter、自定义
- 切换 adapter 不影响上层代码，Session 系统和记忆系统感知不到底层存储是什么

### 框架管到哪 / 开发者管到哪

| 框架管                     | 开发者管                         |
| -------------------------- | -------------------------------- |
| 定义读写接口               | 选择用什么存储                   |
| 调用时机（由生命周期控制） | 实现适配器接口（如果不用默认的） |
| 错误处理策略               | 数据备份、迁移、清理             |
| 默认 FileSystemAdapter     | 生产环境的存储选型               |

---

## 七、生命周期钩子

串联 Session 系统、记忆系统、文件系统的执行时序：

| 钩子              | 触发时机                 | 做什么                                                                                             |
| ----------------- | ------------------------ | -------------------------------------------------------------------------------------------------- |
| bootstrap         | 进入 Session             | 从文件系统读 L1 (core.json) + L2 (summary.json)，按继承策略组装上下文                              |
| ingest            | 每条消息进来             | 识别意图，检测漂移，匹配 Skill                                                                     |
| assemble          | 组装 prompt              | 按 scope + 继承策略从文件系统筛选相关 L2，注入 prompt                                              |
| afterTurn         | 每轮结束                 | 提取信息写 core.json（+ 冒泡），提炼 summary.json，追加 records.jsonl                              |
| compact           | context 接近上限         | 压缩旧内容，关键信息存入 summary.json                                                              |
| onSessionSwitch   | 用户切换到另一个 Session | 对离开的 Session 触发一次 L2 摘要更新（确保离开前的对话被总结），然后对目标 Session 触发 bootstrap |
| prepareChildSpawn | 创建子 Session 前        | 创建新文件夹 + meta.json，按 inheritancePolicy 组装初始上下文                                      |

所有钩子有默认实现，开发者可选择性覆盖。失败不阻塞对话。

---

## 八、Skill 插槽

### 定位

框架提供"可以装 Skill 的地方"，开发者装什么是他的事。v0.1 只需要注册、路由、兜底三个能力。

### Skill 结构

每个 Skill 由以下部分组成：

- **名称 + 描述**：标识这个 Skill 是干什么的
- **意图匹配**：关键词列表，框架用这个做路由（如 `['选校', '推荐学校', '院校对比']`）
- **执行函数**：接收当前 Session 上下文 + 用户消息，返回回复内容 + 可选的记忆更新
- **引导提示**：这个 Skill 被激活时，Agent 应该怎么引导对话（如先问什么、按什么顺序聊）

### 内置：咨询 Skill（Guidance Skill）

框架提供一个默认的咨询 Skill 作为兜底，也作为开发者编写自己 Skill 的参考模板：

**职责**

- 用户第一次进来时的开场引导（了解背景、明确需求）
- 没有匹配到具体 Skill 时的通用对话
- 识别到应该拆分 Session 时，发起拆分建议

**引导结构**

```
开场：了解用户背景和目标
  ↓
梳理：帮用户理清问题的维度和优先级
  ↓
深入：针对具体维度展开讨论（可能触发拆分）
  ↓
总结：阶段性结论，更新 L1，提示下一步
```

这个结构不是硬编码的流程，而是通过 Skill 的引导提示告诉 LLM "你现在处于哪个阶段、该做什么"。开发者可以完全覆盖这个默认 Skill，或者基于它扩展。

### v0.1 实现范围

- Skill 注册接口
- 基础路由（ingest 识别意图 → 分发）
- 内置咨询 Skill 作为兜底 + 模板

### v0.2+

- Pipeline 编排（多个 Skill 按顺序执行）
- Skill 权限控制（限制读写范围）
- Skill 模板市场

---

## 九、Agent Tools

### 做什么

Stello 生命周期钩子自动处理了大部分读写（afterTurn 写记忆、prepareChildSpawn 建文件夹），但 Agent 在对话过程中也需要**主动**操作 Session 和记忆。Stello 暴露一组标准的 tool definitions，开发者直接注册给自己的 LLM（OpenAI function calling / Claude tool use），Agent 就能在对话中主动管理整棵拓扑。

### 两层分工

**框架自动完成的（生命周期钩子，Agent 不感知）**

- afterTurn → 写 core.json / summary.json / records.jsonl
- prepareChildSpawn → 创建新 Session 文件夹 + meta.json
- compact → 压缩旧内容写 summary.json
- bootstrap → 加载记忆组装上下文

**Agent 主动调用的（作为 tool 暴露给 LLM）**

| Tool                  | 做什么                     | 示例场景                                      |
| --------------------- | -------------------------- | --------------------------------------------- |
| stello_update_core    | 更新 L1 某个字段           | "用户说不考虑 GT 了" → 从院校列表删掉         |
| stello_read_core      | 读取 L1 某个字段           | Agent 需要确认当前 GPA 多少                   |
| stello_create_session | 创建子 Session             | Agent 判断该开新分支了，向用户确认后创建      |
| stello_list_sessions  | 列出所有 Session（带状态） | Agent 给用户总结"你目前有哪些分支在进行"      |
| stello_read_summary   | 读某个 Session 的 L2 摘要  | 跨分支查阅：在 CMU 分支里查看 UW 分支聊了什么 |
| stello_add_ref        | 创建跨分支引用             | "这个和财产分割那边有关联"                    |
| stello_archive        | 归档 Session               | "这个方向你不打算继续了，我帮你归档"          |
| stello_update_meta    | 更新 Session 元数据        | 改 scope、加 tags、改 label                   |

### 开发者怎么用

Stello 导出一个 `getToolDefinitions()` 函数，返回符合 OpenAI / Claude tool use 格式的定义数组。开发者一行代码注册：

```
const tools = engine.getToolDefinitions()
// 传给 LLM 的 tool 参数
```

LLM 决定调用哪个 tool → 框架执行 → 返回结果 → LLM 继续对话。开发者不需要自己实现这些 tool 的逻辑，Stello 全包。

### 产品决策

- Tool 的执行结果会触发相应的记忆更新（如 stello_update_core 触发 onChange）
- Tool 调用失败 → 返回错误信息给 LLM，LLM 自行决定怎么向用户解释
- v0.1 不做 tool 级别的权限控制（所有 tool 对所有 Skill 开放）
- 涉及创建 Session 和更新关键字段时，通过确认协议（见下节）让用户确认

---

## 十、确认协议

### 做什么

Agent 不能静默地改数据或开分支——用户要有掌控感。Stello 提供确认机制的**协议**（事件 + 确认/拒绝 API），不提供 UI 组件，开发者自己决定确认界面长什么样。

### 创建 Session 确认

```
Agent 判断该拆分（路径 A 漂移检测 或 路径 B 主动调 tool）
    ↓
Stello 不直接创建，触发 splitProposal 事件：
{
  type: 'split_proposal',
  suggestedLabel: '美国申请',
  suggestedScope: 'us-application',
  reason: '检测到你在深入讨论美国方向',
  parentId: 当前 Session ID
}
    ↓
开发者在自己的 UI 里展示确认组件（卡片/弹窗/按钮，随便）
    ↓
用户确认 → engine.confirmSplit(proposal) → 创建文件夹 + meta.json
用户拒绝 → engine.dismissSplit(proposal) → 不创建，继续当前 Session
```

### 更新 L1 确认

开发者在 L1 schema 中可以把关键字段标记为 `requireConfirm`（如院校列表、重大决策），标记后这些字段的变更不直接写入，而是走确认流程：

```
afterTurn / Agent tool 检测到要更新 requireConfirm 字段
    ↓
Stello 不直接写入，触发 updateProposal 事件：
{
  type: 'update_proposal',
  path: 'schools',
  oldValue: ['CMU', 'UW', 'GT'],
  newValue: ['CMU', 'UW'],
  reason: '用户说不考虑 GT 了'
}
    ↓
开发者展示确认 UI
    ↓
用户确认 → engine.confirmUpdate(proposal) → 写入 core.json + 触发 onChange + 冒泡
用户拒绝 → engine.dismissUpdate(proposal) → 不写入
```

未标记 `requireConfirm` 的字段正常静默写入，不弹确认。

### Stello 提供什么 / 不提供什么

| Stello 提供                           | Stello 不提供            |
| ------------------------------------- | ------------------------ |
| `splitProposal` 事件                  | 确认卡片、弹窗等 UI 组件 |
| `updateProposal` 事件                 | 确认文案                 |
| `confirmSplit()` / `dismissSplit()`   | 交互动画                 |
| `confirmUpdate()` / `dismissUpdate()` | 样式和布局               |
| schema 中的 `requireConfirm` 标记     |                          |

开发者完全控制交互体验，Stello 只管"这里需要确认"和"确认/拒绝后该做什么"。

---

## 十一、可视化引擎（@stello-ai/visualizer）

独立包，可脱离 core 使用。

**v0.1 交付**

- 星空图布局 + Canvas 渲染
- 交互：缩放、平移、点击进入 Session、悬浮预览摘要
- React 组件封装

**节点映射**：大小=turnCount、亮度=lastActiveAt、颜色=开发者自定义、父子=实线、引用=虚线、归档=低透明度

**v0.2+**：树状图/力导向图、SVG/WebGL、导出图片、时间轴回溯

---

## 十二、开发者构建路径

一个开发者从零开始用 Stello 构建产品的完整路径：

### Step 1：定义你的领域（30 分钟）

想清楚三个问题：

- 你的用户是谁？（留学生 / 当事人 / 研究者）
- 核心档案长什么样？（L1 schema：用户画像有哪些字段）
- 什么时候该分叉？（聊到新地区？新争议点？新研究方向？）

产出：一个 L1 schema + 一套拆分规则的文字描述

### Step 2：装包 + 初始化（5 分钟）

```
npm install @stello-ai/core @stello-ai/visualizer
```

创建 Stello 实例，传入：

- `dataDir`：数据存在哪
- `coreSchema`：L1 结构
- `callLLM`：你的 LLM 调用函数（框架用来提取 L2 摘要）
- `embedder`（可选）：embedding 函数，开启自动漂移检测

启动后 stello-data 目录自动创建，根 Session 自动建好。

### Step 3：写你的咨询 Skill（1-2 小时）

基于框架内置的咨询 Skill 模板，填入你的领域知识：

- 开场怎么引导（先问什么）
- 梳理阶段关注什么维度
- 什么时候建议拆分
- 每个阶段结束时总结什么写入 L1

这是你产品的"灵魂"——同样的框架，留学顾问和法律顾问的 Skill 完全不同。

### Step 4：注册 Agent Tools（1 行代码）

```
const tools = engine.getToolDefinitions()
```

把 tools 传给你的 LLM，Agent 就能在对话中主动管理 Session、读写记忆、创建引用。

### Step 5：搭前端（自己的事）

Stello 不管 UI，但你的前端需要接入这些：

- **对话界面**：显示当前 Session 的消息，发消息时调 `engine.ingest()` + `engine.assemble()`
- **Session 切换**：侧边栏或标签页，展示 Session 列表，点击切换
- **确认组件**：监听 `splitProposal` 和 `updateProposal` 事件，展示你自己设计的确认 UI
- **星空图**：`<StelloGraph engine={engine} />`，即插即用
- **L1 变更响应**：监听 `onChange`，刷新对应的 UI 模块（如规划页面、任务列表）

### Step 6：接入对话循环（核心代码）

每一轮对话：

```
1. 用户发消息
2. engine.ingest(message)         → 意图识别 + 漂移检测
3. engine.assemble()              → 组装 prompt（Stello 注入记忆）
4. 你调 LLM 生成回复              → Stello 不管这步
5. engine.afterTurn(reply)        → 提取写 L1/L2/L3 + 冒泡 + onChange

如果触发拆分：
→ splitProposal 事件 → 你的确认 UI → 用户确认 → confirmSplit()

如果用户切换 Session：
→ onSessionSwitch → 旧 Session L2 更新 → 新 Session bootstrap
```

### Step 7：跑起来，迭代

第一版跑起来后，你会发现：

- 某些拆分时机不对 → 调整 splitStrategy
- 某些记忆该继承但没继承 → 调整 inheritancePolicy / scope
- 某些字段变更该确认但没确认 → 在 schema 里标记 requireConfirm
- L2 摘要提取质量不好 → 调整 summaryExtractor 的 prompt

这些全是配置层的调整，不用改框架代码。

### 从最小到完整

```
最小可用版本（1 天）
├── 装包 + L1 schema + 默认咨询 Skill + callLLM
├── 终端里能跑：对话 → 自动拆分 → 记忆继承
└── 没有前端，没有星空图

基础产品（1 周）
├── 加前端：对话页面 + Session 切换 + 确认组件
├── 加星空图
└── 能给用户试用了

打磨版本（持续迭代）
├── 多个垂类 Skill（选校 / 文书 / 面试）
├── L1 schema 越来越丰富
├── 拆分规则越来越精准
└── 用户体验越来越深入
```

---

## 十三、v0.1 开发者能做什么

装上 Stello 后：

1. **Session 树自动生长**——对话分叉时自动创建子 Session（新文件夹），不用手动管理
2. **三层记忆自动读写**——core.json / summary.json / records.jsonl，框架管理读写时机
3. **子 Session 自动继承父上下文**——不用手动拼 prompt
4. **scope 控制记忆召回**——同 scope 的 Session 横向共享记忆
5. **L1 变更自动冒泡 + 通知**——子 Session 的发现自动写入 core.json，onChange 通知上层
6. **Agent Tools 一行注册**——`getToolDefinitions()` 导出标准 tool 定义，Agent 在对话中主动管理 Session、读写记忆、创建引用
7. **注册一个兜底 Skill 就能跑**——最小启动成本
8. **星空图即插即用**——一个 React 组件

**终端用户感受到**

- 越聊越深，Agent 不遗忘、不重复问
- 话题自然分叉，每个分支独立上下文
- 回到老分支，Agent 还记得上次聊到哪
- 星空图展示思考结构

---

## 十四、不做什么（v0.2+）

| 排除项                         | 原因                                                                                                                                                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Main Session 管理者能力        | v0.2 核心特性：main session 自动整合子 Session 成果，在与用户的对话中协作管理记忆/文件/Session（合并结论、清理过时记忆、建议归档不活跃分支）。v0.1 架构上预留口子（main session 的 meta.json 标记 `isRoot: true`），但不实现整合逻辑 |
| Projection（L1 投影 API）      | v0.1 用 onChange，v0.2 抽象为 Projection                                                                                                                                                                                             |
| Skill Pipeline / 权限          | v0.1 只要注册 + 路由 + 兜底                                                                                                                                                                                                          |
| 时间轴回溯                     | 依赖三个核心系统先稳定                                                                                                                                                                                                               |
| L3 语义搜索                    | 需要向量化，v0.1 全文搜索替代                                                                                                                                                                                                        |
| 多布局模式                     | v0.1 只做星空图                                                                                                                                                                                                                      |
| scope 自动推断                 | v0.1 手动指定，v0.2 考虑自动                                                                                                                                                                                                         |
| 框架适配器（LangChain/OpenAI） | 先稳定核心                                                                                                                                                                                                                           |
| Stello Cloud                   | 融资后                                                                                                                                                                                                                               |
| 模板市场                       | 社区起来后                                                                                                                                                                                                                           |

---

## 十五、设计决策记录

以下事项已全部确认：

### 15.1 L2 摘要提取机制

**决策**：框架提供 prompt 模板（定义提取什么：关键结论、意图、待跟进），开发者传入 `callLLM(prompt) → string` 函数。框架不绑定任何 LLM 供应商，开发者用什么模型是他的事。

### 15.2 漂移检测 embedding

**决策**：embedder 是可选的。开发者传入 `embedder` 函数 → 路径 A（自动检测）激活；不传 → 只有路径 B（Agent 主动调 tool）可用。框架只做距离计算，不绑任何 embedding 供应商。

### 15.3 冒泡时机

**决策**：默认即时冒泡 + 500ms debounce。同一个字段短时间内多次变更只写最后一次，避免频繁写 core.json。

### 15.4 onChange 粒度

**决策**：字段级。onChange 通知具体哪个路径变了（如 `profile.gpa`），为 v0.2 Projection 打基础。

### 15.5 文件系统并发写入

**决策**：v0.1 不做锁，单进程够用。多进程场景建议开发者换 DB adapter。

### 15.6 afterTurn 部分失败

**决策**：三层独立写入，某层失败不影响其他层。失败时记错误日志 + 触发 `onError` 回调通知开发者（哪一层失败了、失败原因），开发者决定是否重试或降级。
