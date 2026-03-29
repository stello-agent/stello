<p align="right">
  <strong>English</strong> | <a href="./README_ZH.md">中文</a>
</p>

<div align="center">
  <img src="./stello_logo.svg" alt="Stello" width="200">

  <h1>Stello</h1>

  <p>Open-source conversation topology engine for multi-session AI systems.</p>

  <p>
    <a href="https://www.npmjs.com/package/@stello-ai/core"><img src="https://img.shields.io/npm/v/@stello-ai/core.svg" alt="npm version"></a>
    <a href="./LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License"></a>
  </p>
</div>

## Overview

Stello models AI work as a topology of sessions instead of a single linear chat log.
Each child session handles a scoped branch of work. A main session integrates branch-level summaries and pushes targeted insights back down when needed.

This repository is organized around four packages:

- `@stello-ai/session`: session primitives, context assembly, L2/L3 memory, LLM adapters
- `@stello-ai/core`: orchestration, fork policies, scheduling, integration, agent runtime
- `@stello-ai/server`: HTTP/WebSocket service layer with PostgreSQL-backed persistence
- `@stello-ai/devtools`: local inspection UI for topology, conversations, settings, and events

## Why Stello

Linear chat is a poor fit for workflows that branch, recurse, or need isolated context windows. Typical symptoms are:

- context dilution as unrelated subproblems accumulate in one thread
- weak visibility into how branches relate to each other
- no clean mechanism for cross-branch synthesis
- poor recoverability after long-running sessions

Stello addresses this by separating:

- branch execution: child sessions own their own L3 history
- external description: each child can consolidate L3 into an L2 summary
- global reasoning: the main session integrates all L2 summaries into synthesis and insights

## Core Model

### Skill metaphor

Each child session behaves like a skill with a private implementation and a public description.

```text
Child Session
  L3 = raw conversation history for that session
  L2 = external summary consumed by Main Session

Main Session
  synthesis = integrated view across all child L2 summaries
  insights = targeted guidance pushed back to specific child sessions
```

### Memory layers

| Layer | Meaning | Consumer |
| --- | --- | --- |
| L3 | Raw session history | The session's own LLM |
| L2 | External session summary | Main session |
| L1 | Global structured state and synthesis | Application layer / main session |

### Architectural constraints

- Child sessions do not read their own L2.
- Main session reads L2, not child L3.
- Child sessions do not communicate directly with each other.
- Cross-session information flows through main-session insights.

## Packages

### `@stello-ai/session`

Session-level primitives for:

- assembling prompt context
- storing and replaying L3 records
- consolidating L3 into L2
- handling streaming and tool-call capable LLM adapters

Use this package if you only need a single memory-bearing session abstraction.

### `@stello-ai/core`

Core orchestration for:

- turn execution with tool-call loops
- fork orchestration
- consolidation and integration scheduling
- runtime management and orchestration strategies

Use this package when you need a topology of sessions with a main-session control plane.

### `@stello-ai/server`

Service wrapper for:

- REST and WebSocket APIs
- PostgreSQL-backed persistence
- multi-space and multi-tenant hosting patterns
- long-lived agent runtime management

Use this package when you need a deployable backend instead of an in-process SDK only setup.

### `@stello-ai/devtools`

Development tooling for:

- topology inspection
- conversation replay
- prompt/settings editing
- event stream inspection
- local debugging of agent behavior

Use this during development; it is not meant to be a production UI dependency.

## Quick Start

### Install

```bash
pnpm add @stello-ai/core @stello-ai/session

# optional during development
pnpm add -D @stello-ai/devtools
```

### Create an agent

```ts
import { createStelloAgent } from '@stello-ai/core'

const agent = createStelloAgent({
  sessions: /* SessionTree implementation */,
  session: {
    llm: /* LLM adapter */,
    sessionResolver: async (id) => {
      /* return a session-compatible runtime */
    },
  },
})

const result = await agent.turn('main-session-id', 'Plan a product strategy')
```

### Start devtools

```ts
import { startDevtools } from '@stello-ai/devtools'

await startDevtools(agent, {
  port: 4800,
  open: true,
})
```

## Documentation

- [Usage guide](./docs/usage.md)
- [Stello overview](./docs/stello-usage.md)
- [Orchestrator usage](./docs/orchestrator-usage.md)
- [Server package plan](./docs/server-package-plan.md)
- [API/config reference](./docs/stello-agent-config-reference.md)
- [Contributing guide](./CONTRIBUTING.md)

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

Useful local commands:

```bash
pnpm demo:agent
pnpm demo:chat
```

## Star History

<a href="https://www.star-history.com/?repos=stello-agent%2Fstello&type=timeline&logscale=&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=stello-agent/stello&type=timeline&theme=dark&logscale&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=stello-agent/stello&type=timeline&logscale&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/image?repos=stello-agent/stello&type=timeline&logscale&legend=top-left" />
 </picture>
</a>

## License

Apache-2.0 © [Stello Team](https://github.com/stello-agent)
