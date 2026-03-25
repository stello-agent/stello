---
name: storage-design
description: 存储接口的分层设计原则、SessionMeta 与 TopologyNode 解耦、数据流向。触发条件：理解或实现 StorageAdapter。
---

## 核心原则

**Session 是纯对话单元，不感知树结构。** 存储接口按消费者职责细分。

---

## 两层存储接口

### SessionStorage — 单个 Session 的数据操作

普通 Session 注入此接口。只能操作自身的数据，无法感知其他 Session 的存在。

职责：Session 元数据 CRUD、L3 对话记录追加/查询、上下文槽位（system prompt / insight / memory）读写、事务支持。

### MainStorage extends SessionStorage — Main Session 额外能力

Main Session 注入此接口。除了自身数据操作外，还能：
1. 扁平收集所有子 Session 的 L2（用于 integration，不走树）
2. 操作拓扑树节点（用于前端渲染）
3. 读写全局键值（L1-structured）
4. 列举 Session（管理用）

### 为什么按消费者分接口而不是按数据结构分

同一个实现类可以同时实现两个接口（共享数据库），接口分离只是约束注入范围。普通 Session 拿到 SessionStorage 后无法调用 `getAllSessionL2s()`，从类型层面保证子 Session 不感知其他 Session。

---

## SessionMeta 与 TopologyNode 解耦

树状关系完全由 TopologyNode 维护，SessionMeta 不关心自己在树中的位置。

- **SessionMeta**：对话运行时数据（id、label、status、turnCount 等），无 parentId/children/depth
- **TopologyNode**：纯树结构（id、parentId、children、refs、depth、index、label）

两种类型从同一底层存储投影而来，但消费者不同：SessionMeta 面向 Session 层，TopologyNode 面向编排层和前端渲染。

### 两个包的 SessionMeta

`@stello-ai/session` 和 `@stello-ai/core` 各有自己的 SessionMeta，字段不完全相同：
- session 包的有 `role`，无 `scope`/`turnCount`/`lastActiveAt`
- core 包的有 `scope`/`turnCount`/`lastActiveAt`，无 `role`

PG 存储层存超集，各 adapter 按需投影。

---

## 数据流向

```
普通 Session（注入 SessionStorage）
  send() → 读 system prompt + insight + L3 历史 → 调 LLM → 写 L3
  consolidate() → 读 L3 + 当前 L2 → 调 ConsolidateFn → 写新 L2

Main Session（注入 MainStorage）
  send() → 读 system prompt + synthesis + L3 历史 → 调 LLM → 写 L3
  integrate() → 扁平收集所有子 L2 → 调 IntegrateFn → 写 synthesis + 推送 insights

编排层 fork 流程:
  1. Session 层创建 Session（putSession）
  2. 拷贝上下文
  3. 存储层写入 TopologyNode（putNode）—— 两个独立操作

前端渲染:
  懒加载树节点 → 点击加载 Session 详情
```

---

## 上下文槽位

每个出现在 LLM 上下文中的元素都有对应的专用存储方法（get/put 对），不复用通用键值：

| 上下文元素 | 消费场景 |
|-----------|---------|
| system prompt | 所有 Session |
| insight | 子 Session（Main → 子，消费后清除） |
| L3 历史 | 所有 Session |
| memory（L2 / synthesis） | 子 Session 存 L2，Main Session 存 synthesis |
