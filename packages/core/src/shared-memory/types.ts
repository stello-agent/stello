/**
 * 共享 memory 的单条记录。
 * slug: 主键 / summary: 出现在索引行的一句话 / body: recall 时返回的全文。
 */
export interface SharedMemoryEntry {
  slug: string
  summary: string
  body: string
}

/**
 * StelloAgent 级共享 memory 存储接口。
 *
 * - 一个 StelloAgent 实例对应一份 store；所有 Session 共享
 * - list() 按"插入顺序"返回；upsert 已存在 slug 时**不改变其顺序位置**
 * - 写操作（upsert / remove）由实现内部串行化（writeLock 范式），读操作允许脏读
 */
export interface SharedMemoryStore {
  /** 列举全部 entries（按插入顺序） */
  list(): Promise<SharedMemoryEntry[]>
  /** 读取单条 entry，不存在返回 null */
  get(slug: string): Promise<SharedMemoryEntry | null>
  /** 写入或覆盖一条 entry（不存在则追加到末尾，存在则覆盖 summary + body 并保持顺序） */
  upsert(slug: string, summary: string, body: string): Promise<void>
  /** 删除一条 entry；不存在为 no-op */
  remove(slug: string): Promise<void>
}
