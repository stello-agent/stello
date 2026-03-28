import { describe, it, expect } from 'vitest'
import { makeSession, createMockLLM } from './helpers.js'

describe('updateMeta() + archive() + fork()', () => {
  describe('updateMeta()', () => {
    it('更新 label', async () => {
      const { session } = await makeSession({ label: 'Original' })
      await session.updateMeta({ label: 'Updated' })
      expect(session.meta.label).toBe('Updated')
    })

    it('更新 tags', async () => {
      const { session } = await makeSession()
      await session.updateMeta({ tags: ['tag1', 'tag2'] })
      expect(session.meta.tags).toEqual(['tag1', 'tag2'])
    })

    it('更新 metadata', async () => {
      const { session } = await makeSession()
      await session.updateMeta({ metadata: { key: 'value' } })
      expect(session.meta.metadata).toEqual({ key: 'value' })
    })

    it('部分更新不影响其他字段', async () => {
      const { session } = await makeSession({ label: 'Keep', tags: ['keep'] })
      await session.updateMeta({ label: 'New' })
      expect(session.meta.tags).toEqual(['keep'])
    })

    it('持久化到 storage', async () => {
      const { session, storage } = await makeSession({ label: 'Old' })
      await session.updateMeta({ label: 'Persisted' })
      const stored = await storage.getSession(session.meta.id)
      expect(stored?.label).toBe('Persisted')
    })
  })

  describe('archive()', () => {
    it('archive 后 status 变为 archived', async () => {
      const { session } = await makeSession()
      expect(session.meta.status).toBe('active')
      await session.archive()
      expect(session.meta.status).toBe('archived')
    })

    it('archive 后 storage 中的 status 也更新', async () => {
      const { session, storage } = await makeSession()
      await session.archive()
      const stored = await storage.getSession(session.meta.id)
      expect(stored?.status).toBe('archived')
    })

    it('归档不连带子 Session', async () => {
      const { session, storage } = await makeSession()
      const child = await session.fork({ label: 'Child' })
      await session.archive()
      const childStored = await storage.getSession(child.meta.id)
      expect(childStored?.status).toBe('active')
    })
  })

  describe('fork() 基本行为', () => {
    it('fork 创建子 Session', async () => {
      const { session } = await makeSession({ label: 'Parent' })
      const child = await session.fork({ label: 'Child' })
      expect(child.meta.label).toBe('Child')
      expect(child.meta.role).toBe('standard')
      expect(child.meta.status).toBe('active')
    })

    it('fork 默认不继承 L2（memory）', async () => {
      const { session, storage } = await makeSession()
      await storage.putMemory(session.meta.id, 'parent memory')
      const child = await session.fork({ label: 'Child' })
      expect(await child.memory()).toBeNull()
    })

    it('fork 支持传入 tags 和 metadata', async () => {
      const { session } = await makeSession()
      const child = await session.fork({
        label: 'Child',
        tags: ['forked'],
        metadata: { source: 'fork' },
      })
      expect(child.meta.tags).toEqual(['forked'])
      expect(child.meta.metadata).toEqual({ source: 'fork' })
    })

    it('fork 持久化子 Session 到 storage', async () => {
      const { session, storage } = await makeSession()
      const child = await session.fork({ label: 'Child' })
      const stored = await storage.getSession(child.meta.id)
      expect(stored).not.toBeNull()
      expect(stored?.label).toBe('Child')
    })
  })

  describe('fork() system prompt', () => {
    it('不传 systemPrompt 时继承父 Session 的 system prompt', async () => {
      const { session } = await makeSession({ systemPrompt: '你是一个助手' })
      const child = await session.fork({ label: 'Child' })
      expect(await child.systemPrompt()).toBe('你是一个助手')
    })

    it('传 systemPrompt 时覆盖', async () => {
      const { session } = await makeSession({ systemPrompt: '父提示词' })
      const child = await session.fork({ label: 'Child', systemPrompt: '子提示词' })
      expect(await child.systemPrompt()).toBe('子提示词')
    })

    it('父 Session 无 system prompt，子也无', async () => {
      const { session } = await makeSession()
      const child = await session.fork({ label: 'Child' })
      expect(await child.systemPrompt()).toBeNull()
    })
  })

  describe('fork() context', () => {
    it('context: none（默认）— 子 L3 为空', async () => {
      const llm = createMockLLM([{ content: 'reply' }])
      const { session } = await makeSession({ llm })
      await session.send('hello')
      const child = await session.fork({ label: 'Child' })
      expect(await child.messages()).toEqual([])
    })

    it('context: inherit — 子获得父 L3 副本', async () => {
      const llm = createMockLLM([{ content: 'reply' }])
      const { session } = await makeSession({ llm })
      await session.send('hello')
      const child = await session.fork({ label: 'Child', context: 'inherit' })
      const childMessages = await child.messages()
      expect(childMessages).toHaveLength(2)
      expect(childMessages[0]!.role).toBe('user')
      expect(childMessages[0]!.content).toBe('hello')
      expect(childMessages[1]!.role).toBe('assistant')
      expect(childMessages[1]!.content).toBe('reply')
    })

    it('context: ForkContextFn — 自定义转换', async () => {
      const llm = createMockLLM([{ content: 'r1' }, { content: 'r2' }])
      const { session } = await makeSession({ llm })
      await session.send('msg1')
      await session.send('msg2')
      // 只保留 user 消息
      const child = await session.fork({
        label: 'Child',
        context: (records) => records.filter((r) => r.role === 'user'),
      })
      const childMessages = await child.messages()
      expect(childMessages).toHaveLength(2)
      expect(childMessages.every((m) => m.role === 'user')).toBe(true)
    })

    it('context: async ForkContextFn — 支持异步', async () => {
      const llm = createMockLLM([{ content: 'reply' }])
      const { session } = await makeSession({ llm })
      await session.send('hello')
      const child = await session.fork({
        label: 'Child',
        context: async (records) => {
          await new Promise((r) => setTimeout(r, 1))
          return [{ role: 'system' as const, content: 'compressed: ' + records.length + ' records' }]
        },
      })
      const childMessages = await child.messages()
      expect(childMessages).toHaveLength(1)
      expect(childMessages[0]!.content).toBe('compressed: 2 records')
    })
  })

  describe('fork() prompt', () => {
    it('prompt 写入子 L3 第一条 assistant 开场消息', async () => {
      const { session } = await makeSession()
      const child = await session.fork({ label: 'Child', prompt: '开始调研' })
      const childMessages = await child.messages()
      expect(childMessages).toHaveLength(1)
      expect(childMessages[0]!.role).toBe('assistant')
      expect(childMessages[0]!.content).toBe('开始调研')
    })

    it('prompt + inherit — prompt 追加在继承记录之后', async () => {
      const llm = createMockLLM([{ content: 'reply' }])
      const { session } = await makeSession({ llm })
      await session.send('hello')
      const child = await session.fork({
        label: 'Child',
        context: 'inherit',
        prompt: '继续',
      })
      const childMessages = await child.messages()
      expect(childMessages).toHaveLength(3)
      expect(childMessages[0]!.content).toBe('hello')
      expect(childMessages[1]!.content).toBe('reply')
      expect(childMessages[2]!.role).toBe('assistant')
      expect(childMessages[2]!.content).toBe('继续')
    })
  })

  describe('fork() llm/tools 覆盖', () => {
    it('不传 llm — 继承父 LLM', async () => {
      const llm = createMockLLM([
        { content: 'parent reply' },
        { content: 'child reply' },
      ])
      const { session } = await makeSession({ llm })
      await session.send('parent msg')
      const child = await session.fork({ label: 'Child' })
      const result = await child.send('child msg')
      expect(result.content).toBe('child reply')
    })

    it('传 llm — 子使用覆盖的 LLM', async () => {
      const parentLlm = createMockLLM([{ content: 'parent reply' }])
      const childLlm = createMockLLM([{ content: 'overridden reply' }])
      const { session } = await makeSession({ llm: parentLlm })
      const child = await session.fork({ label: 'Child', llm: childLlm })
      const result = await child.send('hello')
      expect(result.content).toBe('overridden reply')
    })

    it('传 tools — 子使用覆盖的 tools', async () => {
      const parentTools = [{ name: 'parent_tool', description: 'parent', inputSchema: {} }]
      const childTools = [{ name: 'child_tool', description: 'child', inputSchema: {} }]
      const capturedTools: unknown[] = []
      const llm = createMockLLM([{ content: 'ok' }])
      // 拦截 LLM 调用以检查传入的 tools
      const spyLlm = {
        maxContextTokens: llm.maxContextTokens,
        async complete(messages: unknown[], opts?: { tools?: unknown[] }) {
          capturedTools.push(opts?.tools)
          return llm.complete(messages as never[], opts as never)
        },
      }
      const { session } = await makeSession({ llm: spyLlm, tools: parentTools })
      const child = await session.fork({ label: 'Child', tools: childTools, llm: spyLlm })
      await child.send('test')
      // 最后一次调用应该用的是 child tools
      expect(capturedTools[capturedTools.length - 1]).toEqual(childTools)
    })
  })
})
