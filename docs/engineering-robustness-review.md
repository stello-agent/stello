# Stello 工程鲁棒性评审

> 2026-03-31 · 基于 v0.2.x 架构的系统性评审
>
> 聚焦跨 Session 通信链路的工程缺陷与改进方案。

---

## 背景

Stello 的核心价值链路：

```
L3（原始对话）──ConsolidateFn──► L2（技能描述）──IntegrateFn──► synthesis + insights
```

这条链路在 happy path 上设计优雅 — 技能隐喻、信息隔离、低 token 成本。但在 unhappy path 上缺乏防御，存在六个结构性工程问题。

---

## 问题一：L2 单向有损压缩，无反馈通道

### 现状

L3（数百条消息）经 ConsolidateFn 压缩为 L2（100-150 字），再经 IntegrateFn 二次压缩为 synthesis + insights。两次有损压缩串联，信息损耗是乘法关系。

### 具体风险

- **无 query-back 机制**：MainSession 无法向子 Session 追问 "关于 X 具体是什么情况"。只能等下一次 consolidation。
- **质量不可观测**：没有任何机制检测 L2 是否遗漏了关键信息。ConsolidateFn 的质量完全依赖 prompt engineering。
- **不可逆**：L2 生成后，原始 L3 对跨 Session 通信链路永久失效。ConsolidateFn 遗漏的关键决策，在 integration 视角里不存在。

### 改进方向

引入 **Event Sourcing**，用事件流替代快照式 L2。详见「统一解决方案」一节。

---

## 问题二：insights 替换策略导致记忆断崖

### 现状

设计决策（CLAUDE.md #3）：

> insights 替换策略（不追加）— 每次 integration 给出最新完整判断

子 Session 的上下文组装：`system prompt + insights + L3 + 新消息`。其中 insights 槽位每次 integration 被**整体覆盖**。

### 具体风险

```
第一次 integration 推送的 insight:
  "英国方向发现学生看重就业，建议补充 OPT/H1B 数据"
  "学生预算上限 50 万 RMB，注意筛选学费"

第二次 integration 推送的 insight:
  "英国方向学生改为考虑 Oxford，竞争更激烈"
  （没有再提预算信息）

→ "预算 50 万"从子 Session 上下文中消失
```

注意：**L3（对话历史）不受影响**，断崖发生在 insights 这个跨 Session 通信信道上。insights 是一个无记忆的寄存器，每次写入清空前值。这会导致跨 Session 认知随时间静默退化。

### 改进方向

insights 从替换式改为 **append-only + cursor-based consumption**。详见「统一解决方案」一节。

---

## 问题三：时间盲区 — consolidation 间隔内不可见

### 现状

L2 仅在 consolidation 时生成（如 `everyNTurns: 3`）。CLAUDE.md 明确承认：

> 正在进行中的 Session 没有 L2，对 Main Session 暂时不可见 — 这是有意为之的取舍

### 具体风险

```
Turn 1  Turn 2  Turn 3  ← consolidate  Turn 4  Turn 5  Turn 6  ← consolidate
├────────────────┤                      ├────────────────┤
 盲区：MainSession 对                    盲区：用户在 Turn 4
 该 Session 进展一无所知                  说了"不考虑美国了"
                                         但要等 Turn 6 才能传播
```

关键决策在盲区内做出时，其他 Session 可能基于过时信息持续工作。

### 改进方向

事件在发生时即进入 log，不等 consolidation 周期。详见「统一解决方案」一节。

---

## 问题四：fire-and-forget 静默失败

### 现状

设计决策（CLAUDE.md #5, #6）：

> consolidate/integrate 均 fire-and-forget — 不阻塞对话
> 错误处理：emit error，不中断对话周期

### 具体风险

- consolidation 失败 → L2 不更新 → integration 基于过时 L2 决策 → **无人感知**
- integration 失败 → insights 不推送 → 子 Session 用旧 insight → **无人感知**
- 多次失败静默累积，系统表面正常，跨 Session 认知严重滞后
- 缺少最终一致性保证：没有重试、没有版本号、没有 staleness 检测

### 改进方向

append-only event log 提供**持久化 + 可重放**保证。消费失败不丢事件，下次从 cursor 继续。详见「统一解决方案」一节。

---

## 问题五：MainSession 单点中枢，无法 scale

### 现状

所有跨 Session 通信必须经过 MainSession：

```
Session A ──L2──► MainSession ──insight──► Session B
                 （单点瓶颈）
```

### 具体风险

- **O(N) integration 成本**：`getAllSessionL2s()` 每次全量收集所有 Session 的 L2，无增量机制
- **无 freshness 标记**：integration 读到的 L2 可能是 3 轮前的和刚生成的混在一起，IntegrateFn 不知道哪个是新的
- **synthesis 污染无自愈**：synthesis 一旦基于错误 L2 生成，后续 integration 全部基于错误基线，无自我修复机制

### 改进方向

event log 上的 cursor 天然提供 freshness 感知和增量消费。详见「统一解决方案」一节。

---

## 问题六：配对函数无契约校验

### 现状

- ConsolidateFn 输出 L2（某种格式）
- IntegrateFn 读取 L2（期望同种格式）
- 框架对 L2 内容格式完全无感知（设计决策 #12）

### 具体风险

两个函数由开发者分别编写。如果 ConsolidateFn 输出 markdown 而 IntegrateFn 期望 JSON，不会报错 — 只会 integration 质量静默退化。没有 schema 校验、没有 type check、没有运行时断言。

### 改进方向

引入 EventEnvelope 后，信封层有结构校验（sessionId、sequence、timestamp 必填）。content 字段内部仍然格式无感知，但至少信封层有保底断言。可选地，允许开发者注册 content schema 做运行时校验。

---

## 统一解决方案：EventEnvelope + Append-Only Log

### 核心思路

用 **Event Sourcing** 替代当前的快照式 L2 + 替换式 insights。框架只读信封 metadata，不解析 content — 保持格式无感知的设计哲学。

### EventEnvelope 定义

```typescript
interface EventEnvelope {
  /** 产出该事件的 Session */
  sessionId: string
  /** 单调递增序号，用于 cursor 追踪 */
  sequence: number
  /** 事件产生时间 */
  timestamp: string
  /** 框架不解析的内容 — ConsolidateFn/IntegrateFn 自行定义格式 */
  content: string
}
```

类比：Kafka message — broker 只管 topic/partition/offset，payload 是 opaque bytes。

### 数据流对比

**当前模型（快照式）：**

```
Session A ──consolidate──► L2 快照
Session B ──consolidate──► L2 快照
                               │
                     integration 全量读所有 L2
                               │
                     ┌─────────┴─────────┐
                     ▼                   ▼
              synthesis（覆盖）    insights（覆盖）
```

**改进模型（事件式）：**

```
Session A ──emit──► Event(seq=1, "学生确认预算50万")
Session A ──emit──► Event(seq=2, "倾向 CMU 而非 Stanford")
Session B ──emit──► Event(seq=1, "学生改考虑 Oxford")
                          │
                          ▼
                   Ordered Event Log（append-only, 持久化）
                          │
                          ▼
            MainSession 维护 cursor（"已消费到全局 seq #5"）
            各子 Session 维护 cursor（"已消费到 insight seq #3"）
                          │
                  ┌───────┴───────┐
                  ▼               ▼
           synthesis（增量更新） insights（增量追加）
```

### 问题 → 解决映射

| 问题 | 当前状态 | Event Sourcing 如何解决 |
|------|---------|----------------------|
| L2 有损压缩 | 不可逆快照 | 事件是细粒度增量，信息密度更高；历史事件可回溯 |
| insights 记忆断崖 | 全量替换 | append-only，cursor 只前进不回退，历史 insight 不丢失 |
| 时间盲区 | 等 consolidation 周期 | 事件在发生时即入 log，不等批处理 |
| 静默失败 | fire-and-forget，无重试 | 事件持久化，消费失败可从 cursor 重放，保证最终一致 |
| 全量收集 O(N) | getAllSessionL2s() 无增量 | cursor-based 增量消费，只处理新事件 |
| 配对函数无校验 | 框架不感知 L2 格式 | 信封层有结构校验；content 仍格式无感知 |

### 与当前设计的兼容性

- **格式无感知**：保留。框架只读 EventEnvelope 的 metadata 字段，`content` 原样透传。
- **ConsolidateFn / IntegrateFn**：仍为应用层配对函数。ConsolidateFn 改为产出 EventEnvelope[]（而非单个 L2 字符串），IntegrateFn 改为消费 EventEnvelope[]（而非 L2 字符串数组）。
- **fire-and-forget 语义**：保留。consolidation/integration 仍不阻塞对话，但失败后事件不丢，下次可续消费。
- **MainSession 中心角色**：保留。MainSession 仍是 integration 的唯一执行者，但从全量读改为增量消费。

### 需要新增的存储接口

```typescript
interface EventLog {
  /** 追加事件 */
  append(event: EventEnvelope): Promise<void>
  /** 从指定 cursor 开始读取事件 */
  readFrom(cursor: number, limit?: number): Promise<EventEnvelope[]>
  /** 读取当前最大 sequence */
  getLatestSequence(): Promise<number>
}

interface CursorStore {
  /** 读取某个消费者的 cursor */
  getCursor(consumerId: string): Promise<number>
  /** 更新某个消费者的 cursor */
  setCursor(consumerId: string, sequence: number): Promise<void>
}
```

### 迁移策略

建议分阶段推进，不做一次性重写：

1. **Phase 1 — 加信封**：现有 L2 包装进 EventEnvelope，consolidation 产出带 sequence 的事件。insights 仍替换式，但信封提供 freshness 标记。
2. **Phase 2 — 加 Event Log**：引入 append-only log 和 cursor。integration 改为增量消费。
3. **Phase 3 — insights 改追加**：insights 从替换式改为 append-only + cursor-based。子 Session 上下文组装改为读取 cursor 之后的增量 insights。

---

## 不在本文档范围内的问题

以下问题已识别但未深入讨论，留作后续评审：

- L3 本身的上下文窗口管理（trimRecords 策略）
- Session 数量增长时 EventLog 的存储和 GC 策略
- 多个 integration 并发执行时的 cursor 竞争
- event schema versioning（content 格式演进时的向后兼容）
