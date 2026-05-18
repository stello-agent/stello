---
name: session-usage
description: Session 对话单元的设计理念、上下文组装规则、memory / insight 槽位语义、单一 Session 模型与跨 Session 通信模型。
---

# Session 使用

## 单一 Session 模型

`@stello-ai/session` 只对外暴露**一种** Session。对话起点是一个 `parentId === null` 的 root session（由 `agent.createSession()` 创建），其余通过 `agent.forkSession()` 挂在父节点下。Root 与 child 在运行时行为完全一致——差异仅在 `TopologyNode.parentId`。

一棵树可以有任意多 root，互相独立（森林）。

Session 始终是**单次 LLM 调用原语**：`send()` 单次调用 + 持久化，tool call 循环由 `@stello-ai/core` 的 `Engine` 驱动。

---

## 上下文组装规则

这是固定规则，不暴露扩展点（设计决策 #7）。

```
system prompt → session_identity(label) → insight(若有，消费后清除) → L3 历史 → 当前用户消息
```

- **system prompt** 来自 `getSystemPrompt(sessionId)`，全局每 Session 一份。
- **session_identity** 由 `label` 自动生成的 `<session_identity>` 系统消息，告知 LLM 当前所在子会话身份。
- **insight** 来自 `getInsight(sessionId)`，**一次性**：被消费后 send() 内置触发 `clearInsight`。
- **L3 历史** 来自 `listRecords(sessionId)`，会先经 `removeIncompleteToolCallGroups` 净化掉因中断/崩溃残留的不完整 tool call 组。
- **memory 槽位不进入 send() 上下文**——它是对外暴露的描述，由 orchestrator-facing 视角消费，详见下文。

当估算 token 数超过 `maxContextTokens * 0.8` 时，会调用闭包注入的 `compressFn`，将历史压缩为一段 system 摘要，与近期消息拼接。Session 内部缓存压缩结果，避免每次 send() 都调用 compressFn。

---

## 三个上下文槽位的语义

每个 Session 在 `SessionStorage` 中有三个独立内容槽位：

| 槽位 | 写入者 | 消费者 | 生命周期 |
|------|--------|--------|---------|
| `systemPrompt` | fork 合成链固化 / 应用层 | Session.send() 组装上下文 | 持久（每次 send 读取） |
| `insight` | Orchestrator（应用层通过 `putInsight`） | Session.send() 消费一次后清除 | 一次性 inbox |
| `memory` | 应用层（通过 consolidate 输出 / 直接 `putMemory`） | Orchestrator-facing 反思层（`listSessionDigests`） | 持久（被外部读，不进 send） |

**关键不变量**：`memory` 不进入 Session 自身的 LLM 上下文。它是面向外部视角的描述——上层可以批量收集所有 Session 的 memory 做反思、规划、调度，再通过 `putInsight` 把派生的洞察定向回写给目标 Session。Session 自身不感知这个回路。

---

## 跨 Session 通信模型

子 Session 之间完全不感知。唯一的跨 Session 信息通道：

```
所有 Session 的 memory   ──┐
                          ├─→  应用层反思层（任意 LLM）──→  putInsight(targetId, content)
                          ┘
（StelloAgent.listSessionDigests 一次性取齐）
```

- **反思层由应用层实现**：应用层可以用任意频率、任意 LLM、任意策略对 `listSessionDigests` 的结果做综合，再把派生 insight 定向回写。
- **insight 是一次性的**：每次 reflection 写入新 insight；target session 下一次 send() 注入后自动 clear。重复 reflect 不会累积。
- **memory 是持久的**：`putMemory` 的语义是替换不是追加。

---

## fork() 的语义

Session 层 `fork(options)` 完成上下文继承：

- 创建一个新 Session 实例（id 由调用方传入，topology-first）
- 按 `context: 'none' | 'inherit' | ForkContextFn` 决定是否拷贝父 session 的 L3 记录
- 不复制 memory / insight 槽位
- 一次性继承后两个 Session 互相独立

Engine 在编排层会先创建 TopologyNode（拿到 ID），再调用 `session.fork({ id })`。调用方通过 `agent.forkSession()` 一次完成两步，详见 skill `fork-design`。

---

## LLM Adapter

包内置两个 adapter：OpenAI 兼容协议和 Anthropic 协议（均为 optional peerDependencies）。也可自行实现 `LLMAdapter` 接口。

---

## ConsolidateFn / CompressFn

- **ConsolidateFn**：L3 → memory 的提炼函数，由应用层定义输出格式，框架对 memory 内容格式完全无感知。
- **CompressFn**：超 token 阈值时把对话历史压缩为一段摘要，注入到上下文里。
- 两者都不注入 LLM——应用层通过闭包自行选择 LLM tier（设计决策 #12）。
