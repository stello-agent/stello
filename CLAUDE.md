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
│   │       ├── fs/                 ← 文件系统适配器
│   │       ├── session/            ← Session 树管理
│   │       ├── memory/             ← 三层记忆系统
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

### Session 拆分（双路径）

- **路径 A（被动）**：embedder 计算话题漂移分数 → 超阈值触发建议。可选，不传 embedder 则不激活。v0.1 只预留接口
- **路径 B（主动）**：Agent 通过 `stello_create_session` tool 主动拆分。v0.1 完整实现
- 保护机制：最少 N 轮（默认 3）+ 冷却期（默认 5 轮）

### 记忆三层结构

| 层              | 存什么                          | 粒度            | 文件          |
| --------------- | ------------------------------- | --------------- | ------------- |
| L1 核心档案     | 结构化数据，schema 由开发者定义 | 全局唯一        | core.json     |
| L2 Session 摘要 | 关键结论、意图、待跟进          | 每 Session 一份 | summary.json  |
| L3 原始记录     | 完整对话                        | 每 Session 一份 | records.jsonl |

### 记忆继承（向下）— inheritancePolicy

- `full`：所有祖先 L2
- `summary`：只父 Session L2（默认）
- `minimal`：只 L1
- `scoped`：父 L2 + 同 scope 兄弟 L2

### 记忆冒泡（向上）— bubblePolicy

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
        ├── meta.json            ← Session 元数据
        ├── summary.json         ← L2 摘要
        └── records.jsonl        ← L3 原始记录（每行一条 turn）
```

平铺不嵌套：树关系靠 meta.json 的 parentId 维护。adapter 模式，默认 FileSystemAdapter。

### 生命周期钩子

| 钩子              | 触发时机          | 做什么                                    |
| ----------------- | ----------------- | ----------------------------------------- |
| bootstrap         | 进入 Session      | 读 L1 + L2，按继承策略组装上下文          |
| ingest            | 每条消息进来      | 意图识别，匹配 Skill                      |
| assemble          | 组装 prompt       | 按继承策略筛选 L2 注入 prompt             |
| afterTurn         | 每轮结束          | 提取写 L1 + 提炼 L2 + 追加 L3             |
| compact           | context 接近上限  | 压缩旧内容存入 L2（v0.1 只留接口）        |
| onSessionSwitch   | 切换 Session      | 旧 Session 更新 L2 → 新 Session bootstrap |
| prepareChildSpawn | 创建子 Session 前 | 创建文件夹 + meta.json + 组装初始上下文   |

所有钩子有默认实现，开发者可覆盖。失败不阻塞对话。

### Agent Tools（8 个，通过 getToolDefinitions() 导出）

| Tool                  | 做什么              |
| --------------------- | ------------------- |
| stello_update_core    | 更新 L1 某字段      |
| stello_read_core      | 读取 L1 某字段      |
| stello_create_session | 创建子 Session      |
| stello_list_sessions  | 列出所有 Session    |
| stello_read_summary   | 读某 Session 的 L2  |
| stello_add_ref        | 创建跨分支引用      |
| stello_archive        | 归档 Session        |
| stello_update_meta    | 更新 Session 元数据 |

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

---

## 当前进度

- [x] 仓库创建（.gitignore, LICENSE, README）
- [x] 项目初始化（monorepo + TS + Vitest + tsup）`9af6b04`
- [x] types.ts 全量接口定义 `c684697`
- [x] FileSystemAdapter `efeefeb`
- [ ] SessionTree CRUD + 跨分支引用 ← **当前**
- [ ] L1 核心档案（schema + 点路径读写 + onChange）
- [ ] L2 摘要读写 + summaryExtractor 接口
- [ ] L3 原始记录（JSONL 追加读取）
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

- `9af6b04` chore(init): 初始化 monorepo 项目结构 — pnpm workspace、TypeScript 严格模式、tsup 打包、Vitest、ESLint + Prettier、.claude/settings.json
- `c684697` feat(types): 定义全量接口 — 拆为 5 个子文件 (session/memory/fs/lifecycle/engine) + types.ts 统一再导出
- `efeefeb` feat(fs): 实现 NodeFileSystemAdapter — 7 个方法 + 9 个测试

## 设计决策记录

- **平铺不嵌套**：Session 文件夹平铺在 sessions/ 下，树关系靠 parentId，agent 一步到位
- **双路径拆分**：embedding 被动检测（可选）+ Agent 主动调 tool（必有），最小启动不依赖 embedding
- **adapter 模式**：文件系统是默认适配器，可换 SQLite/Postgres，上层无感知
- **确认协议不含 UI**：框架只管事件和 API，开发者自己决定 UI 长什么样
- **afterTurn 三层独立写入**：某层失败不影响其他层，失败触发 onError
- **即时冒泡 + 500ms debounce**：同字段短时间多次变更只写最后一次
- **onChange 字段级粒度**：通知具体路径（如 profile.gpa），为 v0.2 Projection 打基础
- **v0.1 不做锁**：单进程够用，多进程场景建议换 DB adapter
