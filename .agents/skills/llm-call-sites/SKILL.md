---
name: llm-call-sites
description: Stello 框架内所有 LLM 调用位置的消息结构速查。覆盖 MainSession 对话、普通 Session 对话、compress、consolidate、integrate。
---

# LLM 调用消息结构

Stello 里所有 LLM 调用的 `messages` 参数构成。

---

## 1. MainSession 对话

```
[
  { role: 'system',    content: systemPrompt },      // 若非空
  { role: 'system',    content: synthesis },         // 若非空（始终注入）
  { role: 'system',    content: compressSummary },   // 仅当触发自动压缩
  ...recentL3History,                                // user / assistant / tool
  { role: 'user',      content: userInput },
]
```

`tools` 经 `llm.complete(messages, { tools })` 第二参数传入，不进 messages。

MainSession **不**注入 `<session_identity>`（只对普通 session 注入身份标签）。

---

## 2. 普通 Session 对话

```
[
  { role: 'system',    content: systemPrompt },      // 可能含 <parent_context> 块
  { role: 'system',    content: <session_identity> },// 若 meta.label 非空（子 session 总是非空）
  { role: 'system',    content: insight },           // 若非空，消费后清除
  { role: 'system',    content: compressSummary },   // 仅当触发自动压缩
  ...recentL3History,
  { role: 'user',      content: userInput },
]
```

与 MainSession 的差异：第二槽位是 `insight`（一次性）而非 `synthesis`；此外多一条 `<session_identity>` 注入在 systemPrompt 之后。

`<session_identity>` 形态：

```
<session_identity>
你当前在「{meta.label}」子会话中。
</session_identity>
```

label 改名（`updateMeta({ label })`）后下次 send 自动同步，无需重写持久化的 systemPrompt。

`systemPrompt` 在 fork-compress 场景形态：

```
{合成后的 systemPrompt}

<parent_context>
{父 session 压缩摘要}
</parent_context>
```

---

## 3. Compress

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

## 4. Consolidate（L3→L2）

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

- `currentMemory` = 本 session 当前 L2
- `messages` = 本 session 全量 L3

输出：100-150 字摘要，写回本 session memory 槽位。

---

## 5. Integrate（所有子 L2 → synthesis + insights）

```
[
  { role: 'system', content: INTEGRATE_PROMPT },
  { role: 'system', content: <role_context> },       // 若传入非空 roleContext
  { role: 'user',   content: [
    currentSynthesis ? `当前综合:\n${currentSynthesis}` : null,
    `子 Session 摘要:\n` + children.map(c =>
      `- [sessionId=${c.sessionId}] ${c.label}: ${c.l2}`
    ).join('\n'),
  ].filter(Boolean).join('\n\n') },
]
```

- `currentSynthesis` = main 当前 synthesis
- `children` = 扁平收集所有子 session 的 `{ sessionId, label, l2 }`

输出：JSON `{ synthesis, insights: [{ sessionId, content }] }`。

---

## XML Tag 注入汇总

| Tag | 调用路径 | 数据来源 | 注入位置 |
|-----|---------|---------|---------|
| `<parent_context>` | 普通 Session 对话（仅 fork-compress 场景） | 父 session 压缩摘要 | 合成进 systemPrompt 字段 |
| `<session_identity>` | 普通 Session 对话 | `SessionMeta.label`（stello 一等字段） | systemPrompt 之后 |
| `<role_context>` | Compress / Consolidate / Integrate | `DefaultFnOptions.roleContext`（应用层传入） | 任务 prompt 之后、user content 之前 |

## 共性

| 维度 | 对话类（1、2） | 提炼类（3、4、5） |
|------|--------------|------------------|
| 接口 | `llm.complete(msgs, { tools })` | `LLMCallFn(msgs)` → `string` |
| tools | 有 | 无 |
| L3 形态 | 原始 message 数组 | `${role}: ${content}` 字符串拼接进 user content |
| 返回 | 结构化（含 tool calls） | 纯文本 / JSON |
| `<think>` 清洗 | 否 | 是 |
