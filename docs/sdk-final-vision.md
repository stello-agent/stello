# Stello 库 / Server / SDK 最终形态设想

## 文档目的

这份文档不是当前实现说明，而是 Stello 最终形态的目标设计稿。

用途：

- 对齐团队对最终形态的理解
- 作为后续架构演进的参考基线
- 明确哪些能力属于库，哪些能力属于编排层，哪些能力属于更高层 Server / SDK

这份文档允许被持续修订。

当前原则是：

- 先把目标形态讲清楚
- 不被现有实现绑定
- 不以“目前能不能做”为前提，而以“最终应该怎样设计”为前提

---

## 一、术语约定

为了避免概念混用，后续统一采用下面这套术语。

### 1. 库

“库”指面向开发者、直接在本地代码中使用的语言绑定实现。

当前主要是：

- TypeScript 库
- Session / Engine / Scheduler / Tree / Memory / Hooks 等组件

这些能力都是库，不是 SDK。

### 2. Server

“Server”指真正对外提供 HTTP / WebSocket 服务的服务端实现。

它负责把底层库能力服务化。

### 3. SDK

“SDK”只指最高层那个面向 Server API 的薄客户端封装。

也就是说：

- 最终会有一个 Server
- Server 提供 HTTP / WebSocket 接口
- SDK 是对这些接口的薄封装
- SDK 是跨语言概念，不和某个具体语言绑定

例如未来可能存在：

- TypeScript SDK
- Python SDK
- Go SDK

它们都只是封装同一套服务接口。

后续文档中：

- 讲 Session / Engine / Tree / Hooks 时，优先使用“库”
- 讲 HTTP / WS 客户端封装时，使用“SDK”

---

## 二、Stello 是什么

Stello 是一个面向 AI Agent / AI 应用的会话拓扑系统。

它解决的不是单个 chat 对话，而是：

- 如何把线性对话拆成树状 Session
- 如何让每个 Session 成为独立自治的能力单元
- 如何让上层编排层管理这些 Session 的生命周期
- 如何在不同 Session 之间做信息继承、聚合、切换和归档

Stello 的核心目标不是提供某个固定 Agent，而是提供一套可嵌入、可组合、可扩展的会话编排能力。

---

## 三、核心设计原则

### 1. Session 组件化

Session 是 Stello 的原子单元。

每个 Session 都应该是一个独立组件，具备自己的：

- 对话状态
- 记忆状态
- 上下文组装逻辑
- LLM 调用入口
- 任务状态 / 摘要 / 内部元信息

Session 不是树结构节点本身，而是可被树结构引用的对话组件。

### 2. Session 与 Session Tree 解耦

Session 本身不感知自己位于树中的什么位置。

它不应该把以下内容作为自身运行时职责的一部分：

- `parentId`
- `depth`
- sibling 信息
- 整棵树的结构信息

这些信息应由 Session Tree / Topology 管理。

Session 自己只需要一个稳定身份：

- `sessionId`

编排层和服务层通过 `sessionId` 找到对应 Session 组件并与之交互。

补充原则：

- 库不应该把 Topology 的编排方式写死
- 最终推荐由库使用者自己决定如何组织 Session Tree / Topology
- 库只提供少量默认编排范式，作为开箱即用方案

### 3. Session 负责单条，编排层负责整轮

必须明确区分两个粒度：

- 单条对话：用户发一条，LLM 回一条
- 一整轮对话：用户进入某个 Session 开始持续交流，直到离开该 Session

设计上：

- Session 只负责“单条”
- 编排层负责“整轮”

也就是说：

- `session.send()` 是原子行为
- `turn / fork / archive / round end` 是编排层行为

### 4. 默认按轮总结，不按条总结

summary / consolidate / memory update 的默认粒度应该是“轮”。

原因：

- 降低 token 成本
- 降低 LLM 调用频率
- 更符合用户使用习惯

但扩展上应允许：

- 某些开发者选择按条更新 summary
- 某些开发者自己接管 consolidate 时机

### 5. Session 粒度独立配置

每个 Session 最终都应该允许按 Session 粒度独立初始化能力配置。

至少应支持按 Session 粒度传入：

- MCP
- tools
- skills
- system prompt
- memory 策略
- summary / consolidate 策略

这意味着不同 Session 可以拥有不同的：

- 外部能力接入方式
- 工具集
- 技能集
- prompt 风格
- 记忆策略

### 6. hooks-first

Stello 的架构应优先保留足够多的生命周期钩子。

原则：

- 第一版只实现当前需要的默认逻辑
- 但架构层面尽量把潜在扩展点留出来
- 后续扩展应尽量非破坏性

---

## 四、最终的五层结构

最终建议的 Stello 结构分成五层。

### 1. Session Layer

这一层只关心单个 Session 组件本身。

职责：

- 维护自己的消息历史
- 维护自己的记忆状态
- 维护自己的任务状态与摘要
- 组装自己的上下文
- 发起单次 LLM 对话
- 输出单次响应结果

不负责：

- 整棵树
- 全局调度
- 多 Session 切换
- 多轮 tool loop

### 2. Orchestration Layer

这一层只关心多个 Session 的编排。

职责：

- 通过 `sessionId` 找到对应 Session 或 Engine
- 驱动单个 Session 的整轮对话周期
- 驱动 tool loop
- 管理 fork / leave / archive / consolidate / integrate
- 触发各类生命周期钩子
- 管理“单条”和“整轮”之间的边界
- 保证同 Session 串行、跨 Session 并行

不负责：

- Session 内部的具体上下文拼装细节
- Session 内部的记忆具体实现

### 3. Application Layer

这一层由库使用者注入业务能力。

职责：

- 存储适配器
- LLM 适配器
- Memory 策略
- Consolidate / Integrate 策略
- Tool 定义
- MCP 定义
- Skills 定义
- 业务钩子

这一层的目标是让开发者决定：

- 使用哪个模型
- 用什么存储
- 用什么总结策略
- 用什么工具系统
- 每个 Session 具体加载什么能力

### 4. Server / Service Layer

这是更高层的服务封装。

职责：

- 提供 HTTP / WebSocket 接口
- 提供 `GET /sessions/:id` 之类的入口
- 管理用户连接、进入 Session、退出 Session
- 将用户行为转换成编排层事件

这一层不应该反向污染底层 Session 设计。

### 5. SDK Layer

这一层建立在 Server 之上，是对 HTTP / WebSocket 接口的薄客户端封装。

职责：

- 封装远程 API 调用
- 提供更顺手的语言调用方式
- 屏蔽传输层细节

不负责：

- 重新定义 Session 语义
- 重新定义编排层语义
- 重新实现 Session / Engine 逻辑

最终推荐理解为：

- 库：面向开发者的本地语言实现
- Server：真正对外暴露服务接口
- SDK：对 Server 接口的薄封装

---

## 五、最终的 Session 设计

### 1. Session 的身份

Session 的唯一身份是：

- `sessionId`

Session 应该可以被任意上层通过 `sessionId` 获取。

例如服务层未来完全可以提供：

- `GET /sessions/:id`
- `POST /sessions/:id/messages`
- `WS /sessions/:id`

这样 Session Tree 是否变化，对 Session 本体没有影响。

### 2. Session 的核心职责

最终的 Session 应该至少能做到：

- `send(input)`：执行一次单条 LLM 对话
- `stream(input)`：执行一次流式单条对话
- `messages()`：读取自己的历史消息
- `memory()`：读取自己的记忆摘要
- `consolidate()`：生成或更新自己的摘要
- `state()`：读取自己的任务状态、过程状态、结构化状态
- `context()`：读取当前上下文组装结果

### 3. Session 自己应该维护什么

最终应由 Session 自己维护：

- 原始消息记录
- 当前上下文所需的内部状态
- summary / memory
- 当前任务状态
- 当前阶段状态

### 4. Session 不应该维护什么

最终不应由 Session 维护：

- parent / child 拓扑关系
- 全局 active session 指针
- 归档整棵树的策略
- 跨 Session 编排逻辑
- 全局 synthesis

---

## 六、最终的 Session Tree / Topology 设计

Session Tree 的职责是：

- 维护 Session 节点关系
- 维护 `parent / child / refs`
- 维护可视化所需元信息
- 支持通过 `sessionId` 找到节点

但 Session Tree：

- 不负责 Session 内部逻辑
- 不应该替用户决定唯一的编排模式

三者边界如下：

| 组件 | 回答的问题 |
|---|---|
| Tree / Topology | 树长什么样 |
| Session | 我自己怎么对话 |
| Engine | 什么时候和谁对话 |

### 最终推荐

最终推荐把 Topology 编排权交给库使用者。

也就是说：

- 库提供 tree / topology 的抽象和基础能力
- 库使用者决定自己的 Session 组织方式
- 库不把某一种拓扑结构写死成唯一模式

### 库可以提供的两种默认编排范式

虽然最终推荐用户自己编排，但库可以提供两种默认范式，作为开箱即用模板。

#### 范式 A：MainSession - 平铺子节点

适用场景：

- 中心协调型 agent
- 多 skill / 多 topic 并列分支
- MainSession 统一看所有子 Session 的产出

特点：

- 一个 MainSession 作为中心
- 下挂多个平铺子 Session
- 子 Session 默认互不感知
- MainSession 负责汇总和下发 insight

#### 范式 B：树结构 - 层叠式 OKR 汇报结构

适用场景：

- 目标分解
- 多层任务拆分
- 项目管理 / 汇报链

特点：

- 上层 Session 代表更抽象目标
- 下层 Session 代表更具体任务
- 汇报和 summary 沿层级逐步上卷
- 更适合层级式目标推进，而不是平铺技能调用

当前状态：

- 这一范式在设计上已经成立
- 代码里已预留策略接口 TODO
- 具体实现暂未落地

---

## 七、编排层 Engine 与 Orchestrator 的最终形态

编排层最终建议拆成两层，而不是只围绕一个全局 Engine。

### 1. Session Engine

例如：

- `StelloEngine`

它只绑定一个 Session runtime，负责：

- 驱动当前 Session 的单条对话
- 驱动当前 Session 的 tool loop
- 管理当前 Session 的 `enter / leave / fork / archive`
- 判断当前 Session round 的开始与结束
- 触发当前 Session 的 hooks
- 在当前 Session 范围内调度 `consolidate / integrate`

建议保留这些核心入口：

- `turn(input)`
- `enterSession()`
- `leaveSession()`
- `forkSession(options)`
- `archiveSession()`

### 2. Multi-Session Orchestrator

例如：

- `StelloAgent`
- `SessionOrchestrator`
- `DefaultEngineFactory`

它负责：

- 作为 core 对外推荐的最高层对象
- 通过 `sessionId` 找到对应 Engine
- 协调多个 Session / Engine
- 保证同 Session 串行、跨 Session 并行
- 提供多 Session 的高层入口

例如：

- `enterSession(sessionId)`
- `turn(sessionId, input)`
- `leaveSession(sessionId)`
- `forkSession(sessionId, options)`
- `archiveSession(sessionId)`

强调一点：

- Engine 是单 Session 生命周期编排器
- `StelloAgent` 是当前 core 推荐的顶层门面对象
- Orchestrator 才是多 Session 协调器
- 但 Orchestrator 也不应该替用户决定唯一的 topology 组织方式

---

## 八、单条对话 与 整轮对话

| 粒度 | 定义 | 谁负责 |
|---|---|---|
| 单条对话 | 用户发一条，LLM 回一条，中间可含工具循环 | Session + Engine tool loop |
| 一整轮对话 | 用户进入某个 Session 后的持续交流，直到离开 | 编排层 |

为什么必须区分：

- summary 更适合挂在“轮”上
- consolidate 更适合挂在“轮”上
- round end 事件必须有明确归属
- 任务阶段收尾和资源释放也应挂在“轮”上

---

## 九、Memory 设计

### 1. Session 内部 memory

每个 Session 应维护自己的：

- 原始消息
- summary
- 当前任务状态
- 当前上下文状态

### 2. 上层读取什么

上层需要看的不是 Session 所有内部细节，而是可提取结果，例如：

- session summary
- task status
- current objective
- output artifact

也就是说：

- Session 内部可以复杂
- 上层读取的应该是稳定提取接口

### 3. 默认 summary 粒度

默认建议：

- 按轮做

允许扩展：

- 按条做
- 手动触发
- 外部接管

---

## 十、Tool Loop 的定位

Tool loop 不属于 Session 本体。

原因：

- Tool loop 不是单次 LLM 调用，而是多次来回
- Tool loop 更接近编排逻辑
- Tool loop 需要统一接管工具执行与限制策略

因此：

- Session 负责单次 `send`
- Engine 负责多轮 `send + executeTool`

### 补充：LLM 工具调用的语义

在最终形态里，LLM 并不是“自己真的去执行工具”，而只是**表达工具调用意图**。

更准确地说：

- 发给 LLM 的输入中，会声明可用工具
- LLM 返回的输出中，会包含工具调用信息
- 真正的工具执行由 Engine 负责

也就是说，工具调用的完整链路是：

1. Engine 组织 prompt，并把 tools 声明一并交给 LLM
2. Session 负责执行单次 LLM 调用
3. LLM 返回结果，其中可能包含工具调用字段
4. Engine 解析这些工具调用字段
5. Engine 执行对应工具
6. Engine 再把工具结果重新喂给 Session，进入下一次单条调用

所以从 Session 组件自己的视角来看，它仍然可以被抽象成：

- 接受一个字符串
- 返回一个字符串

只是这个字符串中，可能带有结构化的工具调用信息。

### Session 在工具调用中的角色

Session 在工具调用这件事上，本质上仍然只是一个 call LLM 的代理。

它额外负责：

- 维护自己的 L2 记忆
- 执行从 L3 到 L2 的 consolidate

但它不负责：

- 解析工具调用协议
- 实际执行工具
- 决定工具调用后的下一步调度

这些职责都应该在 Engine。

### Engine 在工具调用中的角色

Engine 是工具调用协议的真正执行者。

它负责：

- 解析 LLM 输出里的工具调用字段
- 调用对应工具
- 把工具结果重新注入后续对话
- 控制 tool loop 的轮次、异常和终止条件

因此，工具调用协议本质上属于编排层，而不是 Session 层。

### Session 自动分叉本质上也是工具调用

后续的 Session 自动分叉，也可以被理解为一种特殊工具调用。

也就是说：

- LLM 在输出里表达“应该创建新 Session / fork”
- Engine 识别到这个工具调用
- Engine 调用 Session 或 Tree 对应的 fork 接口
- 再继续后续编排

因此：

- `fork` 不应该是 Session 自己偷偷做的事
- `fork` 应该是 Engine 在处理工具调用时显式执行的动作

这也意味着未来“自动分叉”不需要引入一套完全不同的机制，本质上只是多了一个可选工具。

---

## 十一、Session 初始化模型

最终建议 Session 初始化支持 session 粒度配置。

理想上，一个 Session 初始化时可以指定：

- `sessionId`
- `systemPrompt`
- `tools`
- `skills`
- `mcps`
- `memoryPolicy`
- `summaryPolicy`
- `contextAssembler`

这样不同 Session 可以拥有不同角色定位，例如：

- 代码生成 Session
- UI 设计 Session
- 调研 Session
- 任务拆解 Session

它们可以共享同一个 Engine，但不必共享同一套能力配置。

---

## 十二、Hooks 体系

最终建议 hooks 至少覆盖这些阶段。

### 1. 消息级

- `onMessageReceived`
- `onAssistantReply`
- `onToolCall`
- `onToolResult`

### 2. Session 级

- `onSessionEnter`
- `onSessionLeave`
- `onSessionSwitch`
- `onSessionArchive`
- `onSessionFork`

### 3. Round 级

- `onRoundStart`
- `onRoundEnd`

### 4. Memory 级

- `onConsolidateStart`
- `onConsolidateEnd`
- `onIntegrateStart`
- `onIntegrateEnd`

### 5. Error 级

- `onError`

原则：

- 先定义扩展点
- 默认实现可以很轻
- 第一版不要求全部复杂化

---

## 十三、Server 与 SDK 的最终形态

更高层的 Server 与 SDK 应建立在前面这些能力之上。

### 1. Server 的职责

- 提供 REST / WebSocket 接口
- 暴露通过 `sessionId` 打开 Session 的能力
- 管理客户端连接和用户进入 / 退出 Session
- 在连接断开时触发 leave / round end 相关钩子

### 2. SDK 的职责

- 对 HTTP / WebSocket 接口做薄封装
- 提供跨语言客户端
- 保持与服务端 API 语义一致

### 3. 不应该做的事

- SDK 不应该重新定义 Session 的核心语义
- SDK 不应该重新实现一套本地 Engine
- SDK 不应该反向污染库层抽象

也就是说：

- 库的设计先成立
- Server 的设计再成立
- SDK 只是把 Server 接口更方便地暴露给不同语言

---

## 十四、理想典型流程

一个理想的最终流程应该是：

1. 用户通过 `sessionId` 进入某个 Session
2. 编排层触发 `onSessionEnter`
3. 用户发消息
4. Engine 调当前 Session 的 `send()`
5. 如果模型请求工具，Engine 驱动 tool loop
6. 用户继续若干条消息
7. 用户离开 Session 或切换 Session
8. Engine 触发 `onSessionLeave`
9. Engine 在默认策略下执行 round end consolidate
10. 如有需要，再执行 integrate

---

## 十五、当前实现与目标形态的关系

当前实现不是最终状态，只能算朝这个方向迈出的第一步。

已经开始对齐的部分：

- Session / Tree 解耦方向
- 编排层主入口收口
- tool loop 上提到 orchestration

还没完全到位的部分：

- Session 仍未完全自治
- round 生命周期还未完整建模
- 默认按轮 summary 还未真正落地
- hooks 体系还不完整

---

## 十六、后续建议优先讨论的问题

1. Session 最终公开接口到底有哪些
2. Session 级 MCP / tools / skills 的初始化模型怎么定义
3. Session 内部 state 的边界怎么定义
4. round 的开始和结束事件如何严格定义
5. 默认 consolidate 策略的最小实现是什么
6. hooks 哪些必须首批落地，哪些可以先留接口
7. 默认提供的两种 topology / orchestrator 模板边界怎么划分
8. Server / SDK 层是否显式暴露 `enter / leave` 语义

---

## 一句话总结

Session 是自治的对话组件，Tree 是解耦的拓扑结构，Engine 是单 Session 生命周期编排器，Orchestrator 是多 Session 协调层；Server 提供服务接口，SDK 只是对这些接口的薄封装。

补一句更贴近最终推荐：

Topology 编排权优先属于库使用者，库只提供默认范式；每个 Session 都应该能以 Session 粒度独立配置自己的 MCP、tools 和 skills。
