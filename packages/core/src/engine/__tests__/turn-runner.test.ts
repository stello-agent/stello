import { describe, it, expect, vi } from 'vitest';
import { TurnRunner, formatToolRoundResults } from '../turn-runner';

describe('TurnRunner', () => {
  it('无 tool call 时只调用一次 send()', async () => {
    const session = {
      send: vi.fn().mockResolvedValue({
        content: 'final answer',
      }),
    };
    const tools = {
      executeTool: vi.fn(),
    };

    const runner = new TurnRunner();
    const result = await runner.run(session, 'hello', tools);

    expect(session.send).toHaveBeenCalledTimes(1);
    expect(session.send).toHaveBeenCalledWith('hello');
    expect(tools.executeTool).not.toHaveBeenCalled();
    expect(result).toEqual({
      finalContent: 'final answer',
      toolRoundCount: 0,
      toolCallsExecuted: 0,
    });
  });

  it('单轮 tool call 时执行工具后继续下一轮 send()', async () => {
    const session = {
      send: vi.fn()
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            { id: 'tool-1', name: 'lookup_user', input: { id: 1 } },
          ],
        })
        .mockResolvedValueOnce({
          content: 'done',
        }),
    };
    const tools = {
      executeTool: vi.fn().mockResolvedValue({
        success: true,
        data: { name: 'alice' },
      }),
    };

    const runner = new TurnRunner();
    const result = await runner.run(session, 'hello', tools);

    expect(tools.executeTool).toHaveBeenCalledTimes(1);
    expect(tools.executeTool).toHaveBeenCalledWith('lookup_user', { id: 1 });
    expect(session.send).toHaveBeenCalledTimes(2);
    expect(session.send).toHaveBeenNthCalledWith(
      2,
      formatToolRoundResults([
        {
          toolCallId: 'tool-1',
          name: 'lookup_user',
          success: true,
          data: { name: 'alice' },
        },
      ]),
    );
    expect(result).toEqual({
      finalContent: 'done',
      toolRoundCount: 1,
      toolCallsExecuted: 1,
    });
  });

  it('单轮多个 tool call 时按顺序执行', async () => {
    const session = {
      send: vi.fn()
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            { id: 'tool-1', name: 'read_core', input: { path: 'name' } },
            { id: 'tool-2', name: 'list_sessions', input: {} },
          ],
        })
        .mockResolvedValueOnce({
          content: 'complete',
        }),
    };
    const tools = {
      executeTool: vi.fn()
        .mockResolvedValueOnce({ success: true, data: 'Alice' })
        .mockResolvedValueOnce({ success: true, data: [{ id: 's1' }] }),
    };

    const runner = new TurnRunner();
    const result = await runner.run(session, 'hello', tools);

    expect(tools.executeTool.mock.calls).toEqual([
      ['read_core', { path: 'name' }],
      ['list_sessions', {}],
    ]);
    expect(session.send).toHaveBeenNthCalledWith(
      2,
      formatToolRoundResults([
        {
          toolCallId: 'tool-1',
          name: 'read_core',
          success: true,
          data: 'Alice',
        },
        {
          toolCallId: 'tool-2',
          name: 'list_sessions',
          success: true,
          data: [{ id: 's1' }],
        },
      ]),
    );
    expect(result.toolCallsExecuted).toBe(2);
    expect(result.toolRoundCount).toBe(1);
  });

  it('tool 执行失败时仍将错误结果回灌给下一轮 send()', async () => {
    const session = {
      send: vi.fn()
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            { id: 'tool-1', name: 'update_core', input: { path: 'name', value: 'Bob' } },
          ],
        })
        .mockResolvedValueOnce({
          content: 'handled error',
        }),
    };
    const tools = {
      executeTool: vi.fn().mockResolvedValue({
        success: false,
        error: 'permission denied',
      }),
    };

    const runner = new TurnRunner();
    const result = await runner.run(session, 'hello', tools);

    expect(session.send).toHaveBeenNthCalledWith(
      2,
      formatToolRoundResults([
        {
          toolCallId: 'tool-1',
          name: 'update_core',
          success: false,
          error: 'permission denied',
        },
      ]),
    );
    expect(result.finalContent).toBe('handled error');
  });

  it('超过 maxToolRounds 时安全终止', async () => {
    const session = {
      send: vi.fn()
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [{ id: 'tool-1', name: 'loop', input: { step: 1 } }],
        })
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [{ id: 'tool-2', name: 'loop', input: { step: 2 } }],
        }),
    };
    const tools = {
      executeTool: vi.fn().mockResolvedValue({ success: true, data: 'ok' }),
    };

    const runner = new TurnRunner();

    await expect(runner.run(session, 'hello', tools, { maxToolRounds: 1 }))
      .rejects
      .toThrow('工具调用轮次超过上限: 1');
    expect(session.send).toHaveBeenCalledTimes(2);
    expect(tools.executeTool).toHaveBeenCalledTimes(1);
  });
});
