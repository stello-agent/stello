import type { ToolRegistryEntry } from '../tool/tool-registry'

const DESCRIPTION = `按 slug 读取一条共享 memory 的完整内容。

参数：
- slug（必填）: 索引中列出的某条 entry 的 slug

何时使用：上下文里 <shared_memory_index> 出现了你需要详读的 slug 时调用。`

const PARAMETERS = {
  type: 'object',
  properties: {
    slug: { type: 'string', description: '索引中的 entry slug' },
  },
  required: ['slug'],
}

export function memoryRecallTool(): ToolRegistryEntry {
  return {
    name: 'stello_memory_recall',
    description: DESCRIPTION,
    parameters: PARAMETERS,
    execute: async (args, ctx) => {
      const slug = (args.slug as string | undefined)?.trim()
      if (!slug) return { success: false, error: 'slug is required and must be non-empty' }
      const store = ctx.agent.sharedMemory
      if (!store) return { success: false, error: 'sharedMemory not configured' }
      try {
        const entry = await store.get(slug)
        if (!entry) return { success: false, error: `slug "${slug}" not found` }
        return { success: true, data: { body: entry.body } }
      } catch (e) {
        return { success: false, error: `failed: ${e instanceof Error ? e.message : String(e)}` }
      }
    },
  }
}
