import type { ToolRegistryEntry } from '../tool/tool-registry'

const DESCRIPTION = `删除一条共享 memory entry。

参数：
- slug（必填）: 要删除的 entry slug

何时使用：原 entry 已过时 / 错误 / 不再相关时调用。slug 不存在不报错（no-op）。`

const PARAMETERS = {
  type: 'object',
  properties: {
    slug: { type: 'string', description: '要删除的 entry slug' },
  },
  required: ['slug'],
}

export function memoryForgetTool(): ToolRegistryEntry {
  return {
    name: 'stello_memory_forget',
    description: DESCRIPTION,
    parameters: PARAMETERS,
    execute: async (args, ctx) => {
      const slug = (args.slug as string | undefined)?.trim()
      if (!slug) return { success: false, error: 'slug is required and must be non-empty' }
      const store = ctx.agent.sharedMemory
      if (!store) return { success: false, error: 'sharedMemory not configured' }
      try {
        await store.remove(slug)
        return { success: true, data: { slug } }
      } catch (e) {
        return { success: false, error: `failed: ${e instanceof Error ? e.message : String(e)}` }
      }
    },
  }
}
