# @stello-ai/session

Session primitives for Stello: context assembly, message persistence, memory consolidation, tool calls, and streaming LLM adapters.

## Install

```bash
pnpm add @stello-ai/session
```

Install the provider SDK used by your adapter as well:

```bash
pnpm add @anthropic-ai/sdk
# or
pnpm add openai
```

## Streaming contract

Starting with `0.9.0`, `LLMAdapter.stream()` is required and is the single provider transport. `Session.stream()` exposes text chunks as they arrive, while `Session.send()` consumes the same stream and returns the aggregated result.

Built-in Anthropic and OpenAI-compatible adapters follow this contract. The `complete()` adapter facade remains available for Promise-based callers, but it aggregates `stream()` instead of using a provider non-streaming endpoint.

## Main exports

- `createSession` / `loadSession`
- `createClaude` / `createGPT`
- `createAnthropicAdapter` / `createOpenAICompatibleAdapter`
- `collectLLMStream`
- `InMemoryStorageAdapter`

See the [Stello repository](https://github.com/stello-agent/stello) for guides, examples, and API design documentation.

## License

Apache-2.0
