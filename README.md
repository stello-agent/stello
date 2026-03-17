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

  // Load sessions from your Stello data
  // ...

  return (
    <StelloGraph
      sessions={sessions}
      memories={memories}
      onSessionClick={(id) => console.log('Navigate to', id)}
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

The `<StelloGraph />` React component renders your session tree as an interactive constellation:

- **Node size** = `turnCount` (more conversation = bigger star)
- **Node brightness** = `lastActiveAt` (recent = brighter)
- **Solid lines** = parent-child relationships
- **Dashed lines** = cross-branch references
- **Archived nodes** = low opacity
- **Interactions**: zoom (scroll), pan (drag), click to navigate, hover for tooltip

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
| `<StelloGraph />` | React component — drop-in constellation visualization |
| `computeConstellationLayout()` | Pure function — use without React |
| `renderFrame()` | Canvas renderer — use without React |
| `InteractionHandler` | Zoom / pan / click handler — use without React |

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
pnpm test        # 134 tests across both packages
pnpm typecheck   # TypeScript strict mode
```

## License

[Apache-2.0](./LICENSE)
