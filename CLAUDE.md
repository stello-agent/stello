# CLAUDE.md — Stello 项目上下文

> Claude Code 每次启动必读。这是你的记忆。

---

## 项目定位

Stello 是首个开源对话拓扑引擎（TypeScript SDK）。让 AI Agent 自动将线性对话分裂为树状 Session，跨分支继承记忆，整个拓扑渲染为可交互的星空图。

**npm**：`@stello-ai/core@0.1.1` · `@stello-ai/visualizer@0.1.1`
**仓库**：`github.com/stello-agent/stello`
**示例**：`github.com/stello-agent/stello-examples`（独立仓库）
**协议**：Apache-2.0

---

## 技术栈

- 语言：TypeScript（严格模式，不允许 any）
- 包管理：pnpm monorepo（packages/core + packages/visualizer）
- 测试：Vitest（154 个用例）
- 打包：tsup（ESM + CJS + DTS）
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
│           ├── styles/             ← Liquid Glass 设计令牌
│           ├── layout/             ← 星空图布局算法
│           ├── renderer/           ← Canvas 渲染（渐变背景 + 节点发光）
│           ├── interaction/        ← 缩放/平移/点击/节点拖拽
│           └── components/         ← StelloGraph + ChatPanel + FilePanel + Tooltip
├── docs/
│   ├── sdk-prd.md                  ← 产品需求文档 v0.4
│   └── development-log.md          ← 开发日志（Phase 1-8 详细记录）
├── scripts/
│   └── smoke-test.ts
├── assets/
│   └── logo.png
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
- 拆分双路径：Agent 主动调 tool（v0.1）/ embedder 被动检测（v0.2）
- 保护机制：最少 N 轮（默认 3）+ 冷却期（默认 5 轮）

### 三层记忆

| 层 | 文件 | 说明 |
|----|------|------|
| L1 核心档案 | core.json | 全局唯一，开发者定义 schema，bubbleable 字段冒泡 |
| L2 Session 记忆 | memory.md | 每 Session 一份，afterTurn 自动提炼 |
| L3 原始记录 | records.jsonl | 每 Session 一份，追加写入 |

- **继承（向下）**：`summary`(默认) / `full` / `minimal` / `scoped`
- **冒泡（向上）**：bubbleable 字段 → 500ms debounce → 写入 core.json

### Session 内置文件

| 文件 | 用途 | 维护者 |
|------|------|--------|
| meta.json | 结构化元数据 | 框架 |
| memory.md | 记忆摘要 | Agent（afterTurn） |
| scope.md | 对话边界 | Agent（创建时） |
| index.md | 子节点目录 | 框架自动 |
| records.jsonl | 原始对话 | 框架追加 |

### 生命周期钩子

bootstrap → ingest → assemble → afterTurn → compact → onSessionSwitch → prepareChildSpawn

所有钩子有默认实现，可覆盖，失败不阻塞。afterTurn 三层独立写入。

### Agent Tools（8 个）

stello_read_core / stello_update_core / stello_create_session / stello_list_sessions / stello_read_summary / stello_add_ref / stello_archive / stello_update_meta

### 可视化（@stello-ai/visualizer）

- 星空图：环形布局 + Canvas 渐变背景 + 节点发光
- 交互：缩放、平移、节点拖拽、点击、悬浮
- 侧边栏：ChatPanel（对话）+ FilePanel（文件浏览）+ Tab 切换
- Liquid Glass 视觉风格，theme.ts 统一管理
- React 组件：`<StelloGraph />`、`<ChatPanel />`、`<FilePanel />`

---

## 代码规范

- 模块间只通过 interface 通信，不允许跨包 import 内部文件
- 每个文件不超过 200 行，超过就拆
- 每个函数写一行中文注释说明用途
- 每个 interface 写 JSDoc 注释
- KISS 原则，不做过度抽象
- TypeScript 严格模式，**不允许 any**
- 所有公开接口必须有测试（正常路径 + 错误输入 + 边界条件）
- FileSystemAdapter 测试必须用临时目录

## Git 规范

- commit 格式：`feat/fix/docs/test/chore(模块名): 简短中文描述`
- push 前先 `git diff --stat` 确认改动范围

## 工作流程

- 接到任务先列步骤，确认后再执行
- 每次变更后必须跑 `pnpm test` 和 `tsc --noEmit`

---

## v0.1 降级项（明确不实现）

Skill 意图路由 / L3 全文搜索 / compact 压缩逻辑 / embedding 漂移检测 / scope 横向召回 / Canvas 动画 / Skill Pipeline 权限 / 时间轴回溯 / 多布局模式 / Main Session 管理

---

## 当前状态

**v0.1 已完成并发布**（@stello-ai/core@0.1.1 + @stello-ai/visualizer@0.1.1）

core：118 测试 | visualizer：36 测试 | 共 154 个，全部通过

详细开发记录见 `docs/development-log.md`。

## 设计决策

- 平铺不嵌套：树关系靠 parentId，agent 一步定位
- 双路径拆分：embedding 被动（可选）+ Agent 主动（必有）
- adapter 模式：默认文件系统，可换 DB，上层无感知
- 确认协议不含 UI：框架只管事件和 API
- afterTurn 三层独立：某层失败不影响其他层
- 即时冒泡 + 500ms debounce：last-write-wins
- JSON + Markdown 混合：meta.json 管结构，.md 管内容
- visualizer 不依赖 core：鸭子类型兼容
- inline styles 零依赖：不引入 CSS 文件或 CSS-in-JS
