/** Space 配置（创建 / 更新时使用） */
export interface SpaceConfig {
  label: string
  systemPrompt?: string
  consolidatePrompt?: string
  config?: Record<string, unknown>
}

/** Space 完整数据 */
export interface Space {
  id: string
  userId: string
  label: string
  systemPrompt: string | null
  consolidatePrompt: string | null
  config: Record<string, unknown>
  createdAt: string
  updatedAt: string
}
