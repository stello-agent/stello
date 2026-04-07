import 'dotenv/config'
import { rm } from 'node:fs/promises'
import type { ToolDefinition, ToolExecutionResult } from '../../packages/core/src/index'
import { bootstrap, dataDirAbs, withSessionEngine } from './chat-devtools'

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message)
  }
}

function getActivateSkillTool(defs: ToolDefinition[]): ToolDefinition {
  const tool = defs.find((def) => def.name === 'activate_skill')
  if (!tool) {
    throw new Error('activate_skill tool definition not found')
  }
  return tool
}

function includesSkill(def: ToolDefinition, skillName: string): boolean {
  return def.description.includes(`**${skillName}**`)
}

async function getToolDefinitions(
  app: Awaited<ReturnType<typeof bootstrap>>,
  sessionId: string,
): Promise<ToolDefinition[]> {
  return withSessionEngine(app.agent, sessionId, async (engine) => engine.getToolDefinitions())
}

async function executeTool(
  app: Awaited<ReturnType<typeof bootstrap>>,
  sessionId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  return withSessionEngine(app.agent, sessionId, async (engine) => engine.executeTool(toolName, args))
}

async function run() {
  await rm(dataDirAbs, { recursive: true, force: true })
  const app = await bootstrap()
  const root = await app.sessions.getRoot()

  const mainDefs = await getToolDefinitions(app, root.id)
  const mainSkillTool = getActivateSkillTool(mainDefs)
  assert(includesSkill(mainSkillTool, 'meow-protocol'), 'main session should expose meow-protocol')
  assert(includesSkill(mainSkillTool, 'haiku-mode'), 'main session should expose haiku-mode')

  const poetCreate = await executeTool(app, root.id, 'stello_create_session', {
    label: '诗人 Session',
    profile: 'poet',
  })
  assert(poetCreate.success, `poet session creation failed: ${poetCreate.error ?? 'unknown error'}`)
  const poetSessionId = String((poetCreate.data as { sessionId: string }).sessionId)

  const researcherCreate = await executeTool(app, root.id, 'stello_create_session', {
    label: '研究助手 Session',
    profile: 'researcher',
  })
  assert(researcherCreate.success, `researcher session creation failed: ${researcherCreate.error ?? 'unknown error'}`)
  const researcherSessionId = String((researcherCreate.data as { sessionId: string }).sessionId)

  const poetDefs = await getToolDefinitions(app, poetSessionId)
  const poetSkillTool = getActivateSkillTool(poetDefs)
  assert(includesSkill(poetSkillTool, 'meow-protocol'), 'poet session should expose meow-protocol')
  assert(!includesSkill(poetSkillTool, 'haiku-mode'), 'poet session should hide haiku-mode')

  const researcherDefs = await getToolDefinitions(app, researcherSessionId)
  const researcherSkillTool = getActivateSkillTool(researcherDefs)
  assert(includesSkill(researcherSkillTool, 'meow-protocol'), 'researcher session should expose meow-protocol')
  assert(includesSkill(researcherSkillTool, 'haiku-mode'), 'researcher session should expose haiku-mode')

  const poetActivateHaiku = await executeTool(app, poetSessionId, 'activate_skill', { name: 'haiku-mode' })
  assert(poetActivateHaiku.success === false, 'poet session should reject haiku-mode')
  assert(poetActivateHaiku.error === 'Skill "haiku-mode" not found', `unexpected poet error: ${poetActivateHaiku.error ?? 'empty'}`)

  const researcherActivateHaiku = await executeTool(app, researcherSessionId, 'activate_skill', { name: 'haiku-mode' })
  assert(researcherActivateHaiku.success === true, 'researcher session should allow haiku-mode')
  assert(typeof researcherActivateHaiku.data === 'string' && researcherActivateHaiku.data.includes('5-7-5'), 'researcher haiku-mode content mismatch')

  console.log('Per-session skills verification passed.')
  console.log(`  main: meow-protocol, haiku-mode`)
  console.log(`  poet: meow-protocol`)
  console.log(`  researcher: meow-protocol, haiku-mode`)
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
