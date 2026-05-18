<p align="right">
  <strong>English</strong> | <a href="./README.md">中文</a>
</p>

<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./assets/stello_logo_light.svg">
    <source media="(prefers-color-scheme: light)" srcset="./assets/stello_logo.svg">
    <img src="./assets/stello_logo.svg" alt="Stello" width="200">
  </picture>

  <h1>Stello</h1>

  <p><strong>Your thinking is branching and growing—don't let linear chat limit it!</strong></p>
  <p>Building an Open-Source Agent Cognitive Topology Engine — Know the World the AI-Native Way</p>

  <p>
    <a href="https://www.npmjs.com/package/@stello-ai/core"><img src="https://img.shields.io/npm/v/@stello-ai/core.svg" alt="npm version"></a>
    <a href="./LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License"></a>
  </p>
</div>

<br/>

## 🌟 What Problem Does Stello Solve?

Ever feel your AI conversations trapped in a single thread? Your thinking diverges, branching in multiple directions, weaving together—but the dialogue keeps growing, context tightens, and response quality quietly degrades. Two hours later you close the window—no structure remains. Days later you want to continue, but can't even recall where you left off.

**It's not the model—it's how you collaborate with AI that's primitive!** Your thinking is branching and evolving, yet AI interacts with you linearly through a scrolling window!

**Stello explodes that line into a network! Every conversation you have builds a self-aware, ever-growing cognitive topology!**

<br/>

## 🌟 What is Stello?

**An Agent Cognitive Topology Engine.**

Stello is an open-source conversation topology engine for AI Agent and AI application developers. It splits conversations into a forest of branchable Sessions—each Session has its own L3 history and also exposes an external description (`memory`) for reflection; cross-branch synthesis runs in *your* application layer with any LLM you choose, then writes targeted `insight` back to specific Sessions through the SDK. The whole topology renders as a growable, conversable star-node graph.

Linear chat doesn't fit workflows that branch, recurse, or need context isolation. Common problems include:

- Multiple sub-problems piled into one thread, diluting context
- No way to visualize relationships between different branches
- No stable cross-branch synthesis mechanism
- Long-running sessions lack structural information when resumed

Stello's approach explicitly separates three things:

- **Branch Execution:** Each Session holds its own L3 history
- **External Description:** Each Session distills its conversation into `memory` for external consumption
- **Global Synthesis:** An orchestrator-facing data SDK lets your app batch-collect every Session's memory, run any reflection logic, and write targeted `insight` back

---

## Core Capabilities

- **Auto-splitting Conversations** — AI detects topic branches and creates child Sessions via tool calling, each with clear scope
- **Single Session Model** — root and child are runtime-isomorphic; the only difference is topology position. Multi-root (forest) is a first-class case
- **Three content slots** — `systemPrompt` (persistent), `insight` (one-shot inbox), `memory` (external description; never injected into Session's own context)
- **Orchestrator-facing Data SDK** — `listSessionDigests` / `putInsight` etc. exposed to external reflection layers (your app / Claude Code / Codex / ...). Cross-branch synthesis is your application's choice of LLM and prompt
- **Zero Overhead in Dialogue** — All memory consolidation executes async (fire-and-forget), never blocks conversation flow
- **Star Map Visualization** — Each star is a thought direction, connections show relationships, size maps depth, brightness maps activity
- **Fully Decoupled Architecture** — No LLM / storage / UI lock-in; Session content and Topology structure are injected independently

---

## Core Concepts

### Single Session + Application-Level Orchestrator

Every Session is a conversation unit with a private implementation and a public description.

```text
Session (root or child — runtime-isomorphic)
  L3      = raw conversation history (consumed by itself)
  memory  = external description (consumed by your app / orchestrator)
  insight = one-shot inbox (injected then cleared at next send)

Application-Level Orchestrator (lives outside the framework)
  batch read    = listSessionDigests({ status: 'active' })
  reflection    = any LLM synthesizes all Sessions' memory
  targeted push = putInsight(targetSessionId, content)
```

### Three content slots

| Slot | Writer | Reader | Lifecycle |
|------|--------|--------|-----------|
| `systemPrompt` | fork chain / app | injected into every Session.send() | persistent |
| `insight` | app (`putInsight`) | consumed once, then `clearInsight` | one-shot inbox |
| `memory` | app / `consolidateFn` output | external reflection layer (`listSessionDigests`) | persistent (NOT injected into send) |

### Architectural Constraints

- A Session never reads its own `memory` (memory is the *external* view).
- Sessions don't see each other.
- Cross-Session signal travels through the `insight` one-shot inbox.
- Global reflection is implemented by the application on top of the SDK — the framework holds no cross-Session state.

## Packages

<table>
<tr>
<td width="50%" valign="top">

### `@stello-ai/session`

Handles Session-level capabilities:

- Assemble prompt context
- Store and replay L3 records
- Consolidate the conversation into `memory`
- LLM adapters with streaming and tool call support

If you only need a single Session abstraction with memory, start here.

</td>
<td width="50%" valign="top">

### `@stello-ai/core`

Handles core orchestration and the orchestrator-facing data SDK:

- StelloAgent top-level entry (create / enter / turn / stream / fork / data SDK)
- Turn execution with tool-call loops
- Fork orchestration (topology + Session, two-step)
- Consolidation scheduling
- Runtime ref-counting and lifecycle

If you need a Session topology plus an orchestrator-facing data SDK, start here.

</td>
</tr>
<tr>
<td width="50%" valign="top">

### `@stello-ai/server`

Handles service-level packaging:

- REST and WebSocket API
- PostgreSQL persistence
- Multi-space / multi-tenant hosting
- Long-lifecycle agent runtime management

If you need a deployable backend rather than an in-process SDK, start here.

</td>
<td width="50%" valign="top">

### `@stello-ai/devtools`

Handles development debugging:

- Topology graph inspection
- Conversation replay
- Prompt / settings editing
- Event stream observation
- Local agent behavior debugging

This package is for development, not a production UI dependency.

</td>
</tr>
</table>

## Quick Start

### Installation

```bash
pnpm add @stello-ai/core @stello-ai/session

# Optional for development
pnpm add -D @stello-ai/devtools
```

### Create an Agent

```ts
import { createStelloAgent } from '@stello-ai/core'

const agent = createStelloAgent({
  sessions: /* SessionTree implementation */,
  storage:  /* SessionStorage implementation (enables orchestrator-facing data SDK) */,
  memory:   /* MemoryEngine implementation */,
  capabilities: {
    lifecycle, tools, skills, confirm,
  },
  session: {
    sessionLoader: async (id) => {
      /* return a Session instance and its serializable config for the given id */
    },
  },
})

// Create the conversation entry point (no parentId == new root)
const root = await agent.createSession({ label: 'Main' })

await agent.enterSession(root.id)
const result = await agent.turn(root.id, 'Help me plan a product strategy')
```

### Launch Devtools

```ts
import { startDevtools } from '@stello-ai/devtools'

await startDevtools(agent, {
  port: 4800,
  open: true,
})
```

## Documentation

- [Usage Guide](./docs/usage.md)
- [Stello Overview](./docs/stello-usage.md)
- [Orchestrator Guide](./docs/orchestrator-usage.md)
- [Server Design](./docs/server-package-plan.md)
- [API / Config Reference](./docs/stello-agent-config-reference.md)
- [Contributing](./CONTRIBUTING.md)

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

Common local commands:

```bash
pnpm demo:agent
pnpm demo:chat
```

## License

Apache-2.0 © [Stello Team](https://github.com/stello-agent)

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=stello-agent/stello&type=Date)](https://star-history.com/#stello-agent/stello&Date)
