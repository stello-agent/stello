import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import type pg from 'pg'
import {
  createDefaultConsolidateFn,
  createDefaultIntegrateFn,
  type LLMCallFn,
} from '../llm/defaults.js'
import { createTestPool, setupDatabase, cleanDatabase, createTestUser } from './helpers.js'

let pool: pg.Pool
let userId: string
let spaceId: string
let sessionId: string

beforeAll(async () => {
  pool = createTestPool()
  await setupDatabase(pool)
})

beforeEach(async () => {
  await cleanDatabase(pool)
  userId = await createTestUser(pool)
  const { rows: spaceRows } = await pool.query(
    `INSERT INTO spaces (user_id, label) VALUES ($1, 'test') RETURNING id`,
    [userId],
  )
  spaceId = spaceRows[0]!['id'] as string
  const { rows: sessionRows } = await pool.query(
    `INSERT INTO sessions (space_id, label, role) VALUES ($1, $2, 'standard') RETURNING id`,
    [spaceId, 'test'],
  )
  sessionId = sessionRows[0]!['id'] as string
})

afterAll(async () => {
  await pool.end()
})

describe('createDefaultConsolidateFn', () => {
  it('使用 space prompt 作为 fallback', async () => {
    const llm = vi.fn<LLMCallFn>(async () => 'new L2 summary')
    const fn = createDefaultConsolidateFn(sessionId, '请提炼对话要点', llm, pool, spaceId)

    const result = await fn(null, [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ])

    expect(result).toBe('new L2 summary')
    expect(llm).toHaveBeenCalledOnce()

    const [messages] = llm.mock.calls[0]!
    expect(messages[0]).toEqual({ role: 'system', content: '请提炼对话要点' })
    expect(messages[1]!.content).toContain('user: hello')
  })

  it('per-session prompt 优先于 space prompt', async () => {
    // 写入 per-session prompt
    await pool.query(
      `INSERT INTO session_data (session_id, key, content) VALUES ($1, 'consolidate_prompt', $2)`,
      [sessionId, '自定义提炼提示'],
    )

    const llm = vi.fn<LLMCallFn>(async () => 'custom L2')
    const fn = createDefaultConsolidateFn(sessionId, 'space 级 prompt', llm, pool, spaceId)

    await fn(null, [{ role: 'user', content: 'msg' }])

    const [messages] = llm.mock.calls[0]!
    expect(messages[0]!.content).toBe('自定义提炼提示')
  })

  it('无任何 prompt 时返回当前 memory', async () => {
    const llm = vi.fn<LLMCallFn>()
    const fn = createDefaultConsolidateFn(sessionId, null, llm, pool, spaceId)

    const result = await fn('existing memory', [{ role: 'user', content: 'msg' }])

    expect(result).toBe('existing memory')
    expect(llm).not.toHaveBeenCalled()
  })

  it('包含当前 L2 作为上下文', async () => {
    const llm = vi.fn<LLMCallFn>(async () => 'updated L2')
    const fn = createDefaultConsolidateFn(sessionId, 'summarize', llm, pool, spaceId)

    await fn('existing summary', [{ role: 'user', content: 'new message' }])

    const [messages] = llm.mock.calls[0]!
    expect(messages[1]!.content).toContain('当前摘要:\nexisting summary')
  })
})

describe('createDefaultIntegrateFn', () => {
  it('使用 space prompt 作为 fallback', async () => {
    const llm = vi.fn<LLMCallFn>(async () =>
      JSON.stringify({
        synthesis: 'global view',
        insights: [{ sessionId: 's1', content: 'focus more' }],
      }),
    )
    const fn = createDefaultIntegrateFn(sessionId, '请综合所有子 Session', llm, pool, spaceId)

    const result = await fn(
      [
        { sessionId: 's1', label: 'Session 1', l2: 'about topic A' },
        { sessionId: 's2', label: 'Session 2', l2: 'about topic B' },
      ],
      null,
    )

    expect(result.synthesis).toBe('global view')
    expect(result.insights).toEqual([{ sessionId: 's1', content: 'focus more' }])

    const [messages] = llm.mock.calls[0]!
    expect(messages[0]).toEqual({ role: 'system', content: '请综合所有子 Session' })
  })

  it('per-session prompt 优先于 space prompt', async () => {
    await pool.query(
      `INSERT INTO session_data (session_id, key, content) VALUES ($1, 'integrate_prompt', $2)`,
      [sessionId, '自定义综合提示'],
    )

    const llm = vi.fn<LLMCallFn>(async () =>
      JSON.stringify({ synthesis: 'custom', insights: [] }),
    )
    const fn = createDefaultIntegrateFn(sessionId, 'space 级 prompt', llm, pool, spaceId)

    await fn([{ sessionId: 's1', label: 'S1', l2: 'data' }], null)

    const [messages] = llm.mock.calls[0]!
    expect(messages[0]!.content).toBe('自定义综合提示')
  })

  it('无任何 prompt 时返回当前 synthesis', async () => {
    const llm = vi.fn<LLMCallFn>()
    const fn = createDefaultIntegrateFn(sessionId, null, llm, pool, spaceId)

    const result = await fn([{ sessionId: 's1', label: 'S1', l2: 'data' }], 'existing synthesis')

    expect(result.synthesis).toBe('existing synthesis')
    expect(result.insights).toEqual([])
    expect(llm).not.toHaveBeenCalled()
  })
})
