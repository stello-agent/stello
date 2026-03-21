---
name: session-usage
description: 当用户或编排层需要操作 Session 对话单元时，触发此 skill。
---

## Session 是什么

Session 是**有记忆的对话单元**。它的核心职责：

1. 接收一条消息 → 组装上下文 → 调一次 LLM → 保存到 L3 → 返回 LLM 响应
2. 暴露 `consolidate()` 供上层触发 L3 → L2 提炼
3. 接受 Main Session 推送的 insights

Session **不负责**：tool call 循环、consolidation 触发时机、Session 切换路由、integration cycle——这些是编排层的事。

---

## 场景 1：创建 Session 并对话

```typescript
import { createSession, InMemoryStorageAdapter } from '@stello-ai/session'

const storage = new InMemoryStorageAdapter()
const session = await createSession({
  storage,
  llm: myLLMAdapter,        // 实现 LLMAdapter 接口
  label: '选校讨论',
  systemPrompt: '你是留学申请顾问',
})

// 发送一条消息，Session 组装上下文后调 LLM 返回响应
// 上下文 = system prompt + insights(如有) + 最近 N 条 L3 + 当前消息
const response = await session.send('MIT 和 Stanford 怎么选？')
// response.content = LLM 的文本回复
// 消息已自动保存到 L3
```

编排层拿到 `response` 后，检查是否有 `toolCalls`，自行决定是否执行工具、是否再送回 Session。

---

## 场景 2：编排层驱动 tool call 循环

```typescript
// 编排层伪代码——不是 Session 的职责
let response = await session.send(userInput)

while (response.toolCalls?.length) {
  const toolResults = await executeTools(response.toolCalls)
  response = await session.send(formatToolResults(toolResults))
}

return response.content  // 最终文本回复给用户
```

Session 每次只做**单次 LLM 调用 + L3 持久化**，循环逻辑由上层控制。

---

## 场景 3：L3 → L2 提炼（consolidation）

L2 是 Session 的**技能描述**——给 Main Session 看的外部摘要，不是 Session 自己的工作记忆。
L2 对子 Session 自身 LLM **不可见**。

```typescript
// 上层在合适时机（onSwitch / onArchive / manual）触发
await session.consolidate(async (currentL2, l3Records) => {
  // currentL2: 上一次的 L2（可能为 null）
  // l3Records: L3 对话记录
  // 应用层决定 L2 的格式（Markdown / JSON / 任意）
  return JSON.stringify({
    focus: 'CS PhD 选校策略',
    status: '分析中',
    key_decisions: ['倾向 top10 CS 项目'],
  })
})

// consolidate 后 session.meta.consolidatedTurn 更新
// Main Session 通过 integration cycle 读取此 L2
```

---

## 场景 4：Main Session 推送 insights

insights 是 Main Session 通过 integration cycle **定向推送**给子 Session 的。
子 Session 自己不写 insights，只被动接收。

```typescript
// integration cycle（编排层）推送 insights 到子 Session
await childSession.setInsight('文书 DDL 11/15，选校需在 11/8 前完成')

// 子 Session 下次组装上下文时，insights 自动出现在 system context 中
// [system] ... --- 来自规划师的提示 --- ...

// 读取 insights
const insight = await session.insight()  // 等价于 session.doc('insights')
```

---

## 场景 5：fork 派生子 Session

fork 根据 `forkRole` 一次性决定从父链继承多少上下文。fork 完成后，新 Session 与父链**断开直接依赖**，挂到 Main Session 下作为平级子 Session。

```typescript
// forkRole 决定继承策略（完全继承 / 部分继承 / 无继承）
const child = await session.fork({
  label: '子任务：清洗数据',
  forkRole: 'full',  // 完全继承父链上下文
})
// child 挂到 Main Session 下，与 session 不再有直接数据依赖
// child 从此通过 Main Session 的 insights 获取跨 Session 信息

// 另一种：轻量 fork，只带必要上下文
const lightweight = await session.fork({
  label: '快速验证',
  forkRole: 'minimal',
})
```

fork 后的拓扑关系：
```
Main Session
├── Session A（原始）
├── Session B（从 A fork 出，但挂在 Main 下）
└── Session C（从 B fork 出，同样挂在 Main 下）
```

所有子 Session 是 Main Session 的平级子节点，通过 insights 获取跨 Session 信息。

---

## 场景 6：恢复会话

```typescript
import { loadSession } from '@stello-ai/session'

const session = await loadSession(savedId, { storage, llm: myLLMAdapter })
if (!session) throw new Error('Session not found')

// 继续对话
const response = await session.send('继续上次的讨论')
```

---

## 场景 7：事件驱动

```typescript
session.on('consolidated', ({ memory }) => {
  // L2 更新了，可通知 integration cycle
})

session.on('archived', () => {
  // Session 归档，可触发最终 consolidation
})

session.on('insightUpdated', ({ content }) => {
  // Main Session 推送了新 insights
})
```

---

## API 速查

### Session 接口

| 方法 | 说明 |
|------|------|
| `meta` | 同步读取元数据（Readonly） |
| `send(content)` | 组装上下文 → 单次 LLM 调用 → 存 L3 → 返回响应 |
| `messages(options?)` | 读取 L3 对话记录（支持分页、角色过滤） |
| `memory()` | 读取 L2（技能描述），初始为 null |
| `consolidate(fn)` | L3 → L2 提炼，由上层触发 |
| `doc(key)` / `setDoc(key, content)` | per-session 文档读写 |
| `insight()` / `setInsight(content)` | insights 别名（Main Session 推送用） |
| `fork(options)` | 派生子 Session |
| `updateMeta(updates)` | 更新 label / tags / metadata |
| `archive()` | 归档（不可逆，不连带子 Session） |
| `on(event, handler)` / `off(event, handler)` | 事件订阅 |

### 外部注入

| 注入 | Session 层 | 编排层 |
|------|-----------|--------|
| StorageAdapter | 必须 | — |
| LLMAdapter | 必须 | 多 tier（fast/strong） |
| system prompt | 可选 | — |
| ConsolidateFn | 通过 consolidate() 传入 | 触发时机 |
| IntegrateFn | — | 编排层配置 |
| tool 定义 | — | 编排层驱动循环 |

### 错误类型

| 错误 | 触发条件 |
|------|----------|
| `SessionArchivedError` | 对归档 Session 执行写操作 |
| `NotImplementedError` | 调用尚未实现的方法 |

### DOC_KEYS 常量

```typescript
DOC_KEYS.SCOPE = 'scope'       // 对话边界
DOC_KEYS.INSIGHTS = 'insights' // Main Session 推送的洞察
DOC_KEYS.INDEX = 'index'       // 子节点目录
```
