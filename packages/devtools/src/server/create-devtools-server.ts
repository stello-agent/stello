import { readFileSync, existsSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Server as HttpServer } from 'node:http'
import { Hono } from 'hono'
import type { StelloAgent } from '@stello-ai/core'
import { createRoutes } from './routes.js'
import { createWsHandler } from './ws-handler.js'
import { EventBus, wrapAgentWithEvents } from './event-bus.js'
import type { DevtoolsOptions, DevtoolsInstance, DevtoolsPersistedState, ToolsProvider, SkillsProvider } from './types.js'

/** 定位前端打包产物目录 */
function resolveWebDir(): string {
  /* 兼容 ESM 和 CJS */
  let currentDir: string
  try {
    currentDir = dirname(fileURLToPath(import.meta.url))
  } catch {
    currentDir = __dirname
  }

  const candidates = [
    /* tsup flat output: dist/index.js → dist/web/ */
    resolve(currentDir, 'web'),
    /* 子目录 output: dist/server/xxx.js → dist/web/ */
    resolve(currentDir, '..', 'web'),
    /* 从源码运行（tsx）: src/server/xxx.ts → dist/web/ */
    resolve(currentDir, '..', '..', 'dist', 'web'),
    /* 从源码运行（tsx）: src/xxx.ts → dist/web/ */
    resolve(currentDir, '..', 'dist', 'web'),
  ]

  for (const dir of candidates) {
    if (existsSync(join(dir, 'index.html'))) return dir
  }
  return candidates[0]!
}

/** MIME 类型映射 */
const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

/** 从 webDir serve 静态文件的 Hono 中间件 */
function createStaticMiddleware(webDir: string) {
  return async (c: { req: { path: string }; body: (data: string | null, init?: ResponseInit) => Response; notFound: () => Response }) => {
    const filePath = c.req.path === '/' ? '/index.html' : c.req.path
    const fullPath = join(webDir, filePath)

    /* 安全检查：不能跳出 webDir */
    if (!fullPath.startsWith(webDir)) return c.notFound()

    if (existsSync(fullPath)) {
      const ext = filePath.substring(filePath.lastIndexOf('.'))
      const mime = MIME[ext] ?? 'application/octet-stream'
      const content = readFileSync(fullPath)
      return new Response(content, {
        headers: { 'Content-Type': mime, 'Cache-Control': 'no-cache' },
      })
    }

    /* SPA fallback: 所有未匹配路径返回 index.html */
    const indexPath = join(webDir, 'index.html')
    if (existsSync(indexPath)) {
      const content = readFileSync(indexPath, 'utf-8')
      return new Response(content, {
        headers: { 'Content-Type': 'text/html' },
      })
    }

    return c.notFound()
  }
}

/** 将已持久化状态恢复到当前 agent/provider。 */
async function restorePersistedState(
  agent: StelloAgent,
  state: DevtoolsPersistedState | null,
  options: DevtoolsOptions,
): Promise<void> {
  if (!state) return

  if (state.hotConfig) {
    agent.updateConfig(state.hotConfig)
  }

  if (state.llm && options.llm) {
    const current = options.llm.getConfig()
    options.llm.setConfig({
      model: state.llm.model,
      baseURL: state.llm.baseURL,
      apiKey: current.apiKey,
      temperature: state.llm.temperature,
      maxTokens: state.llm.maxTokens,
    })
  }

  if (state.prompts && options.prompts) {
    options.prompts.setPrompts(state.prompts)
  }

  if (options.tools && state.disabledTools) {
    syncProviderToggleState(options.tools, new Set(state.disabledTools))
  }

  if (options.skills && state.disabledSkills) {
    syncProviderToggleState(options.skills, new Set(state.disabledSkills))
  }
}

/** 按禁用列表同步 tools/skills provider 状态。 */
function syncProviderToggleState(
  provider: ToolsProvider | SkillsProvider,
  disabledNames: Set<string>,
): void {
  if ('getTools' in provider) {
    for (const tool of provider.getTools()) {
      provider.setEnabled(tool.name, !disabledNames.has(tool.name))
    }
    return
  }
  for (const skill of provider.getSkills()) {
    provider.setEnabled(skill.name, !disabledNames.has(skill.name))
  }
}

/** 启动 DevTools 调试服务器 */
export async function startDevtools(
  agent: StelloAgent,
  options: DevtoolsOptions = {},
): Promise<DevtoolsInstance> {
  const { port = 4800, open = true } = options

  const app = new Hono()
  const webDir = resolveWebDir()
  const eventBus = new EventBus()

  const persistedState = options.stateStore ? await options.stateStore.load() : null
  await restorePersistedState(agent, persistedState, options)

  /* Proxy 包装 agent，拦截操作自动广播事件 */
  const wrappedAgent = wrapAgentWithEvents(agent, eventBus)

  /* API 路由——用包装后的 agent + 事件回调 + 历史查询 + 各种 provider */
  const api = createRoutes(
    wrappedAgent,
    (event) => eventBus.emit(event),
    () => eventBus.getHistory(),
    options.llm,
    options.prompts,
    options.sessionAccess,
    options.tools,
    options.skills,
    options.integration,
    options.reset,
    options.stateStore,
  )
  app.route('/api', api)

  /* 前端静态文件 */
  app.all('/*', createStaticMiddleware(webDir) as never)

  const { serve } = await import('@hono/node-server')

  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port }, (info) => {
      /* 附着 WS + 事件广播 */
      const wss = createWsHandler(server as unknown as HttpServer, wrappedAgent)

      /* 事件总线 → 广播到所有 WS 客户端 */
      eventBus.on((event) => {
        const msg = JSON.stringify(event)
        wss.clients.forEach((client) => {
          if (client.readyState === 1) client.send(msg)
        })
      })

      const url = `http://localhost:${info.port}`
      const hasWeb = existsSync(join(webDir, 'index.html'))
      console.log(`\n  Stello DevTools running at ${url}`)
      if (!hasWeb) {
        console.log(`  ⚠ Frontend not built. Run: cd packages/devtools/web && pnpm exec vite build`)
      }
      console.log()

      /* 自动打开浏览器 */
      if (open && hasWeb) {
        import('node:child_process').then(({ exec }) => {
          const cmd = process.platform === 'darwin'
            ? 'open'
            : process.platform === 'win32'
              ? 'start'
              : 'xdg-open'
          exec(`${cmd} ${url}`)
        })
      }

      resolve({
        port: info.port,
        async close() {
          server.close()
        },
      })
    })
  })
}
