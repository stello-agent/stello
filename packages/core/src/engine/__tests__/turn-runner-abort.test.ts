import { describe, expect, it, vi } from 'vitest'
import { TurnRunner, type ToolCallParser } from '../turn-runner'

const parser: ToolCallParser = {
  parse(raw) {
    return JSON.parse(raw) as { content: string | null; toolCalls: Array<{ id?: string; name: string; args: Record<string, unknown> }> }
  },
}

describe('TurnRunner.run AbortSignal', () => {
  it('signal abort 在轮间生效，下一轮 send 不再发起', async () => {
    const controller = new AbortController()
    const session = {
      id: 's1',
      send: vi
        .fn<(input: string, options?: { signal?: AbortSignal }) => Promise<string>>()
        .mockResolvedValueOnce(
          JSON.stringify({
            content: null,
            toolCalls: [{ id: '1', name: 'read', args: { path: 'a' } }],
          }),
        ),
    }
    const tools = {
      executeTool: vi.fn().mockImplementation(async () => {
        controller.abort()
        return { success: true, data: 'ok' }
      }),
    }
    const onToolResult = vi.fn()

    const runner = new TurnRunner(parser)
    await expect(
      runner.run(session, 'hello', tools, {
        signal: controller.signal,
        onToolResult,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })

    // 第二轮 session.send 不应被调用（signal 在 round 边界检查）
    expect(session.send).toHaveBeenCalledTimes(1)
    // tool 执行后立刻 abort，onToolResult 不应触发（避免 phantom result）
    expect(onToolResult).not.toHaveBeenCalled()
  })

  it('已 abort 的 signal 立即拒绝，不调用 session.send', async () => {
    const controller = new AbortController()
    controller.abort()
    const session = { id: 's1', send: vi.fn() }
    const tools = { executeTool: vi.fn() }

    const runner = new TurnRunner(parser)
    await expect(
      runner.run(session, 'hello', tools, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })

    expect(session.send).not.toHaveBeenCalled()
  })

  it('signal 透传到 session.send 与 tools.executeTool', async () => {
    const controller = new AbortController()
    const session = {
      id: 's1',
      send: vi
        .fn<(input: string, options?: { signal?: AbortSignal }) => Promise<string>>()
        .mockResolvedValueOnce(
          JSON.stringify({
            content: null,
            toolCalls: [{ id: '1', name: 'read', args: {} }],
          }),
        )
        .mockResolvedValueOnce(JSON.stringify({ content: 'done', toolCalls: [] })),
    }
    const tools = {
      executeTool: vi
        .fn<(name: string, args: Record<string, unknown>, id?: string, options?: { signal?: AbortSignal }) => Promise<{ success: boolean; data?: unknown }>>()
        .mockResolvedValue({ success: true, data: 'x' }),
    }

    const runner = new TurnRunner(parser)
    await runner.run(session, 'hi', tools, { signal: controller.signal })

    // session.send 第一参数是 input；第二参数应携带 signal
    expect(session.send).toHaveBeenCalledWith('hi', expect.objectContaining({ signal: controller.signal }))
    // tools.executeTool 第四参数应携带 signal
    expect(tools.executeTool).toHaveBeenCalledWith(
      'read',
      {},
      '1',
      expect.objectContaining({ signal: controller.signal }),
    )
  })
})

describe('TurnRunner.runStream AbortSignal', () => {
  it('运行中 abort 后 result reject 为 AbortError，且后续不再 send', async () => {
    const controller = new AbortController()
    // 模拟 session.stream 的真实行为：iterator 抛 AbortError，result 也 reject。
    function makeMockStream(chunks: string[]) {
      let resolveResult: (raw: string) => void = () => {}
      let rejectResult: (err: unknown) => void = () => {}
      const result = new Promise<string>((resolve, reject) => {
        resolveResult = resolve
        rejectResult = reject
      })
      result.catch(() => {})
      return {
        result,
        async *[Symbol.asyncIterator]() {
          try {
            for (const chunk of chunks) {
              if (controller.signal.aborted) {
                const err = new DOMException('aborted', 'AbortError')
                rejectResult(err)
                throw err
              }
              await new Promise((r) => setTimeout(r, 5))
              yield chunk
            }
            resolveResult(JSON.stringify({ content: chunks.join(''), toolCalls: [] }))
          } catch (err) {
            rejectResult(err)
            throw err
          }
        },
      }
    }
    const session = {
      id: 's1',
      stream: vi.fn(() => makeMockStream(['a', 'b', 'c'])),
      send: vi.fn(),
    }
    const tools = { executeTool: vi.fn() }

    const runner = new TurnRunner(parser)
    const stream = runner.runStream(session, 'hi', tools, { signal: controller.signal })

    const collected: string[] = []
    const iter = (async () => {
      try {
        for await (const chunk of stream) {
          collected.push(chunk)
          if (collected.length === 1) controller.abort()
        }
      } catch {
        // iterator re-throws AbortError per plan; consumer-side ok
      }
    })()

    await expect(stream.result).rejects.toMatchObject({ name: 'AbortError' })
    await iter

    expect(session.send).not.toHaveBeenCalled()
  })

  it('已 abort signal 让 runStream 立即让 result reject', async () => {
    const controller = new AbortController()
    controller.abort()
    const session = {
      id: 's1',
      send: vi.fn(),
      stream: vi.fn(),
    }
    const tools = { executeTool: vi.fn() }

    const runner = new TurnRunner(parser)
    const stream = runner.runStream(session, 'hi', tools, { signal: controller.signal })
    await expect(stream.result).rejects.toMatchObject({ name: 'AbortError' })
    expect(session.stream).not.toHaveBeenCalled()
  })
})
