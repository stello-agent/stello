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

**The first Agent Cognitive Topology Engine.**

Stello is an open-source cognitive topology engine for AI Agent and AI application developers. It provides four core capabilities: auto-splitting conversations, three-layer hierarchical memory, global consciousness integration, and topology visualization.

Conversations auto-split into independent Sessions by semantics, forming tree-structured topologies. The three-layer memory system inherits hierarchically across Sessions. The global consciousness layer (Main Session) perceives conflicts and dependencies across all branches, pushing targeted insights. The entire cognitive topology renders as a growable, conversable star-node graph.

Linear chat doesn't fit workflows that branch, recurse, or need context isolation. Common problems include:

- Multiple sub-problems piled into one thread, diluting context
- No way to visualize relationships between different branches
- No stable cross-branch synthesis mechanism
- Long-running sessions lack structural information when resumed

Stello's approach explicitly separates three things:

- **Branch Execution:** Child Sessions hold their own L3 history
- **External Description:** Child Sessions distill L3 into L2 for external consumption
- **Global Integration:** Main Session reads all L2s, producing synthesis and insights

---

## Core Capabilities

- **Auto-splitting Conversations** — AI detects topic branches and creates child Sessions via tool calling, each with clear scope
- **Three-layer Memory** — L3 raw records / L2 skill descriptions / L1 global cognition, memory flows between layers
- **Global Synthesis** — Main Session collects all child Session L2s, generates synthesis and pushes insights
- **Zero Overhead in Dialogue** — All memory consolidation executes async (fire-and-forget), never blocks conversation flow
- **Star Map Visualization** — Each star is a thought direction, connections show relationships, size maps depth, brightness maps activity
- **Fully Decoupled Architecture** — No LLM / storage / UI lock-in, Session and Topology are separate

---

## Core Concepts

### The Skill Metaphor

Each child Session can be seen as a skill with a private implementation and a public description.

```text
Child Session
  L3 = The session's raw conversation history
  L2 = External summary consumed by Main Session

Main Session
  synthesis = Integrated view of all child Session L2s
  insights = Targeted suggestions pushed to specific child Sessions
```

### Three-layer Memory

| Layer | Meaning | Consumer |
| --- | --- | --- |
| L3 | Raw conversation history | The session's own LLM |
| L2 | Session's external summary | Main Session |
| L1 | Global structured state and synthesis | Application layer / Main Session |

### Architectural Constraints

- Child Sessions do not read their own L2.
- Main Session reads L2, not child Sessions' L3.
- Child Sessions do not communicate directly.
- Cross-Session information propagates through Main Session insights.

## Packages

<table>
<tr>
<td width="50%" valign="top">

### `@stello-ai/session`

Handles Session-level capabilities:

- Assemble prompt context
- Store and replay L3 records
- Consolidate L3 into L2
- Handle LLM adapters with streaming and tool call support

If you only need a single Session abstraction with memory, start here.

</td>
<td width="50%" valign="top">

### `@stello-ai/core`

Handles core orchestration:

- Turn execution with tool-call loops
- Fork orchestration
- Consolidation / integration scheduling
- Runtime management and lifecycle

If you need a Session topology with Main Session coordinating everything, start here.

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
  session: {
    llm: /* LLM adapter */,
    sessionResolver: async (id) => {
      /* return session-compatible runtime */
    },
  },
})

const result = await agent.turn('main-session-id', 'Help me plan a product strategy')
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
