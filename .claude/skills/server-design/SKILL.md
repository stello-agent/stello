---
name: server-design
description: Server 层设计：WS 连接管理、Engine 创建销毁、HTTP API 路由。Engine 细节见 engine-design，Scheduler 细节见 scheduler-design。
---

# Server 层（Service Layer）技术设计

> Server 是最外层服务壳，负责 WS/HTTP 连接管理、Engine 生命周期、以及内嵌 Scheduler。
>
> 相关 skill：**engine-design**（Engine 内部职责）、**scheduler-design**（跨 Session 协调）
>
> 状态：**设计草案**（2026-03-22）

---

## 1. 四层执行模型

```
Session    = 一次 LLM 调用（原子操作）
Engine     = 一个 Session 的多轮对话生命周期（per-session-round）→ 见 engine-design
Scheduler  = 跨 Session 协调（per-space）→ 见 scheduler-design
Server     = WS/HTTP 服务层，管理连接和路由
```

### 职责分界

| 职责 | Session | Engine | Scheduler | Server |
|------|---------|--------|-----------|--------|
| 单次 LLM 调用 | send() | — | — | — |
| Tool call 循环 | — | turn() | — | — |
| 该 Session 的 consolidation | — | 判断时机 | onSwitch 外部触发 | — |
| Integration 调度 | — | — | 判断时机 | — |
| Session 切换检测 | — | — | 检测 | — |
| WS 连接管理 | — | — | — | 管理 |
| Engine 创建/销毁 | — | — | 协助时序 | 执行 |
| HTTP 路由 | — | — | — | 处理 |

---

## 2. Engine 生命周期

Engine 是**有状态的、动态的**，与 WS 连接绑定。

```
用户打开 Session 页面
  → WS connect
  → Server 创建 Engine(sessionId)
  → Engine 从 storage 加载 session 上下文（L3, insights, system prompt）
  → 缓存在内存中
  │
  ├─ user msg → engine.turn(msg)
  │               ├─ session.send(msg) → LLM
  │               ├─ tool call? → execute → session.send(result)
  │               └─ 返回响应（WS 流式推送）
  ├─ user msg → engine.turn(msg)  ← 使用缓存，不重新加载
  ├─ ...
  │
  ├─ Server 推送 insight → engine.receiveInsight(insight)
  │
  用户关闭页面 / 切换 Session
  → WS close
  → Engine emit 'leave' 事件
  → Server 收到事件 → 触发 consolidation → 销毁 Engine
```

### 内存开销

| 阶段 | 内存 | 持续时间 |
|------|------|---------|
| 空闲（用户阅读中） | ~10-50 KB（WS fd + session 引用） | 秒～分钟 |
| turn() 执行中 | + L3 历史 + prompt + LLM 缓冲 | 几秒 |
| turn() 结束后 | 可保留缓存或释放，回到空闲 | — |

10,000 并发用户 ≈ 100-500 MB，可忽略。瓶颈在 LLM 调用，不在 Engine 内存。

### 空闲超时

设合理超时（如 30 分钟），主动关闭僵尸 Engine，避免连接积累。

---

## 3. WebSocket 连接模型

### 为什么用 WS 而不是纯 REST + SSE

| 理由 | 说明 |
|------|------|
| Round 边界 | WS connect/close 天然给出 enter/leave 信号 |
| 流式响应 | turn() 中 LLM 流式输出直接推送 |
| 服务端推送 | insight 更新、consolidation 完成通知 |
| 前端星空图 | 实时拓扑变更推送 |

业界参考：ChatGPT / Discord / Slack 的前端对话均使用 WebSocket。

### 边界情况

| 场景 | 处理 |
|------|------|
| 网络抖动断连 | 短暂重连窗口（~30s），不立即触发 leave |
| 用户刷新页面 | 同上，重连后恢复 Engine |
| 用户切换 Session | 关旧 WS → open 新 WS → Server 检测 switch |
| 服务端重启 | 所有 WS 断开，客户端自动重连，Engine 冷启动 |

---

## 4. Server 内部架构

```
┌─────────────────────────────────────────────┐
│  Server                                      │
│                                              │
│  SpaceRegistry: Map<spaceId, SpaceContext>   │
│                                              │
│  SpaceContext:                                │
│    config (adapters, triggers, tools...)     │
│    storage: MainStorage                      │
│    activeEngines: Map<sessionId, Engine>     │
│    scheduler: Scheduler  → 详见 scheduler-design
└──────────────────────────────────────────────┘
```

Scheduler 是 Server 内部的 per-space 组件，负责跨 Session 协调（切换检测、integration 调度、onSwitch consolidation 触发）。详细职责和流程见 **scheduler-design** skill。

---

## 5. HTTP API

所有接口在 `spaceId` 下，一个 space = 一棵拓扑树。

### 对话（WebSocket）

```
WS /spaces/:spaceId/sessions/:sessionId
  → 建立连接 → 创建 Engine
  → 双向消息：
    client → server: { type: 'message', content: '...' }
    server → client: { type: 'chunk', content: '...' }      // 流式
    server → client: { type: 'turnComplete', result: ... }
    server → client: { type: 'insight', content: '...' }     // 推送
    server → client: { type: 'consolidated', sessionId }
  → 断开连接 → 销毁 Engine → 触发 leave 钩子
```

### 管理接口（REST）

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/spaces/:spaceId/sessions` | 返回树状列表（id, parentId, label） |
| `POST` | `/spaces/:spaceId/sessions` | 创建子 Session |
| `GET` | `/spaces/:spaceId/sessions/:id` | Session 详情 |
| `POST` | `/spaces/:spaceId/sessions/:id/fork` | fork Session |
| `DELETE` | `/spaces/:spaceId/sessions/:id` | 归档 Session |
| `POST` | `/spaces/:spaceId/main/messages` | Main Session 对话 |
| `POST` | `/spaces/:spaceId/main/integrate` | 手动触发 integration |
| `GET` | `/spaces/:spaceId/main/synthesis` | 读取 synthesis |
| `GET` | `/spaces/:spaceId/kv/:key` | 全局键值读 |
| `PUT` | `/spaces/:spaceId/kv/:key` | 全局键值写 |

### 对话走 WS，管理走 REST

- 用户在 Session 页面的持续对话 → WebSocket（Engine 生命周期绑定）
- 前端获取列表、创建 Session、读取状态 → REST（无状态，简单）
- Main Session 对话也可走 WS（同样创建 Engine）

---

## 6. 业界对比

### Engine 生命周期模型

| 模式 | 框架 | Stello |
|------|------|--------|
| 无状态单例，state from storage per request | LangGraph, OpenAI, Mastra | — |
| Per-session-round，WS 绑定 | ChatGPT Web, Discord | **采用** |

Stello 选择 per-session-round 的原因：
- 有前端 UI（星空图），不是纯 API 服务
- 需要 Round 生命周期边界（consolidation 挂在轮上）
- WS 天然提供 enter/leave 信号
- Engine 可缓存 session 上下文，避免每轮重复加载

### 如果未来需要纯 REST 模式

保留 Engine 的 per-turn 无状态使用方式作为降级路径：
- 不建立 WS → 每次 REST 请求临时创建 Engine → turn() → 销毁
- 退化为 LangGraph 模式，switch 检测靠 `lastActiveSessionId` 持久化到 storage
- 不推荐但可行
