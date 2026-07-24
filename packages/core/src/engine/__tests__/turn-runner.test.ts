import { describe, expect, it, vi } from 'vitest';
import {
  TurnRunner,
  type ParsedTurnResponse,
  type ToolCallParser,
} from '../turn-runner';

const parser: ToolCallParser = {
  parse(raw) {
    return JSON.parse(raw) as ParsedTurnResponse;
  },
};

interface StreamStep {
  response: ParsedTurnResponse;
  chunks?: string[];
}

function deferredStream(step: StreamStep) {
  let resolveResult!: (raw: string) => void;
  let rejectResult!: (error: unknown) => void;
  const result = new Promise<string>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  result.catch(() => {});

  return {
    result,
    async *[Symbol.asyncIterator]() {
      try {
        for (const chunk of step.chunks ?? []) yield chunk;
        resolveResult(JSON.stringify(step.response));
      } catch (error) {
        rejectResult(error);
        throw error;
      }
    },
  };
}

function createSession(steps: StreamStep[]) {
  let index = 0;
  const stream = vi
    .fn<(input: unknown, options?: unknown) => ReturnType<typeof deferredStream>>()
    .mockImplementation(() => {
      const step = steps[index++];
      if (!step) throw new Error('unexpected LLM round');
      return deferredStream(step);
    });
  return {
    id: 's1',
    send: vi.fn(async () => {
      throw new Error('TurnRunner must not call session.send()');
    }),
    stream,
  };
}

describe('TurnRunner', () => {
  it('run 只消费 session.stream，无 tool call 时只调用一次', async () => {
    const session = createSession([
      { response: { content: 'final', toolCalls: [] }, chunks: ['fi', 'nal'] },
    ]);
    const tools = { executeTool: vi.fn() };

    const result = await new TurnRunner(parser).run(session, 'hello', tools);

    expect(session.stream).toHaveBeenCalledOnce();
    expect(session.stream).toHaveBeenCalledWith('hello', { signal: undefined });
    expect(session.send).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      finalContent: 'final',
      toolRoundCount: 0,
      toolCallsExecuted: 0,
    });
  });

  it('多轮 tool loop 每轮都使用 stream，并聚合 usage', async () => {
    const session = createSession([
      {
        response: {
          content: null,
          toolCalls: [{ id: '1', name: 'read', args: { path: 'core.name' } }],
          usage: { promptTokens: 10, completionTokens: 2 },
        },
      },
      {
        response: {
          content: 'done',
          toolCalls: [],
          usage: { promptTokens: 8, completionTokens: 4 },
        },
      },
    ]);
    const tools = {
      executeTool: vi.fn().mockResolvedValue({ success: true, data: { value: 'Stello' } }),
    };

    const result = await new TurnRunner(parser).run(session, 'hello', tools);

    expect(session.stream).toHaveBeenCalledTimes(2);
    expect(session.send).not.toHaveBeenCalled();
    expect(tools.executeTool).toHaveBeenCalledWith(
      'read',
      { path: 'core.name' },
      '1',
      { signal: undefined },
    );
    expect(session.stream.mock.calls[1]?.[0]).toContain('"toolResults"');
    expect(result).toMatchObject({
      finalContent: 'done',
      toolRoundCount: 1,
      toolCallsExecuted: 1,
      usage: { promptTokens: 18, completionTokens: 6, totalTokens: 24 },
    });
  });

  it('runStream 按顺序输出所有 tool 子轮的 chunks', async () => {
    const session = createSession([
      {
        response: {
          content: null,
          toolCalls: [{ id: '1', name: 'read', args: {} }],
        },
        chunks: ['checking'],
      },
      {
        response: { content: 'done', toolCalls: [] },
        chunks: ['do', 'ne'],
      },
    ]);
    const tools = {
      executeTool: vi.fn().mockResolvedValue({ success: true, data: 'value' }),
    };

    const stream = new TurnRunner(parser).runStream(session, 'hello', tools);
    // result 不依赖外部消费 iterator；子流由 runner 主动驱动。
    const result = await stream.result;
    const chunks: string[] = [];
    for await (const chunk of stream) chunks.push(chunk);

    expect(chunks).toEqual(['checking', 'do', 'ne']);
    expect(session.stream).toHaveBeenCalledTimes(2);
    expect(session.send).not.toHaveBeenCalled();
    expect(result.finalContent).toBe('done');
  });

  it('同轮多个 tool 并行执行', async () => {
    const session = createSession([
      {
        response: {
          content: null,
          toolCalls: [
            { id: '1', name: 'first', args: {} },
            { id: '2', name: 'second', args: {} },
            { id: '3', name: 'third', args: {} },
          ],
        },
      },
      { response: { content: 'done', toolCalls: [] } },
    ]);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = 0;
    let allStarted!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      allStarted = resolve;
    });
    const tools = {
      executeTool: vi.fn().mockImplementation(async () => {
        started += 1;
        if (started === 3) allStarted();
        await gate;
        return { success: true, data: null };
      }),
    };

    const running = new TurnRunner(parser).run(session, 'hello', tools);
    await startedPromise;
    expect(tools.executeTool).toHaveBeenCalledTimes(3);
    release();
    await running;
  });

  it('tool 抛错会转成失败结果，回调与回灌保持输入顺序', async () => {
    const session = createSession([
      {
        response: {
          content: null,
          toolCalls: [
            { id: 'a', name: 'ok', args: {} },
            { id: 'b', name: 'boom', args: {} },
            { id: 'c', name: 'ok', args: {} },
          ],
        },
      },
      { response: { content: 'done', toolCalls: [] } },
    ]);
    const tools = {
      executeTool: vi.fn().mockImplementation(async (name: string) => {
        if (name === 'boom') throw new Error('tool internal error');
        return { success: true, data: { ok: true } };
      }),
    };
    const onToolCall = vi.fn();
    const onToolResult = vi.fn();

    await new TurnRunner(parser).run(session, 'hello', tools, { onToolCall, onToolResult });

    expect(onToolCall.mock.calls.map(([call]) => call.id)).toEqual(['a', 'b', 'c']);
    expect(onToolResult.mock.calls.map(([result]) => result.toolCallId)).toEqual(['a', 'b', 'c']);
    expect(onToolResult.mock.calls[1]?.[0]).toMatchObject({
      success: false,
      error: 'tool internal error',
    });
    const reentry = session.stream.mock.calls[1]?.[0];
    expect(reentry).toContain('"toolCallId":"b"');
    expect(reentry).toContain('tool internal error');
  });

  it('超过 maxToolRounds 时安全终止', async () => {
    const loop = {
      response: {
        content: null,
        toolCalls: [{ id: 'loop', name: 'loop', args: {} }],
      },
    } satisfies StreamStep;
    const session = createSession([loop, loop]);
    const tools = {
      executeTool: vi.fn().mockResolvedValue({ success: true }),
    };

    await expect(
      new TurnRunner(parser).run(session, 'hello', tools, { maxToolRounds: 1 }),
    ).rejects.toThrow('tool loop 超出上限');
    expect(tools.executeTool).toHaveBeenCalledOnce();
    expect(session.stream).toHaveBeenCalledTimes(2);
  });

  it('runStream 的 iterator 和 result 都传递子流错误', async () => {
    const failure = new Error('stream failed');
    const sourceResult = Promise.reject(failure);
    sourceResult.catch(() => {});
    const session = {
      id: 's1',
      send: vi.fn(),
      stream: vi.fn(() => ({
        result: sourceResult,
        async *[Symbol.asyncIterator]() {
          yield 'partial';
          throw failure;
        },
      })),
    };
    const stream = new TurnRunner(parser).runStream(
      session,
      'hello',
      { executeTool: vi.fn() },
    );

    const iteratorOutcome = (async () => {
      const chunks: string[] = [];
      for await (const chunk of stream) chunks.push(chunk);
      return chunks;
    })();

    await expect(iteratorOutcome).rejects.toBe(failure);
    await expect(stream.result).rejects.toBe(failure);
  });
});
