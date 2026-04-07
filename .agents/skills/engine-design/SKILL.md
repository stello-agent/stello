---
name: engine-design
description: Engine 职责定义：per-session-round 生命周期管理器。驱动 tool call 循环，管理单个 Session 的多轮对话。不感知树结构，不感知调度。
---

# Engine — Per-Session-Round 生命周期管理器

## 定位

Engine 是 Session 原语之上的**单 Session 多轮对话管理器**。

- Session = 一次 LLM 调用（原子操作）
- Engine = 一个 Session 的整轮交互生命周期（多次 turn，含 tool call 循环）
- Scheduler = 调度策略（consolidation / integration 触发时机判断）
- Factory = 装配层（构建 Engine，注入 Scheduler 闭包）

Engine 不感知树结构，不知道其他 Session 的存在，**也不知道 Scheduler 的存在**。

---

## Engine 做什么 / 不做什么

**做**：tool call 循环、hooks fire-and-forget、生命周期边界（enter/leave/archive/fork）、fork 编排（拓扑 + session 创建）、内置 tool 拦截（stello_create_session / activate_skill）、error 事件 emit

**不做**：调度判断（由 Scheduler 通过 Factory 注入闭包）、持有 Scheduler 或 MainSession、Session 切换检测（Orchestrator）、多 Session 管理

---

## 核心设计决策

### Engine 接管 Fork 编排

Engine 负责 fork 的完整编排：创建拓扑节点（topology-first，生成 ID）→ 调用 `session.fork({ id, ... })` 创建 session 实例 → 触发事件。session.fork() 天然处理 systemPrompt 继承、context 继承（含 contextFn）、prompt 写入、LLM/tools 覆盖。Orchestrator 分离"拓扑父节点"（策略决定）与"fork 来源 session"（继承内容来源）。

内置 tool（stello_create_session、activate_skill）由 Engine 在 executeTool 中拦截，不透传给用户工具运行时。LLM 调用 stello_create_session 时，Engine 先解析 ForkProfile（如有），合成 systemPrompt，profile 的 contextFn/llm/tools 直接映射到 fork 选项，再走 forkSession 完整路径。

### 工具注册与内置工具

Engine 管理两类工具：内置工具（自动注入，Engine 拦截执行）和用户工具（通过 ToolRegistry 注册，Engine 透传执行）。getToolDefinitions 合并两者，内置 tool 优先。

### Engine 与 Scheduler 解耦

Engine 不持有 Scheduler 和 MainSession。Factory 持有二者，构建闭包注入 EngineHooks。Engine 在事件点 fire-and-forget 调用 hooks，不知道背后有调度。

### turn() 返回值

`EngineTurnResult` 只包含 `{ turn }`。调度是 fire-and-forget 的内部副作用，结果对调用方不可见。

### 所有 hooks fire-and-forget

hooks 抛错时 emit error 事件 + 调用 onError hook，不中断对话周期。Scheduler 闭包失败同理。

### Factory 合并 hooks

用户 hooks 和 Scheduler hooks 在同一 key 下都能触发，由 Factory 的 mergeHooks 保证。

---

## 错误处理原则

- session.send() 失败 → 向上抛出（核心路径）
- tool.execute() 失败 → 错误信息作为 tool result 返回给 LLM，继续循环
- hook / Scheduler 闭包失败 → emit error，不影响 turn() 返回

---

## Streaming + Tool Call 策略

- 无工具：session.stream() 直接逐 chunk 输出
- 有工具：中间轮用 session.send()（非流式），末轮内容一次性返回
