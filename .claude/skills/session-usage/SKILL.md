---
name: session-usage
description: Session / MainSession 对话单元的设计理念、上下文组装规则、insights 交流模型。
---

## 两种 Session

`@stello-ai/session` 提供两个独立接口：

| | Session（子 Session） | MainSession（全局意识层） |
|--|----------------------|-------------------------|
| 上下文 | system prompt + insight + L3 + msg | system prompt + synthesis + L3 + msg |
| 记忆 | `memory()` = L2（技能描述，给 Main 看） | `synthesis()` = integration 产出 |
| 提炼 | `consolidate(fn)` L3→L2 | `integrate(fn)` 所有 L2→synthesis+insights |
| insights | 被动接收（消费后清除） | 通过 integrate 主动推送 |
| fork | `fork()` 创建子 Session | 无 — 子 Session 由编排层创建 |

两者都是**单次 LLM 调用原语**，tool call 循环由上层驱动。

---

## 上下文组装规则

这是固定规则，不暴露扩展点（设计决策 #7）。

**子 Session**：system prompt → insight（如有，消费后清除）→ L3 历史 → 当前消息

**Main Session**：system prompt → synthesis（如有）→ L3 历史 → 当前消息

每个上下文元素对应 SessionStorage 中的一个专用槽位。

---

## Insights 交流模型

这是 Session 间唯一的信息通道：

1. **Integration 生成 insights**：MainSession.integrate(fn) 收集所有子 L2 → IntegrateFn 生成 synthesis + per-child insights
2. **定向推送**：每个 insight 通过 `putInsight(sessionId, content)` 写入目标子 Session
3. **消费即清除**：子 Session 下次 send() 时读取 insight，注入上下文，然后清除
4. **替换策略**：每次 integration 覆盖上一次的 insight（不追加）

子 Session 之间完全不感知。唯一的跨 Session 信息来源是 Main Session 推送的 insights。

---

## L2 的语义

L2 是子 Session 的**外部描述**（技能描述），不是自用记忆。

- L2 对子 Session 自身 LLM **不可见**（设计决策 #1）
- Main Session 只读 L2，不读子 Session 的 L3（设计决策 #2）
- L2 在 consolidation 时批量生成，不在每轮对话中更新
- 正在进行中的 Session 没有 L2，对 Main Session 暂时不可见——有意为之

---

## LLM Adapter

包内置两个 adapter：OpenAI 兼容协议和 Anthropic 协议（均为 optional peerDependencies）。也可自行实现 `LLMAdapter` 接口。

---

## ConsolidateFn / IntegrateFn 配对

这两个函数是**配对的**——ConsolidateFn 输出某种格式的 L2，IntegrateFn 读取该格式。框架对 L2 内容格式完全无感知。

两个函数都不注入 LLM——应用层通过闭包自行选择 LLM tier（设计决策 #12）。
