---
name: llm-call-sites
description: Stello 框架内所有 LLM 调用位置的消息结构速查。覆盖 Session 对话、compress、consolidate；应用层 reflection 调用由 orchestrator 自行决定。
---

# LLM 调用消息结构

Stello 里所有 LLM 调用的 `messages` 参数构成。Session 同构——root 与 child 走同一套上下文组装规则，差异只在 `meta.label`。

---

## 1. Session 对话

```
[
  { role: 'system',    content: systemPrompt },       // 可能含 <parent_context> 块；若非空
  { role: 'system',    content: <session_identity> }, // 若 meta.label 非空
  { role: 'system',    content: insight },            // 若非空，消费后清除
  { role: 'system',    content: compressSummary },    // 仅当触发自动压缩
  ...recentL3History,                                 // user / assistant / tool
  { role: 'user',      content: userInput },
]
```

`tools` 经 `llm.complete(messages, { tools })` 第二参数传入，不进 messages。

`<session_identity>` 形态（label 缺省则该消息不注入）：

```
<session_identity>
你当前在「{meta.label}」子会话中。
</session_identity>
```

label 改名后下次 send 自动同步，无需重写持久化的 systemPrompt。

`systemPrompt` 在 fork-compress 场景形态：

```
{合成后的 systemPrompt}

<parent_context>
{父 session 压缩摘要}
</parent_context>
```

所有 Session 同构走这套规则。Root 也是普通 Session，差异只在 `meta.label`。如需在 root 上注入"全局综合"，应用层把综合结果通过 `putInsight(rootId, content)` 一次性写入即可。`memory` 槽位**不进入** send() 上下文。

---

## 2. Compress

```
[
  { role: 'system', content: COMPRESS_PROMPT },
  { role: 'system', content: <role_context> },       // 若传入非空 roleContext
  { role: 'user',   content: "对话记录:\n" + messages.map(m => `${m.role}: ${m.content}`).join('\n') },
]
```

两种触发：
- **对话内自动压缩**（超阈值 80%）：`messages` = 待压缩的 L3 头部
- **fork 时父→子**（`context: 'compress'`）：`messages` = 父 session 全量 L3

输出：纯文本摘要。

---

## 3. Consolidate（L3 → memory）

```
[
  { role: 'system', content: CONSOLIDATE_PROMPT },
  { role: 'system', content: <role_context> },       // 若传入非空 roleContext
  { role: 'user',   content: [
    currentMemory ? `当前摘要:\n${currentMemory}` : null,
    `对话记录:\n${messages.map(m => `${m.role}: ${m.content}`).join('\n')}`,
  ].filter(Boolean).join('\n\n') },
]
```

- `currentMemory` = 本 session 当前 memory 槽位
- `messages` = 本 session 全量 L3

输出：100-150 字摘要，写回本 session memory 槽位。

---

## 4. Reflection（应用层自行实现）

跨 Session 的"全 memory → 综合 → 定向 insight"循环由应用层自行调用任意 LLM 完成：

- 输入：`agent.listSessionDigests({ status: 'active' })` —— `{ id, label, memory, insight }[]`
- 输出：派生 per-target `insight`，通过 `agent.putInsight(targetId, content)` 写回

应用层完全掌控 prompt 形态、调用频率、LLM tier。详见 stello-agent-creation §7 与 stello-agent-usage §6.4。

---

## XML Tag 注入汇总

| Tag | 调用路径 | 数据来源 | 注入位置 |
|-----|---------|---------|---------|
| `<parent_context>` | Session 对话（仅 fork-compress 场景） | 父 session 压缩摘要 | 合成进 systemPrompt 字段 |
| `<session_identity>` | Session 对话 | `SessionMeta.label` | systemPrompt 之后 |
| `<role_context>` | Compress / Consolidate | `DefaultFnOptions.roleContext`（应用层传入） | 任务 prompt 之后、user content 之前 |

---

## 共性

| 维度 | 对话类（1） | 提炼类（2、3） |
|------|------------|--------------|
| 接口 | `llm.complete(msgs, { tools })` | `LLMCallFn(msgs)` → `string` |
| tools | 有 | 无 |
| L3 形态 | 原始 message 数组 | `${role}: ${content}` 字符串拼接进 user content |
| 返回 | 结构化（含 tool calls） | 纯文本 |
| `<think>` 清洗 | 否 | 是 |
