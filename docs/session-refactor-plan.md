# Session 改造计划

## 目标

当前 `StelloEngine` 的编排层骨架已经跑通，也已经能接真实 LLM 做 demo 验证。

下一阶段的重点，不是继续堆更多入口，而是把 `Session` 真正做成符合设计规范的自治组件。

这份文档用于整理从“当前 demo 形态”到“设计规范形态”的改造路径。

---

## 当前状态

当前已经具备：

- `TurnRunner`：负责单个 session 的 tool loop
- `Scheduler`：负责 `consolidate / integrate` 的触发时机
- `StelloEngineImpl`：负责 `turn / fork / switch / archive` 等编排入口
- `engine-openai-demo.ts`：可以接真实 LLM 跑通主流程

但当前仍然存在这些偏差：

- Session 还不是完整自治组件
- 单条对话和一整轮对话的边界还没完全落地
- 默认 summary 还没有真正按“轮”执行
- 生命周期钩子体系还不够完整
- demo 仍然偏“验证脚本”，还不是半真实产品结构

---

## 总体改造方向

核心原则只有一句话：

**让 Session 负责自己的事情，让 Engine 只负责编排。**

也就是：

- Session 负责自己的记忆、上下文、单条对话
- Engine 负责树、入口切换、时序、调度、事件

---

## 改造步骤

## 1. 先把 Session 做成真正自治组件

### 目标

让 session 不再只是“对 LLM 发一次请求的包装层”，而是成为独立的对话组件。

### 当前问题

现在 demo 里的 runtime session 主要只做了两件事：

- `send()`
- `consolidate()`

但它还没有真正管理这些数据：

- 历史消息
- session memory
- summary
- task 状态
- context 输入

### 需要补的能力

- session 自己维护对话记录
- session 自己维护 memory / summary / task state
- session 自己组装上下文
- session 自己处理 tool result 回灌
- session 对外只暴露稳定的 `send()` / `consolidate()` / 读取能力

### 改造结果

做完这一层后，session 才真正符合“组件化”的设计要求。

---

## 2. 明确“单条”与“整轮”的生命周期

### 目标

把设计讨论里的两个粒度明确落到代码里。

### 建议定义

- 单条对话：用户发一条，LLM 回一条
- 一整轮对话：用户进入某个 session 开始持续交流，直到离开该 session

### 当前问题

现在 engine 已经有：

- `turn()`
- `switchSession()`
- `archiveSession()`

但“round”这个概念还没有被显式建模。

### 建议新增的生命周期事件

- `onSessionEnter`
- `onMessage`
- `onAssistantReply`
- `onSessionLeave`
- `onRoundEnd`

### 改造结果

做完这一层后，summary、consolidate、leave hook 等逻辑都会更自然。

---

## 3. 把 summary / consolidate 默认策略切到“按轮”

### 目标

让默认实现符合设计规范：**默认按轮，不按条**。

### 原因

- 按条 summary 会导致 LLM 调用频率过高
- token 成本容易爆炸
- 对大多数场景来说，用户离开 session 或 round 结束后再总结更合理

### 当前问题

虽然 `Scheduler` 已经有调度结构，但真实 demo 里并没有体现“默认按轮 consolidate”。

### 建议默认触发点

- session leave
- session switch
- session archive
- 明确的 round end

### 允许的扩展

框架层仍然应该允许：

- 开发者显式配置成按条 summary
- 开发者自己接管 consolidate 时机

### 改造结果

做完这一层后，默认行为才真正贴近讨论中确定的设计原则。

---

## 4. 补齐钩子体系，但第一版只实现最小默认行为

### 目标

贯彻“钩子优先、扩展点先留出来”的原则。

### 当前问题

现在已经有一些主流程入口，但还不是一个完整的 hooks-first 架构。

### 建议预留的钩子

- `onTurnStart`
- `onTurnEnd`
- `onSessionEnter`
- `onSessionLeave`
- `onRoundStart`
- `onRoundEnd`
- `onFork`
- `onArchive`
- `onConsolidate`
- `onIntegrate`

### 注意

第一版不需要全部做复杂默认实现。

重点是：

- 先定义好可扩展点
- 默认逻辑只覆盖当前业务所需
- 保证后续扩展是非破坏性的

### 改造结果

做完这一层后，SDK 的可扩展性会大幅提高。

---

## 5. 把 demo 从“验证脚本”升级成“半真实实现”

### 目标

让 demo 不只是验证编排链路，而是开始体现未来产品结构。

### 当前问题

现在 `engine-openai-demo.ts` 已经能跑真实 LLM，但仍然是：

- 真实模型
- 最小 in-memory tree
- 最小 lifecycle
- 最小 split guard

它更像验证脚本，不像“可参考实现”。

### 建议升级方向

- tree 继续真实维护 `sessionId`
- session 改成真正自治对象
- engine 只通过 `sessionId + resolver` 找 session
- summary/consolidate 改成按轮触发
- child session 的 scope/prompt 由 session 内部吸收

### 改造结果

做完这一层后，demo 会更像真实产品实现，而不是纯演示脚本。

---

## 推荐执行顺序

建议按下面顺序推进：

1. 先改 session，让它自管 history / context / memory
2. 再补 round lifecycle
3. 再让 scheduler 默认按 round consolidate
4. 再补 hooks
5. 最后升级 demo

原因：

- session 自治是核心地基
- round 和 summary 都依赖 session 的内部状态
- hooks 和 demo 应该建立在前面两层稳定之后

---

## 每一步的验收标准

## Step 1: Session 自治

验收标准：

- session 内部能保存自己的消息历史
- session 内部能自己组装 prompt/context
- engine 不再负责拼 session 内部 prompt

## Step 2: round 生命周期

验收标准：

- 代码中明确存在 round 相关概念
- 能区分单条消息事件和整轮结束事件

## Step 3: 默认按轮 summary

验收标准：

- 默认配置下，不会每条消息都触发 consolidate
- session leave / switch / archive 时会触发 consolidate

## Step 4: hooks 体系

验收标准：

- hooks 接口稳定
- 新增钩子不会破坏现有默认逻辑

## Step 5: demo 升级

验收标准：

- demo 不再依赖过多硬编码 prompt 拼装
- demo 能更真实体现 session/tree/engine 的职责分层

---

## 一句话总结

接下来的重点不是继续给 `Engine` 加更多方法，而是：

**把 Session 从“轻量 LLM wrapper”升级成“真正自治的对话组件”。**

这一步做好之后：

- Session 与树的解耦会更彻底
- 按轮 summary 会更自然
- hooks 扩展会更顺
- demo 也会更接近真正的 Stello 设计目标
