---
name: scheduler-design
description: Consolidation 触发机制：自动触发通过 Factory 配置内联，手动触发通过 StelloAgent API；全局 reflection 由应用层在 SDK 之上自行实现。
---

# Consolidation 触发机制

## 概述

Consolidation 的触发机制有两条路径：

1. **自动触发**：`consolidateEveryNTurns` 配置项，由 Factory 内联处理
2. **手动触发**：`agent.consolidateSession(sessionId)`

跨 Session 的 reflection 由应用层在 `agent.listSessionDigests` / `agent.putInsight` 之上自行实现，详见 skill `session-usage`。

---

## 自动 Consolidation

在 `orchestration` 配置中设置 `consolidateEveryNTurns`，每 N 轮对话后自动触发 consolidation（fire-and-forget）：

```typescript
orchestration: {
  consolidateEveryNTurns: 5,
}
```

这是框架提供的唯一自动触发策略。逻辑内联在 Factory 的 hook 中，无独立调度器组件。

---

## 手动触发

```typescript
await agent.consolidateSession(sessionId)
```

应用层可在任意时机调用，例如 session 结束时、定时任务、用户操作后。

---

## 应用层 Reflection 循环

```typescript
async function reflect() {
  const digests = await agent.listSessionDigests({ status: 'active' })
  // 调任意 LLM、用任意 schema 解析 ...
  for (const [id, content] of Object.entries(insightsByTarget)) {
    await agent.putInsight(id, content)
  }
}
```

可在 `hooks.onRoundEnd` / `hooks.onSessionFork` 内 fire-and-forget 触发，或绑定到外部 cron / 用户操作。框架不假设调用频率与策略——这部分被有意外推到应用层。

---

## 设计决策

调度被有意压到最小：
- 自动调度只保留"每 N 轮 consolidate"——这是高频被用的唯一策略，其他策略都被应用层覆盖
- 全局 reflection 的频率 / prompt / schema / LLM tier 选择强烈与应用业务耦合，框架不假设
- reflection 由应用层在 `listSessionDigests` / `putInsight` 之上自行实现，框架不持有跨 Session 状态
