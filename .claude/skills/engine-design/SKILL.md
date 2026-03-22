---
name: engine-design
description: Engine 职责定义：per-session-round 生命周期管理器。持有 WS 连接，驱动 tool call 循环，管理单个 Session 的多轮对话。不感知树结构。
---

# Engine — Per-Session-Round 生命周期管理器

> 状态：**设计草案**（2026-03-22）

---

## 定位

Engine 是 Session 原语之上的**单 Session 多轮对话管理器**。

- Session = 一次 LLM 调用（原子操作）
- Engine = 一个 Session 的整轮交互生命周期（多次 turn，含 tool call 循环）
- Scheduler = 跨 Session 协调（切换检测、integration、topology）

Engine 不感知树结构，不知道其他 Session 的存在。它只管好「用户进入一个 Session → 多轮对话 → 用户离开」这段生命周期。

---

## 生命周期

Engine 与 WS 连接绑定，由 Server 创建和销毁：

```
用户打开 Session 页面 → WS connect → Server 创建 Engine
  ├─ 用户发消息 → engine.turn() → tool call 循环 → 响应
  ├─ 用户发消息 → engine.turn() → ...
  ├─ Scheduler 推送 insight → engine.receiveInsight()
  └─ 用户离开 → WS close → Server 销毁 Engine
```

Engine 在创建时从 storage 加载 session 上下文，后续 turn 使用缓存，不重复加载。

---

## Engine 做什么

| 职责 | 说明 |
|------|------|
| **turn()** | 接收用户输入 → tool call 循环（多次 session.send()）→ 返回最终结果 |
| **turnStream()** | 流式变体：无工具时直接流式，有工具时中间轮非流式 |
| **Tool call 循环** | send → 有 toolCalls? → 执行工具 → send(结果) → 直到无 toolCalls |
| **该 Session 的 consolidation 调度** | everyNTurns / onArchive / manual 三种时机，fire-and-forget |
| **接收 insight** | Scheduler 推送 insight 后更新 session，下次 turn 自动生效 |
| **事件 emit（向上）** | turnComplete / consolidated / error，供 Server / Scheduler 监听 |
| **destroy** | 释放缓存，由 Server 在 WS close 时调用 |

## Engine 不做什么

| 不做 | 由谁做 |
|------|--------|
| Session 切换检测 | Scheduler |
| Integration 调度 | Scheduler |
| onSwitch consolidation 触发 | Scheduler（检测到切换后调用 engine.consolidate()） |
| Topology 管理 | Scheduler / Server |
| Engine 创建/销毁 | Server |
| 多 Session 管理 | Scheduler |
| 上下文组装规则 | Session 层内部 |
| L3 写入 | Session 层内部 |
| turnCount 维护 | Session 层内部 |

---

## 关键设计决策

### turn() 不接受 sessionId

Engine 绑定到特定 Session，`turn(input)` 不需要 sessionId 参数。这与旧设计（Engine 作为树级单例，`turn(sessionId, input)`）的根本区别。

### Consolidation 触发的分工

- **Engine 内部判断**：everyNTurns（turn 完成后检查）、onArchive（归档时）、manual
- **Scheduler 外部触发**：onSwitch（Scheduler 检测到用户切换 Session，调用旧 Engine 的 consolidate() 后再销毁）

### 事件只向上 emit

Engine 发出 turnComplete / consolidated / error，由 Server / Scheduler 监听。跨 Session 事件（sessionSwitched、integrated、sessionCreated）不是 Engine 的职责。

### 内存开销

空闲 Engine（用户阅读中）≈ 10-50 KB（WS fd + session 引用）。10,000 并发 ≈ 100-500 MB。瓶颈在 LLM 调用，不在 Engine 内存。设 30 分钟超时回收僵尸 Engine。

---

## 包结构

```
@stello-ai/session  ← Session 层（已实现）
@stello-ai/engine   ← Engine（本文档）
@stello-ai/server   ← Server + Scheduler
```

Engine 只依赖 Session。Server 依赖 Engine。

---

## 与 Scheduler 的交互

```
Scheduler 创建 Engine(sessionId)
  ↓
Engine emit 'turnComplete' → Scheduler 可用于统计
Engine emit 'consolidated' → Scheduler 判断是否触发 integration
Engine emit 'error' → Scheduler 记录日志
  ↓
Scheduler 检测到用户切换 → 调用 engine.consolidate() → engine.destroy()
Scheduler 完成 integration → 调用 engine.receiveInsight()
```

---

## 错误处理原则

- session.send() 失败 → 向上抛出，turn() 失败（核心路径）
- tool.execute() 失败 → 捕获，错误信息作为 tool result 返回给 LLM，继续循环
- consolidate() 失败 → 捕获，emit error 事件，不影响 turn() 返回

回调失败不中断对话周期，只降低记忆质量。

---

## Streaming + Tool Call 策略

- 无工具：session.stream() 直接逐 chunk 输出
- 有工具：中间轮用 session.send()（非流式），末轮内容一次性返回
- v0.2 不做末轮流式优化（判断"最后一轮"需要投机执行，复杂度高）
