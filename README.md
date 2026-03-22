<p align="right">
  <a href="#english">English</a> | <a href="#中文">中文</a>
</p>

<a id="english"></a>

<p align="center">
  <img src="./assets/logo.png" alt="Stello Logo" width="200" />
</p>

<p align="center">
  <h1 align="center">Stello</h1>
  <p align="center">
    <strong>The first open-source conversation topology engine.</strong><br/>
    Auto-branching session trees, inherited memory, star-map visualization.
  </p>
</p>

<p align="center">
  <a href="https://github.com/stello-agent/stello/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="License" /></a>
  <a href="https://www.npmjs.com/package/@stello-ai/core"><img src="https://img.shields.io/npm/v/@stello-ai/core" alt="npm" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-strict-blue" alt="TypeScript" /></a>
</p>

---

Conversations aren't linear — why should AI chats be?

Stello lets AI agents **automatically branch** linear conversations into tree-structured sessions, **inherit memory** across branches, and render the entire topology as an interactive **star-map**. Build agents that remember, branch, and grow.

```
@stello-ai/core        →  Session tree + 3-layer memory + lifecycle hooks + agent tools
@stello-ai/visualizer  →  Constellation layout + Canvas rendering + React component
```

## Installation

```bash
# npm
npm install @stello-ai/core @stello-ai/visualizer

# pnpm
pnpm add @stello-ai/core @stello-ai/visualizer

# yarn
yarn add @stello-ai/core @stello-ai/visualizer
```

> `@stello-ai/visualizer` has `react` and `react-dom` as peer dependencies. `@stello-ai/core` has zero dependencies.

## Current Docs

The repository has evolved beyond the original quickstart below. If you want the current architecture and usage entrypoints, start with:

- [Stello Usage Overview](./docs/stello-usage.md)
- [StelloAgent API](./docs/stello-agent-api.md)
- [Config Design](./docs/config-design.md)
- [Orchestrator Usage](./docs/orchestrator-usage.md)

## 5-Minute Quickstart

### 1. Initialize the engine

```typescript
import {
  NodeFileSystemAdapter,
  CoreMemory,
  SessionMemory,
  SessionTreeImpl,
  LifecycleManager,
  SplitGuard,
  SkillRouterImpl,
  AgentTools,
} from '@stello-ai/core';
import type { CoreSchema, StelloConfig } from '@stello-ai/core';

// Define what your agent remembers globally
const schema: CoreSchema = {
  name:    { type: 'string',  default: '',  bubbleable: true },
  goal:    { type: 'string',  default: '',  bubbleable: true },
  notes:   { type: 'array',   default: [],  bubbleable: true },
};

// Plug in your LLM
const callLLM = async (prompt: string): Promise<string> => {
  // Replace with your OpenAI / Claude / local model call
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }] }),
  });
  const json = await res.json() as { choices: { message: { content: string } }[] };
  return json.choices[0]?.message.content ?? '';
};

// Wire everything up
const fs       = new NodeFileSystemAdapter('./stello-data');
const core     = new CoreMemory(fs, schema);
const sessions = new SessionTreeImpl(fs);
const memory   = new SessionMemory(fs);
const config: StelloConfig = { dataDir: './stello-data', coreSchema: schema, callLLM };
const lifecycle = new LifecycleManager(core, memory, sessions, config);
const guard    = new SplitGuard(sessions);
const tools    = new AgentTools(sessions, core, memory, lifecycle, guard);

await core.init();
```

### 2. Create a root session and start a conversation

```typescript
const root = await sessions.createRoot('My Project');
const { context } = await lifecycle.bootstrap(root.id);

// context.core    → { name: '', goal: '', notes: [] }
// context.memories → []
// context.scope   → null

// After each conversation turn, call afterTurn to update all 3 memory layers
const result = await lifecycle.afterTurn(
  root.id,
  { role: 'user',      content: 'My name is Alice and I want to build a chatbot', timestamp: new Date().toISOString() },
  { role: 'assistant', content: 'Got it, Alice! Let me help you build a chatbot.', timestamp: new Date().toISOString() },
);
await lifecycle.flushBubbles();
// result → { recordAppended: true, memoryUpdated: true, coreUpdated: true }
```

### 3. Branch into a child session

```typescript
// Give the agent the 8 built-in tools
const toolDefs = tools.getToolDefinitions();
// → Pass toolDefs to your LLM as function/tool definitions

// When the agent decides to branch:
await sessions.updateMeta(root.id, { turnCount: 5 });
const { success, data: child } = await tools.executeTool('stello_create_session', {
  parentId: root.id,
  label: 'UI Design Discussion',
});
// child inherits parent's memory.md via the inheritance policy
```

### 4. Render the star-map

```tsx
import { StelloGraph } from '@stello-ai/visualizer';

function App() {
  const [sessions, setSessions] = useState([]);
  const [memories, setMemories] = useState(new Map());
  const [messages, setMessages] = useState(new Map());

  // Load sessions from your Stello data
  // ...

  return (
    <StelloGraph
      sessions={sessions}
      memories={memories}
      messages={messages}
      onSessionClick={(id) => console.log('Navigate to', id)}
      onSendMessage={(id, text) => console.log('Send to', id, text)}
      sessionFiles={(id) => ({ memory: '...', scope: '...' })}
      layoutConfig={{ ringSpacing: 120, colorFn: (s) => s.depth === 0 ? '#FFD700' : '#7EC8E3' }}
    />
  );
}
```

## Core Concepts

### Session Tree

Every conversation is a **tree**. The root session is your main thread; child sessions branch off to explore subtopics. Sessions link back with **cross-branch references** (refs).

```
        ┌── UI Design ──── Colors
Root ───┤
        └── Backend API ─── Auth
                (ref) ─ ─ ─ ─ ┘
```

- **Flat storage**: `sessions/{uuid}/` — tree relationships live in `meta.json`, not folder nesting
- **No deletion**: sessions archive (reversible), never delete
- **Split protection**: minimum turn count + cooldown prevents over-branching

### Three-Layer Memory

| Layer | What it stores | Granularity | File |
|-------|---------------|-------------|------|
| **L1** Core Archive | Structured data (developer-defined schema) | Global | `core.json` |
| **L2** Session Memory | Key conclusions, intents, follow-ups | Per session | `memory.md` |
| **L3** Raw Records | Complete conversation turns | Per session | `records.jsonl` |

**Memory flows in two directions:**

- **Inheritance (down)**: child sessions inherit parent memory via configurable policy (`summary` / `full` / `minimal` / `scoped`)
- **Bubbling (up)**: fields marked `bubbleable` in the schema propagate from child sessions back to the global `core.json` (500ms debounce, last-write-wins)

### Star-Map Visualization

The `<StelloGraph />` React component renders your session tree as an interactive constellation with **Liquid Glass** aesthetics:

- **Node size** = `turnCount` (more conversation = bigger star)
- **Node brightness** = `lastActiveAt` (recent = brighter)
- **Node glow** = color-matched glow effect on each star
- **Solid lines** = parent-child relationships
- **Dashed lines** = cross-branch references
- **Archived nodes** = low opacity
- **Gradient background** = smooth dark gradient canvas
- **Interactions**: zoom (scroll), pan (drag), **drag nodes**, click to navigate, hover for tooltip
- **Sidebar panel**: click a node to open a side panel with **Chat** (conversation view) and **Files** (memory/scope/index) tabs

## API Overview

### @stello-ai/core

| Class | Purpose |
|-------|---------|
| `NodeFileSystemAdapter` | File system persistence (swappable for DB adapters) |
| `SessionTreeImpl` | CRUD for the session tree — `createRoot`, `createChild`, `archive`, `addRef` |
| `CoreMemory` | L1 global archive — schema validation, point-path access (`profile.gpa`), change events |
| `SessionMemory` | L2 + L3 per-session — `readMemory`, `writeMemory`, `appendRecord`, `readRecords` |
| `LifecycleManager` | Orchestrates `bootstrap`, `afterTurn`, `onSessionSwitch`, `prepareChildSpawn` |
| `BubbleManager` | Debounced L1 upward propagation from child sessions |
| `SplitGuard` | Prevents premature splitting (min turns + cooldown) |
| `ConfirmManager` | Confirmation protocol for splits and `requireConfirm` field updates |
| `SkillRouterImpl` | Register skills with keyword matching |
| `AgentTools` | 8 LLM-callable tools for session/memory management |

#### Agent Tools (LLM function calling)

```typescript
const defs = tools.getToolDefinitions();
// Pass to your LLM, then execute:
const result = await tools.executeTool('stello_create_session', { parentId, label });
```

| Tool | Purpose |
|------|---------|
| `stello_read_core` | Read a field from the global archive |
| `stello_update_core` | Update a field in the global archive |
| `stello_create_session` | Branch into a new child session |
| `stello_list_sessions` | List all sessions |
| `stello_read_summary` | Read a session's memory.md |
| `stello_add_ref` | Create a cross-branch reference |
| `stello_archive` | Archive a session |
| `stello_update_meta` | Update session metadata |

### @stello-ai/visualizer

| Export | Purpose |
|--------|---------|
| `<StelloGraph />` | React component — drop-in constellation with sidebar panels |
| `<ChatPanel />` | Standalone chat panel component |
| `<FilePanel />` | Standalone file viewer panel component |
| `theme` | Liquid Glass design tokens (colors, blur, shadows) |
| `computeConstellationLayout()` | Pure function — use without React |
| `renderFrame()` | Canvas renderer — gradient background + node glow |
| `InteractionHandler` | Zoom / pan / drag nodes / click — use without React |

## Configuration

```typescript
const config: StelloConfig = {
  dataDir: './stello-data',           // Where to store files (required)
  coreSchema: schema,                 // L1 field definitions (required)
  callLLM: myLLMFunction,            // Your LLM adapter (required)
  inheritancePolicy: 'summary',      // 'summary' | 'full' | 'minimal' | 'scoped'
  splitStrategy: {
    minTurns: 3,                      // Min turns before allowing split
    cooldownTurns: 5,                 // Min turns between splits
  },
  bubblePolicy: {
    debounceMs: 500,                  // Bubble debounce interval
  },
};
```

## Design Philosophy

- **Adapter pattern**: default file system, swap for SQLite/Postgres with zero code changes
- **Three-layer independence**: L1/L2/L3 failures are isolated — one layer crashing won't block the others
- **Markdown-native**: memory/scope/index files are `.md` — LLMs understand markdown natively, humans can read and edit directly
- **No vendor lock-in**: bring your own LLM via `callLLM`, bring your own embedder via `embedder`
- **Events, not UI**: confirmation protocol emits events — you build the UI

## Contributing

We welcome contributions! Please check the [issues](https://github.com/stello-agent/stello/issues) page.

```bash
git clone https://github.com/stello-agent/stello.git
cd stello
pnpm install
pnpm test        # 154 tests across both packages
pnpm typecheck   # TypeScript strict mode
```

## Examples

See the [stello-examples](https://github.com/stello-agent/stello-examples) repository for working demos:

- **basic** — Minimal setup (create root session, run afterTurn)
- **conversation** — Multi-turn conversation with memory updates
- **branching** — Session branching and memory inheritance
- **cross-reference** — Cross-branch references between sessions
- **agent-tools** — All 8 agent tools in action
- **full-flow** — Complete lifecycle with visualization export
- **visualizer-test** — Interactive star-map visualization (Vite + React)

```bash
git clone https://github.com/stello-agent/stello-examples.git
cd stello-examples/demo && pnpm install && pnpm dev
```

## License

[Apache-2.0](./LICENSE)

---

<a id="中文"></a>

<p align="right">
  <a href="#english">English</a> | <a href="#中文">中文</a>
</p>

<p align="center">
  <img src="./assets/logo.png" alt="Stello Logo" width="200" />
</p>

<h1 align="center">Stello</h1>
<p align="center">
  <strong>首个开源对话拓扑引擎。</strong><br/>
  自动分支会话树、跨分支继承记忆、星空图可视化。
</p>

<p align="center">
  <a href="https://github.com/stello-agent/stello/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="License" /></a>
  <a href="https://www.npmjs.com/package/@stello-ai/core"><img src="https://img.shields.io/npm/v/@stello-ai/core" alt="npm" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-strict-blue" alt="TypeScript" /></a>
</p>

---

对话不是线性的——AI 聊天为什么要是？

Stello 让 AI Agent **自动将**线性对话分裂为树状 Session，跨分支**继承记忆**，并将整个拓扑渲染为可交互的**星空图**。构建能记忆、能分支、能生长的 Agent。

```
@stello-ai/core        →  Session 树 + 三层记忆 + 生命周期钩子 + Agent Tools
@stello-ai/visualizer  →  星图布局 + Canvas 渲染 + React 组件
```

## 安装

```bash
# npm
npm install @stello-ai/core @stello-ai/visualizer

# pnpm
pnpm add @stello-ai/core @stello-ai/visualizer

# yarn
yarn add @stello-ai/core @stello-ai/visualizer
```

> `@stello-ai/visualizer` 需要 `react` 和 `react-dom` 作为 peer dependency。`@stello-ai/core` 零依赖。

## 5 分钟快速上手

### 1. 初始化引擎

```typescript
import {
  NodeFileSystemAdapter,
  CoreMemory,
  SessionMemory,
  SessionTreeImpl,
  LifecycleManager,
  SplitGuard,
  SkillRouterImpl,
  AgentTools,
} from '@stello-ai/core';
import type { CoreSchema, StelloConfig } from '@stello-ai/core';

// 定义 Agent 的全局核心档案结构
const schema: CoreSchema = {
  name:    { type: 'string',  default: '',  bubbleable: true },
  goal:    { type: 'string',  default: '',  bubbleable: true },
  notes:   { type: 'array',   default: [],  bubbleable: true },
};

// 接入你的 LLM
const callLLM = async (prompt: string): Promise<string> => {
  // 替换为你的 OpenAI / Claude / 本地模型调用
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }] }),
  });
  const json = await res.json() as { choices: { message: { content: string } }[] };
  return json.choices[0]?.message.content ?? '';
};

// 组装所有模块
const fs       = new NodeFileSystemAdapter('./stello-data');
const core     = new CoreMemory(fs, schema);
const sessions = new SessionTreeImpl(fs);
const memory   = new SessionMemory(fs);
const config: StelloConfig = { dataDir: './stello-data', coreSchema: schema, callLLM };
const lifecycle = new LifecycleManager(core, memory, sessions, config);
const guard    = new SplitGuard(sessions);
const tools    = new AgentTools(sessions, core, memory, lifecycle, guard);

await core.init();
```

### 2. 创建根 Session 并开始对话

```typescript
const root = await sessions.createRoot('我的项目');
const { context } = await lifecycle.bootstrap(root.id);

// context.core    → { name: '', goal: '', notes: [] }
// context.memories → []
// context.scope   → null

// 每轮对话结束后调用 afterTurn，同时更新三层记忆
const result = await lifecycle.afterTurn(
  root.id,
  { role: 'user',      content: '我叫 Alice，想做一个聊天机器人', timestamp: new Date().toISOString() },
  { role: 'assistant', content: '好的 Alice！让我来帮你做聊天机器人。', timestamp: new Date().toISOString() },
);
await lifecycle.flushBubbles();
// result → { recordAppended: true, memoryUpdated: true, coreUpdated: true }
```

### 3. 分支到子 Session

```typescript
// 将 8 个内置 tool 交给 LLM
const toolDefs = tools.getToolDefinitions();
// → 将 toolDefs 传给 LLM 的 function calling / tool use

// 当 Agent 决定分支时：
await sessions.updateMeta(root.id, { turnCount: 5 });
const { success, data: child } = await tools.executeTool('stello_create_session', {
  parentId: root.id,
  label: 'UI 设计讨论',
});
// 子 Session 通过继承策略自动获得父的 memory.md
```

### 4. 渲染星空图

```tsx
import { StelloGraph } from '@stello-ai/visualizer';

function App() {
  const [sessions, setSessions] = useState([]);
  const [memories, setMemories] = useState(new Map());
  const [messages, setMessages] = useState(new Map());

  // 从 Stello 数据加载 sessions
  // ...

  return (
    <StelloGraph
      sessions={sessions}
      memories={memories}
      messages={messages}
      onSessionClick={(id) => console.log('跳转到', id)}
      onSendMessage={(id, text) => console.log('发送到', id, text)}
      sessionFiles={(id) => ({ memory: '...', scope: '...' })}
      layoutConfig={{ ringSpacing: 120, colorFn: (s) => s.depth === 0 ? '#FFD700' : '#7EC8E3' }}
    />
  );
}
```

## 核心概念

### Session 树

每段对话都是一棵**树**。根 Session 是主线程，子 Session 分支出去探索子话题，还可以通过**跨分支引用**（refs）横向关联。

```
        ┌── UI 设计 ──── 配色方案
根 ─────┤
        └── 后端 API ─── 认证模块
               (ref) ─ ─ ─ ─ ┘
```

- **平铺存储**：`sessions/{uuid}/` — 树关系靠 `meta.json` 维护，不靠文件夹嵌套
- **只归档不删除**：归档可逆，永不删除
- **拆分保护**：最少轮次 + 冷却期，防止过度分支

### 三层记忆

| 层 | 存什么 | 粒度 | 文件 |
|----|--------|------|------|
| **L1** 核心档案 | 结构化数据（开发者定义 schema） | 全局唯一 | `core.json` |
| **L2** Session 记忆 | 关键结论、意图、待跟进 | 每 Session 一份 | `memory.md` |
| **L3** 原始记录 | 完整对话历史 | 每 Session 一份 | `records.jsonl` |

**记忆双向流动：**

- **继承（向下）**：子 Session 按策略继承父的记忆（`summary` / `full` / `minimal` / `scoped`）
- **冒泡（向上）**：schema 中标记 `bubbleable` 的字段从子 Session 冒泡回全局 `core.json`（500ms 防抖，last-write-wins）

### 星空图可视化

`<StelloGraph />` React 组件将 Session 树渲染为可交互的星座图，采用 **Liquid Glass** 视觉风格：

- **节点大小** = `turnCount`（对话越多，星星越大）
- **节点亮度** = `lastActiveAt`（越近越亮）
- **节点发光** = 每颗星带颜色匹配的光晕效果
- **实线** = 父子关系
- **虚线** = 跨分支引用
- **归档节点** = 低透明度
- **渐变背景** = 暗色渐变画布
- **交互**：滚轮缩放、拖拽平移、**节点拖拽**、点击导航、悬浮预览
- **侧边栏面板**：点击节点展开侧边栏，包含**对话**和**文件**（memory/scope/index）两个 Tab

## API 概览

### @stello-ai/core

| 类 | 用途 |
|----|------|
| `NodeFileSystemAdapter` | 文件系统持久化（可替换为 DB 适配器） |
| `SessionTreeImpl` | Session 树 CRUD — `createRoot`、`createChild`、`archive`、`addRef` |
| `CoreMemory` | L1 全局档案 — schema 校验、点路径访问（`profile.gpa`）、变更事件 |
| `SessionMemory` | L2 + L3 — `readMemory`、`writeMemory`、`appendRecord`、`readRecords` |
| `LifecycleManager` | 编排 `bootstrap`、`afterTurn`、`onSessionSwitch`、`prepareChildSpawn` |
| `BubbleManager` | 防抖冒泡：子 Session L1 变更传播到全局 |
| `SplitGuard` | 拆分保护（最少轮次 + 冷却期） |
| `ConfirmManager` | 确认协议：拆分建议 + `requireConfirm` 字段变更 |
| `SkillRouterImpl` | Skill 注册 + 关键词匹配 |
| `AgentTools` | 8 个 LLM 可调用的 tool |

#### Agent Tools（LLM function calling）

```typescript
const defs = tools.getToolDefinitions();
// 传给 LLM，然后执行：
const result = await tools.executeTool('stello_create_session', { parentId, label });
```

| Tool | 用途 |
|------|------|
| `stello_read_core` | 读取全局档案字段 |
| `stello_update_core` | 更新全局档案字段 |
| `stello_create_session` | 创建子 Session |
| `stello_list_sessions` | 列出所有 Session |
| `stello_read_summary` | 读取 Session 的 memory.md |
| `stello_add_ref` | 创建跨分支引用 |
| `stello_archive` | 归档 Session |
| `stello_update_meta` | 更新 Session 元数据 |

### @stello-ai/visualizer

| 导出 | 用途 |
|------|------|
| `<StelloGraph />` | React 组件 — 开箱即用的星座图 + 侧边栏面板 |
| `<ChatPanel />` | 独立对话面板组件 |
| `<FilePanel />` | 独立文件浏览面板组件 |
| `theme` | Liquid Glass 设计令牌（颜色、模糊、阴影） |
| `computeConstellationLayout()` | 纯函数 — 不依赖 React 也能用 |
| `renderFrame()` | Canvas 渲染器 — 渐变背景 + 节点发光 |
| `InteractionHandler` | 缩放 / 平移 / 节点拖拽 / 点击处理器 |

## 配置项

```typescript
const config: StelloConfig = {
  dataDir: './stello-data',           // 数据存储目录（必填）
  coreSchema: schema,                 // L1 字段定义（必填）
  callLLM: myLLMFunction,            // LLM 调用函数（必填）
  inheritancePolicy: 'summary',      // 'summary' | 'full' | 'minimal' | 'scoped'
  splitStrategy: {
    minTurns: 3,                      // 拆分前最少轮次
    cooldownTurns: 5,                 // 两次拆分间最少间隔轮次
  },
  bubblePolicy: {
    debounceMs: 500,                  // 冒泡防抖间隔
  },
};
```

## 设计哲学

- **适配器模式**：默认文件系统，换 SQLite/Postgres 不改业务代码
- **三层独立**：L1/L2/L3 互不阻塞，某层失败不影响其他层
- **Markdown 原生**：memory/scope/index 文件都是 `.md` — LLM 天然理解，人类可直接阅读编辑
- **无厂商锁定**：自带 LLM（`callLLM`）、自带 embedder — 你选什么模型就用什么模型
- **事件驱动，不含 UI**：确认协议只发事件，UI 你自己定

## 参与贡献

欢迎贡献！请查看 [issues](https://github.com/stello-agent/stello/issues) 页面。

```bash
git clone https://github.com/stello-agent/stello.git
cd stello
pnpm install
pnpm test        # 两个包共 154 个测试
pnpm typecheck   # TypeScript 严格模式
```

## 示例

完整示例请查看 [stello-examples](https://github.com/stello-agent/stello-examples) 仓库：

- **basic** — 最小启动（创建根 Session，执行 afterTurn）
- **conversation** — 多轮对话 + 记忆更新
- **branching** — Session 分支 + 记忆继承
- **cross-reference** — 跨分支引用
- **agent-tools** — 8 个 Agent Tool 全部演示
- **full-flow** — 完整生命周期 + 可视化导出
- **visualizer-test** — 交互式星空图（Vite + React）

```bash
git clone https://github.com/stello-agent/stello-examples.git
cd stello-examples/demo && pnpm install && pnpm dev
```

## 许可证

[Apache-2.0](./LICENSE)
