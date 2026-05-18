<p align="right">
  <a href="./README_EN.md">English</a> | <strong>中文</strong>
</p>

<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./assets/stello_logo_light.svg">
    <source media="(prefers-color-scheme: light)" srcset="./assets/stello_logo.svg">
    <img src="./assets/stello_logo.svg" alt="Stello" width="200">
  </picture>

  <h1>Stello</h1>

  <p><strong>你的思维正在发散成长！别让线性对话限制了它！</strong></p>
  <p>构建开源 Agent 认知拓扑引擎，用 AI Native 的方式认识世界</p>

  <p>
    <a href="https://www.npmjs.com/package/@stello-ai/core"><img src="https://img.shields.io/npm/v/@stello-ai/core.svg" alt="npm version"></a>
    <a href="./LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License"></a>
  </p>
</div>

<br/>

## 🌟 Stello 解决什么问题？

你是否觉得与AI的交流被困在了一条直线里，当你的思维开始发散，多方向展开并交织，对话越来越长，但上下文逐渐吃紧，回复质量悄然下降。两小时后关掉窗口，什么结构都没留下。几天后想继续，连自己聊到哪了都想不起来。

**不是模型不够强，是你与AI的协作方式太原始！** 你的思维在发散成长，AI却只通过一个滚动窗口和你线性交互！

**Stello 把这条线炸开成一张网！你的每一次对话都在构建一个有自我意识、会持续成长的认知拓扑！**

<br/>

## 🌟 Stello 是什么？

**Agent 认知拓扑引擎。**

Stello 是一个开源的对话拓扑引擎，面向 AI Agent 和 AI 应用开发者。它把对话切成可分裂的 Session 森林，每个 Session 既有自己的对话历史，又对外暴露可被反思的描述；跨分支的综合洞察由你的应用层用任意 LLM 完成，再通过 SDK 定向回写给目标 Session。整棵拓扑可渲染为可生长可对话的星空节点图。

线性聊天不适合会分叉、递归或需要上下文隔离的工作流。常见问题包括：

- 多个子问题堆在一个线程里，导致上下文被稀释
- 无法直观看到不同分支之间的关系
- 缺少稳定的跨分支综合机制
- 长周期会话在恢复时缺少结构信息

Stello 的做法是明确拆分三件事：

- **分支执行：** 每个 Session 持有自己的 L3 历史
- **外部描述：** 每个 Session 把对话提炼成 `memory`，供外部 orchestrator 消费
- **全局综合：** Orchestrator-facing 数据 SDK 让应用层批量收集所有 Session 的 memory，做综合反思后通过 `insight` 定向回写

---

## 核心能力

- **对话自动分裂** — AI 识别话题分叉时通过工具调用创建子 Session，每个分支有明确 scope
- **单一 Session 模型** — root 与 child 同构，差异仅在拓扑位置；多 root 合法（森林）
- **三个内容槽位** — `systemPrompt`（持久注入）/ `insight`（一次性 inbox）/ `memory`（对外描述，不进自身上下文）
- **Orchestrator-facing 数据 SDK** — `listSessionDigests` / `putInsight` 等暴露给外部反思层（你的应用 / Claude Code / Codex 等），跨分支综合由你的应用层用任意 LLM 实现
- **对话中零开销** — 所有记忆提炼异步执行（fire-and-forget），不阻塞对话流程
- **星空图可视化** — 每颗星是一个思考方向，连线是关联，大小映射深度，亮度映射活跃度
- **完全解耦架构** — 不绑定 LLM / 存储 / UI；Session 内容与 Topology 结构分离注入

---

## 核心概念

### 单一 Session + 应用层 Orchestrator

每个 Session 可以看作一个拥有私有实现和公开描述的对话单元。

```text
Session（root 或 child，运行时同构）
  L3      = 该 Session 的原始对话历史（自己消费）
  memory  = 对外描述（应用层 / orchestrator 消费）
  insight = 一次性 inbox（被 send 注入并 clear）

应用层 Orchestrator（不在框架内）
  batch read  = listSessionDigests({ status: 'active' })
  reflection  = 任意 LLM 综合所有 Session 的 memory
  targeted push = putInsight(targetSessionId, content)
```

### 三个内容槽位

| 槽位 | 写入者 | 消费者 | 生命周期 |
|------|--------|--------|---------|
| `systemPrompt` | fork 合成链 / 应用层 | Session.send() 注入 | 持久 |
| `insight` | 应用层（`putInsight`） | Session.send() 消费后 `clearInsight` | 一次性 inbox |
| `memory` | 应用层 / `consolidateFn` | 外部反思层（`listSessionDigests`） | 持久（不进 send 上下文） |

### 架构约束

- Session 不读取自己的 `memory`（memory 是外部视角的描述）。
- Session 之间互相不感知。
- 跨 Session 信息传播走 `insight` 一次性 inbox。
- 全局反思由应用层在 SDK 之上自行实现——框架不持有跨 Session 状态。

## 包说明

<table>
<tr>
<td width="50%" valign="top">

### `@stello-ai/session`

负责 Session 级别的能力：

- 组装 prompt 上下文
- 存储与回放 L3 记录
- 把对话提炼为 `memory`（consolidate）
- 处理支持 streaming 和 tool call 的 LLM 适配器

如果你只需要一个具备记忆能力的单 Session 抽象，优先看这个包。

</td>
<td width="50%" valign="top">

### `@stello-ai/core`

负责核心编排和 orchestrator-facing 数据 SDK：

- StelloAgent 顶层入口（创建 / 进入 / turn / stream / fork / 数据 SDK）
- 带 tool-call loop 的 turn 执行
- fork 编排（topology + Session 两步）
- consolidation 调度
- runtime 引用计数管理与生命周期

如果你需要一棵 Session 拓扑加 orchestrator-facing 数据 SDK，优先看这个包。

</td>
</tr>
<tr>
<td width="50%" valign="top">

### `@stello-ai/server`

负责服务化封装：

- REST 与 WebSocket API
- PostgreSQL 持久化
- 多 space / 多租户托管模式
- 长生命周期 agent runtime 管理

如果你需要可部署的后端，而不只是进程内 SDK，优先看这个包。

</td>
<td width="50%" valign="top">

### `@stello-ai/devtools`

负责开发调试能力：

- 拓扑图检查
- 对话回放
- prompt / settings 编辑
- 事件流观察
- 本地 agent 行为调试

这个包面向开发阶段，不是生产环境 UI 依赖。

</td>
</tr>
</table>

## 快速开始

### 安装

```bash
pnpm add @stello-ai/core @stello-ai/session

# 开发阶段可选
pnpm add -D @stello-ai/devtools
```

### 创建 agent

```ts
import { createStelloAgent } from '@stello-ai/core'

const agent = createStelloAgent({
  sessions: /* SessionTree 实现 */,
  storage:  /* SessionStorage 实现（启用 orchestrator-facing 数据 SDK） */,
  memory:   /* MemoryEngine 实现 */,
  capabilities: {
    lifecycle, tools, skills, confirm,
  },
  session: {
    sessionLoader: async (id) => {
      /* 按 id 返回 Session 实例与固化配置 */
    },
  },
})

// 创建对话起点（不传 parentId 即新 root）
const root = await agent.createSession({ label: 'Main' })

await agent.enterSession(root.id)
const result = await agent.turn(root.id, '帮我规划一个产品策略')
```

### 启动 devtools

```ts
import { startDevtools } from '@stello-ai/devtools'

await startDevtools(agent, {
  port: 4800,
  open: true,
})
```

## 文档

- [使用指南](./docs/usage.md)
- [Stello 总览](./docs/stello-usage.md)
- [Orchestrator 使用说明](./docs/orchestrator-usage.md)
- [Server 设计与职责](./docs/server-package-plan.md)
- [API / 配置参考](./docs/stello-agent-config-reference.md)
- [贡献指南](./CONTRIBUTING.md)

## 开发

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

常用本地命令：

```bash
pnpm demo:agent
pnpm demo:chat
```

## 许可证

Apache-2.0 © [Stello Team](https://github.com/stello-agent)

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=stello-agent/stello&type=Date)](https://star-history.com/#stello-agent/stello&Date)
