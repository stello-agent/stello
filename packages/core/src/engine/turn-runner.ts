import type { ToolExecutionResult } from '../types/lifecycle';

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
}

/** Session 调用的运行时选项 */
export interface TurnRunnerSessionCallOptions {
  /** AbortSignal — 透传给 session.send/stream，进而透传给 LLM 调用 */
  signal?: AbortSignal;
}

/** 单个 Session 的最小运行时契约 */
export interface TurnRunnerSession {
  /** Session 标识 */
  id: string;
  /** 执行一次单条对话 */
  send(input: string, options?: TurnRunnerSessionCallOptions): Promise<string>;
  /** 可选：流式执行一次单条对话 */
  stream?(
    input: string,
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
   * AbortSignal — abort 后下一轮边界（含 send / tool 执行前后）抛 AbortError，
   * 同时透传给 session.send/stream 与 tools.executeTool。
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
}

/** 流式 tool loop 的执行结果 */
export interface TurnRunnerStreamResult extends AsyncIterable<string> {
  /** 流式完成后的最终结果 */
  result: Promise<TurnRunnerResult>;
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
   * 1. 把用户输入交给 Session.send()
   * 2. 解析 LLM 是否表达了工具调用意图
   * 3. 如有工具调用，则由 Engine 执行后回灌结果继续下一轮
   * 4. 没有工具调用时结束
   */
  async run(
    session: TurnRunnerSession,
    input: string,
    tools: TurnRunnerToolExecutor,
    options: TurnRunnerOptions = {},
  ): Promise<TurnRunnerResult> {
    const maxToolRounds = options.maxToolRounds ?? 5;
    let currentInput = input;
    let toolRoundCount = 0;
    let toolCallsExecuted = 0;
    let lastRawResponse = '';

    while (true) {
      options.signal?.throwIfAborted();
      lastRawResponse = await session.send(currentInput, { signal: options.signal });
      const parsed = this.parser.parse(lastRawResponse);

      if (parsed.toolCalls.length === 0) {
        return {
          finalContent: parsed.content,
          toolRoundCount,
          toolCallsExecuted,
          rawResponse: lastRawResponse,
        };
      }

      if (toolRoundCount >= maxToolRounds) {
        throw new Error(`tool loop 超出上限：最多允许 ${maxToolRounds} 轮`);
      }

      const toolResults = [];
      for (const toolCall of parsed.toolCalls) {
        options.signal?.throwIfAborted();
        await options.onToolCall?.(toolCall);
        const result = await tools.executeTool(
          toolCall.name,
          toolCall.args,
          toolCall.id,
          { signal: options.signal },
        );
        toolCallsExecuted += 1;
        // tool 结果收集后立刻检查 signal — 已 abort 时不下发 phantom onToolResult。
        options.signal?.throwIfAborted();
        const toolResult: ToolCallResult = {
          toolCallId: toolCall.id ?? null,
          toolName: toolCall.name,
          args: toolCall.args,
          success: result.success,
          data: result.data ?? null,
          error: result.error ?? null,
        };
        toolResults.push(toolResult);
        await options.onToolResult?.(toolResult);
      }

      toolRoundCount += 1;
      currentInput = JSON.stringify({ toolResults });
    }
  }

  /**
   * 流式运行一次完整 turn。
   *
   * 语义：
   * - 优先使用 session.stream() 输出增量文本
   * - 流结束后再解析最终结果
   * - 若后续存在工具调用，则继续使用 send() 完成剩余 tool loop
   */
  runStream(
    session: TurnRunnerSession,
    input: string,
    tools: TurnRunnerToolExecutor,
    options: TurnRunnerOptions = {},
  ): TurnRunnerStreamResult {
    // pre-flight：已 abort 时直接返回 reject 的 result + 立刻抛错的 iterator
    if (options.signal?.aborted) {
      const aborted = Promise.reject(new DOMException('aborted', 'AbortError'))
      // 安抚 unhandledRejection：消费方通过 `result` 或 iterator 任一感知即可。
      aborted.catch(() => {})
      return {
        result: aborted as Promise<TurnRunnerResult>,
        async *[Symbol.asyncIterator]() {
          throw new DOMException('aborted', 'AbortError')
        },
      }
    }

    if (!session.stream) {
      const result = this.run(session, input, tools, options)
      return {
        result,
        async *[Symbol.asyncIterator]() {
          const final = await result
          if (final.finalContent) {
            yield final.finalContent
          }
        },
      }
    }

    const source = session.stream(input, { signal: options.signal })
    const result = this.finishFromStreamResult(session, source.result, tools, options)

    return {
      result,
      async *[Symbol.asyncIterator]() {
        // 重新抛出 AbortError（而不是静默关闭），让调用方明确感知取消语义。
        for await (const chunk of source) {
          yield chunk
        }
      },
    }
  }

  private async finishFromStreamResult(
    session: TurnRunnerSession,
    rawResult: Promise<string>,
    tools: TurnRunnerToolExecutor,
    options: TurnRunnerOptions,
  ): Promise<TurnRunnerResult> {
    const maxToolRounds = options.maxToolRounds ?? 5
    let toolRoundCount = 0
    let toolCallsExecuted = 0
    let lastRawResponse = await rawResult
    options.signal?.throwIfAborted()
    let parsed = this.parser.parse(lastRawResponse)

    while (parsed.toolCalls.length > 0) {
      if (toolRoundCount >= maxToolRounds) {
        throw new Error(`tool loop 超出上限：最多允许 ${maxToolRounds} 轮`)
      }

      const toolResults = []
      for (const toolCall of parsed.toolCalls) {
        options.signal?.throwIfAborted()
        await options.onToolCall?.(toolCall)
        const result = await tools.executeTool(
          toolCall.name,
          toolCall.args,
          toolCall.id,
          { signal: options.signal },
        )
        toolCallsExecuted += 1
        options.signal?.throwIfAborted()
        const toolResult: ToolCallResult = {
          toolCallId: toolCall.id ?? null,
          toolName: toolCall.name,
          args: toolCall.args,
          success: result.success,
          data: result.data ?? null,
          error: result.error ?? null,
        }
        toolResults.push(toolResult)
        await options.onToolResult?.(toolResult)
      }

      toolRoundCount += 1
      options.signal?.throwIfAborted()
      lastRawResponse = await session.send(JSON.stringify({ toolResults }), { signal: options.signal })
      parsed = this.parser.parse(lastRawResponse)
    }

    return {
      finalContent: parsed.content,
      toolRoundCount,
      toolCallsExecuted,
      rawResponse: lastRawResponse,
    }
  }
}
