# Stello DevTools Phase 1 — 脚手架 + Server 骨架

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 创建 `@stello-ai/devtools` 包骨架，实现 `startDevtools(agent)` 入口，包含 REST API + WS 事件流 + 前端 Vite 脚手架（Tailwind + shadcn/ui），浏览器能打开看到空壳页面。

**Architecture:** devtools 同进程持有 StelloAgent 引用，内置极简 Hono server 提供 REST/WS 接口给浏览器前端。前端用 React + Vite + Tailwind CSS + shadcn/ui 构建，打包后内嵌到 npm 包。

**Tech Stack:** React 19, Vite 6, Tailwind CSS 4, shadcn/ui, Lucide React, Hono, ws, tsup, Vitest

---

## File Structure

```
packages/devtools/
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── vitest.config.ts
├── src/
│   ├── index.ts                      # 公开入口：export { startDevtools }
│   ├── server/
│   │   ├── create-devtools-server.ts  # startDevtools() 实现
│   │   ├── routes.ts                  # Hono REST 路由
│   │   ├── ws-handler.ts             # WS 事件流处理
│   │   └── types.ts                  # DevTools 配置类型
│   └── __tests__/
│       ├── routes.test.ts            # REST 路由测试
│       └── ws-handler.test.ts        # WS 测试
├── web/                              # 前端源码（Vite 项目）
│   ├── index.html
│   ├── vite.config.ts
│   ├── postcss.config.js
│   ├── tailwind.config.ts
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx                   # 路由 + 侧边栏布局
│   │   ├── globals.css               # Tailwind 入口 + shadcn 主题变量
│   │   ├── lib/
│   │   │   └── utils.ts              # shadcn cn() 工具函数
│   │   ├── components/
│   │   │   └── ui/                   # shadcn/ui 组件（按需添加）
│   │   └── pages/
│   │       ├── Topology.tsx          # 占位
│   │       ├── Conversation.tsx      # 占位
│   │       ├── Inspector.tsx         # 占位
│   │       ├── Events.tsx            # 占位
│   │       └── Settings.tsx          # 占位
│   └── tsconfig.json
└── dist/                             # 构建产物（gitignore）
```

---

### Task 1: 包脚手架

**Files:**
- Create: `packages/devtools/package.json`
- Create: `packages/devtools/tsconfig.json`
- Create: `packages/devtools/tsup.config.ts`
- Create: `packages/devtools/vitest.config.ts`
- Create: `packages/devtools/src/index.ts`

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "@stello-ai/devtools",
  "version": "0.1.0",
  "description": "Developer debugging frontend for Stello agents",
  "license": "Apache-2.0",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
      "require": { "types": "./dist/index.d.cts", "default": "./dist/index.cjs" }
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup",
    "build:web": "cd web && npx vite build",
    "dev:web": "cd web && npx vite",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@hono/node-server": "^1.19.11",
    "@stello-ai/core": "workspace:^",
    "hono": "^4.12.9",
    "ws": "^8.20.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/ws": "^8.18.1",
    "tsup": "^8.4.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: 创建 tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: 创建 tsup.config.ts + vitest.config.ts**

tsup.config.ts 和 server 包一致：
```typescript
import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
});
```

vitest.config.ts:
```typescript
import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {},
})
```

- [ ] **Step 4: 创建 src/index.ts 占位**

```typescript
export { startDevtools } from './server/create-devtools-server.js'
export type { DevtoolsOptions } from './server/types.js'
```

- [ ] **Step 5: pnpm install 验证包结构**

Run: `cd /Users/bytedance/Github/stello && pnpm install`
Expected: 无报错，packages/devtools 被识别

- [ ] **Step 6: Commit**

```bash
git add packages/devtools/package.json packages/devtools/tsconfig.json packages/devtools/tsup.config.ts packages/devtools/vitest.config.ts packages/devtools/src/index.ts
git commit -m "chore(devtools): 初始化包脚手架"
```

---

### Task 2: Server 端类型 + 入口函数

**Files:**
- Create: `packages/devtools/src/server/types.ts`
- Create: `packages/devtools/src/server/create-devtools-server.ts`

- [ ] **Step 1: 创建 types.ts**

```typescript
import type { StelloAgent } from '@stello-ai/core'

/** startDevtools 配置 */
export interface DevtoolsOptions {
  /** 监听端口，默认 4800 */
  port?: number
  /** 是否自动打开浏览器，默认 true */
  open?: boolean
}

/** startDevtools 返回值 */
export interface DevtoolsInstance {
  /** 实际监听端口 */
  port: number
  /** 关闭 devtools server */
  close(): Promise<void>
}
```

- [ ] **Step 2: 创建 create-devtools-server.ts**

```typescript
import type { Server as HttpServer } from 'node:http'
import type { StelloAgent } from '@stello-ai/core'
import { Hono } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import { createRoutes } from './routes.js'
import { createWsHandler } from './ws-handler.js'
import type { DevtoolsOptions, DevtoolsInstance } from './types.js'

/** 启动 DevTools 调试服务器 */
export async function startDevtools(
  agent: StelloAgent,
  options: DevtoolsOptions = {},
): Promise<DevtoolsInstance> {
  const { port = 4800, open = true } = options

  const app = new Hono()

  // API 路由
  const api = createRoutes(agent)
  app.route('/api', api)

  // 静态文件（前端打包产物）
  app.use('/*', serveStatic({ root: './web/dist' }))

  const { serve } = await import('@hono/node-server')

  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port }, (info) => {
      // 附着 WS
      createWsHandler(server as unknown as HttpServer, agent)

      const url = `http://localhost:${info.port}`
      console.log(`\n  Stello DevTools running at ${url}\n`)

      // 自动打开浏览器
      if (open) {
        import('node:child_process').then(({ exec }) => {
          const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
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
```

- [ ] **Step 3: Commit**

```bash
git add packages/devtools/src/server/
git commit -m "feat(devtools): 添加 startDevtools 入口和类型定义"
```

---

### Task 3: REST 路由

**Files:**
- Create: `packages/devtools/src/server/routes.ts`
- Create: `packages/devtools/src/__tests__/routes.test.ts`

- [ ] **Step 1: 写 routes.ts 的失败测试**

```typescript
// routes.test.ts
import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import { createRoutes } from '../server/routes.js'

function createMockAgent() {
  return {
    sessions: {
      getRoot: vi.fn().mockResolvedValue({ id: 'root', parentId: null, label: 'Main' }),
      getChildren: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue({ id: 'sess-1', parentId: 'root', label: 'test' }),
    },
    config: {
      orchestration: { strategy: {} },
      capabilities: { tools: { getToolDefinitions: () => [] }, skills: { getAll: () => [] } },
    },
    turn: vi.fn().mockResolvedValue({ response: 'hello' }),
    forkSession: vi.fn().mockResolvedValue({ id: 'child-1', parentId: 'sess-1', label: 'fork' }),
    archiveSession: vi.fn().mockResolvedValue(undefined),
  }
}

describe('devtools REST routes', () => {
  it('GET /sessions returns session tree', async () => {
    const agent = createMockAgent()
    const app = new Hono()
    app.route('/api', createRoutes(agent as never))

    const res = await app.request('/api/sessions')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('root')
  })

  it('GET /config returns agent config', async () => {
    const agent = createMockAgent()
    const app = new Hono()
    app.route('/api', createRoutes(agent as never))

    const res = await app.request('/api/config')
    expect(res.status).toBe(200)
  })

  it('POST /sessions/:id/turn calls agent.turn', async () => {
    const agent = createMockAgent()
    const app = new Hono()
    app.route('/api', createRoutes(agent as never))

    const res = await app.request('/api/sessions/sess-1/turn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: 'hello' }),
    })
    expect(res.status).toBe(200)
    expect(agent.turn).toHaveBeenCalledWith('sess-1', 'hello')
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd packages/devtools && npx vitest run`
Expected: FAIL — routes.js not found

- [ ] **Step 3: 实现 routes.ts**

```typescript
import { Hono } from 'hono'
import type { StelloAgent } from '@stello-ai/core'

/** 创建 DevTools REST 路由 */
export function createRoutes(agent: StelloAgent): Hono {
  const app = new Hono()

  // 获取 session 树
  app.get('/sessions', async (c) => {
    const root = await agent.sessions.getRoot()
    const children = await agent.sessions.getChildren(root.id)
    return c.json({ root, children })
  })

  // 获取单个 session 信息
  app.get('/sessions/:id', async (c) => {
    const id = c.req.param('id')
    const node = await agent.sessions.get(id)
    return c.json(node)
  })

  // 非流式 turn
  app.post('/sessions/:id/turn', async (c) => {
    const id = c.req.param('id')
    const { input } = await c.req.json<{ input: string }>()
    const result = await agent.turn(id, input)
    return c.json(result)
  })

  // Fork session
  app.post('/sessions/:id/fork', async (c) => {
    const id = c.req.param('id')
    const options = await c.req.json<{ label: string; scope?: string }>()
    const child = await agent.forkSession(id, options)
    return c.json(child)
  })

  // Archive session
  app.post('/sessions/:id/archive', async (c) => {
    const id = c.req.param('id')
    await agent.archiveSession(id)
    return c.json({ ok: true })
  })

  // 获取 agent 配置（只读序列化）
  app.get('/config', (c) => {
    const config = agent.config
    return c.json({
      orchestration: {
        strategy: config.orchestration?.strategy?.constructor?.name ?? 'MainSessionFlatStrategy',
      },
      capabilities: {
        tools: config.capabilities.tools.getToolDefinitions(),
        skills: config.capabilities.skills.getAll().map((s) => ({
          name: s.name,
          description: s.description,
        })),
      },
    })
  })

  return app
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd packages/devtools && npx vitest run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/devtools/src/server/routes.ts packages/devtools/src/__tests__/routes.test.ts
git commit -m "feat(devtools): 实现 REST 路由（sessions/config/turn/fork/archive）"
```

---

### Task 4: WS 事件流处理

**Files:**
- Create: `packages/devtools/src/server/ws-handler.ts`
- Create: `packages/devtools/src/__tests__/ws-handler.test.ts`

- [ ] **Step 1: 写 ws-handler.ts 失败测试**

测试 WS 连接建立和消息发送的基础功能。

- [ ] **Step 2: 实现 ws-handler.ts**

处理：
- WS upgrade（无认证，devtools 是本地工具）
- 客户端消息：`session.enter` / `session.message` / `session.stream` / `session.leave` / `session.fork`
- 服务端推送：`session.entered` / `turn.complete` / `stream.delta` / `stream.end` / `event`（engine 事件转发）

- [ ] **Step 3: 运行测试**

- [ ] **Step 4: Commit**

```bash
git add packages/devtools/src/server/ws-handler.ts packages/devtools/src/__tests__/ws-handler.test.ts
git commit -m "feat(devtools): 实现 WS 事件流处理"
```

---

### Task 5: 前端 Vite + Tailwind + shadcn/ui 脚手架

**Files:**
- Create: `packages/devtools/web/` 目录下所有前端文件

- [ ] **Step 1: 初始化 Vite + React 项目**

在 `packages/devtools/web/` 下创建：
- `index.html`
- `vite.config.ts`（配置 proxy 到 server 端口）
- `tsconfig.json`
- `package.json`（前端依赖：react, react-dom, tailwindcss, lucide-react, react-router-dom）

- [ ] **Step 2: 配置 Tailwind CSS + 原木主题色**

`globals.css` 配置 shadcn 的 CSS 变量，覆盖为原木色系：
- `--primary`: 琥珀橙 hsl(24, 52%, 50%)
- `--background`: 奶油白 hsl(40, 14%, 96%)
- `--card`: 纯白
- `--muted`: 浅木色 hsl(30, 20%, 93%)

- [ ] **Step 3: 初始化 shadcn/ui**

添加 `cn()` 工具函数，按需引入 Button、Card、Badge 等基础组件。

- [ ] **Step 4: 创建 App.tsx — 侧边栏 + 路由**

实现左侧 64px 图标侧边栏（Logo + 5 个导航项），使用 react-router-dom 路由到 5 个占位页面。侧边栏导航项使用 Lucide 图标：Sparkles(Map)、MessageSquare(Chat)、Search(Inspect)、Activity(Events)、Settings(Settings)。

- [ ] **Step 5: 创建 5 个占位页面**

每个页面显示页面名称 + "Coming soon" 文字。

- [ ] **Step 6: 验证前端能跑**

Run: `cd packages/devtools/web && npx vite`
Expected: 浏览器打开能看到侧边栏和占位页面

- [ ] **Step 7: Commit**

```bash
git add packages/devtools/web/
git commit -m "feat(devtools): 前端脚手架（Vite + Tailwind + shadcn/ui + 路由）"
```

---

### Task 6: 集成验证

**Files:**
- Modify: `packages/devtools/src/server/create-devtools-server.ts`（调整静态文件路径）

- [ ] **Step 1: 构建前端**

Run: `cd packages/devtools/web && npx vite build --outDir ../dist/web`

- [ ] **Step 2: 调整 server 端静态文件 serve 路径**

确保 `startDevtools()` 能正确 serve 打包后的前端文件。

- [ ] **Step 3: 端到端验证**

Run: `cd packages/devtools && npx tsup && node -e "..."`（用 mock agent 测试完整流程）
Expected: 浏览器打开 localhost:4800 看到带侧边栏的空壳页面

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(devtools): Phase 1 完成——server + 前端脚手架集成"
```
