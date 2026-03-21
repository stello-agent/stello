# CLAUDE.md — Stello 项目上下文

> Claude Code 每次启动必读。这是你的记忆。

---

## 项目定位

Stello 是开源对话拓扑引擎（TypeScript SDK）。让 AI Agent 将线性对话分裂为树状 Session，跨分支通过 Main Session 传递洞察，整个拓扑可渲染为可交互的星空图。

**npm**：`@stello-ai/core@0.1.1` · `@stello-ai/visualizer@0.1.1`（v0.1 已发布）
**仓库**：`github.com/stello-agent/stello`
**示例**：`github.com/stello-agent/stello-examples`（独立仓库）
**协议**：Apache-2.0

---

## 当前状态

**v0.2 重构进行中**（分支 `refactor/v2`）

- v0.1 已发布（core 118 测试 + visualizer 36 测试 = 154 个，全部通过）
- v0.2 新建 `packages/session`（`@stello-ai/session`），接口定义 + 测试骨架已就位
- 设计文档：`docs/sdk-v2-design.md`

---

## 技术栈

- 语言：TypeScript（严格模式，不允许 any）
- 包管理：pnpm monorepo（packages/core + packages/session + packages/visualizer）
- 测试：Vitest
- 打包：tsup（ESM + CJS + DTS）
- 代码规范：ESLint + Prettier

---

## v0.2 三层组件架构

```
┌─────────────────────────────────────────────────────────┐
│  应用层（Application Layer）                               │
│  开发者提供：StorageAdapter · LLMAdapter · system prompt  │
│  · ConsolidateFn（L3→L2）· IntegrateFn（L2s→synthesis）   │
│  · 触发时机配置 · 工具定义                                 │
├─────────────────────────────────────────────────────────┤
│  编排层（Orchestration Layer）— 未实现                      │
│  管理执行周期：tool call 循环 · 触发时机判断                │
│  · consolidation/integration 调度 · Session 切换/路由      │
│  · SplitPolicy 检查 · 事件发射                             │
├─────────────────────────────────────────────────────────┤
│  Session 层（@stello-ai/session）— 当前实现中               │
│  独立对话单元：接收消息 → 组装上下文 → 单次 LLM 调用        │
│  → 保存 L3 → 返回响应                                     │
│  暴露 consolidate() 供上层调度 L3→L2 提炼                   │
│  接受 Main Session 的 insights 注入                        │
└─────────────────────────────────────────────────────────┘
         ↑ 依赖注入
   StorageAdapter    LLMAdapter
```

### Session 层职责（@stello-ai/session）

Session 是**有记忆的对话单元**，不是存储容器。核心能力：

1. **对话**：接收消息 → 组装上下文（system prompt + insights + L3 历史 + 当前消息）→ 调一次 LLM → 存 L3 → 返回响应
2. **记忆**：L3 持久化（追加/读取）+ 暴露 `consolidate()` 由上层触发 L3→L2 提炼
3. **文档**：per-session 文档读写（scope, insights 等）
4. **生命周期**：meta 管理、归档、fork（根据 forkRole 一次性继承父链上下文，之后独立挂到 Main Session 下）

Session **不做**：tool call 循环、consolidation 触发时机判断、Session 切换路由、integration cycle。这些是编排层职责。

### 三层记忆模型（v0.2）

| 层 | 语义 | 消费者 |
|----|------|--------|
| L3 | 原始对话记录 | 该 Session 自身的 LLM |
| L2 | 技能描述（外部视角） | Main Session 的 LLM |
| L1-structured | 全局键值（core.json） | 应用层直接读写 |
| L1-emergent | Main Session 综合认知（synthesis） | Main Session 自身 |

关键语义变化（vs v0.1）：
- L2 **不是** Session 自用工作记忆，是给 Main Session 消费的外部描述
- L2 对子 Session 自身 **不可见**
- **无冒泡**，**无持续父链依赖** — fork 时根据 forkRole 一次性继承父链上下文，之后与父链断开，挂到 Main Session 下作为平级子 Session
- 跨 Session 信息传递由 Main Session → insights 定向推送
- **零对话中 LLM 开销**：L2 在 consolidation 时批量生成，不在每轮对话中更新

### Session 上下文组装规则（固定，不可覆盖）

**子 Session**：system prompt + insights（Main 推送的）+ 最近 N 轮 L3 + 当前消息
**Main Session**：system prompt + 所有子 Session L2（技能清单）+ synthesis + 最近 N 轮 L3 + 当前消息

### 外部注入点

| 注入 | 说明 |
|------|------|
| StorageAdapter | 持久化抽象（业务语义键，非文件路径） |
| LLMAdapter | LLM 接口（支持消息数组、tool use），多 tier（default/fast/strong） |
| ConsolidateFn | L3→L2 转换逻辑，应用层定义 L2 格式 |
| IntegrateFn | all L2s → synthesis + insights，与 ConsolidateFn 配对 |
| system prompt | 全局共享，所有 Session 可见 |
| tool 定义 | 工具 schema + 执行函数（编排层驱动 tool call 循环） |

---

## 目录结构

```
stello/
├── packages/
│   ├── core/                  ← v0.1 实现（已发布）
│   ├── session/               ← v0.2 Session 层（开发中）
│   │   └── src/
│   │       ├── types/         ← 接口定义（session, storage, llm, session-api, functions）
│   │       ├── mocks/         ← InMemoryStorageAdapter
│   │       ├── tool.ts        ← tool() 工厂函数
│   │       ├── create-session.ts  ← createSession / loadSession
│   │       └── index.ts
│   └── visualizer/            ← 星空图可视化（已发布）
├── docs/
│   ├── sdk-v2-design.md       ← v0.2 架构设计文档（唯一参考）
│   ├── sdk-prd.md             ← 产品需求文档
│   └── development-log.md     ← v0.1 开发日志
├── .claude/skills/            ← Agent skills
├── CLAUDE.md                  ← 本文件
└── pnpm-workspace.yaml
```

---

## 代码规范

- 模块间只通过 interface 通信，不允许跨包 import 内部文件
- 每个文件不超过 200 行，超过就拆
- 每个函数写一行中文注释说明用途
- 每个 interface 写 JSDoc 注释
- KISS 原则，不做过度抽象
- TypeScript 严格模式，**不允许 any**
- 所有公开接口必须有测试（正常路径 + 错误输入 + 边界条件）

## Git 规范

- commit 格式：`feat/fix/docs/test/chore(模块名): 简短中文描述`
- push 前先 `git diff --stat` 确认改动范围

## 工作流程

- 接到任务先列步骤，确认后再执行
- 每次变更后必须跑 `pnpm test` 和 `tsc --noEmit`

---

## 设计决策（v0.2 已确认，不再讨论）

1. L2 对子 Session 自身不可见 — L2 是外部描述
2. Main Session 只读 L2，不读子 Session 的 L3
3. insights 替换策略（不追加）— 每次 integration 给出最新完整判断
4. 回调一次性注入（immutable config）
5. consolidate/integrate 均 fire-and-forget — 不阻塞对话
6. 错误处理：emit error，不中断对话周期
7. Session 上下文组装为固定规则，不暴露 assembler 扩展点
8. fork 一次性继承后独立 — 新 Session 挂到 Main Session 下，无冒泡，跨 Session 通信靠 insights
9. Session 做单次 LLM 调用 — tool call 循环由编排层驱动

## v0.2 降级项（不实现）

L3 全文搜索 / compact 压缩 / embedding 漂移检测 / scope 横向召回 / Canvas 动画 / Skill Pipeline 权限 / 时间轴回溯 / 多布局模式
