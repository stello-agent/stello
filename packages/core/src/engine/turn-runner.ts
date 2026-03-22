import type { ToolExecutionResult } from '../types/lifecycle';

/** Tool call 的最小结构，供编排层循环使用。 */
export interface TurnRunnerToolCall {
  /** tool call 的唯一标识，用于和结果关联。 */
  id: string;
  /** 要调用的工具名。 */
  name: string;
  /** 工具参数。 */
  input: Record<string, unknown>;
}

/** Session.send() 的最小返回结构，编排层不关心底层实现细节。 */
export interface TurnRunnerSendResult {
  /** 模型本轮返回的文本内容。 */
  content: string | null;
  /** 模型本轮请求执行的工具列表。 */
  toolCalls?: TurnRunnerToolCall[];
}

/** 编排层消费的 Session 最小接口。 */
export interface TurnRunnerSession {
  /** 发送一次输入，让底层 session 自行决定如何调用模型。 */
  send(input: string): Promise<TurnRunnerSendResult>;
}

/** 编排层消费的 Tool 执行器最小接口。 */
export interface TurnRunnerToolExecutor {
  /** 执行一次工具调用，并返回统一的执行结果。 */
  executeTool(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult>;
}

/** turn() 的可选配置。 */
export interface TurnRunnerOptions {
  /** 允许的最大工具循环轮次，防止模型无限递归调用工具。 */
  maxToolRounds?: number;
}

/** turn() 的结果。 */
export interface TurnRunnerResult {
  /** 最终返回给用户的文本内容。 */
  finalContent: string | null;
  /** 本次 turn 实际发生了多少轮工具循环。 */
  toolRoundCount: number;
  /** 本次 turn 实际执行了多少个 tool call。 */
  toolCallsExecuted: number;
}

/** 单次 tool loop 的执行结果。 */
interface ToolRoundResult {
  /** 对应的 tool call id。 */
  toolCallId: string;
  /** 对应的工具名。 */
  name: string;
  /** 工具执行是否成功。 */
  success: boolean;
  /** 工具成功时的返回数据。 */
  data?: unknown;
  /** 工具失败时的错误信息。 */
  error?: string;
}

/** 将 tool 执行结果编码为下一轮 send() 的输入。 */
export function formatToolRoundResults(results: ToolRoundResult[]): string {
  return JSON.stringify({ toolResults: results });
}

/** TurnRunner 负责驱动单个 Session 的 tool call 循环。 */
export class TurnRunner {
  /** 执行一次 turn，直到模型不再请求工具或超过循环上限。 */
  async run(
    session: TurnRunnerSession,
    userInput: string,
    tools: TurnRunnerToolExecutor,
    options: TurnRunnerOptions = {},
  ): Promise<TurnRunnerResult> {
    const maxToolRounds = options.maxToolRounds ?? 8;
    let nextInput = userInput;
    let toolRoundCount = 0;
    let toolCallsExecuted = 0;

    for (;;) {
      const result = await session.send(nextInput);
      const toolCalls = result.toolCalls ?? [];

      if (toolCalls.length === 0) {
        return {
          finalContent: result.content,
          toolRoundCount,
          toolCallsExecuted,
        };
      }

      /** 先判断上限，再进入下一轮工具执行。 */
      if (toolRoundCount >= maxToolRounds) {
        throw new Error(`工具调用轮次超过上限: ${maxToolRounds}`);
      }

      toolRoundCount += 1;
      const toolResults: ToolRoundResult[] = [];

      for (const toolCall of toolCalls) {
        /** 逐个执行模型请求的工具，并收集统一结果。 */
        const toolResult = await tools.executeTool(toolCall.name, toolCall.input);
        toolCallsExecuted += 1;
        toolResults.push({
          toolCallId: toolCall.id,
          name: toolCall.name,
          success: toolResult.success,
          ...(toolResult.data !== undefined && { data: toolResult.data }),
          ...(toolResult.error !== undefined && { error: toolResult.error }),
        });
      }

      /** 将这一轮工具结果编码成下一轮 send() 的输入。 */
      nextInput = formatToolRoundResults(toolResults);
    }
  }
}
