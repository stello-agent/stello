import type { SessionInput } from '@stello-ai/session';
import type { ToolExecutionResult } from '../types/lifecycle';

export type TurnInput = string | SessionInput;

/**
 * 在单轮内并行执行所有 tool call，按输入顺序整理结果并按序触发事件。
 *
 * 协议侧（Anthropic content blocks / OpenAI tool_calls 数组）允许 LLM 在一次响应里
 * 同时给出多个独立 tool call，原意就是 client 端并发执行。这里只把 settled 结果按
 * 索引取回、保持外部可见的事件顺序与单 tool 时一致；并发安全由各 tool 自身保证。
 */
async function executeToolsParallel(
  toolCalls: ToolCall[],
  tools: TurnRunnerToolExecutor,
  options: TurnRunnerOptions,
): Promise<ToolCallResult[]> {
  // 先按输入顺序触发 onToolCall，再统一发起执行
  for (const toolCall of toolCalls) {
    options.signal?.throwIfAborted();
    await options.onToolCall?.(toolCall);
  }

  const settled = await Promise.allSettled(
    toolCalls.map((toolCall) =>
      tools.executeTool(toolCall.name, toolCall.args, toolCall.id, {
        signal: options.signal,
      }),
    ),
  );

  // 所有 tool 自然返回后再做边界 abort 检查；与原行为一致：abort 后不下发 phantom result
  options.signal?.throwIfAborted();

  const results: ToolCallResult[] = [];
  for (let i = 0; i < toolCalls.length; i++) {
    const toolCall = toolCalls[i]!;
    const settle = settled[i]!;
    let success: boolean;
    let data: unknown;
    let error: string | null;
    if (settle.status === 'fulfilled') {
      success = settle.value.success;
      data = settle.value.data ?? null;
      error = settle.value.error ?? null;
    } else {
      // tool 抛错 → 转成失败 ToolCallResult，保留"错误回灌给 LLM 继续循环"的语义
      success = false;
      data = null;
      error = settle.reason instanceof Error ? settle.reason.message : String(settle.reason);
    }
    const result: ToolCallResult = {
      toolCallId: toolCall.id ?? null,
      toolName: toolCall.name,
      args: toolCall.args,
      success,
      data,
      error,
    };
    results.push(result);
    await options.onToolResult?.(result);
  }

  return results;
}

/** 单次工具调用描述 */
export interface ToolCall {
  /** 可选调用 ID，用于在回灌结果时做关联 */
  id?: string;
  /** 工具名称 */
  name: string;
  /** 工具参数 */
  args: Record<string, unknown>;
}

/** 解析后的单次 LLM 输出 */
export interface ParsedTurnResponse {
  /** 面向用户的最终文本 */
  content: string | null;
  /** 需要由 Engine 执行的工具调用 */
  toolCalls: ToolCall[];
  /** 本次 LLM 调用的 token 用量 */
  usage?: TurnRunnerUsage;
}

/** 单次或聚合后的 LLM token 用量 */
export interface TurnRunnerUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

function addOptionalNumbers(a: number | undefined, b: number | undefined): number | undefined {
  return a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);
}

function addUsage(current: TurnRunnerUsage | undefined, next: TurnRunnerUsage | undefined): TurnRunnerUsage | undefined {
  if (!next) return current;
  const currentTotal = current?.totalTokens ?? ((current?.promptTokens ?? 0) + (current?.completionTokens ?? 0));
  const nextTotal = next.totalTokens ?? ((next.promptTokens ?? 0) + (next.completionTokens ?? 0));
  return {
    promptTokens: addOptionalNumbers(current?.promptTokens, next.promptTokens),
    completionTokens: addOptionalNumbers(current?.completionTokens, next.completionTokens),
    totalTokens: currentTotal + nextTotal,
  };
}

/** Session 调用的运行时选项 */
export interface TurnRunnerSessionCallOptions {
  /** AbortSignal — 透传给 session.stream，进而透传给 LLM 调用 */
  signal?: AbortSignal;
}

/** 单个 Session 的最小运行时契约 */
export interface TurnRunnerSession {
  /** Session 标识 */
  id: string;
  /** 执行一次单条对话 */
  send(input: TurnInput, options?: TurnRunnerSessionCallOptions): Promise<string>;
  /** 流式执行一次单条对话 */
  stream(
    input: TurnInput,
    options?: TurnRunnerSessionCallOptions,
  ): AsyncIterable<string> & { result: Promise<string> };
}

/** Tool 调用的运行时选项 */
export interface TurnRunnerToolCallOptions {
  /** AbortSignal — tool 可读取以中断长任务（HTTP、subprocess 等） */
  signal?: AbortSignal;
}

/** Tool 执行器的最小契约 */
export interface TurnRunnerToolExecutor {
  /** 执行指定工具 */
  executeTool(
    name: string,
    args: Record<string, unknown>,
    toolCallId?: string,
    options?: TurnRunnerToolCallOptions,
  ): Promise<ToolExecutionResult>;
}

/** 工具调用解析器 */
export interface ToolCallParser {
  /** 从 LLM 返回文本中提取内容与工具调用 */
  parse(raw: string): ParsedTurnResponse;
}

/** tool loop 的运行选项 */
export interface TurnRunnerOptions {
  /** 最多允许多少轮工具调用 */
  maxToolRounds?: number;
  /** 工具调用前的观察回调 */
  onToolCall?: (toolCall: ToolCall) => Promise<void> | void;
  /** 工具调用后的观察回调 */
  onToolResult?: (result: ToolCallResult) => Promise<void> | void;
  /**
   * AbortSignal — abort 后下一轮边界（含 stream / tool 执行前后）抛 AbortError，
   * 同时透传给 session.stream 与 tools.executeTool。
   * Tools 不消费 ctx.signal 时，runner 会等本轮 tool 自然返回，再在边界处抛。
   */
  signal?: AbortSignal;
}

/** 单个工具调用的执行结果 */
export interface ToolCallResult {
  toolCallId: string | null;
  toolName: string;
  args: Record<string, unknown>;
  success: boolean;
  data: unknown;
  error: string | null;
}

/** tool loop 的执行结果 */
export interface TurnRunnerResult {
  /** 最终输出文本 */
  finalContent: string | null;
  /** 实际执行了多少轮 tool loop */
  toolRoundCount: number;
  /** 实际执行了多少个工具 */
  toolCallsExecuted: number;
  /** 原始最终响应 */
  rawResponse: string;
  /** 本轮内所有 LLM 调用聚合后的 token 用量 */
  usage?: TurnRunnerUsage;
}

/** 流式 tool loop 的执行结果 */
export interface TurnRunnerStreamResult extends AsyncIterable<string> {
  /** 流式完成后的最终结果 */
  result: Promise<TurnRunnerResult>;
}

function createTurnRunnerStreamResult(
  processor: (push: (chunk: string) => void) => Promise<TurnRunnerResult>,
): TurnRunnerStreamResult {
  const queue: string[] = [];
  let done = false;
  let hasTerminalError = false;
  let terminalError: unknown;
  let notify: (() => void) | null = null;

  const wake = () => {
    if (!notify) return;
    const current = notify;
    notify = null;
    current();
  };

  const push = (chunk: string) => {
    if (!chunk) return;
    queue.push(chunk);
    wake();
  };

  const result = (async () => {
    try {
      return await processor(push);
    } catch (error) {
      hasTerminalError = true;
      terminalError = error;
      throw error;
    } finally {
      done = true;
      wake();
    }
  })();
  // Consumers may observe failures through the iterator only. Keep the result
  // promise handled without changing the promise returned to explicit awaiters.
  result.catch(() => {});

  return {
    result,
    async *[Symbol.asyncIterator]() {
      while (!done || queue.length > 0) {
        if (queue.length > 0) {
          yield queue.shift()!;
          continue;
        }
        await new Promise<void>((resolve) => {
          notify = resolve;
        });
      }
      if (hasTerminalError) throw terminalError;
    },
  };
}

/**
 * TurnRunner
 *
 * 只负责驱动单个 Session 的 tool loop。
 * 它不关心 Session 内部如何组装 prompt，也不关心工具背后是 tree 操作还是外部副作用。
 */
export class TurnRunner {
  constructor(private readonly parser: ToolCallParser) {}

  /**
   * 运行一次完整 turn。
   *
   * 流程：
   * 1. 把用户输入交给 Session.stream() 并消费完整子流
   * 2. 解析 LLM 是否表达了工具调用意图
   * 3. 如有工具调用，则由 Engine 执行后回灌结果继续下一轮
   * 4. 没有工具调用时结束
   */
  async run(
    session: TurnRunnerSession,
    input: TurnInput,
    tools: TurnRunnerToolExecutor,
    options: TurnRunnerOptions = {},
  ): Promise<TurnRunnerResult> {
    return this.executeStreamingLoop(session, input, tools, options);
  }

  /**
   * 流式运行一次完整 turn。
   *
   * 所有 LLM 子轮都使用 session.stream()；工具调用后的续轮 chunk
   * 与首轮保持顺序，统一向调用方输出。
   */
  runStream(
    session: TurnRunnerSession,
    input: TurnInput,
    tools: TurnRunnerToolExecutor,
    options: TurnRunnerOptions = {},
  ): TurnRunnerStreamResult {
    return createTurnRunnerStreamResult((push) =>
      this.executeStreamingLoop(session, input, tools, options, push),
    );
  }

  /**
   * turn / stream 共用的唯一 tool loop。
   *
   * Runner 主动消费每个 Session 子流，因此即使底层 runtime 的
   * result 依赖 iterator 被驱动，run() 也不会死锁。结构化的
   * toolCalls / usage 始终以子流 result 为准，不从文本 chunk 反推。
   */
  private async executeStreamingLoop(
    session: TurnRunnerSession,
    input: TurnInput,
    tools: TurnRunnerToolExecutor,
    options: TurnRunnerOptions,
    onChunk?: (chunk: string) => void,
  ): Promise<TurnRunnerResult> {
    const maxToolRounds = options.maxToolRounds ?? 5;
    let currentInput: TurnInput = input;
    let toolRoundCount = 0;
    let toolCallsExecuted = 0;
    let usage: TurnRunnerUsage | undefined;

    while (true) {
      options.signal?.throwIfAborted();
      const source = session.stream(currentInput, { signal: options.signal });
      // If the iterator is the error channel a caller observes, keep a later
      // result rejection from becoming unhandled while preserving it for await.
      source.result.catch(() => {});

      for await (const chunk of source) {
        onChunk?.(chunk);
      }

      const lastRawResponse = await source.result;
      options.signal?.throwIfAborted();
      const parsed = this.parser.parse(lastRawResponse);
      usage = addUsage(usage, parsed.usage);

      if (parsed.toolCalls.length === 0) {
        return {
          finalContent: parsed.content,
          toolRoundCount,
          toolCallsExecuted,
          rawResponse: lastRawResponse,
          usage,
        };
      }

      if (toolRoundCount >= maxToolRounds) {
        throw new Error(`tool loop 超出上限：最多允许 ${maxToolRounds} 轮`);
      }

      const toolResults = await executeToolsParallel(parsed.toolCalls, tools, options);
      toolCallsExecuted += parsed.toolCalls.length;

      toolRoundCount += 1;
      currentInput = JSON.stringify({ toolResults });
    }
  }
}
