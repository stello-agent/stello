---
name: scheduler-design
description: Scheduler 职责定义：调度策略组件，判断 consolidation / integration 的触发时机。由 Factory 持有，通过闭包注入 Engine hooks。
---

# Scheduler — 调度策略组件

## 定位

Scheduler 是纯粹的**调度策略判断器**，不直接驱动对话，不持有 Engine 引用。

- Scheduler 判断「何时触发 consolidate / integrate」
- Factory 持有 Scheduler + MainSession，构建闭包注入 Engine hooks
- Engine 在事件点 fire-and-forget 调用 hooks，不知道 Scheduler 存在

---

## Scheduler 做什么 / 不做什么

**做**：根据配置的触发时机（everyNTurns / onSwitch / onArchive / onLeave / manual）判断是否执行 consolidation 和 integration

**不做**：持有 Engine 引用、驱动对话、管理 WS 连接、维护 topology

---

## 调度触发时机

| 事件点 | Scheduler 方法 | Factory 注入的 hook |
|--------|---------------|-------------------|
| turn 结束 | afterTurn() | onRoundEnd |
| session 离开 | onSessionLeave() | onSessionLeave |
| session 归档 | onSessionArchive() | onSessionArchive |
| session 切换 | onSessionSwitch() | （未来由 Orchestrator 调用） |

---

## 与 Factory 的关系

Factory 是 Scheduler 和 Engine 之间的桥梁：

- Factory 持有 Scheduler 和 MainSession
- Factory 在 create() 时调用 buildSchedulerHooks(session) 构建闭包
- 闭包通过 mergeHooks() 与用户 hooks 合并后注入 Engine
- 用户 hooks 和 Scheduler hooks 同一 key 下都能触发

---

## 核心设计决策

### 从 Engine 解耦到 Factory

Engine 之前直接 await scheduler.afterTurn()，违反 fire-and-forget 原则。现在 Scheduler 通过 Factory 闭包注入，Engine 完全不知道调度的存在。

### afterConsolidate 联动链

consolidation 完成 → integration 触发（如果配置了 afterConsolidate）。整个链条通过 Scheduler 内部逻辑串联，不阻塞 turn() 返回。

### 错误处理

Scheduler 闭包内的错误被 `.catch(() => {})` 静默吞掉。Scheduler 自身的 run() 方法会捕获 consolidate/integrate 错误并记录在 SchedulerResult.errors 中。
