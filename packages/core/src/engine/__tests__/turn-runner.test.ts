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
    expect(session.send).toHaveBeenCalledWith('hello', { signal: undefined });
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
    expect(tools.executeTool).toHaveBeenCalledWith('read', { path: 'core.name' }, '1', { signal: undefined });
    expect(session.send.mock.calls[1]?.[0]).toContain('"toolResults"');
    expect(result.finalContent).toBe('done');
    expect(result.toolRoundCount).toBe(1);
    expect(result.toolCallsExecuted).toBe(1);
  });

  it('多个 tool call 在同轮内并行执行，但调用顺序保持输入序', async () => {
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
      ['read', { path: 'core.name' }, undefined, { signal: undefined }],
      ['list', { scope: 'ui' }, undefined, { signal: undefined }],
    ]);
    expect(result.toolCallsExecuted).toBe(2);
  });

  it('多个 tool call 真正并发执行（耗时按 max 计算而非 sum）', async () => {
    const DELAY = 80;
    const session = {
      id: 's1',
      send: vi
        .fn()
        .mockResolvedValueOnce(
          JSON.stringify({
            content: null,
            toolCalls: [
              { id: '1', name: 't', args: {} },
              { id: '2', name: 't', args: {} },
              { id: '3', name: 't', args: {} },
            ],
          }),
        )
        .mockResolvedValueOnce(JSON.stringify({ content: 'done', toolCalls: [] })),
    };
    let active = 0;
    let maxConcurrent = 0;
    const tools = {
      executeTool: vi.fn().mockImplementation(async () => {
        active += 1;
        if (active > maxConcurrent) maxConcurrent = active;
        await new Promise((r) => setTimeout(r, DELAY));
        active -= 1;
        return { success: true, data: null };
      }),
    };

    const runner = new TurnRunner(parser);
    const start = Date.now();
    await runner.run(session, 'hello', tools);
    const elapsed = Date.now() - start;

    // 串行需 ≥ 3*DELAY；并行应在 1*DELAY 量级（留较宽松上界以避免 CI 抖动）
    expect(maxConcurrent).toBe(3);
    expect(elapsed).toBeLessThan(DELAY * 3 - 20);
  });

  it('单个 tool 抛错不影响兄弟 tool，错误转为 success=false 回灌', async () => {
    const session = {
      id: 's1',
      send: vi
        .fn()
        .mockResolvedValueOnce(
          JSON.stringify({
            content: null,
            toolCalls: [
              { id: 'a', name: 'ok', args: {} },
              { id: 'b', name: 'boom', args: {} },
              { id: 'c', name: 'ok', args: {} },
            ],
          }),
        )
        .mockResolvedValueOnce(JSON.stringify({ content: 'done', toolCalls: [] })),
    };
    const tools = {
      executeTool: vi.fn().mockImplementation(async (name: string) => {
        if (name === 'boom') throw new Error('tool internal error');
        return { success: true, data: { ok: true } };
      }),
    };
    const onToolResult = vi.fn();

    const runner = new TurnRunner(parser);
    const result = await runner.run(session, 'hello', tools, { onToolResult });

    expect(result.toolCallsExecuted).toBe(3);
    // onToolResult 按输入顺序触发 3 次
    expect(onToolResult).toHaveBeenCalledTimes(3);
    expect(onToolResult.mock.calls[0]?.[0]).toMatchObject({ toolCallId: 'a', success: true });
    expect(onToolResult.mock.calls[1]?.[0]).toMatchObject({
      toolCallId: 'b',
      success: false,
      error: 'tool internal error',
    });
    expect(onToolResult.mock.calls[2]?.[0]).toMatchObject({ toolCallId: 'c', success: true });

    // 错误结果作为 toolResults 回灌给下一轮 send
    const reentry = session.send.mock.calls[1]?.[0];
    expect(reentry).toContain('"toolCallId":"b"');
    expect(reentry).toContain('tool internal error');
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
