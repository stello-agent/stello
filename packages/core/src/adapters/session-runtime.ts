import type { ForkContextFn, LLMAdapter, LLMCompleteOptions } from '@stello-ai/session';
import type { EngineRuntimeSession } from '../engine/stello-engine';
import type { ToolCallParser } from '../engine/turn-runner';

/**
 * 结构兼容 @stello-ai/session 的 ToolCall。
 *
 * 这里不直接 import 包类型，是为了避免 monorepo 下未构建 dist 时的类型解析问题。
 * 但字段语义和 session 包保持一致。
 */
export interface SessionCompatibleToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** 结构兼容 @stello-ai/session 的 send() 返回 */
export interface SessionCompatibleSendResult {
  content: string | null;
  toolCalls?: SessionCompatibleToolCall[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

/** 结构兼容 @stello-ai/session 的 consolidate 函数签名 */
export type SessionCompatibleConsolidateFn = (
  currentMemory: string | null,
  messages: Array<{ role: string; content: string; timestamp?: string }>,
) => Promise<string>;

/** 结构兼容 @stello-ai/session 的 compress 函数签名 */
export type SessionCompatibleCompressFn = (
  messages: Array<{ role: string; content: string; timestamp?: string }>,
) => Promise<string>;

/** 结构兼容 @stello-ai/session 的 ForkOptions */
export interface SessionCompatibleForkOptions {
  id?: string;
  label: string;
  systemPrompt?: string;
  context?: 'none' | 'inherit' | 'compress' | ForkContextFn;
  prompt?: string;
  llm?: LLMAdapter;
  tools?: LLMCompleteOptions['tools'];
  /** 子 session 的 L3→L2 提炼函数（不传则继承父 session 的） */
  consolidateFn?: SessionCompatibleConsolidateFn;
  /** 子 session 的上下文压缩函数（不传则继承父 session 的） */
  compressFn?: SessionCompatibleCompressFn;
}

/** Session.send / Session.stream 的可选运行时参数（结构兼容 @stello-ai/session） */
export interface SessionCompatibleSendOptions {
  /** AbortSignal — abort 时底层 LLM 调用应被取消 */
  signal?: AbortSignal;
  /** Agent 级共享 memory 索引段（已由编排层渲染） */
  sharedMemoryContext?: string;
  /** Per-session topology 上下文段（已由编排层渲染） */
  topologyContext?: string;
}

/** 结构兼容 @stello-ai/session 的 Session */
export interface SessionCompatible {
  meta: {
    id: string;
    status: 'active' | 'archived';
  };
  send(
    content: string,
    options?: SessionCompatibleSendOptions,
  ): Promise<SessionCompatibleSendResult>;
  stream?(
    content: string,
    options?: SessionCompatibleSendOptions,
  ): AsyncIterable<string> & { result: Promise<SessionCompatibleSendResult> };
  messages(): Promise<Array<{ role: string; content: string; timestamp?: string }>>;
  consolidate(): Promise<void>;
  /** fork 子 session，返回结构兼容的子 session */
  fork?(options: SessionCompatibleForkOptions): Promise<SessionCompatible>;
  /** Current tool list visible to LLM (mirrors underlying Session.tools) */
  readonly tools?: LLMCompleteOptions['tools'];
  /** Replace tool list (forwards to underlying Session.setTools) */
  setTools(tools: LLMCompleteOptions['tools'] | undefined): void;
}

/** Session -> EngineRuntime 适配配置 */
export interface SessionRuntimeAdapterOptions {
  /** 上下文压缩函数（可选） */
  compressFn?: SessionCompatibleCompressFn;
  /** 自定义 send() 结果序列化方式，默认转成 JSON 字符串 */
  serializeResult?: (result: SessionCompatibleSendResult) => string;
  /**
   * 每次 send/stream 前调用，返回当前 agent 的共享 memory 全量上下文段。
   * 返回 undefined / 空字符串则不注入。adapter 把结果合并进 sendOptions.sharedMemoryContext。
   */
  sharedMemoryContextProvider?: () => Promise<string | undefined>;
  /**
   * Per-session topology context provider, called before each send/stream with
   * the session's own id. Result is merged into sendOptions.topologyContext.
   * Returning undefined / empty string omits injection.
   */
  topologyContextProvider?: (sessionId: string) => Promise<string | undefined>;
}

/** 默认的 Session send() 结果序列化 */
export function serializeSessionSendResult(result: SessionCompatibleSendResult): string {
  return JSON.stringify({
    content: result.content,
    toolCalls: (result.toolCalls ?? []).map((call: SessionCompatibleToolCall) => ({
      id: call.id,
      name: call.name,
      args: call.input,
    })),
    usage: result.usage,
  });
}

/** 对应上面序列化格式的 ToolCallParser */
export const sessionSendResultParser: ToolCallParser = {
  parse(raw: string) {
    const parsed = JSON.parse(raw) as {
      content: string | null;
      toolCalls?: Array<{
        id: string;
        name: string;
        args: Record<string, unknown>;
      }>;
    };

    return {
      content: parsed.content,
      toolCalls: parsed.toolCalls ?? [],
    };
  },
};

/** 把 @stello-ai/session 的 ToolCall 转成 core 当前常用的工具调用结构 */
export function toCoreToolCalls(toolCalls: SessionCompatibleToolCall[] | undefined) {
  return (toolCalls ?? []).map((call) => ({
    id: call.id,
    name: call.name,
    args: call.input,
  }));
}

/**
 * 把真实 Session 适配成 core 的 EngineRuntimeSession。
 *
 * 说明：
 * - `@stello-ai/session` 当前没有 turnCount 字段
 * - 这里在初始化时通过 L3 条数估算 turnCount，并在每次 send() 后递增
 */
export async function adaptSessionToEngineRuntime(
  session: SessionCompatible,
  options: SessionRuntimeAdapterOptions,
): Promise<EngineRuntimeSession> {
  const messages = await session.messages();
  let turnCount = Math.floor(messages.length / 2);

  return {
    id: session.meta.id,
    get meta() {
      return {
        id: session.meta.id,
        turnCount,
        status: session.meta.status,
      };
    },
    get turnCount() {
      return turnCount;
    },
    async send(input: string, sendOptions?: SessionCompatibleSendOptions): Promise<string> {
      const sharedMemoryContext = await options.sharedMemoryContextProvider?.();
      const topologyContext = await options.topologyContextProvider?.(session.meta.id);
      const mergedOptions: SessionCompatibleSendOptions = {
        ...sendOptions,
        ...(sharedMemoryContext ? { sharedMemoryContext } : {}),
        ...(topologyContext ? { topologyContext } : {}),
      };
      const result = await session.send(input, mergedOptions);
      turnCount += 1;
      return (options.serializeResult ?? serializeSessionSendResult)(result);
    },
    async messages() {
      return session.messages();
    },
    get tools() {
      return session.tools;
    },
    setTools(tools) {
      session.setTools(tools);
    },
    ...(session.stream
      ? {
          stream(input: string, sendOptions?: SessionCompatibleSendOptions) {
            const contextPromise = options.sharedMemoryContextProvider?.() ?? Promise.resolve(undefined);
            const topologyPromise = options.topologyContextProvider?.(session.meta.id) ?? Promise.resolve(undefined);
            const source = (async () => {
              const sharedMemoryContext = await contextPromise;
              const topologyContext = await topologyPromise;
              const mergedOptions: SessionCompatibleSendOptions = {
                ...sendOptions,
                ...(sharedMemoryContext ? { sharedMemoryContext } : {}),
                ...(topologyContext ? { topologyContext } : {}),
              };
              return session.stream!(input, mergedOptions);
            })();
            return {
              result: (async () => {
                const stream = await source;
                const result = await stream.result;
                turnCount += 1;
                return (options.serializeResult ?? serializeSessionSendResult)(result);
              })(),
              async *[Symbol.asyncIterator]() {
                const stream = await source;
                for await (const chunk of stream) yield chunk;
              },
            };
          },
        }
      : {}),
    async consolidate(): Promise<void> {
      await session.consolidate();
    },
    ...(session.fork
      ? {
          async fork(forkOptions: SessionCompatibleForkOptions): Promise<EngineRuntimeSession> {
            const child = await session.fork!(forkOptions);
            return adaptSessionToEngineRuntime(child, options);
          },
        }
      : {}),
  };
}

