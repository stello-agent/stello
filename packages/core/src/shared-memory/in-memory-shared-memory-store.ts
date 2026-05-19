import type { SharedMemoryEntry, SharedMemoryStore } from './types'

/**
 * 内置 SharedMemoryStore — 基于 JS Map（天然保留插入顺序）。
 *
 * 所有写操作通过 writeLock 串行化（沿用 SessionTreeImpl 的范式），
 * 避免并发 upsert / remove 时读到中间状态。读操作不加锁，允许脏读。
 */
export class InMemorySharedMemoryStore implements SharedMemoryStore {
  private readonly entries = new Map<string, { summary: string; body: string }>()
  private writeLock: Promise<unknown> = Promise.resolve()

  /** 把 fn 排入写队列，串行执行 */
  private withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writeLock.then(fn, fn)
    this.writeLock = next.catch(() => undefined)
    return next
  }

  /** 列举全部 entries，按 Map 插入顺序 */
  async list(): Promise<SharedMemoryEntry[]> {
    return [...this.entries].map(([slug, { summary, body }]) => ({ slug, summary, body }))
  }

  /** 读取单条 entry */
  async get(slug: string): Promise<SharedMemoryEntry | null> {
    const v = this.entries.get(slug)
    return v ? { slug, summary: v.summary, body: v.body } : null
  }

  /** 写入或覆盖；JS Map.set 在已有 key 上不改变插入位置 */
  upsert(slug: string, summary: string, body: string): Promise<void> {
    return this.withWriteLock(async () => {
      this.entries.set(slug, { summary, body })
    })
  }

  /** 删除一条；不存在为 no-op */
  remove(slug: string): Promise<void> {
    return this.withWriteLock(async () => {
      this.entries.delete(slug)
    })
  }
}
