# 迁移指南：Main Session 解耦

> 对应 spec：`docs/superpowers/specs/2026-05-16-decouple-main-session-design.md`
> 对应 plan：`docs/superpowers/plans/2026-05-17-decouple-main-session-plan.md`
> 合入版本：`@stello-ai/session@0.8.0` + `@stello-ai/core@0.10.0`（`refactor/decouple-main-session` 分支）

---

## TL;DR

**Stello 现在只有一种 Session。** 原来的 `MainSession` 概念（类型、工厂、独占的 `integrate()` 方法、`MainStorage` 接口、`MAIN_SESSION_ID` 常量、`mainSessionConfig` / `mainSessionLoader` 配置项）**全部删除**。

对话的起点 = "root session" = 普通 Session（`parentId === null` 的拓扑节点），与子 Session 同构。原 Main 承担的"跨 Session 综合 + 定向 insight 推送"职责完全外包给**外部 orchestrator client**（Claude Code / Codex / 用户自写脚本）。框架只暴露纯数据 IO SDK。

---

## 1. 心智模型的转变

| 维度 | 旧模型 | 新模型 |
|---|---|---|
| Session 类型数 | 2（`Session` + `MainSession`） | **1**（`Session`） |
| 上下文组装规则 | 两套（一套带 synthesis，一套带 insight） | **一套**（systemPrompt + identity + insight + memory + L3 + msg） |
| 跨 Session 综合 | 框架内 `MainSession.integrate()` 自动调度 IntegrateFn → 写 synthesis + 推 insights | **外包给 orchestrator**：调用方读 `listSessionDigests` → 自己做 reflection → 调 `putMemory` / `putInsight` 写回 |
| Root 唯一性 | `MAIN_SESSION_ID = 'main'`，每个拓扑有且仅有一个 root | **多 root 合法**：`parentId === null` 即 root，UUID 命名，可有多个 |
| Memory 槽位语义 | `Session.memory()` = L2（技能描述）；`MainSession.synthesis()` = 全局综合（两者实现走不同存储方法） | **统一**：所有 Session 共用 `memory()`（持久；每次 send 注入）。"L2" / "synthesis" 是应用层标签，框架对内容无感知 |
| 存储接口数 | `SessionStorage` 子集 + `MainStorage` 超集（含 `getAllSessionL2s` / `putNode` / `getGlobal` 等） | **1 个 `SessionStorage`**。拓扑节点 CRUD 由 core `SessionTree` 持有。 |
| `SessionMeta` 字段 | `id / label / role / status / tags / metadata / createdAt / updatedAt` | `id / label / status / createdAt / updatedAt` |

> **关键认知**：Stello 退化为"会话拓扑 + 单 Session 对话 + L2/L3 数据层"。它只负责承载内容；语义判断（L2 是什么格式、synthesis 怎么算、insight 推给谁）全部交给应用 orchestrator 自定义。

---

## 2. 决策要点（rationale）

新模型背后的几个核心权衡，迁移代码时遇到边界情况可以回到这些原则上判断：

1. **职责单一** — Stello 框架只做"装数据 + 跑 tool loop + 调度 consolidate"。任何"理解多个 Session 之间的关系并做出判断"的工作都属于 orchestrator 层。
2. **零隐式 LLM 调用** — orchestrator-facing SDK 全是数据 IO。调用方知道每一次 LLM 调用都是自己显式发起的。
3. **接口收敛优于双重派生** — `MainSession` 与 `Session` 当初就是 95% 重复代码 + 5% 不同的两个 slot。合并后 1124 行代码消失，行为无差异。
4. **composition 优于 data extension** — Stello 不再为应用域字段（tags / metadata / conflicts / relations / priority）开口子。应用层应通过 wrapper Session（持有 Stello Session + 自己的 side-table）扩展业务字段。
5. **多 root 自然支持** — 这既是删除 `MAIN_SESSION_ID` 的副产品，也让"一个 agent 同时进行多条独立对话"成为可能。
6. **persistence 不强求迁移** — 旧 FileSystem 存储下 `'main'` 目录里的数据在新版本里"读不到 root"，应用自行处理（详见 §5）。框架不提供自动迁移工具。

---

## 3. 删除清单（速查表）

### `@stello-ai/session` 0.8.0

| 删除项 | 替代 |
|---|---|
| `MainSession` interface | 用 `Session` |
| `createMainSession` / `loadMainSession` | 用 `createSession` / `loadSession` |
| `CreateMainSessionOptions` / `LoadMainSessionOptions` | 用 `CreateSessionOptions` / `LoadSessionOptions` |
| `MainStorage` interface | 用 `SessionStorage`（已合并 `listSessions`） |
| `IntegrateFn` / `IntegrateResult` / `ChildL2Summary` | orchestrator 自定义 |
| `SessionMeta.role` / `.tags` / `.metadata` | 删除 — 用 wrapper Session 承载业务字段 |
| `SessionFilter.role` / `.tags` | 删除 |
| `ForkOptions.tags` / `.metadata` | 删除 |
| `assembleMainSessionContext` | 用 `assembleSessionContext`（唯一上下文组装函数） |
| `MainSession.synthesis()` | 用 `session.memory()`（已统一） |
| `MainStorage.getAllSessionL2s` | 用 `StelloAgent.listSessionDigests()` |
| `MainStorage.putNode` / `getChildren` / `removeNode` | 用 `SessionTree.createSession` / `getTree` |
| `MainStorage.getGlobal` / `putGlobal` | 删除（未被任何路径使用） |

### `@stello-ai/core` 0.10.0

| 删除项 | 替代 |
|---|---|
| `MAIN_SESSION_ID = 'main'` | 删除 — root 由拓扑决定（`parentId === null`） |
| `SessionTree.createRoot(label?)` | 用 `createSession({ label? })` |
| `SessionTree.createChild(options)` | 用 `createSession({ parentId, label? })` |
| `SessionTree.getRoot()` | 用 `listRoots()`（多 root 合法） |
| `MainSessionConfig` / `SerializableMainSessionConfig` | 用 `SessionConfig` / `SerializableSessionConfig` |
| `MainSessionCompatible` / `SessionCompatibleIntegrateFn` | 删除 |
| `DEFAULT_INTEGRATE_PROMPT` / `createDefaultIntegrateFn` | orchestrator 自定义 |
| `StelloAgentConfig.mainSessionConfig` | 删除 |
| `StelloAgentSessionConfig.mainSessionLoader` | 删除 |
| `StelloAgent.createMainSession(opts?)` | 用 `agent.createSession({ parentId?, label? })` |
| `StelloAgent.integrate()` | 自己在 orchestrator 里实现（见 §6） |
| Engine 中 `sourceSessionId === MAIN_SESSION_ID` 跳过分支 | 删除 — root 配置正常被子 fork 继承 |

### 新增（orchestrator-facing SDK）

| 新增项 | 用途 |
|---|---|
| `StelloAgentConfig.storage?: SessionStorage` | 顶层注入数据存储；data-IO SDK 依赖此字段 |
| `agent.createSession({ parentId?, label? })` | 创建拓扑节点（root or child） |
| `agent.listSessions(filter?)` | 列出所有 Session（按状态过滤） |
| `agent.listRoots()` | 列出所有 `parentId === null` 节点 |
| `agent.getTopology()` | 完整森林（`SessionTreeNode[]`） |
| `agent.getTopologyNode(id)` | 单个拓扑节点 |
| `agent.getSessionMetadata(id)` | `{ memory, insight }` 视图 |
| `agent.listSessionDigests(filter?)` | 批量 `{ id, label, status, memory, insight }` — 取代 `getAllSessionL2s` |
| `agent.listMessages(id, opts?)` | 读取 L3 |
| `agent.putMemory(id, content)` | 写 memory |
| `agent.putInsight(id, content)` | 写 insight（一次性，被下次 `send` 消费） |
| `agent.clearInsight(id)` | 清 insight |

---

## 4. 迁移配方

### 4.1 创建 root session（原 `createMainSession` / `agent.createMainSession()`）

**旧写法 A**（Session 包直接调用）：

```ts
import { createMainSession } from '@stello-ai/session'

const main = await createMainSession({
  storage,
  llm,
  label: 'Main Session',
  systemPrompt: '...',
  integrateFn: myIntegrate,
})
```

**新写法 A**：

```ts
import { createSession } from '@stello-ai/session'

const root = await createSession({
  storage,
  llm,
  label: 'Main Session',
  systemPrompt: '...',
  // integrateFn 已删除：integration 由 orchestrator 在外部实现
})
```

**旧写法 B**（StelloAgent 工厂）：

```ts
const node = await agent.createMainSession({ label: 'Main' })
```

**新写法 B**：

```ts
const node = await agent.createSession({ label: 'Main' })
// parentId 省略 ⇒ 新 root；非空 ⇒ 挂在该父节点下
```

> 注意：新版 `createSession` 默认**不**继承父 Session 上下文。需要继承走 `agent.forkSession(parentId, opts)`。

### 4.2 读取所有 Session 的 L2 / synthesis 数据（原 `getAllSessionL2s`）

**旧写法**：

```ts
const summaries = await mainStorage.getAllSessionL2s()
// → ChildL2Summary[]: { sessionId, label, l2 }
```

**新写法**（要求 `agent.storage` 已注入）：

```ts
const digests = await agent.listSessionDigests({ status: 'active' })
// → SessionDigest[]: { id, label, status, memory, insight }
```

差异：
- `id` 替代 `sessionId`
- `memory` 替代 `l2`（语义一致，仅命名收敛）
- 额外提供 `status` 与 `insight`，方便 orchestrator 复用同一份 digest

### 4.3 自己实现 integrate 循环（原 `MainSession.integrate()`）

旧框架内部逻辑大致是：

```
getAllSessionL2s() → IntegrateFn(children, currentSynthesis) → { synthesis, insights[] }
→ transaction { putMemory(rootId, synthesis); insights.forEach(putInsight) }
```

迁到 orchestrator 后，用 SDK 拼一个等价循环：

```ts
import { collectLLMStream } from '@stello-ai/session'

async function runIntegrate(
  agent: StelloAgent,
  rootId: string,
  llm: LLMAdapter,
) {
  // 1. 收集所有 Session 摘要
  const digests = await agent.listSessionDigests({ status: 'active' })
  const children = digests.filter((d) => d.id !== rootId)

  // 2. 读取当前 root 的 memory（== 旧 synthesis）
  const { memory: currentSynthesis } = await agent.getSessionMetadata(rootId)

  // 3. 调用你自己的 IntegrateFn —— 现在是普通函数，框架不感知
  const prompt = buildIntegratePrompt(children, currentSynthesis)
  const raw = await collectLLMStream(llm.stream([
    { role: 'system', content: prompt },
    { role: 'user', content: serialize(children) },
  ]))
  const result = JSON.parse(raw.content ?? '{}') as {
    synthesis: string
    insights: Array<{ sessionId: string; content: string }>
  }

  // 4. 写回 — 不再走 storage.transaction，多个写操作可并发也可串行
  await agent.putMemory(rootId, result.synthesis)
  await Promise.all(
    result.insights
      .filter((i) => children.some((c) => c.id === i.sessionId))
      .map((i) => agent.putInsight(i.sessionId, i.content)),
  )
}
```

**与旧实现的语义差异**：
- 旧版自动过滤无效 `sessionId`（不存在 / 已归档的子 session）；新版需要你自己做（上例的 `.filter`）。
- 旧版 `transaction` 保证 synthesis + insights 原子写；新版默认非原子。若需要原子性，自己用 `agent.storage.transaction(...)` 包裹。
- 旧版会强制把 `currentSynthesis` 与 `children` 传给 IntegrateFn；新版完全由调用方决定输入。

> 参考实现可以从 `@stello-ai/core@0.9` 的 `createDefaultIntegrateFn` 拷出（已删除，但 git 历史里仍能找到，commit `f89a6a4` 之前的 `packages/core/src/llm/defaults.ts`）。

### 4.4 读取拓扑树（原 `MainStorage.getChildren` / `SessionTree.getRoot` / `getTree`）

**旧写法**：

```ts
const rootMeta = await sessionTree.getRoot()
const treeNode = await sessionTree.getTree()  // SessionTreeNode（单 root）
const children = await mainStorage.getChildren(parentId)
```

**新写法**：

```ts
// 多 root 合法 — 用 listRoots
const roots = await agent.listRoots()           // TopologyNode[]
const forest = await agent.getTopology()        // SessionTreeNode[]
const node = await agent.getTopologyNode(id)    // TopologyNode | null
// 子节点：直接读 TopologyNode.children（id 列表），再 getTopologyNode 逐个解析
```

注意：`getTree()` 返回值从 `Promise<SessionTreeNode>` 变成 `Promise<SessionTreeNode[]>`。所有调用点都需要适配数组。

### 4.5 写 memory / insight（原 `MainSession.integrate` 内部 / `setInsight`）

orchestrator 现在直接调 SDK 方法，无需经过 Session 实例：

```ts
await agent.putMemory(sessionId, '综合认知文本')
await agent.putInsight(childId, '给这个子 session 的建议')
// send 消费 insight 后，框架内部自动 clearInsight；调用方一般不需要主动清
await agent.clearInsight(childId)  // 仅在需要"撤回"未消费 insight 时用
```

### 4.6 配置 StelloAgent（删除 mainSessionConfig / mainSessionLoader）

**旧写法**：

```ts
createStelloAgent({
  sessions,
  memory,
  sessionDefaults: { ... },
  mainSessionConfig: {
    systemPrompt: 'main system prompt',
    integrateFn: createDefaultIntegrateFn(...),
    llm: mainLLM,
  },
  session: {
    sessionLoader: ...,
    mainSessionLoader: async () => ({ session: mainSession, config: null }),
  },
  capabilities: { ... },
})
```

**新写法**：

```ts
createStelloAgent({
  sessions,
  memory,
  storage,                          // 新：data-IO SDK 依赖
  sessionDefaults: { ... },         // root 也吃这套默认配置
  session: {
    sessionLoader: ...,             // 仅保留 sessionLoader；mainSessionLoader 已删
  },
  capabilities: { ... },
})
```

整个 `mainSessionConfig` 和 `mainSessionLoader` 字段在新版本里**不存在**，传了会触发 TS 报错。

如果你之前在 `mainSessionConfig` 里放了 root 专属的 `systemPrompt` 或 `skills`，现在改在 root 节点的 `SerializableSessionConfig` 里写（通过 `agent.sessions.putConfig(rootId, ...)`），或者作为 `sessionDefaults` 的一部分（所有新 Session 都吃）。

### 4.7 持久化文件迁移（旧 `'main'` 目录）

旧 `FileSystem` 存储 layout：

```
sessions/
  main/
    meta.json   (role: 'main')
    memory.md
    scope.md
    index.md
  <uuid-1>/...
  <uuid-2>/...
```

新版本 `SessionTreeImpl.createSession()` 总是生成 `randomUUID()` 作为 id，所以"main"目录里的 root 数据**读不到**（`listRoots()` 不会发现它，因为 `listAllStored` 走 `listDirs('sessions')` 但 `getRoot` 已删除）。

**应用层迁移方案**（如果有线上数据需要保留）：

```ts
// 启动脚本里跑一次
import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'

async function migrateLegacyMainDir(rootDir: string) {
  const legacyPath = `${rootDir}/sessions/main`
  if (!(await pathExists(legacyPath))) return

  const metaJson = JSON.parse(await fs.readFile(`${legacyPath}/meta.json`, 'utf8'))
  const newId = randomUUID()
  // 新 meta：去掉 role，保留 label/status/timestamps
  const newMeta = {
    id: newId,
    parentId: null,
    children: metaJson.children ?? [],
    refs: metaJson.refs ?? [],
    label: metaJson.label,
    index: 0,
    status: metaJson.status,
    depth: 0,
    turnCount: metaJson.turnCount,
    createdAt: metaJson.createdAt,
    updatedAt: metaJson.updatedAt,
    lastActiveAt: metaJson.lastActiveAt,
  }
  await fs.mkdir(`${rootDir}/sessions/${newId}`, { recursive: true })
  await fs.writeFile(
    `${rootDir}/sessions/${newId}/meta.json`,
    JSON.stringify(newMeta, null, 2),
  )
  // 复制 .md 内容文件
  for (const file of ['memory.md', 'scope.md', 'index.md']) {
    await fs.copyFile(`${legacyPath}/${file}`, `${rootDir}/sessions/${newId}/${file}`)
  }
  // 更新所有以 'main' 为 parentId 的子节点
  const dirs = await fs.readdir(`${rootDir}/sessions`)
  for (const dir of dirs) {
    if (dir === 'main' || dir === newId) continue
    const childMetaPath = `${rootDir}/sessions/${dir}/meta.json`
    const childMeta = JSON.parse(await fs.readFile(childMetaPath, 'utf8'))
    if (childMeta.parentId === 'main') {
      childMeta.parentId = newId
      await fs.writeFile(childMetaPath, JSON.stringify(childMeta, null, 2))
    }
  }
  // 删除老的 main 目录
  await fs.rm(legacyPath, { recursive: true })
}
```

框架不提供这个工具——它是应用层一次性操作，不该污染 SDK API。

---

## 5. 兼容性 / 升级路径

- 推荐**同时升级**两个包到对齐版本（session@0.8 + core@0.10）。任何混搭组合都不工作。
- 不提供 deprecated alias。所有 break 是硬 break，编辑器立即报错；不会出现"运行时悄悄失败"。
- demo / devtools / visualizer **本次未同步更新**。如果你在用它们，需要按本指南手动迁移（或暂停升级）。
- 上线步骤建议：
  1. `pnpm up` 升级依赖
  2. 跑 `pnpm typecheck`——所有 break 都是编译错误，对照本文档逐个改
  3. 跑测试套件
  4. 如有持久化数据，按 §4.7 跑一次性迁移脚本
  5. 重新部署

---

## 6. 完整 orchestrator 重建示例

把"反思 + 推送 insight"的最小循环写在你自己的 orchestrator 层里：

```ts
import { createStelloAgent, type StelloAgent } from '@stello-ai/core'
import { collectLLMStream, createSession, createClaude, InMemoryStorageAdapter } from '@stello-ai/session'

// 1. 装配
const storage = new InMemoryStorageAdapter()
const llm = createClaude({ model: 'claude-sonnet-4-6', apiKey: process.env.ANTHROPIC_API_KEY! })
const agent = createStelloAgent({
  sessions: mySessionTreeImpl(storage),  // 你自己的 SessionTree 实现，或 SessionTreeImpl(fs)
  memory: myMemoryEngine(),
  storage,                               // 新增 — data-IO SDK 依赖
  session: {
    sessionLoader: async (id) => {
      const session = await loadSession(id, { storage, llm })
      if (!session) throw new Error(`Session not found: ${id}`)
      return { session, config: null }
    },
  },
  capabilities: { lifecycle, tools, skills, confirm },
})

// 2. 创建 root
const root = await agent.createSession({ label: 'Mission Control' })

// 3. 跑几轮对话 / fork 几个子 session
await agent.enterSession(root.id)
await agent.turn(root.id, '帮我拆个子任务出来')
// ... 用户和 agent 来回几轮 ...

// 4. orchestrator 自己跑 reflection
async function reflect() {
  const digests = await agent.listSessionDigests({ status: 'active' })
  const { memory: synthesis } = await agent.getSessionMetadata(root.id)
  const children = digests.filter((d) => d.id !== root.id)

  // 你的 IntegrateFn —— 普通 LLM 调用，框架不感知
  const prompt = `当前综合: ${synthesis ?? '(无)'}\n\n子会话:\n${children
    .map((c) => `[${c.id}] ${c.label}: ${c.memory ?? '(空)'}`)
    .join('\n')}\n\n请输出 JSON: { "synthesis": "...", "insights": [{ "sessionId": "...", "content": "..." }] }`

  const result = JSON.parse(
    (await collectLLMStream(llm.stream([{ role: 'user', content: prompt }]))).content ?? '{}',
  )

  // 写回
  await agent.putMemory(root.id, result.synthesis)
  for (const { sessionId, content } of result.insights) {
    if (children.some((c) => c.id === sessionId)) {
      await agent.putInsight(sessionId, content)
    }
  }
}

// 5. 在你认为合适的时机触发
setInterval(reflect, 60_000)              // 例：每分钟
// 或挂在 agent hooks 上，例如 onRoundEnd
```

这就是原来框架替你做的事情。**唯一的变化是它现在在你的代码里，你能完全控制 prompt、调度时机、原子性、错误处理、模型 tier 选择**。

---

## 7. 下轮（暂未实施）

以下条目在本次重构中**有意未做**，留待下一轮专门处理（spec §7.2 / §7.5）：

- **批量原子写 API**（`applyMetadataBatch` 类）：当前需要多次调用 `putMemory` / `putInsight`，非原子。
- **未来 context 字段扩展**：除 memory / insight 外的新 prompt 槽位（例如 agent-shared memory index）。
- **StelloAgent 级共享 memory**（Claude Code auto-memory 路线）。
- **持久化数据自动迁移工具**：见 §4.7，自行处理。
- **demo / devtools / visualizer** 跟进升级。

如果你的迁移卡在这些条目上，开 issue 单独讨论。
