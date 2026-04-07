# CLAUDE.md — Stello 架构参考

> 本文件描述 Stello 的核心设计理念和架构约束。内容应长期稳定，不含版本状态或文件路径。

---

## 项目定位

Stello 是开源对话拓扑引擎（TypeScript SDK）。让 AI Agent 将线性对话分裂为树状 Session，跨分支通过 Main Session 传递洞察，整个拓扑可渲染为可交互的星空图。

**仓库**：`github.com/stello-agent/stello`
**协议**：Apache-2.0

---

## 核心理念 — 技能隐喻

每个子 Session 是一个**技能（Skill）**，Main Session 是**技能调用方（Orchestrator）**。

```
子 Session = Skill
  L3 = 技能的详细知识体（内部消费）
  L2 = 技能的 description（外部接口，Main Session 消费）

Main Session = Orchestrator
  读所有子 Session 的 L2 = 知道自己有哪些技能
  synthesis = 对所有 L2 的综合认知
  insights = 定向推送给各子 Session 的建议
```

由此推导出三条核心约束：

1. **L2 对子 Session 自身不可见** — L2 是外部描述，不是自用记忆
2. **Main Session 只读 L2，不读子 Session 的 L3** — Orchestrator 看接口，不看实现
3. **子 Session 对其他 Session 完全不感知** — 唯一的跨 Session 信息来源是 Main Session 推送的 insights

---

## 三层记忆模型

| 层 | 语义 | 消费者 |
|----|------|--------|
| L3 | 原始对话记录 | 该 Session 自身的 LLM |
| L2 | 技能描述（外部视角） | Main Session（通过 integration cycle） |
| L1-structured | 全局键值 | 应用层直接读写 |
| L1-emergent（synthesis） | Main Session 对所有 L2 的综合提炼 | Main Session 自身 |

**零对话中 LLM 开销**：L2 在 consolidation 时批量生成，不在每轮对话中更新。正在进行中的 Session 没有 L2，对 Main Session 暂时不可见——这是有意为之的取舍。

---

## 四层架构

```
┌─────────────────────────────────────────────────────────┐
│  HTTP / SDK 层                                           │
│  REST / WebSocket 服务，多租户，跨语言客户端              │
├─────────────────────────────────────────────────────────┤
│  应用层（Application Layer）                              │
│  开发者提供：StorageAdapter · LLMAdapter · system prompt │
│  · ConsolidateFn · IntegrateFn · 触发时机配置 · 工具定义  │
├─────────────────────────────────────────────────────────┤
│  编排层（Orchestration Layer）                            │
│  Engine：tool call 循环 · consolidation/integration 调度 │
│  · Session 切换追踪 · fire-and-forget 异步调度 · 事件     │
├─────────────────────────────────────────────────────────┤
│  Session 层                                              │
│  独立对话单元：send() 单次 LLM 调用 · consolidate()      │
│  · fork() · 不感知树结构 · 不做 tool call 循环            │
└─────────────────────────────────────────────────────────┘
         ↑ 依赖注入
  SessionStorage / MainStorage    LLMAdapter
```

### Session 层

Session 是**有记忆的对话单元**，与树结构完全解耦。

- **send()**：组装上下文 → 单次 LLM 调用 → 存 L3 → 返回响应
- **consolidate(fn)**：暴露给上层调度 L3→L2 提炼
- **fork()**：一次性继承源 Session 上下文，创建独立新 Session
- **SessionMeta 不含 parentId / depth** — Session 不知道自己在树中的位置

两种 Session 接口，不同的上下文组装规则：

| | Session（子） | MainSession（全局意识层） |
|--|--------------|-------------------------|
| 上下文 | system prompt + insights + L3 + msg | system prompt + synthesis + L3 + msg |
| 记忆 | `memory()` = L2 | `synthesis()` = integration 产出 |
| 提炼 | `consolidate(fn)` L3→L2 | `integrate(fn)` 所有 L2→synthesis+insights |
| insights | 被动接收 | 主动推送 |

### 编排层

Engine 是 Session 原语之上的**执行周期管理器**，不创造新能力：

- **turn()**：Session.send() × N（tool call 循环）+ 调度判断
- **Consolidation 调度**：onSwitch / everyNTurns / onArchive / manual
- **Integration 调度**：afterConsolidate / onSwitch / everyNTurns / manual
- **fork 编排**：创建拓扑节点（topology-first ID）+ 调用 `session.fork({ id })` 创建 Session
- **内置 tool**：Engine 完整持有内置 tool（stello_create_session、activate_skill）的定义和执行
- **所有异步副作用 fire-and-forget**，不阻塞 turn() 返回

### HTTP / SDK 层

编排层之上的薄 HTTP 包装，实现跨语言和多租户。编排层本身与传输无关。

---

## 存储设计

存储接口按消费者职责分层，不是按数据结构分：

| 接口 | 注入对象 | 职责 |
|------|---------|------|
| **SessionStorage** | 普通 Session | 单个 Session 的数据：L3、system prompt、insight、L2 |
| **MainStorage** (extends SessionStorage) | Main Session + 编排层 | 额外：`getAllSessionL2s()` 批量收集、拓扑树、Session 列举、全局键值 |

### Session 与拓扑树解耦

Session 是独立对话单元，不知道树的存在。树状拓扑由 **TopologyNode**（`{ id, parentId, label }`）独立维护在 MainStorage 中。

- **前端渲染**：通过 `getChildren(parentId)` 懒加载树节点
- **Integration**：通过 `getAllSessionL2s()` 扁平收集所有 L2，不走树
- **fork**：编排层创建 Session（Session 层）+ 写入 TopologyNode（存储层），两个独立操作

### 上下文组装依赖的存储槽位

每个出现在 LLM 上下文中的元素都有对应的专用存储接口：

| 上下文元素 | 存储方法 | 说明 |
|-----------|---------|------|
| system prompt | `getSystemPrompt / putSystemPrompt` | 全局共享 |
| insights | `getInsight / putInsight` | Main → 子 Session 定向推送 |
| L3 历史 | `appendRecord / listRecords` | 原始对话记录 |
| L2 / synthesis | `getMemory / putMemory` | 子 Session 存 L2，Main Session 存 synthesis |

---

## 外部注入点

| 注入 | 说明 |
|------|------|
| SessionStorage / MainStorage | 持久化抽象（按消费者职责分层） |
| LLMAdapter | LLM 接口（消息数组、tool use、可选 stream） |
| ConsolidateFn | L3→L2 转换逻辑，应用层定义 L2 格式，fn 自行选择 LLM tier |
| IntegrateFn | all L2s → synthesis + insights，与 ConsolidateFn 配对，fn 自行选择 LLM tier |
| system prompt | 全局共享 |
| ToolRegistry | 应用层工具注册（`register(tool)`），Engine 自动合并内置 tool + 用户 tool |
| SessionRuntimeResolver | Session 加载（`resolve`），Engine 通过 `session.fork()` 创建子 Session |
| ForkProfile | 预注册的 fork 配置模板（systemPrompt 合成策略 + LLM/tools/context 预设） |

ConsolidateFn 和 IntegrateFn 是**配对函数**——ConsolidateFn 输出某种格式的 L2，IntegrateFn 读取该格式。框架对 L2 内容格式完全无感知。

---

## 设计决策（已确认，不再讨论）

1. L2 对子 Session 自身不可见 — L2 是外部描述
2. Main Session 只读 L2，不读子 Session 的 L3
3. insights 替换策略（不追加）— 每次 integration 给出最新完整判断
4. 回调一次性注入（immutable config）
5. consolidate/integrate 均 fire-and-forget — 不阻塞对话
6. 错误处理：emit error，不中断对话周期
7. Session 上下文组装为固定规则，不暴露 assembler 扩展点
8. fork 一次性继承后独立 — 跨 Session 通信靠 insights
9. Session 做单次 LLM 调用 — tool call 循环由编排层驱动
10. Session 与树结构解耦 — SessionMeta 无 parentId/depth，拓扑由 TopologyNode 独立维护
11. 存储接口按职责分层 — SessionStorage / MainStorage
12. ConsolidateFn / IntegrateFn 不注入 LLM — 应用层通过闭包自行选择 tier
13. 内置 tool 由 Engine 完整持有 — 定义、拦截、执行全在编排层，应用层不参与内置 tool 逻辑
14. Fork = 创建独立 Session + 添加拓扑节点 — 不需要"从父 Session fork"，parentId 只是拓扑关系元数据
15. Engine 编排 fork 的两步 — 创建拓扑节点（`sessions.createChild` 生成 ID）+ 调用 `session.fork({ id })` 创建 Session（topology-first ID）
16. 应用层工具注册仿照 SkillRouter 模式 — `ToolRegistry.register(tool)`，Engine 自动管理定义和执行 dispatch
17. 层级依赖单向向下 — Engine 不 import Orchestrator，共享类型定义在 `types/` 层

---

## 代码规范

- 模块间只通过 interface 通信，不允许跨包 import 内部文件
- 文件需要合理模块化, 职责相关的放在一起, 否则独立
- 每个函数写一行中文注释说明用途
- 每个 interface 写 JSDoc 注释
- KISS 原则，不做过度抽象
- TypeScript 严格模式，**不允许 any**
- 所有公开接口必须有测试（正常路径 + 错误输入 + 边界条件）

## 技术栈

- TypeScript 严格模式 · pnpm monorepo · Vitest · tsup（ESM + CJS + DTS）

## Git 规范

- commit 格式：`feat/fix/docs/test/chore(模块名): 简短中文描述`
- push 前先 `git diff --stat` 确认改动范围

## Skills 持久化规则

项目级别的架构认知、设计决策等持久化知识，统一通过 `.claude/skills/` 目录管理。

### 组织方式

- 每个主题一个 skill 目录，包含 `SKILL.md`（遵循标准 agent skills 格式）
- 遇到新的项目级认知 → 封装为 skill 或更新已有 skill
- 遇到与当前 skill 认知不匹配的理解 → **先与用户澄清**，确认后再更新对应 skill
- 不要在对话中默认自己的理解是正确的，skill 是唯一的认知基线

### 内容规范 — 只写不变的，不写易变的

Skills 是**方向指导**，不是代码文档。核心原则：**如果内容会随实现变化而过时，就不该写进 skill。**

**应该写（持久）：**
- 设计决策和背后的理由（why）
- 架构约束和不变量（invariants）
- 使用模式和推荐做法（how to use）
- 职责边界（做什么 / 不做什么）
- 与其他层的关系

**不应该写（易变）：**
- 具体方法签名、字段列表（读代码即可）
- 文件路径和目录结构（用 glob/grep 查找）
- Phase 进度状态、emoji 标记（用 git log）
- 测试数量（会随开发变化）
- 代码块（除非是展示用法的最小示例，且不会频繁变化）
- 依赖版本号

**判断标准：** 如果这条信息 3 个月后可能过时，不写。如果这条信息帮助理解"为什么这样设计"，写。

## 降级项（不实现）

L3 全文搜索 / compact 压缩 / embedding 漂移检测 / scope 横向召回 / Canvas 动画 / Skill Pipeline 权限 / 时间轴回溯 / 多布局模式
