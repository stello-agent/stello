import { describe, it, expect, vi } from 'vitest'
import type { SessionTree } from '../types/session'
import type { MemoryEngine } from '../types/memory'
import type { ConfirmProtocol } from '../types/lifecycle'
import type { StelloAgent } from '../agent/stello-agent'
import type { LLMAdapter, LLMResult } from '@stello-ai/session'
import {
  StelloEngineImpl,
  ToolRegistryImpl,
  SkillRouterImpl,
  createSession,
  InMemoryStorageAdapter,
  adaptSessionToEngineRuntime,
  serializeSessionSendResult,
  sessionSendResultParser,
  TurnRunner,
  createSessionTool,
  activateSkillTool,
} from '../index'

/**
 * 回归测试：内置工具的 description 必须能传到 LLM。
 *
 * 全链路：
 *   ToolRegistryImpl([createSessionTool(), activateSkillTool(skills)])
 *     → new StelloEngineImpl(...)  // 构造时会调用 pushToolsToSession
 *       → session.setTools(union(...))
 *         → engine.turn('hi') → session.send('hi')
 *           → llm.complete(messages, { tools })  ← 断言这里收到 tools
 */
describe('Built-in tool LLM exposure (bug regression)', () => {
  it('LLM 在 send 时收到 stello_create_session 与 activate_skill 的描述', async () => {
    // 1. 用 spy LLM，捕获 complete 的调用参数
    const completeSpy = vi.fn<NonNullable<LLMAdapter['complete']>>().mockResolvedValue({
      content: 'ok',
      toolCalls: [],
      usage: { promptTokens: 0, completionTokens: 0 },
    } satisfies LLMResult)
    const llm: LLMAdapter = {
      maxContextTokens: 1_000_000,
      complete: completeSpy,
    }

    // 2. 真实的 createSession（带 InMemoryStorage）
    const storage = new InMemoryStorageAdapter()
    const session = await createSession({
      storage,
      llm,
      label: 'Regression Test Session',
    })

    // 3. 注册一个 skill 让 activate_skill 工具可用
    const skills = new SkillRouterImpl()
    skills.register({ name: 'analyzer', description: 'analyze stuff', content: 'skill body' })

    // 4. 把内置工具放入 ToolRegistry
    const tools = new ToolRegistryImpl([
      createSessionTool(),
      activateSkillTool(skills),
    ])

    // 5. 把 Session 适配成 EngineRuntimeSession
    const runtime = await adaptSessionToEngineRuntime(session, {
      serializeResult: serializeSessionSendResult,
    })

    // 6. 构造 Engine —— 构造时即触发 pushToolsToSession
    const engine = new StelloEngineImpl({
      session: runtime,
      sessions: {
        archive: vi.fn().mockResolvedValue(undefined),
        getNode: vi.fn(),
        getTree: vi.fn(),
        getConfig: vi.fn().mockResolvedValue(null),
        putConfig: vi.fn().mockResolvedValue(undefined),
      } as unknown as SessionTree,
      memory: {} as MemoryEngine,
      skills,
      confirm: {} as ConfirmProtocol,
      agent: {} as StelloAgent,
      lifecycle: {
        bootstrap: vi.fn(),
        afterTurn: vi.fn(),
      },
      tools,
      turnRunner: new TurnRunner(sessionSendResultParser),
    })

    // 7. 跑一轮 turn，从而触发 session.send → llm.complete
    await engine.turn('hi')

    // 8. 断言：llm.complete 第一次调用时收到了内置工具的定义
    expect(completeSpy).toHaveBeenCalled()
    const [, completeOptions] = completeSpy.mock.calls[0]!
    const toolList = completeOptions?.tools ?? []
    const toolNames = toolList.map(t => t.name)

    expect(toolNames).toContain('stello_create_session')
    expect(toolNames).toContain('activate_skill')

    const createTool = toolList.find(t => t.name === 'stello_create_session')!
    expect(createTool.description).toMatch(/创建.*子会话/)
    // 其参数 schema 应非空（防止只透传名字、丢失描述/schema 的回归）
    expect(createTool.inputSchema).toBeDefined()
    expect(createTool.inputSchema).toHaveProperty('properties')

    const activateTool = toolList.find(t => t.name === 'activate_skill')!
    // activate_skill 的描述应包含已注册 skill 的枚举
    expect(activateTool.description).toContain('analyzer')
  })
})
