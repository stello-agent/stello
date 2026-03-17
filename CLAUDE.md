# CLAUDE.md — Stello 项目上下文

> Claude Code 每次启动必读。这是你的记忆。

---

## 项目定位

Stello 是首个开源对话拓扑引擎（TypeScript SDK）。让 AI Agent 自动将线性对话分裂为树状 Session，跨分支继承记忆，整个拓扑渲染为可交互的星空图。

**npm**：`@stello-ai/core` · `@stello-ai/visualizer`
**仓库**：`github.com/stello-agent/stello`
**协议**：Apache-2.0

---

## 技术栈

- 语言：TypeScript（严格模式，不允许 any）
- 包管理：pnpm monorepo（packages/core + packages/visualizer）
- 测试：Vitest
- 打包：tsup
- 代码规范：ESLint + Prettier

---

## 目录结构

```
stello/
├── packages/
│   ├── core/
│   │   └── src/
│   │       ├── types.ts            ← 所有接口定义（项目骨架）
│   │       ├── types/              ← 接口按领域拆分
│   │       ├── fs/                 ← 文件系统适配器
│   │       ├── session/            ← Session 树管理
│   │       ├── memory/             ← 记忆系统
│   │       ├── lifecycle/          ← 生命周期钩子
│   │       ├── skill/              ← Skill 插槽
│   │       ├── tools/              ← Agent Tools 定义
│   │       ├── confirm/            ← 确认协议
│   │       └── index.ts            ← 统一导出
│   └── visualizer/
│       └── src/
│           ├── layout/             ← 星空图布局算法
│           ├── renderer/           ← Canvas 渲染
│           ├── interaction/        ← 缩放/平移/点击
│           └── StelloGraph.tsx     ← React 组件
├── .claude/
│   └── settings.json
├── CLAUDE.md                       ← 本文件
├── pnpm-workspace.yaml
├── tsconfig.json
└── package.json
```

---

## 架构概览

```
@stello-ai/core 三层架构：

Session 系统（结构层）— 管理对话的空间结构：谁是谁的子节点
    ↕
记忆系统（内容层）— 管理每个 Session "知道什么"
    ↕
文件系统（持久化层）— 管理数据"存在哪、怎么存"

+ Skill 插槽 + Agent Tools + 确认协议 + 生命周期钩子
```

---

## 核心概念速查

### Session 系统

- Session 是原子单元：一个独立对话空间
- 树状父子关系 + 跨分支横向引用（refs）
- 元数据：id, parentId, children, refs, label, scope, status, depth, turnCount, metadata, tags, 时间戳
- 不支持删除，只支持归档（归档不连带子 Session）
- 父 Session 可通过 index.md 查看子 Session 概况，按需加载子的 memory.md
- 子 Session 不能主动读兄弟的内容

### Session 拆分（双路径）

- **路径 A（被动）**：embedder 计算话题漂移分数 → 超阈值触发建议。可选，不传 embedder 则不激活。v0.1 只预留接口
- **路径 B（主动）**：Agent 通过 `stello_create_session` tool 主动拆分。v0.1 完整实现
- 保护机制：最少 N 轮（默认 3）+ 冷却期（默认 5 轮）

### 记忆系统

#### 三层结构

| 层 | 存什么 | 粒度 | 文件 |
|----|--------|------|------|
| L1 核心档案 | 结构化数据，schema 由开发者定义 | 全局唯一 | core.json |
| L2 Session 记忆 | 关键结论、意图、待跟进 | 每 Session 一份 | memory.md |
| L3 原始记录 | 完整对话 | 每 Session 一份 | records.jsonl |

#### Session 内置文件（每个 Session 必有）

| 文件 | 用途 | 谁生成 | 谁消费 |
|------|------|--------|--------|
| meta.json | 结构化元数据（父子关系、状态、时间戳） | 框架 | 框架 |
| memory.md | Session 记忆摘要（结论、意图、待跟进） | Agent（afterTurn 自动提炼） | Agent（bootstrap 注入） |
| scope.md | 对话边界（这个 Session 能聊什么、不能聊什么） | Agent（创建子 Session 时自动生成） | Agent（每轮读取，判断是否跑偏） |
| index.md | 子节点目录（子 Session 标题 + 简要摘要） | 框架自动维护（子 Session 创建/归档/memory 更新时重新生成） | Agent + 用户（查看下级分支概况） |
| records.jsonl | 原始对话记录（每行一条 turn） | 框架（实时追加） | 按需检索 |

**设计原则**：meta.json 存结构化关系数据（JSON），其余内容文件用 markdown（LLM 天然理解，用户可直接阅读）。开发者可往 Session 文件夹里加自定义文件，框架不管但不阻止。

#### 记忆继承（向下）— inheritancePolicy

- `full`：所有祖先 memory.md
- `summary`：只父 Session memory.md（默认）
- `minimal`：只 L1
- `scoped`：父 memory.md + 同 scope 兄弟 memory.md

#### 记忆冒泡（向上）— bubblePolicy

- 子 Session 的 L1 字段变更 → 写入全局 core.json
- 只有 schema 中标记 `bubbleable` 的字段才冒泡
- 即时冒泡 + 500ms debounce
- 冲突处理：默认 last-write-wins

### 文件系统

```
stello-data/
├── core.json                    ← L1（全局唯一）
└── sessions/                    ← 平铺存放（不嵌套）
    └── {session-id}/
        ├── meta.json            ← 结构化元数据（父子关系、状态）
        ├── memory.md            ← L2 记忆摘要（Agent 生成维护）
        ├── scope.md             ← 对话边界（创建时生成）
        ├── index.md             ← 子节点目录（框架自动维护）
        └── records.jsonl        ← L3 原始记录（每行一条 turn）
```

平铺不嵌套：树关系靠 meta.json 的 parentId 维护。adapter 模式，默认 FileSystemAdapter。

### Main Session

- 根 Session 标记 `isRoot: true`
- v0.2 核心特性：main session 可整合子 Session 成果、管理记忆/文件/Session（合并、清理、归档建议）
- v0.1 只做标记预留，不实现管理逻辑

### 生命周期钩子

| 钩子 | 触发时机 | 做什么 |
|------|----------|--------|
| bootstrap | 进入 Session | 读 L1 + memory.md，按继承策略组装上下文 |
| ingest | 每条消息进来 | 意图识别，匹配 Skill |
| assemble | 组装 prompt | 按继承策略筛选 memory.md 注入 prompt，注入当前 Session 的 scope.md |
| afterTurn | 每轮结束 | 提取写 L1 + 更新 memory.md + 追加 records.jsonl + 触发父 index.md 更新 |
| compact | context 接近上限 | 压缩旧内容存入 memory.md（v0.1 只留接口） |
| onSessionSwitch | 切换 Session | 旧 Session 更新 memory.md → 新 Session bootstrap |
| prepareChildSpawn | 创建子 Session 前 | 创建文件夹 + meta.json + 空 memory.md + 生成 scope.md + 更新父 index.md |

所有钩子有默认实现，开发者可覆盖。失败不阻塞对话。

### Agent Tools（8 个，通过 getToolDefinitions() 导出）

| Tool | 做什么 |
|------|--------|
| stello_update_core | 更新 L1 某字段 |
| stello_read_core | 读取 L1 某字段 |
| stello_create_session | 创建子 Session |
| stello_list_sessions | 列出所有 Session |
| stello_read_summary | 读某 Session 的 memory.md |
| stello_add_ref | 创建跨分支引用 |
| stello_archive | 归档 Session |
| stello_update_meta | 更新 Session 元数据 |

### 确认协议

- `splitProposal` 事件 → confirm/dismiss API → 创建或取消
- `updateProposal` 事件 → schema 中 `requireConfirm` 字段走确认流程
- 框架只管事件 + API，不提供 UI 组件

### Skill 插槽

- 注册接口 + 手动调用（v0.1 不做意图路由）
- Skill 结构：名称、描述、handler、引导提示

### 可视化（@stello-ai/visualizer）

- 星空图布局 + Canvas 渲染
- 节点映射：大小=turnCount、亮度=lastActiveAt、颜色=开发者自定义
- 父子=实线、引用=虚线、归档=低透明度
- 交互：缩放、平移、点击进入 Session、悬浮预览摘要
- React 组件：`<StelloGraph />`

---

## 代码规范

- 模块间只通过 interface 通信，不允许跨包 import 内部文件
- 每个文件不超过 200 行，超过就拆
- 每个函数写一行中文注释说明用途
- 每个 interface 写 JSDoc 注释
- KISS 原则，不做过度抽象
- TypeScript 严格模式，**不允许 any**，类型写不出来就简化设计
- 所有公开接口必须有测试
- 测试覆盖：正常路径 + 错误输入 + 边界条件
- FileSystemAdapter 测试必须用临时目录（os.tmpdir），beforeEach 创建，afterEach 删除

## Git 规范

- commit 格式：`feat/fix/docs/test/chore(模块名): 简短中文描述`
- 每个功能点一个 commit
- 改代码前先 commit 当前状态
- push 前先 `git diff --stat` 确认改动范围

## 工作流程

- 接到任务先列步骤，确认后再执行
- 每个功能点完成后：跑测试 → commit → 更新本文档进度
- 改代码前先 commit 当前状态
- 每次变更后必须跑 `pnpm test` 和 `tsc --noEmit`

---

## v0.1 降级项（明确不实现）

- Skill 意图路由（只做注册 + 手动调用）
- L3 全文搜索（只做 JSONL 追加读取）
- compact 默认压缩逻辑（只留接口）
- embedding 漂移检测路径 A（只预留接口）
- scope 横向召回（只做父子继承，scope 字段保留）
- Canvas 动画/脉冲（静态渲染）
- Skill Pipeline / 权限控制
- 时间轴回溯
- 多布局模式
- Main Session 管理能力（只做 isRoot 标记预留）

---

## 当前进度

- [x] 仓库创建（.gitignore, LICENSE, README）
- [x] 项目初始化（monorepo + TS + Vitest + tsup）`9af6b04`
- [x] types.ts 全量接口定义 `c684697`
- [x] FileSystemAdapter `efeefeb`
- [x] SessionTree CRUD + 跨分支引用 `ac64dc2`
- [x] 架构变更：Session 文件从 summary.json 改为 memory.md / scope.md / index.md `320b3d8`
- [ ] **记忆系统（L1 core.json + L2 memory.md + L3 records.jsonl）** ← **当前**
- [ ] bootstrap + assemble + afterTurn + onSessionSwitch 钩子
- [ ] 冒泡机制（bubbleable + debounce + 冲突处理）
- [ ] 拆分策略 + 保护机制
- [ ] 确认协议（splitProposal + updateProposal）
- [ ] Skill 插槽（注册 + 手动调用）
- [ ] Agent Tools（getToolDefinitions + 8 个 tool）
- [ ] 生命周期完整串联 + 集成测试
- [ ] 星空图布局 + Canvas 渲染 + 交互
- [ ] StelloGraph React 组件
- [ ] 终端 demo
- [ ] README + Quickstart
- [ ] npm 发布 0.1.0

## 最近改动日志

- `9af6b04` chore(init): 初始化 monorepo 项目结构
- `c684697` feat(types): 定义全量接口
- `efeefeb` feat(fs): 实现 NodeFileSystemAdapter — 7 个方法 + 9 个测试
- `ac64dc2` feat(session): 实现 SessionTree — createRoot/createChild/get/archive/addRef/updateMeta + 15 个测试
- `320b3d8` refactor(types): Session 文件从 summary.json 改为 memory.md / scope.md / index.md — 28 个测试

## 设计决策记录

- **平铺不嵌套**：Session 文件夹平铺在 sessions/ 下，树关系靠 parentId，agent 一步到位
- **双路径拆分**：embedding 被动检测（可选）+ Agent 主动调 tool（必有），最小启动不依赖 embedding
- **adapter 模式**：文件系统是默认适配器，可换 SQLite/Postgres，上层无感知
- **确认协议不含 UI**：框架只管事件和 API，开发者自己决定 UI 长什么样
- **afterTurn 三层独立写入**：某层失败不影响其他层，失败触发 onError
- **即时冒泡 + 500ms debounce**：同字段短时间多次变更只写最后一次
- **onChange 字段级粒度**：通知具体路径（如 profile.gpa），为 v0.2 Projection 打基础
- **v0.1 不做锁**：单进程够用，多进程场景建议换 DB adapter
- **JSON + Markdown 混合存储**：meta.json 存结构化关系数据（父子、状态、时间戳），memory.md / scope.md / index.md 存内容（LLM 天然理解 markdown，用户可直接阅读编辑）。summary.json 废弃，由 memory.md 替代
- **Session 内置三个 .md 文件**：memory.md（Agent afterTurn 维护）、scope.md（创建时 Agent 生成，定义对话边界）、index.md（框架自动维护，子节点目录）。开发者可加自定义文件，框架不管不阻止
- **Main Session 预留**：根 Session 标记 isRoot: true，v0.2 实现管理能力