<p align="right">
  <a href="#english">English</a> | <a href="./README_CN.md">中文</a>
</p>

<a id="english"></a>

<div align="center">
  <img src="./stello_logo.svg" alt="Stello" width="200">

  <h1>Stello</h1>

  <p><strong>Your thinking branches. Tools flatten it.</strong></p>

  <p>
    <a href="https://www.npmjs.com/package/@stello-ai/core"><img src="https://img.shields.io/npm/v/@stello-ai/core.svg" alt="npm version"></a>
    <a href="./LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License"></a>
  </p>
</div>

<br/>

You talk with AI about product design, then drift into tech stack choices, hiring needs, and back to fundraising. Two hours later, you close the window—no structure left behind.

**All thinking compressed into a single line.**

Your brain juggles five directions at once, but tools give you a single-threaded window. ChatGPT, Claude, Gemini—all the same.

**It's not the model. It's the container.**

---

**Stello** is the first conversation topology system.

Conversations auto-split into tree-structured sessions. Each branch dives deep independently. Insights flow across branches. The entire topology renders as an interactive star map.

Thinking finally has shape.

---

## ✨ Core Capabilities

- 🌳 **Auto-splitting Conversations** — AI detects topic branches and creates child sessions via tool calling, each with clear scope
- 🧠 **Three-layer Memory** — L3 raw records / L2 skill descriptions / L1 global cognition, memory flows between layers
- 🔄 **Global Synthesis** — Main Session collects all L2s from child sessions, generates synthesis and pushes insights
- ⚡️ **Zero Overhead in Dialogue** — All memory consolidation executes async (fire-and-forget), never blocks conversation flow
- 🎨 **Star Map Visualization** — Each star is a thought direction, connections show relationships, size maps depth, brightness maps activity
- 🔌 **Fully Decoupled Architecture** — No LLM lock-in / storage lock-in / UI lock-in, Session and Topology are separate

---

## 🚀 Quick Start

### Installation

```bash
npm install @stello-ai/core @stello-ai/session
# or
pnpm add @stello-ai/core @stello-ai/session

# For development debugging
pnpm add -D @stello-ai/devtools
```

### 30-Second Example

```typescript
import { createStelloAgent } from '@stello-ai/core'
import { FileSystemStorageAdapter } from '@stello-ai/core/adapters'

// Create Agent
const agent = await createStelloAgent({
  sessions: /* SessionTree implementation */,
  memory: /* MemoryEngine implementation */,
  session: {
    llm: yourLLMAdapter,
    sessionResolver: async (id) => /* return Session instance */,
  },
})

// Start conversation
const result = await agent.turn('main-session-id', 'Help me plan a startup')

// AI auto-detects topic branches, creates child sessions
// Dive deep in different branches, Main Session maintains global view
```

### Launch Visual Debugger

```typescript
import { startDevtools } from '@stello-ai/devtools'

await startDevtools(agent, {
  port: 4800,
  open: true
})

// Browser opens automatically at http://localhost:4800
// See star map + conversation panels + live event streams
```

---

## 📦 Packages

### @stello-ai/session

**Standalone conversation unit**, minimal three-layer memory implementation.

- ✅ Single LLM calls (send / stream)
- ✅ L3 conversation record persistence
- ✅ L2 skill description generation (consolidate)
- ✅ Fully decoupled from tree structure
- ✅ Streaming output and tool calling support

**Use for:** Simple scenarios needing single conversation + memory

---

### @stello-ai/core

**Orchestration engine**, session tree scheduler.

- ✅ Tool call loops (turn)
- ✅ Consolidation / Integration scheduling
- ✅ Main Session global consciousness
- ✅ Session tree management (fork / archive / refs)
- ✅ Split protection and policy configuration
- ✅ Lifecycle hooks and event system

**Use for:** Complex apps needing multi-branch dialogue + global synthesis

---

### @stello-ai/server

**Service layer**, PostgreSQL + HTTP/WebSocket.

- ✅ REST + WebSocket dual channels
- ✅ PostgreSQL persistence (7 tables)
- ✅ Multi-tenant Space management
- ✅ AgentPool lazy-loading + auto-eviction
- ✅ Per-session prompt 3-tier fallback
- ✅ Out-of-box Docker Compose

**Use for:** Production deployments + multi-user isolation for SaaS apps

---

### @stello-ai/devtools

**Development debugger**, star map + live panels.

- ✅ Interactive star map (drag / zoom)
- ✅ Conversation panel + file browser
- ✅ Real-time event monitoring
- ✅ Apple Liquid Glass visual style
- ✅ One-line integration

**Use for:** Development debugging (not production dependency)

---

## 🎯 Core Concepts

### The Skill Metaphor

Each child session is a **skill**. Main Session is the **skill orchestrator**.

```
Child Session = Skill
  L3 = Skill's detailed knowledge base (internal consumption)
  L2 = Skill's description (external interface, Main Session consumes)

Main Session = Orchestrator
  synthesis = Synthesized cognition of all L2s
  insights = Targeted suggestions pushed to each child session
```

**Core Constraints:**
- L2 invisible to child session itself — L2 is external description, not self-use memory
- Main Session only reads L2, never reads child session's L3
- Child sessions completely isolated, only cross-branch info source is Main Session's pushed insights

---

### Three-layer Memory

| Layer | Content | Consumer |
|-------|---------|----------|
| **L3** | Raw conversation records | The session's own LLM |
| **L2** | Skill description (external view) | Main Session (via integration) |
| **L1** | Global key-value + synthesis | Application layer direct access |

**Memory Flow:**
- **Upward Reporting** — L3 → L2 → Main Session index
- **Downward Push** — Main Session insights → Child Sessions
- **Horizontal Isolation** — No direct communication between child sessions

---

## 💡 Use Cases

- **Deep Consulting** — Legal, medical, financial multi-dimensional analysis, avoid information pollution
- **Knowledge Exploration** — Learning, researching multiple topics in parallel, auto-build knowledge maps
- **Goal Decomposition** — Startup planning, project management, OKR execution with hierarchical tasks
- **System Building** — Course systems, knowledge systems, product architecture with layered design
- **Creative Production** — Content, design exploring multiple approaches in parallel, maintain global consistency
- **Office Collaboration** — Multi-task coordination, AI discovers omissions and cross-task dependencies

For scenarios needing **simultaneous multi-directional progress + global oversight**.

---

## 📚 Documentation

- 📖 **Complete Guide** — _Coming Soon_
- 🎯 **Core Concepts** — _Coming Soon_
- 📦 **API Reference** — _Coming Soon_
- 💡 **Examples** — _Coming Soon_
- 🏗️ **Architecture** — _Coming Soon_
- 💬 **Community** — _Coming Soon_

---

## 🤝 Contributing

Contributions welcome! See [CONTRIBUTING.md](./CONTRIBUTING.md)

---

## 📄 License

Apache-2.0 © [Stello Team](https://github.com/stello-agent)
