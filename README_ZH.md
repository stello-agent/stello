<p align="right">
  <a href="./README.md">English</a> | <strong>中文</strong>
</p>

<div align="center">
  <img src="./stello_logo.svg" alt="Stello" width="200">

  <h1>Stello</h1>

  <p>面向多 Session AI 系统的开源会话拓扑引擎。</p>

  <p>
    <a href="https://www.npmjs.com/package/@stello-ai/core"><img src="https://img.shields.io/npm/v/@stello-ai/core.svg" alt="npm version"></a>
    <a href="./LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License"></a>
  </p>
</div>

## 概述

Stello 不是把 AI 工作流建模成一条线性的聊天记录，而是建模成一棵由多个 Session 组成的拓扑。
每个子 Session 负责一个有边界的工作分支，主 Session 负责整合各分支的摘要，并在需要时向下推送定向 insight。

当前仓库主要包含四个包：

- `@stello-ai/session`：Session 原语、上下文组装、L2/L3 记忆、LLM 适配器
- `@stello-ai/core`：编排、fork 策略、调度、integration、agent runtime
- `@stello-ai/server`：基于 PostgreSQL 的 HTTP / WebSocket 服务层
- `@stello-ai/devtools`：用于检查拓扑、对话、配置和事件的本地调试 UI

## 这个项目解决什么问题

线性聊天不适合会分叉、递归或需要上下文隔离的工作流。常见问题包括：

- 多个子问题堆在一个线程里，导致上下文被稀释
- 无法直观看到不同分支之间的关系
- 缺少稳定的跨分支综合机制
- 长周期会话在恢复时缺少结构信息

Stello 的做法是明确拆分三件事：

- 分支执行：子 Session 持有自己的 L3 历史
- 外部描述：子 Session 可以把 L3 提炼成供外部消费的 L2
- 全局整合：主 Session 读取所有 L2，产出 synthesis 和 insights

## 核心模型

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

### `@stello-ai/session`

负责 Session 级别的能力：

- 组装 prompt 上下文
- 存储与回放 L3 记录
- 将 L3 consolidate 为 L2
- 处理支持 streaming 和 tool call 的 LLM 适配器

如果你只需要一个具备记忆能力的单 Session 抽象，优先看这个包。

### `@stello-ai/core`

负责核心编排：

- 带 tool-call loop 的 turn 执行
- fork 编排
- consolidation / integration 调度
- runtime 管理与 orchestration strategy

如果你需要一棵 Session 拓扑，并由 Main Session 统一调度，优先看这个包。

### `@stello-ai/server`

负责服务化封装：

- REST 与 WebSocket API
- PostgreSQL 持久化
- 多 space / 多租户托管模式
- 长生命周期 agent runtime 管理

如果你需要可部署的后端，而不只是进程内 SDK，优先看这个包。

### `@stello-ai/devtools`

负责开发调试能力：

- 拓扑图检查
- 对话回放
- prompt / settings 编辑
- 事件流观察
- 本地 agent 行为调试

这个包面向开发阶段，不是生产环境 UI 依赖。

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
