# @stello-ai/core

The Stello orchestration layer for session topologies, tool-call loops, lifecycle management, forking, consolidation, and orchestrator-facing data APIs.

## Install

```bash
pnpm add @stello-ai/core @stello-ai/session
```

## Conversation APIs

`createStelloAgent()` is the recommended entry point. Starting with `0.11.0`, streaming is the required runtime transport:

- `stream()` exposes chunks from every LLM sub-round, including continuations after tool calls.
- `turn()` consumes the same streaming tool loop and returns the aggregated final result.
- Custom Session/Engine runtimes must implement a real `stream()` method.

## Main exports

- `createStelloAgent` / `StelloAgent`
- `TurnRunner` / `StelloEngineImpl`
- `SessionOrchestrator`
- `DefaultEngineFactory` / `DefaultEngineRuntimeManager`
- `SessionTreeImpl`
- `ToolRegistryImpl`
- Session factories and adapters re-exported from `@stello-ai/session`

See the [Stello repository](https://github.com/stello-agent/stello) for guides, examples, migration notes, and API design documentation.

## License

Apache-2.0
