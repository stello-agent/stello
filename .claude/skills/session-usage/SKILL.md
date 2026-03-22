---
name: session-usage
description: 当用户或编排层需要操作 Session / MainSession 对话单元时，触发此 skill。
---

## 两种 Session

`@stello-ai/session` 提供两个独立接口，同一个 trait 的两种实现：

| | Session（子 Session） | MainSession（全局意识层） |
|--|----------------------|-------------------------|
| 工厂 | `createSession()` | `createMainSession()` |
| 上下文 | system prompt + insights + L3 + msg | system prompt + **synthesis** + L3 + msg |
| 记忆 | `memory()` = L2（技能描述，给 Main 看） | `synthesis()` = integration 产出 |
| 提炼 | `consolidate(fn)` L3→L2 | `integrate(fn)` 所有 L2→synthesis+insights |
| insights | 被动接收 | 通过 integrate 主动推送 |
| fork | `fork()` 创建子 Session | 无 — 子 Session 由编排层创建 |

两者都是**单次 LLM 调用原语**，tool call 循环由上层驱动。

---

## 子 Session

### 创建并对话

```typescript
import { createSession, InMemoryStorageAdapter } from '@stello-ai/session'

const storage = new InMemoryStorageAdapter()
const session = await createSession({
  storage,                        // SessionStorage 即可
  llm: myLLMAdapter,
  label: '选校讨论',
  systemPrompt: '你是留学申请顾问',
})

const res = await session.send('MIT 和 Stanford 怎么选？')
// res.content = LLM 文本回复
// res.toolCalls = 工具调用（由上层决定是否执行）
// 用户消息 + LLM 响应已自动保存到 L3
```

### 流式对话

```typescript
const stream = session.stream('帮我分析 MIT 的优劣')
for await (const chunk of stream) {
  process.stdout.write(chunk)
}
const res = await stream.result  // L3 已保存
```

### 编排层驱动 tool call 循环

```typescript
let res = await session.send(userInput)
while (res.toolCalls?.length) {
  const toolResults = await executeTools(res.toolCalls)
  res = await session.send(formatToolResults(toolResults))
}
return res.content
```

### System Prompt

```typescript
// 创建时注入
const session = await createSession({ storage, systemPrompt: '你是顾问' })

// 运行时读取/更新
const prompt = await session.systemPrompt()
await session.setSystemPrompt('新的系统提示')
```

### L3 → L2 提炼（consolidation）

L2 是给 Main Session 看的**技能描述**，对子 Session 自身 LLM 不可见。

```typescript
await session.consolidate(async (currentL2, l3Records) => {
  return JSON.stringify({
    focus: 'CS PhD 选校策略',
    status: '分析中',
    key_decisions: ['倾向 top10 CS 项目'],
  })
})
```

### fork 派生子 Session

fork 根据 `forkRole` 一次性继承父链上下文，之后独立挂到 Main Session 下。

```typescript
const child = await session.fork({
  label: '子任务：清洗数据',
  forkRole: 'full',
})
// child 与 session 断开直接依赖，独立运行
// 树状关系由编排层通过 storage.putNode() 维护
```

---

## Main Session

### 创建

```typescript
import { createMainSession } from '@stello-ai/session'

const main = await createMainSession({
  storage,                        // 需要 MainStorage（superset of SessionStorage）
  llm: myLLMAdapter,
  label: '留学申请规划师',
  systemPrompt: '你是全局规划师，根据各子任务的进展给出综合建议',
})
```

### 对话

Main Session 对话上下文使用 **synthesis**（从所有子 L2 提炼而来），不是原始 L2。

```typescript
const res = await main.send('整体申请进度如何？')
// 上下文 = system prompt + synthesis + L3 历史 + 当前消息
```

### System Prompt

```typescript
const prompt = await main.systemPrompt()
await main.setSystemPrompt('更新后的全局指令')
```

### Integration cycle

`integrate()` 是 Main Session 的核心能力：收集所有子 L2 → 生成 synthesis + per-child insights。

```typescript
const result = await main.integrate(async (children, currentSynthesis) => {
  // children: Array<{ sessionId, label, l2 }>
  // currentSynthesis: 上一次的 synthesis（可能为 null）

  // 用 LLM 处理所有 L2，生成综合认知和定向建议
  return {
    synthesis: '选校已确认 top5，文书 PS 初稿完成，推荐信待跟进',
    insights: [
      { sessionId: children[0].sessionId, content: '选校已完成，可以开始准备面试' },
      { sessionId: children[1].sessionId, content: '推荐信需要在 11/15 前确认' },
    ],
  }
})

// result.synthesis 已保存到 Main Session
// result.insights 已推送到各子 Session 的 insight 存储
// 子 Session 下次 send() 时 insights 自动出现在上下文中
```

### 读取 synthesis

```typescript
const syn = await main.synthesis()  // integration 产出的综合认知
```

### 恢复会话

```typescript
import { loadMainSession } from '@stello-ai/session'

const main = await loadMainSession(savedId, { storage, llm })
if (!main) throw new Error('MainSession not found')
```

---

## API 速查

### Session 接口

| 方法 | 说明 |
|------|------|
| `meta` | 同步读取元数据（Readonly） |
| `send(content)` | 组装上下文 → 调 LLM → 存 L3 → 返回 SendResult |
| `stream(content)` | 流式输出，返回 StreamResult |
| `messages(options?)` | 读取 L3 对话记录 |
| `systemPrompt()` / `setSystemPrompt(content)` | 系统提示词读写 |
| `memory()` | 读取 L2（技能描述） |
| `consolidate(fn)` | L3 → L2 提炼 |
| `insight()` / `setInsight(content)` | insights（被动接收） |
| `fork(options)` | 派生子 Session |
| `updateMeta(updates)` / `archive()` | 生命周期 |

### MainSession 接口

| 方法 | 说明 |
|------|------|
| `meta` | 同步读取元数据（role: 'main'） |
| `send(content)` | 组装上下文（用 synthesis）→ 调 LLM → 存 L3 |
| `stream(content)` | 流式输出 |
| `messages(options?)` | 读取 L3 对话记录 |
| `systemPrompt()` / `setSystemPrompt(content)` | 系统提示词读写 |
| `synthesis()` | 读取 synthesis（integration 产出） |
| `integrate(fn)` | 所有子 L2 → synthesis + insights |
| `updateMeta(updates)` / `archive()` | 生命周期 |

### IntegrateFn / IntegrateResult

```typescript
type IntegrateFn = (
  children: ChildL2Summary[],       // { sessionId, label, l2 }
  currentSynthesis: string | null
) => Promise<IntegrateResult>

interface IntegrateResult {
  synthesis: string                  // Main Session 的综合认知
  insights: Array<{                  // 定向推送给子 Session
    sessionId: string
    content: string
  }>
}
```

### 错误类型

| 错误 | 触发条件 |
|------|----------|
| `SessionArchivedError` | 对归档 Session/MainSession 执行写操作 |
| `NotImplementedError` | 调用 send/stream（尚未实现） |
