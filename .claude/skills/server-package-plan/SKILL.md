---
name: server-package-plan
description: "@stello-ai/server 的包结构、职责边界、依赖关系。Server 只做服务化适配，不重写编排逻辑。"
---

# `@stello-ai/server` 包设计

> 状态：**Phase 1-3 已实现，Phase 4-5 进行中**（2026-03-24）

---

## 定位

`@stello-ai/server` 把 `@stello-ai/core` 的能力服务化。

**server 负责协议与连接，core 负责语义与编排。**

---

## 包结构（已实现 + 进行中）

```
packages/server/
  package.json
  tsconfig.json
  tsup.config.ts
  vitest.config.ts                  -- fileParallelism: false
  docker-compose.yml                -- PG 16-alpine 测试用
  src/
    index.ts                        -- 公开导出
    types.ts                        -- Space, SpaceConfig, ServerOptions, WS 消息类型
    db/
      pool.ts                       -- pg.Pool 工厂
      migrate.ts                    -- SQL 迁移执行器
      migrations/
        001_init.sql                -- 7 张表
    storage/                        -- ✅ 已实现
      pg-session-storage.ts         -- SessionStorage 实现
      pg-main-storage.ts            -- MainStorage 实现（extends above）
      pg-session-tree.ts            -- SessionTree 实现
      pg-memory-engine.ts           -- MemoryEngine 实现
    space/                          -- ✅ 已实现
      space-manager.ts              -- Space CRUD + root session 自动创建
      agent-pool.ts                 -- 懒 StelloAgent 缓存 + TTL 驱逐
    http/                           -- 🔨 Phase 4
      app.ts                        -- createApp() Hono 工厂
      middleware/
        auth.ts                     -- X-API-Key 认证中间件
      routes/
        spaces.ts                   -- Space CRUD 路由
        sessions.ts                 -- Session 查询 + agent 操作路由
    ws/                             -- 🔨 Phase 5
      gateway.ts                    -- WS 升级 + 消息分发
      connection-manager.ts         -- connectionId ↔ sessionId 映射
    create-server.ts                -- 🔨 createStelloServer() 入口
  __tests__/
    helpers.ts                      -- 测试工具（pool, setupDB, cleanDB, createUser/Space）
    pg-session-storage.test.ts      -- ✅ 12 tests
    pg-main-storage.test.ts         -- ✅ 8 tests
    pg-session-tree.test.ts         -- ✅ 20 tests
    pg-memory-engine.test.ts        -- ✅ 9 tests
    space-manager.test.ts           -- ✅ 7 tests
    agent-pool.test.ts              -- ✅ 5 tests + 3 idle
    rest-spaces.test.ts             -- 🔨 Phase 4
    rest-sessions.test.ts           -- 🔨 Phase 4
    ws-gateway.test.ts              -- 🔨 Phase 5
```

---

## 依赖

```json
{
  "dependencies": {
    "@stello-ai/core": "workspace:^",
    "@stello-ai/session": "workspace:^",
    "pg": "^8.13.0",
    "hono": "^4.7.0",
    "@hono/node-server": "^1.13.0",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/pg": "^8.11.0",
    "@types/ws": "^8.5.0"
  }
}
```

---

## Server 不该做的事

- 不重写 Engine / tool loop / topology 规则 / Session 语义
- 不自己发明第二套编排逻辑
- 连接态留在 server，不塞回 core
- 运行时回收复用 core 的 `runtimeRecyclePolicy`

---

## 与上下游的关系

- **Core** 先稳定语义 → **Server** 做服务化适配 → **SDK** 最后做薄封装
- Server 通过 `StelloAgent` 的公开 API 操作（turn/stream/enterSession/attachSession 等）
- Server 通过 `AgentPool.getAgent(spaceId)` 获取 per-space 的 StelloAgent
