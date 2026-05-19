import type { ToolRegistryEntry } from '../tool/tool-registry'

const DESCRIPTION = `写入或覆盖一条共享 memory entry。所有 Session 共享同一份 store。

参数：
- slug（必填）: kebab-case 主键
- summary（必填）: 索引行展示的一句话
- body（必填）: 详情全文（recall 时返回）

何时使用：当你判断某个事实 / 偏好 / 背景对整个 agent 都有用，且未来对话需要复用时调用。
存在则覆盖，不存在则追加；不会改变 entry 的原有插入顺序。`

const PARAMETERS = {
  type: 'object',
  properties: {
    slug:    { type: 'string', description: 'kebab-case 主键' },
    summary: { type: 'string', description: '索引行的一句话' },
    body:    { type: 'string', description: '完整内容' },
  },
  required: ['slug', 'summary', 'body'],
}

export function memoryRememberTool(): ToolRegistryEntry {
  return {
    name: 'stello_memory_remember',
    description: DESCRIPTION,
    parameters: PARAMETERS,
    execute: async (args, ctx) => {
      const slug = (args.slug as string | undefined)?.trim()
      if (!slug) return { success: false, error: 'slug is required and must be non-empty' }
      const summary = args.summary as string | undefined
      if (summary === undefined || summary === null) {
        return { success: false, error: 'summary is required' }
      }
      const body = args.body as string | undefined
      if (body === undefined || body === null) {
        return { success: false, error: 'body is required' }
      }
      const store = ctx.agent.sharedMemory
      if (!store) return { success: false, error: 'sharedMemory not configured' }
      try {
        await store.upsert(slug, summary, body)
        return { success: true, data: { slug } }
      } catch (e) {
        return { success: false, error: `failed: ${e instanceof Error ? e.message : String(e)}` }
      }
    },
  }
}
