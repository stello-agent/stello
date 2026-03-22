---
name: scheduler-design
description: Scheduler（Coordinator）职责定义：跨 Session 协调器。管理 Session 切换检测、integration 调度、Engine 生命周期、topology 维护。
---

# Scheduler — 跨 Session 协调器

> 状态：**设计草案**（2026-03-22）

---

## 定位

Scheduler 是**树级跨 Session 协调组件**，运行在 Server 内部，per space 一个实例。

- Session = 一次 LLM 调用（原子操作）
- Engine = 一个 Session 的多轮对话（per-session-round）
- **Scheduler = 跨 Session 协调**（切换检测、integration、topology）
- Server = HTTP/WS 服务层（管理连接、路由请求）

Scheduler 不直接和 LLM 交互，不做 turn()，不做 tool call。它监听 Engine 事件，协调跨 Session 的副作用。

---

## Scheduler 做什么

| 职责 | 说明 |
|------|------|
| **Session 切换检测** | 用户从 Session A 切换到 Session B 时识别 switch 事件 |
| **onSwitch consolidation 触发** | 检测到切换 → 调用旧 Engine 的 consolidate() → 销毁旧 Engine |
| **Integration 调度** | 根据配置的触发时机决定何时调用 main.integrate() |
| **Insight 推送** | integration 完成后，将 insights 写入各子 Session storage，并通知活跃 Engine |
| **Engine 生命周期协助** | 协助 Server 管理 Engine 创建/销毁的时序（确保先 consolidate 再销毁） |

## Scheduler 不做什么

| 不做 | 由谁做 |
|------|--------|
| LLM 对话 | Engine → Session |
| Tool call 循环 | Engine |
| everyNTurns consolidation | Engine 内部 |
| WS 连接管理 | Server |
| HTTP 路由 | Server |

---

## 核心协调流程

### Session 切换

```
用户从 Session A 页面切换到 Session B
  → WS(A) close
  → Server 通知 Scheduler: 用户离开 Session A
  → Scheduler:
      1. onSwitch consolidation? → engine(A).consolidate()
      2. consolidation 完成 → engine(A).destroy()
      3. 记录 lastActiveSessionId = B
  → WS(B) open
  → Server 创建 Engine(B)
```

### Integration 调度

Scheduler 监听 Engine 的 `consolidated` 事件，决定是否触发 integration：

```
Engine(A) emit 'consolidated'
  → Scheduler 收到
  → shouldIntegrate('afterConsolidate')?
    → mainSession.integrate(fn)
    → integration 产出 synthesis + per-child insights
    → 写入各子 Session 的 insight storage
    → 活跃的 Engine 收到 receiveInsight()
```

### Integration 触发时机

| 触发器 | 时机 | 说明 |
|--------|------|------|
| afterConsolidate | 任何子 Session consolidation 完成后 | 最常用，形成 consolidation → integration 链 |
| onSwitch | 用户切换到 Main Session 时 | 确保 Main Session 对话时 synthesis 最新 |
| everyNTurns | Main Session 每 N 轮对话后 | 适合 Main Session 高频使用场景 |
| manual | 仅 API 手动触发 | 完全由应用层控制 |

### afterConsolidate 联动链

```
turn 完成
  → Engine: consolidation (fire-and-forget)
    → consolidation 完成 → Engine emit 'consolidated'
      → Scheduler: integration (fire-and-forget)
        → synthesis 更新 + insights 推送
```

整个链条不阻塞 turn() 返回。

---

## 状态

Scheduler 维护少量运行时状态：

| 状态 | 用途 |
|------|------|
| activeEngines: Map<sessionId, Engine> | 当前活跃的 Engine，用于 insight 推送 |
| lastActiveSessionId | 用于 onSwitch 检测 |

无持久化需求——Scheduler 重启后从 activeEngines 为空开始，不影响正确性（只是错过一次 onSwitch）。

---

## 与 Server 的关系

Scheduler 是 Server 内部的组件，不对外暴露 HTTP 接口。Server 在以下时机调用 Scheduler：

| Server 事件 | Scheduler 动作 |
|-------------|---------------|
| WS connect (新 Session) | 注册 Engine 到 activeEngines |
| WS close | 触发 switch 检测 → consolidation → 销毁 Engine |
| REST: POST /main/integrate | 手动触发 integration |
| REST: DELETE /sessions/:id | 触发 onArchive consolidation |

---

## 与 Engine 的关系

Scheduler 不继承 Engine，不扩展 Engine。二者通过事件通信：

- **Scheduler → Engine**：consolidate()、receiveInsight()、destroy()
- **Engine → Scheduler**：emit turnComplete / consolidated / error

---

## 设计决策

### 为什么不把 Scheduler 职责放在 Engine 里

旧设计中 Engine 是树级单例，承担了切换检测和 integration。但这违反单一职责：

1. Engine 管理单 Session 的对话循环 ≠ 跨 Session 协调
2. per-session-round Engine 不知道其他 Session 的存在
3. Integration 需要 MainStorage（getAllSessionL2s），普通 Engine 只有 SessionStorage

分离后：Engine 纯粹，Scheduler 专注协调，各自可独立测试。

### 为什么 Scheduler 是 per-space

一个 space = 一棵拓扑树 = 一个 Scheduler。不同 space 之间完全隔离，Scheduler 无需全局状态。

### Integration 的所有 L2 通过 storage 收集

Scheduler 不缓存 L2。每次 integration 通过 `mainStorage.getAllSessionL2s()` 从 storage 获取最新数据。这保证一致性，代价是一次批量读取（可接受）。
