import type { SharedMemoryStore } from './types'

const HINT = `调用 stello_memory_recall 工具按 slug 查阅完整内容；
调用 stello_memory_remember / stello_memory_forget 工具维护此处条目。`

/**
 * 渲染共享 memory 索引段。
 * - store 为 undefined 或无 entry：返回 undefined（调用方应跳过注入）
 * - 否则返回 <shared_memory_index>…</shared_memory_index> + hint 文本
 */
export async function renderSharedMemoryIndex(
  store: SharedMemoryStore | undefined,
): Promise<string | undefined> {
  if (!store) return undefined
  const entries = await store.list()
  if (entries.length === 0) return undefined
  const lines = entries.map(e => `- ${e.slug}: ${e.summary}`).join('\n')
  return `<shared_memory_index>\n${lines}\n</shared_memory_index>\n\n${HINT}`
}
