# StelloAgent Shared Memory — 设计文档

> **状态**：Spec（架构与 API 决策）
> **日期**：2026-05-17
> **前置**：`2026-05-16-decouple-main-session-design.md` 已实施
> **范围**：StelloAgent 级跨 Session 共享 memory 的接口与编排定调。实现细节（具体方法签名以外的文件级改动、测试用例清单）由后续 plan 文档承接。

---

## 1. 背景与目标

### 1.1 现状

main-session decouple refactor 落地后：

- `SessionStorage` 持有 per-session 内容（systemPrompt / insight / memory / L3 / SessionMeta CRUD）
- `agent.memory` 字段仍指向遗留 `MemoryEngine` 接口与 `FileSystemMemoryEngine` 实现 —— 这是 refactor 前的旧设计（L1 core.json + L2 per-session memory.md/scope.md/index.md + L3 records.jsonl），**目前已无任何代码调用其方法**，仅作为注入位残留
- 内置 tool 只有 `createSessionTool` / `activateSkillTool`
- 上下文组装规则：`system prompt → session_identity → insight → memory → L3 → user message`，固定不暴露扩展点

外部反思 / 跨 Session 综合由应用层在 `agent.listSessionDigests` / `agent.putInsight` 之上自行实现，框架不持有跨 Session 状态。

### 1.2 目标

引入 **StelloAgent 级共享 memory** ——

- 一个 `StelloAgent` 实例对应**一份**共享 memory，所有 root、所有子 Session 都可读可写
- 适用于"整个 agent 范围内稳定的认知"——用户背景、偏好、跨树事实
- 索引始终注入对话上下文；详情通过 `stello_memory_recall` 内置 tool 懒加载
- Stello 同时暴露 SDK 层读写接口，便于应用层维护 / 展示 / 同步

### 1.3 非目标

- 不引入多 agent 跨进程同步、订阅、事件
- 不做 embedding / 语义检索（slug-based 直接定位）
- 不做版本控制、历史回溯、diff
- 不引入跨 root 的"局部共享"层（多 root 共享 = agent 范围）
- 不预制文件系统适配器实现（同 SessionStorage，留给应用层）

---

## 2. 设计原则

1. **职责单一**：shared memory 只解决"agent 范围、agent 可写、详情懒加载"这一个问题；不耦合 session、tool registry、storage 适配器
2. **接口收敛**：单一 `SharedMemoryStore` 接口；不分多个子接口
3. **零应用域建模**：entry 只有 slug / summary / body 三字段，不预判 type / tags / 时间戳
4. **零隐式 LLM**：所有读写都是数据 IO；agent 写入由内置 tool 显式触发
5. **延续既有范式**：内置 tool 走 factory + ctx 模式；store 用 writeLock 串行；SDK 方法扁平挂在 StelloAgent 上
6. **清理 dead code**：同 release 把 legacy `MemoryEngine` 全部删除，避免双轨

---

## 3. 数据模型

### 3.1 Entry

```
SharedMemoryEntry {
  slug:    string
  summary: string
  body:    string
}
```

- **slug**：主键，kebab-case，应用层 / agent 自定，框架不校验合法字符集（但要求非空）
- **summary**：索引里出现的一行，无长度限制（建议短，但不强制）
- **body**：recall 时返回的全文

不引入字段：

- 无 `type` / `tags`：违背"零应用域建模"，分类需求由 agent 在 summary 里写前缀解决
- 无 `createdAt` / `updatedAt`：不维护时间元数据，调用方需要时间感知应在 body 里自己写
- 无嵌套 KV / schema：legacy `MemoryEngine.core.json` 的 point-path 思路不沿用

### 3.2 排序

`list()` 按**插入顺序**返回。upsert 一条已存在的 slug **不改变其顺序位置**（仅覆盖 summary + body）。

### 3.3 索引渲染

索引由所有 entries 的 `slug + summary` 渲染：

```
<shared_memory_index>
- prefer-concise: 用户偏好简短回答
- user-profile: 大三本科生 CS 专业
</shared_memory_index>

调用 stello_memory_recall 工具按 slug 查阅完整内容；
调用 stello_memory_remember / stello_memory_forget 工具维护此处条目。
```

格式固定，框架不暴露模板扩展点。

### 3.4 空状态

entries 数组为空时，索引段（含 hint 文本）**完全不注入**上下文。三个内置 tool 仍然注册可用。

---

## 4. 上下文注入

### 4.1 注入位置

上下文装配顺序调整为：

```
[system prompt]
[shared_memory_index]      ← 新增槽位
[session_identity]
[insight if present, consume]
[memory if present]
[L3 history with sanitize]
[user message]
```

- 高于 session_identity：shared memory 是 agent 范围共享认知，比"这个 session 是谁"更全局
- 低于 system prompt：避免覆盖应用层固化指令
- 与 memory / insight 严格分槽：shared memory 是 agent 范围、memory 是 per-session 持久、insight 是 per-session 一次性

### 4.2 消费策略

每次 send 都**全量重新渲染并注入**，不缓存（索引体积小，渲染开销可忽略）。

### 4.3 与压缩的关系

shared memory 索引是 system 段内容、不进入 L3 历史，因此不参与历史压缩。每次 send 都按当前 store 状态重新拉取。

---

## 5. 写操作与并发

### 5.1 操作集

| 操作 | 语义 |
|---|---|
| `upsert(slug, summary, body)` | 不存在则新增（追加到末尾），存在则覆盖 summary + body（保持原插入顺序位置） |
| `remove(slug)` | 按 slug 删除，不存在为 no-op |

**不提供**：

- 分别更新 summary 或 body 的细粒度 API（YAGNI）
- 批量写入 / transaction（单操作已原子，YAGNI）
- rename：删 + 新增即可

### 5.2 并发

`SharedMemoryStore` 实现内部用 **per-store writeLock** 串行化所有写操作（upsert / remove）：

- 多个 tool 调用 / SDK 调用并发触发时，store 内排队，先到先做完
- 单次写入是 RMW（读全集 → 改 → 写回），lock 保证原子
- 读取（`list` / `get`）**不加锁**，允许脏读

沿用项目里 `SessionTree.writeLock` 的现成范式，认知成本零。

### 5.3 错误处理

- 内置 tool 写入抛错 → tool 返回 `"failed: {reason}"` 字符串，agent 自行决定要不要重试（不中断对话）
- SDK 调用抛错 → 同步向调用方抛出
- store 未注入时调用 SDK 或 tool → 抛 `"sharedMemory not configured"`（同 `requireStorage` 写法）

---

## 6. 内置工具

放在 `packages/core/src/builtin-tools/`，仿 `createSessionTool` / `activateSkillTool` 的 factory + ctx 模式。

### 6.1 工具列表

| 工具名 | 参数 | 返回 |
|---|---|---|
| `stello_memory_recall` | `slug: string` | entry body 全文；slug 不存在返回明确错误文本 |
| `stello_memory_remember` | `slug: string, summary: string, body: string` | 成功确认；upsert 语义 |
| `stello_memory_forget` | `slug: string` | 成功确认；slug 不存在仍返回成功（no-op） |

### 6.2 Factory

三个工具各自暴露为 factory：

```
memoryRecallTool(): ToolFactory
memoryRememberTool(): ToolFactory
memoryForgetTool(): ToolFactory
```

应用层在构造 ToolRegistry 时显式 opt-in，与 `createSessionTool()` / `activateSkillTool(skills)` 同款。三个 tool 都从 `ctx.agent` 拿 `SharedMemoryStore`。

**不提供 `memoryToolSet()` 打包**：应用可能只想给某些 Session 开 recall、不开 remember；ToolRegistry 已支持按 Session 配置，框架不重复抽象。

### 6.3 异常返回

按现有 builtin tools 惯例：

- slug 为空 → tool 返回 error 字符串，不抛
- store 异常 → tool 返回 `"failed: {reason}"`，agent 决定如何处理

---

## 7. 外部 SDK

在 `StelloAgent` 上扁平挂载四个方法，命名风格同 `putMemory` / `getSessionMetadata`：

| 方法 | 参数 | 返回 |
|---|---|---|
| `listSharedMemory()` | 无 | `SharedMemoryEntry[]`（按插入顺序） |
| `getSharedMemoryEntry(slug)` | `slug` | `SharedMemoryEntry \| null` |
| `upsertSharedMemoryEntry(slug, summary, body)` | 三参数 | `Promise<void>` |
| `removeSharedMemoryEntry(slug)` | `slug` | `Promise<void>` |

### 7.1 注入

`StelloAgentConfig` 添加：

```
sharedMemory?: SharedMemoryStore
```

未注入时：

- 四个 SDK 方法抛 `"sharedMemory not configured"`
- 三个内置 tool 调用抛同样错误
- 索引段不注入上下文（同空 entries 状态）

### 7.2 不提供的 API

- **transaction / batch**：YAGNI
- **subscribe / on('changed')**：YAGNI；应用有需求可在自己的 store 实现里挂事件
- **renderIndex()**：调用方拿到 list 自己渲染，框架不重复

---

## 8. `SharedMemoryStore` 接口

放在 `@stello-ai/core`（agent 级概念，不属 session 层）。

### 8.1 接口

```
SharedMemoryStore {
  list():                          Promise<SharedMemoryEntry[]>
  get(slug: string):               Promise<SharedMemoryEntry | null>
  upsert(slug, summary, body):     Promise<void>
  remove(slug: string):            Promise<void>
}
```

- 形状与 SDK 一一对应；SDK 方法是薄代理 + 错误兜底
- `list()` 按插入顺序返回（FIFO 约定，上层 SDK / 索引渲染依赖此约定）
- writeLock 串行**由实现内部保证**，不暴露给调用方

### 8.2 内置实现

提供 `InMemorySharedMemoryStore` 作为默认 / 测试用：

- 基于 `Map<slug, { summary, body }>`（JS Map 天然保留插入顺序，list() 直接按 entries 顺序返回）
- 内置 writeLock（沿用现有 SessionTree.writeLock 工具，或本地 Promise 串行）

**不提供** `FileSystemSharedMemoryStore`：与 SessionStorage 文件适配器一样的处理——落盘策略（per-entry .md / 单文件 JSON / SQLite）应用层差异大，留给应用层。

### 8.3 序列化建议（文档建议，非接口约束）

给应用层文件实现的参考布局：

```
basePath/
  shared-memory/
    INDEX.md
    entries/
      prefer-concise.md
      user-profile.md
```

但 store 实现愿意把所有 entry 塞一个 JSON 也合法。

---

## 9. Legacy `MemoryEngine` 清理

同 release 一次性删除：

| 项 | 性质 |
|---|---|
| `packages/core/src/types/memory.ts` 整文件 | 类型 |
| `packages/core/src/memory/file-system-memory-engine.ts` | 实现 |
| `packages/core/src/memory/__tests__/` 全部 | 测试 |
| `StelloAgentConfig.memory: MemoryEngine` 字段 | 配置 |
| `StelloAgent.memory` 字段 | 属性 |
| Engine / DefaultEngineFactory / types/engine 对 `memory: MemoryEngine` 的引用 | 内部接线 |
| `index.ts` 的 `MemoryEngine` / `FileSystemMemoryEngine` 公开导出 | 公共 API |

CHANGELOG 列入 breaking。

---

## 10. 测试方向

| 测试位置 | 覆盖点 |
|---|---|
| `packages/core/src/agent/__tests__/shared-memory.test.ts` | SDK 四方法正常路径 + store 未注入抛错 |
| `packages/core/src/builtin-tools/__tests__/memory-recall.test.ts` 等三个 | 三个 tool 正常路径 / slug 不存在 / 非法参数 |
| `packages/session/src/__tests__/context-assembly.test.ts`（扩） | 索引段注入顺序、空索引不出现、模板格式 |
| `packages/core/src/__tests__/in-memory-shared-memory-store.test.ts` | 内置 store 并发串行化（多 upsert 并发不丢数据）+ 插入顺序保持 |

覆盖原则按 CLAUDE.md：公开接口正常路径 + 错误输入 + 边界条件。

---

## 11. 范围、迁移、风险

### 11.1 范围内

- `@stello-ai/core` 实施本 spec 全部改动
- `@stello-ai/session` 仅扩 context assembly（加 shared_memory_index 槽）
- 新增三个内置 tool、`InMemorySharedMemoryStore` 实现、`SharedMemoryStore` 接口、四个 SDK 方法
- 删除 legacy MemoryEngine 全套

### 11.2 范围外

- 文件系统 / DB 适配器实现
- demo / devtools / visualizer 集成（CHANGELOG 标注）
- 应用层 reflection 模式与 shared memory 联动的官方示例

### 11.3 风险与已知 break

| 风险 | 说明 | 处置 |
|---|---|---|
| 上下文装配多一槽 | session 包的 assemble 规则变更 | 已在 §4.1 明确位置；测试覆盖注入顺序 |
| Legacy MemoryEngine 删除 | 公共 API 表面收缩 | CHANGELOG 列入 breaking；本来就无生效代码 |
| shared memory 滥用 | agent 写太多冗余 entry → 索引膨胀 | 当前不引入截断；后续按使用反馈再加策略 |
| store 注入遗漏 | 未注入但调用 → 抛错 | 错误消息明确 `"sharedMemory not configured"` |
| writeLock 死锁 | RMW 写操作内部不递归调用其他写 | 实现自检；测试覆盖并发 upsert |

### 11.4 版本与发布

前一次 main-session decouple 的 release commit 尚未推到 npm，本次改动直接并入同一个未发布版本，无需考虑 deprecated alias / 跨版本兼容。CHANGELOG 在最终 npm 发布前一并整理。

### 11.5 已知未决问题（spec 不解决，备忘）

1. 文件系统 store 的官方默认实现（什么时候做、做不做）
2. 索引膨胀治理策略（按字节截断 / 按 LRU 淘汰 / 自动 consolidate）
3. shared memory 的导入导出（备份 / 跨 agent 迁移）
4. 多 root 时是否需要"per-root 子作用域"层（当前 spec 选择不做）

---

## 12. 设计立场回顾

1. **agent-writable + 索引注入 + tool 详情**：参考 Claude Code auto-memory 范式，与人工书写的 system prompt 分层
2. **接口最薄**：四方法 + 三 tool + 一个 store interface，没有多余抽象
3. **延续既有范式**：writeLock、factory + ctx、扁平 SDK 命名，零认知成本
4. **死代码同步清理**：legacy MemoryEngine 一次性删完，避免双轨长期共存
