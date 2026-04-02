import type { SchedulerMainSession } from '../engine/scheduler';
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

/** 结构兼容 @stello-ai/session 的 integrate 函数签名 */
export type SessionCompatibleIntegrateFn = (
  children: Array<{ sessionId: string; label: string; l2: string }>,
  currentSynthesis: string | null,
) => Promise<{
  synthesis: string;
  insights: Array<{ sessionId: string; content: string }>;
}>;

/** 结构兼容 @stello-ai/session 的 Session */
export interface SessionCompatible {
  meta: {
    id: string;
    status: 'active' | 'archived';
  };
  send(content: string): Promise<SessionCompatibleSendResult>;
  stream?(
    content: string
  ): AsyncIterable<string> & { result: Promise<SessionCompatibleSendResult> };
  messages(): Promise<Array<{ role: string; content: string; timestamp?: string }>>;
  consolidate(fn: SessionCompatibleConsolidateFn): Promise<void>;
}

/** 结构兼容 @stello-ai/session 的 MainSession */
export interface MainSessionCompatible {
  integrate(fn: SessionCompatibleIntegrateFn): Promise<unknown>;
}

/** Session -> EngineRuntime 适配配置 */
export interface SessionRuntimeAdapterOptions {
  /** 把 session 的 L3 收敛成 L2 的函数 */
  consolidateFn: SessionCompatibleConsolidateFn;
  /** 自定义 send() 结果序列化方式，默认转成 JSON 字符串 */
  serializeResult?: (result: SessionCompatibleSendResult) => string;
}

/** MainSession -> SchedulerMainSession 适配配置 */
export interface MainSessionAdapterOptions {
  /** 执行全局 integrate 的函数 */
  integrateFn: SessionCompatibleIntegrateFn;
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
    async send(input: string): Promise<string> {
      const result = await session.send(input);
      turnCount += 1;
      return (options.serializeResult ?? serializeSessionSendResult)(result);
    },
    ...(session.stream
      ? {
          stream(input: string) {
            const source = session.stream!(input);
            return {
              result: (async () => {
                const result = await source.result;
                turnCount += 1;
                return (options.serializeResult ?? serializeSessionSendResult)(result);
              })(),
              async *[Symbol.asyncIterator]() {
                for await (const chunk of source) {
                  yield chunk;
                }
              },
            };
          },
        }
      : {}),
    async consolidate(): Promise<void> {
      await session.consolidate(options.consolidateFn);
    },
  };
}

/** 把真实 MainSession 适配成 core 的 SchedulerMainSession */
export function adaptMainSessionToSchedulerMainSession(
  mainSession: MainSessionCompatible,
  options: MainSessionAdapterOptions,
): SchedulerMainSession {
  return {
    async integrate(): Promise<void> {
      await mainSession.integrate(options.integrateFn);
    },
  };
}
