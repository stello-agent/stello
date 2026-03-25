/** LLM 配置的 getter/setter，由调用方实现具体的 adapter 切换 */
export interface LLMConfigProvider {
  getConfig(): { model: string; baseURL: string; apiKey?: string }
  setConfig(config: { model: string; baseURL: string; apiKey?: string }): void
}

/** startDevtools 配置 */
export interface DevtoolsOptions {
  /** 监听端口，默认 4800 */
  port?: number
  /** 是否自动打开浏览器，默认 true */
  open?: boolean
  /** LLM 配置提供者（传入后 Settings 页面可动态切换 LLM） */
  llm?: LLMConfigProvider
}

/** startDevtools 返回值 */
export interface DevtoolsInstance {
  /** 实际监听端口 */
  port: number
  /** 关闭 devtools server */
  close(): Promise<void>
}
