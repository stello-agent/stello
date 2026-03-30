<p align="right">
  <a href="./README_EN.md">English</a> | <strong>中文</strong>
</p>

<div align="center">
  <img src="./stello_logo.svg" alt="Stello" width="200">

  <h1>Stello</h1>

  <p><strong>用 AI Native 的方式认识世界</strong></p>
  <p>开源认知拓扑引擎 · 面向多 Session AI 系统</p>
  <p>你的思维正在发散成长！别让线性对话限制了它！</p>

  <p>
    <a href="https://www.npmjs.com/package/@stello-ai/core"><img src="https://img.shields.io/npm/v/@stello-ai/core.svg" alt="npm version"></a>
    <a href="./LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License"></a>
  </p>
</div>

<br/>

## 🌟 Stello 解决什么问题？

你是否觉得与AI的交流被困在了一条直线里，当你的思维开始发散，多方向展开并交织，对话越来越长，但上下文逐渐吃紧，回复质量悄然下降。两小时后关掉窗口，什么结构都没留下。几天后想继续，连自己聊到哪了都想不起来。

**不是模型不够强，是你与AI的协作方式太原始！**

你的思维在发散成长，AI却只通过一个滚动窗口和你线性交互！

Stello 把这条线炸开成一张网！构建了人与AI的全新协作范式，每一次对话都在构建一个具备自我意识且会生长的认知拓扑。

<br/>

## 💡 Stello 是什么？

**首个 AI Native 认知拓扑引擎。**

Stello 是一个开源的认知拓扑引擎，面向 AI Agent 和 AI 应用开发者。它提供对话自动分裂、三层分级记忆、全局意识整合和拓扑可视化四大核心能力。

对话按语义自动分裂为独立 Session，形成树状拓扑结构。三层记忆系统在 Session 之间分级继承。全局意识层（Main Session）跨所有分支感知冲突与依赖，并定向推送洞察。整棵认知拓扑渲染为可生长可对话的星空节点图。

线性聊天不适合会分叉、递归或需要上下文隔离的工作流。常见问题包括：

- 多个子问题堆在一个线程里，导致上下文被稀释
- 无法直观看到不同分支之间的关系
- 缺少稳定的跨分支综合机制
- 长周期会话在恢复时缺少结构信息

Stello 的做法是明确拆分三件事：

- **分支执行：** 子 Session 持有自己的 L3 历史
- **外部描述：** 子 Session 可以把 L3 提炼成供外部消费的 L2
- **全局整合：** 主 Session 读取所有 L2，产出 synthesis 和 insights

---

## 核心能力

- **对话自动分裂** — AI 识别话题分叉时通过工具调用创建子 Session，每个分支有明确 scope
- **三层分级记忆** — L3 原始对话 / L2 技能描述 / L1 全局认知，记忆在层级间流动
- **全局意识整合** — Main Session 收集所有子 Session 的 L2，生成 synthesis 并推送 insights
- **对话中零开销** — 所有记忆提炼异步执行（fire-and-forget），不阻塞对话流程
- **星空图可视化** — 每颗星是一个思考方向，连线是关联，大小映射深度，亮度映射活跃度
- **完全解耦架构** — 不绑定 LLM / 存储 / UI，Session 与 Topology 分离

---

## 核心概念

### 技能隐喻

每个子 Session 可以看作一个拥有私有实现和公开描述的技能。

```text
子 Session
  L3 = 该 Session 的原始对话历史
  L2 = 供 Main Session 消费的外部摘要

主 Session
  synthesis = 对所有子 Session L2 的整合视图
  insights = 定向推送给特定子 Session 的建议
```

### 三层记忆

| 层级 | 含义 | 消费者 |
| --- | --- | --- |
| L3 | 原始对话历史 | Session 自身的 LLM |
| L2 | Session 的外部摘要 | Main Session |
| L1 | 全局结构化状态和 synthesis | 应用层 / Main Session |

### 架构约束

- 子 Session 不读取自己的 L2。
- Main Session 读取 L2，不读取子 Session 的 L3。
- 子 Session 之间不直接通信。
- 跨 Session 信息通过 Main Session 的 insight 传播。

## 包说明

<table>
<tr>
<td width="50%" valign="top">

### `@stello-ai/session`

负责 Session 级别的能力：

- 组装 prompt 上下文
- 存储与回放 L3 记录
- 将 L3 consolidate 为 L2
- 处理支持 streaming 和 tool call 的 LLM 适配器

如果你只需要一个具备记忆能力的单 Session 抽象，优先看这个包。

</td>
<td width="50%" valign="top">

### `@stello-ai/core`

负责核心编排：

- 带 tool-call loop 的 turn 执行
- fork 编排
- consolidation / integration 调度
- runtime 管理与 orchestration strategy

如果你需要一棵 Session 拓扑，并由 Main Session 统一调度，优先看这个包。

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
  session: {
    llm: /* LLM adapter */,
    sessionResolver: async (id) => {
      /* 返回 session-compatible runtime */
    },
  },
})

const result = await agent.turn('main-session-id', '帮我规划一个产品策略')
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
