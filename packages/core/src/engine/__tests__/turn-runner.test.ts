import { describe, expect, it, vi } from 'vitest';
import { TurnRunner, type ToolCallParser } from '../turn-runner';

const parser: ToolCallParser = {
  parse(raw) {
    return JSON.parse(raw) as { content: string | null; toolCalls: Array<{ name: string; args: Record<string, unknown> }> };
  },
};

describe('TurnRunner', () => {
  it('无 tool call 时只调用一次 send', async () => {
    const session = {
      id: 's1',
      send: vi.fn().mockResolvedValue(JSON.stringify({ content: 'final', toolCalls: [] })),
    };
    const tools = {
      executeTool: vi.fn(),
    };

    const runner = new TurnRunner(parser);
    const result = await runner.run(session, 'hello', tools);

    expect(session.send).toHaveBeenCalledTimes(1);
    expect(session.send).toHaveBeenCalledWith('hello');
    expect(result.finalContent).toBe('final');
    expect(result.toolRoundCount).toBe(0);
    expect(result.toolCallsExecuted).toBe(0);
  });

  it('单轮 tool call 后继续下一轮 send', async () => {
    const session = {
      id: 's1',
      send: vi
        .fn()
        .mockResolvedValueOnce(
          JSON.stringify({
            content: null,
            toolCalls: [{ id: '1', name: 'read', args: { path: 'core.name' } }],
          }),
        )
        .mockResolvedValueOnce(JSON.stringify({ content: 'done', toolCalls: [] })),
    };
    const tools = {
      executeTool: vi.fn().mockResolvedValue({ success: true, data: { value: 'Stello' } }),
    };

    const runner = new TurnRunner(parser);
    const result = await runner.run(session, 'hello', tools);

    expect(session.send).toHaveBeenCalledTimes(2);
    expect(tools.executeTool).toHaveBeenCalledWith('read', { path: 'core.name' });
    expect(session.send.mock.calls[1]?.[0]).toContain('"toolResults"');
    expect(result.finalContent).toBe('done');
    expect(result.toolRoundCount).toBe(1);
    expect(result.toolCallsExecuted).toBe(1);
  });

  it('多个 tool call 按顺序执行', async () => {
    const session = {
      id: 's1',
      send: vi
        .fn()
        .mockResolvedValueOnce(
          JSON.stringify({
            content: null,
            toolCalls: [
              { name: 'read', args: { path: 'core.name' } },
              { name: 'list', args: { scope: 'ui' } },
            ],
          }),
        )
        .mockResolvedValueOnce(JSON.stringify({ content: 'done', toolCalls: [] })),
    };
    const tools = {
      executeTool: vi.fn().mockResolvedValue({ success: true, data: null }),
    };

    const runner = new TurnRunner(parser);
    const result = await runner.run(session, 'hello', tools);

    expect(tools.executeTool.mock.calls).toEqual([
      ['read', { path: 'core.name' }],
      ['list', { scope: 'ui' }],
    ]);
    expect(result.toolCallsExecuted).toBe(2);
  });

  it('tool 执行失败时会把错误继续回灌给下一轮 send', async () => {
    const session = {
      id: 's1',
      send: vi
        .fn()
        .mockResolvedValueOnce(
          JSON.stringify({
            content: null,
            toolCalls: [{ id: '1', name: 'fork', args: { label: 'UI' } }],
          }),
        )
        .mockResolvedValueOnce(JSON.stringify({ content: 'fallback', toolCalls: [] })),
    };
    const tools = {
      executeTool: vi.fn().mockResolvedValue({ success: false, error: 'split blocked' }),
    };

    const runner = new TurnRunner(parser);
    const result = await runner.run(session, 'hello', tools);

    expect(session.send.mock.calls[1]?.[0]).toContain('"success":false');
    expect(session.send.mock.calls[1]?.[0]).toContain('"split blocked"');
    expect(result.finalContent).toBe('fallback');
  });

  it('超过 maxToolRounds 时安全终止', async () => {
    const session = {
      id: 's1',
      send: vi.fn().mockResolvedValue(
        JSON.stringify({
          content: null,
          toolCalls: [{ name: 'loop', args: {} }],
        }),
      ),
    };
    const tools = {
      executeTool: vi.fn().mockResolvedValue({ success: true }),
    };

    const runner = new TurnRunner(parser);

    await expect(runner.run(session, 'hello', tools, { maxToolRounds: 1 })).rejects.toThrow(
      'tool loop 超出上限',
    );
    expect(tools.executeTool).toHaveBeenCalledTimes(1);
  });

  it('工具调用过程中会触发 onToolCall 和 onToolResult', async () => {
    const session = {
      id: 's1',
      send: vi
        .fn()
        .mockResolvedValueOnce(
          JSON.stringify({
            content: null,
            toolCalls: [{ id: '1', name: 'read', args: { path: 'core.name' } }],
          }),
        )
        .mockResolvedValueOnce(JSON.stringify({ content: 'done', toolCalls: [] })),
    };
    const tools = {
      executeTool: vi.fn().mockResolvedValue({ success: true, data: { value: 'Stello' } }),
    };
    const onToolCall = vi.fn();
    const onToolResult = vi.fn();

    const runner = new TurnRunner(parser);
    await runner.run(session, 'hello', tools, { onToolCall, onToolResult });

    expect(onToolCall).toHaveBeenCalledWith({
      id: '1',
      name: 'read',
      args: { path: 'core.name' },
    });
    expect(onToolResult).toHaveBeenCalledWith({
      toolCallId: '1',
      toolName: 'read',
      args: { path: 'core.name' },
      success: true,
      data: { value: 'Stello' },
      error: null,
    });
  });
});
