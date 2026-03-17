# Stello SDK 开发日志

> 面向研发团队的技术文档。每个 Phase 完成后更新，记录架构决策、接口设计、文件变更和测试覆盖。

---

## Phase 1：项目初始化 + 基础设施层

**时间**：2026-03-17
**Commits**：`9af6b04` → `c684697` → `efeefeb` → `ac64dc2`
**测试**：24 个（fs 9 + session 15）

### 1.1 Monorepo 骨架

采用 pnpm workspace 管理两个包：

```
stello/
├── packages/core/       → @stello-ai/core（引擎 SDK）
├── packages/visualizer/ → @stello-ai/visualizer（星空图可视化）
├── pnpm-workspace.yaml
├── tsconfig.json        → 根级 TS 配置（strict: true, noUncheckedIndexedAccess）
└── package.json         → 统一的 build/test/typecheck/lint/format 脚本
```

**技术选型**：

| 工具 | 选型 | 理由 |
|------|------|------|
| 包管理 | pnpm 9.x | workspace 原生支持，磁盘占用小 |
| 打包 | tsup | 零配置输出 ESM + CJS + DTS，基于 esbuild |
| 测试 | Vitest | 原生 TS 支持，与 Vite 生态一致 |
| 规范 | ESLint flat config + Prettier | 统一代码风格，TS strict 模式 |

### 1.2 全量类型定义

将所有接口按领域拆分为 5 个子文件（单文件不超过 200 行），通过 `types.ts` 统一 re-export：

```
types/
├── session.ts    → SessionMeta, SessionTree, CreateSessionOptions
├── memory.ts     → MemoryEngine, AssembledContext, CoreSchema, TurnRecord
├── fs.ts         → FileSystemAdapter（持久化抽象）
├── lifecycle.ts  → LifecycleHooks, Skill, SkillRouter, ConfirmProtocol, ToolDefinition
└── engine.ts     → StelloConfig, StelloEngine, StelloEventMap, SplitStrategy, BubblePolicy
```

**设计要点**：

- `index.ts` 只导出 `types.ts` 的 re-export，外部使用者通过 `@stello-ai/core` 一行 import 拿到所有类型
- 所有接口使用 `unknown` 替代 `any`，严格类型安全
- `SessionMeta.id` 标记 `readonly`，创建后不可变
- `MemoryEngine` 的方法名体现层级（`readCore` / `readMemory` / `appendRecord`）

### 1.3 FileSystemAdapter 实现

**文件**：`fs/file-system-adapter.ts`（`NodeFileSystemAdapter` 类）

接口 `FileSystemAdapter` 是持久化层的抽象。默认实现基于 Node.js `fs/promises`，零外部依赖。开发者可替换为 SQLite / Postgres 适配器，上层代码无感知。

**9 个方法**：

| 方法 | 功能 | 错误处理 |
|------|------|----------|
| `readJSON<T>(path)` | 读 JSON 文件，反序列化 | ENOENT → `null` |
| `writeJSON(path, data)` | 写 JSON（自动建父目录） | — |
| `appendLine(path, line)` | 追加一行到文件末尾 | — |
| `readLines(path)` | 读所有行（过滤空行） | ENOENT → `[]` |
| `mkdir(path)` | 递归建目录 | — |
| `exists(path)` | 判断文件/目录是否存在 | ENOENT → `false` |
| `listDirs(path)` | 列出子目录名 | ENOENT → `[]` |
| `readFile(path)` | 读文本文件 | ENOENT → `null` |
| `writeFile(path, content)` | 写文本文件（自动建父目录） | — |

> `readFile` / `writeFile` 在 Phase 2 架构变更中新增，用于读写 `.md` 文件。

**实现细节**：
- 所有路径通过 `join(basePath, path)` 拼接，构造时传入 `basePath`
- 写操作前统一调用 `ensureDir()` 确保父目录存在
- ENOENT 判断提取为 `isNotFound()` 工具函数，避免重复

**测试策略**：
- `beforeEach`：`mkdtemp(join(tmpdir(), 'stello-test-'))` 创建临时目录
- `afterEach`：`rm(tmpDir, { recursive: true, force: true })` 清理
- 每个方法覆盖正常路径 + 文件不存在场景

### 1.4 SessionTree 实现

**文件**：`session/session-tree.ts`（`SessionTreeImpl` 类）

Session 是 Stello 的原子单元。`SessionTreeImpl` 管理对话的树状空间结构，所有数据通过 `FileSystemAdapter` 持久化。

**存储模型**：

```
stello-data/
├── core.json                   ← L1 全局核心档案
└── sessions/                   ← 平铺存放（不嵌套）
    ├── {uuid-1}/meta.json
    ├── {uuid-2}/meta.json
    └── ...
```

树关系靠 `meta.json` 内的 `parentId` / `children` 维护，不靠文件夹嵌套。好处是 Agent 通过 UUID 一步定位，不需要遍历路径。

**10 个方法**：

| 方法 | 功能 |
|------|------|
| `createRoot(label?)` | 创建根 Session + 初始化 core.json |
| `createChild(options)` | 创建子 Session + 更新父的 children |
| `get(id)` | 按 ID 查找，不存在返回 null |
| `getRoot()` | 遍历找 parentId === null 的节点 |
| `listAll()` | 列出 sessions/ 下所有 meta.json |
| `archive(id)` | 归档（不连带子节点） |
| `addRef(fromId, toId)` | 创建跨分支引用 |
| `updateMeta(id, updates)` | 更新 label / scope / tags / metadata |
| `getAncestors(id)` | 向上遍历到根 |
| `getSiblings(id)` | 获取同级兄弟 |

**addRef 校验规则**：
1. 不能引用自己 → 抛错
2. 不能引用直系祖先 → `getAncestors()` 检查
3. 不能引用直系后代 → `getAllDescendants()` 递归检查
4. 重复引用 → 幂等跳过（不抛错）

**测试覆盖（15 个）**：
- createRoot / createChild 基本创建
- 父不存在时抛错
- get 正常 / 不存在
- getRoot / listAll
- getAncestors（三级链路）/ getSiblings
- archive 不连带子节点
- addRef 正常 + 四种校验（自引用、祖先、后代、幂等）
- updateMeta 持久化验证

---

## Phase 2：架构变更 — summary.json → markdown 文件

**时间**：2026-03-17
**Commit**：`320b3d8`
**测试**：28 个（fs 11 + session 17，新增 4 个）

### 2.1 变更背景

原设计中每个 Session 有一个 `summary.json` 存 Session 摘要（结构化 JSON）。经过评估后改为三个 markdown 文件：

| 旧 | 新 | 用途 | 维护者 |
|----|-----|------|--------|
| `summary.json` | `memory.md` | Session 记忆摘要（结论、意图、待跟进） | Agent（afterTurn 自动提炼） |
| _(无)_ | `scope.md` | 对话边界（这个 Session 能聊什么、不能聊什么） | Agent（创建子 Session 时生成） |
| _(无)_ | `index.md` | 子节点目录（子 Session 标题 + 摘要） | 框架自动维护 |

**设计原则**：`meta.json` 存结构化关系数据（JSON），其余内容文件用 markdown。理由：

1. **LLM 原生理解** — markdown 是 LLM 训练语料中最常见的格式，注入 prompt 无需额外转换
2. **用户可读写** — 开发者可以直接打开 `.md` 文件查看或手动编辑 Session 记忆
3. **灵活性** — markdown 没有 schema 约束，Agent 可以自由组织内容结构

### 2.2 类型层变更

**移除**：

- `SessionSummary` 接口 — 不再需要结构化的摘要对象
- `types.ts` 和 `index.ts` 中对应的 re-export

**修改 `AssembledContext`**（bootstrap / assemble 的产物）：

```typescript
// Before
export interface AssembledContext {
  core: Record<string, unknown>;
  summaries: SessionSummary[];        // 结构化摘要数组
  currentSummary: SessionSummary | null;
}

// After
export interface AssembledContext {
  core: Record<string, unknown>;
  memories: string[];                 // 按继承策略收集的 memory.md 内容列表
  currentMemory: string | null;       // 当前 Session 的 memory.md 内容
  scope: string | null;               // 当前 Session 的 scope.md 内容（新增）
}
```

**修改 `MemoryEngine`**：

```typescript
// 原方法改名
readSummary → readMemory(sessionId): Promise<string | null>
writeSummary → writeMemory(sessionId, content): Promise<void>

// 新增 4 个方法
readScope(sessionId): Promise<string | null>
writeScope(sessionId, content): Promise<void>
readIndex(sessionId): Promise<string | null>
writeIndex(sessionId, content): Promise<void>
```

**修改 `FileSystemAdapter`**：新增 `readFile` / `writeFile` 方法，用于读写纯文本文件（区别于 `readJSON` / `writeJSON`）。

**修改 `LifecycleHooks`**：`AfterTurnResult.summaryUpdated` → `memoryUpdated`，所有钩子 JSDoc 更新为引用 `memory.md` / `scope.md` / `index.md`。

### 2.3 实现层变更

**NodeFileSystemAdapter** — 新增两个方法：

```typescript
async readFile(path: string): Promise<string | null> {
  // fsReadFile + ENOENT → null，与 readJSON 同模式
}

async writeFile(path: string, content: string): Promise<void> {
  // ensureDir + fsWriteFile，与 writeJSON 同模式
}
```

> 因为类方法名与 `node:fs/promises` 的 `readFile` / `writeFile` 冲突，导入时加了别名 `fsReadFile` / `fsWriteFile`。

**SessionTreeImpl** — `createRoot` 和 `createChild` 增加 .md 文件初始化：

```typescript
// 写完 meta.json 后
await this.fs.writeFile(`sessions/${meta.id}/memory.md`, '');
await this.fs.writeFile(`sessions/${meta.id}/scope.md`, '');
await this.fs.writeFile(`sessions/${meta.id}/index.md`, '');
```

### 2.4 变更文件清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `types/fs.ts` | 新增方法 | `readFile` / `writeFile` |
| `types/memory.ts` | 删除 + 修改 | 移除 `SessionSummary`，改 `AssembledContext` / `MemoryEngine` |
| `types/lifecycle.ts` | 修改 | `summaryUpdated` → `memoryUpdated`，JSDoc 更新 |
| `types.ts` | 修改 | 移除 `SessionSummary` 导出 |
| `index.ts` | 修改 | 移除 `SessionSummary` 导出 |
| `fs/file-system-adapter.ts` | 新增方法 + 重构导入 | 实现 `readFile` / `writeFile`，fs 导入加别名 |
| `fs/__tests__/...test.ts` | 新增用例 | +2 个测试（readFile/writeFile） |
| `session/session-tree.ts` | 修改 | createRoot / createChild 创建 .md 文件 |
| `session/__tests__/...test.ts` | 新增用例 | +2 个测试（.md 文件存在性） |
| `CLAUDE.md` | 修改 | 更新进度 |

### 2.5 Session 文件结构（最终版）

```
sessions/{uuid}/
├── meta.json       ← 结构化元数据（JSON）：父子关系、状态、时间戳
├── memory.md       ← Session 记忆摘要（Markdown）：Agent afterTurn 提炼
├── scope.md        ← 对话边界（Markdown）：创建子 Session 时 Agent 生成
├── index.md        ← 子节点目录（Markdown）：框架自动维护
└── records.jsonl   ← 原始对话记录（JSONL）：每行一条 turn
```

---

## Phase 3（进行中）：记忆系统

### 3.1 L1 核心档案 CoreMemory

**时间**：2026-03-17
**Commit**：`3dea1bb`
**测试**：40 个（fs 11 + session 17 + core-memory 12）

**文件**：`memory/core-memory.ts`（`CoreMemory` 类）

CoreMemory 管理全局 `core.json`（L1 核心档案），是记忆系统三层中的第一层。开发者通过 `CoreSchema` 定义字段结构，CoreMemory 负责校验和持久化。

**核心能力**：

| 能力 | 实现方式 |
|------|----------|
| 点路径读写 | `getByPath` / `setByPath` 工具函数，支持 `'profile.gpa'` 嵌套访问 |
| Schema 类型校验 | 顶层写入时校验值类型匹配（string/number/boolean/array/object） |
| onChange 事件 | 写入后 emit `CoreChangeEvent { path, oldValue, newValue }` |
| requireConfirm 确认流程 | schema 标记 `requireConfirm` 的字段 → emit `UpdateProposal` 而不写入 |
| confirmWrite | 供 ConfirmProtocol 确认后调用，跳过确认检查直接写入 |
| 初始化默认值 | `core.json` 不存在时按 schema 的 `default` 字段生成 |

**方法清单**：

| 方法 | 功能 |
|------|------|
| `init()` | 加载或创建 core.json |
| `readCore(path?)` | 读取，无 path 返回整个对象，有 path 走点路径 |
| `writeCore(path, value)` | 写入，校验 schema + requireConfirm 检查 |
| `confirmWrite(path, value)` | 确认写入，跳过 requireConfirm |
| `on(event, handler)` | 注册事件监听 |
| `off(event, handler)` | 取消事件监听 |

**事件系统**：自建 typed emitter（`Map<string, Set<handler>>`），不依赖 Node.js EventEmitter，保持可移植性。复用 `CoreChangeEvent`（engine.ts）和 `UpdateProposal`（lifecycle.ts）类型。

**Schema 校验规则**：
- 顶层写入（如 `writeCore('gpa', 3.5)`）：校验值类型匹配 schema 定义
- 嵌套写入（如 `writeCore('profile.gpa', 3.5)`）：只校验顶层 key 存在于 schema
- 不存在的字段：直接抛错

**测试覆盖（12 个）**：
- init 默认值创建 / 加载已有数据
- readCore 完整对象 / 点路径 / 不存在路径
- writeCore 写入持久化 / 点路径嵌套 / 类型校验拒绝 / 不存在字段拒绝
- onChange 事件触发验证
- requireConfirm 触发 proposal + 数据不变
- confirmWrite 写入 + change 事件

### 3.2 L2 + L3 SessionMemory

**时间**：2026-03-17
**Commit**：`12fa359`
**测试**：50 个（fs 11 + session 17 + core-memory 12 + session-memory 10）

**文件**：`memory/session-memory.ts`（`SessionMemory` 类）

SessionMemory 是 FileSystemAdapter 的 Session 路径封装层，将底层文件操作映射为语义化的记忆读写方法。

**设计**：所有方法都是一层薄委托，核心是路径映射 `sessions/{sessionId}/{filename}`。

| 方法 | 文件 | 底层调用 |
|------|------|----------|
| `readMemory` / `writeMemory` | `memory.md` | `fs.readFile` / `fs.writeFile` |
| `readScope` / `writeScope` | `scope.md` | `fs.readFile` / `fs.writeFile` |
| `readIndex` / `writeIndex` | `index.md` | `fs.readFile` / `fs.writeFile` |
| `appendRecord` | `records.jsonl` | `fs.appendLine(JSON.stringify)` |
| `readRecords` | `records.jsonl` | `fs.readLines` → `map(JSON.parse)` |

**L3 存储格式**：JSONL（每行一个 JSON 对象），每条记录是一个 `TurnRecord { role, content, timestamp, metadata? }`。

**测试覆盖（10 个）**：
- memory.md / scope.md / index.md：正常读写 + 空文件 + 不存在返回 null
- records.jsonl：追加读取 + 无记录空数组 + 多条记录顺序正确

### 3.3 LifecycleManager — 上下文组装 + 生命周期钩子

**时间**：2026-03-17
**Commit**：`5b90342`
**测试**：65 个（fs 11 + session 17 + core-memory 12 + session-memory 10 + lifecycle 15）

**文件**：`lifecycle/lifecycle-manager.ts`（`LifecycleManager` 类）

LifecycleManager 是 Stello 的调度中枢，串联 CoreMemory + SessionMemory + SessionTreeImpl + callLLM。

**核心方法**：

| 方法 | 功能 |
|------|------|
| `bootstrap(sessionId)` | 进入 Session 时组装上下文，返回 BootstrapResult |
| `assemble(sessionId)` | 组装 prompt 上下文，返回 AssembledContext |
| `afterTurn(sessionId, userMsg, assistantMsg)` | 每轮结束处理，三层独立写入 |
| `onSessionSwitch(fromId, toId)` | 切换 Session，更新旧 memory → bootstrap 新 |
| `prepareChildSpawn(options)` | 创建子 Session + scope.md + 父 index.md |

**继承策略实现**（`collectMemories` 方法）：

| 策略 | 收集逻辑 |
|------|----------|
| `minimal` | 不收集任何祖先 memory |
| `summary` | 只取父的 memory.md |
| `full` | `getAncestors()` → reverse 得到根→父顺序 → 逐个读 memory.md |
| `scoped` | 父 memory.md + `getSiblings()` 过滤同 scope → 读 memory.md |

**afterTurn 三层独立设计**：

```
try L3: appendRecord × 2
try L2: callLLM 提炼 → writeMemory
try L1: callLLM 检测变更 → writeCore
try index: updateParentIndex
```

每层独立 try/catch，失败通过 `emitError(source, err)` 通知，不影响其他层。error 事件通过 `onError`/`offError` 监听。

**LLM Prompt**：
- memory 提炼：当前记忆 + 新对话 → 输出 markdown 摘要
- L1 检测：当前档案 + 新对话 → 输出 `{"updates":[{path, value}]}` JSON
- scope 生成：父/子标题 → 输出对话边界 markdown

**测试拆分**（避免单文件超 200 行）：
- `lifecycle-bootstrap.test.ts`（6 个）：bootstrap 基本 + 四种继承策略 + assemble
- `lifecycle-turns.test.ts`（9 个）：afterTurn 各层 + 失败隔离 + error 事件 + onSessionSwitch + prepareChildSpawn

---

## Phase 4：冒泡机制 BubbleManager

**时间**：2026-03-17
**Commit**：`841bf9b`
**测试**：71 个（fs 11 + session 17 + core-memory 12 + session-memory 10 + lifecycle 15 + bubble 6）

**文件**：`memory/bubble.ts`（`BubbleManager` 类）

BubbleManager 实现子 Session 的 L1 字段变更冒泡到全局 core.json。只有 schema 中标记 `bubbleable: true` 的字段才会冒泡，同字段短时间多次变更通过 500ms debounce 合并为一次写入。

**核心方法**：

| 方法 | 功能 |
|------|------|
| `handleBubble(path, value)` | 同步方法：过滤非 bubbleable → debounce → 定时调 writeCore |
| `flush()` | 立即执行所有待处理的冒泡写入（关闭前 / 测试用） |
| `dispose()` | 清理所有 timer，不执行写入 |

**设计决策**：
- **不依赖 SessionTreeImpl**：v0.1 无跨 Session 冲突检测需求，KISS 原则
- **复用 CoreMemory.writeCore**：requireConfirm 字段自动走确认流程（CoreMemory 内部处理）
- **last-write-wins**：同字段 debounce 期间多次变更，只保留最后一次

**集成方式**：
- LifecycleManager 构造函数中创建 BubbleManager 实例
- afterTurn L1 步骤从直接 `coreMemory.writeCore` 改为 `bubbleManager.handleBubble`
- 新增 `LifecycleManager.flushBubbles()` 暴露给外部（测试 / 关闭前调用）

**测试覆盖（6 个）**：
- bubbleable 字段 500ms 后写入 core.json
- 非 bubbleable 字段不触发写入
- 500ms debounce：短时间多次只写最后一次
- requireConfirm + bubbleable 走确认流程（触发 updateProposal，不直接写入）
- flush 立即执行所有待处理冒泡
- dispose 清理 timer 不执行写入

**lifecycle-turns.test.ts 适配**：
- testSchema 字段加 `bubbleable: true`
- "afterTurn 检测 L1 变更" 测试在断言前调 `lm.flushBubbles()`

---

## Phase 5：拆分策略 + 确认协议

**时间**：2026-03-17
**Commit**：`066bdbc`
**测试**：82 个（fs 11 + session 17 + core-memory 12 + session-memory 10 + lifecycle 15 + bubble 6 + confirm 5 + split-guard 6）

### 5.1 ConfirmManager — 确认协议实现

**文件**：`confirm/confirm-manager.ts`

ConfirmManager 实现 `ConfirmProtocol` 接口，处理拆分建议和 L1 更新建议的确认/拒绝。

| 方法 | 功能 |
|------|------|
| `confirmSplit(proposal)` | 从 SplitProposal 构造 CreateSessionOptions → 调 lifecycle.prepareChildSpawn |
| `dismissSplit(proposal)` | v0.1 空实现 |
| `confirmUpdate(proposal)` | 调 coreMemory.confirmWrite（跳过 requireConfirm 直接写入） |
| `dismissUpdate(proposal)` | v0.1 空实现 |

**设计决策**：
- 复用 `LifecycleManager.prepareChildSpawn`，不重复实现 createChild + scope.md + index.md 逻辑
- 复用 `CoreMemory.confirmWrite`，保持写入路径一致

**测试覆盖（5 个）**：
- confirmSplit 创建子 Session（parentId、label、scope 正确，scope.md 已生成）
- confirmSplit 更新父 index.md
- dismissSplit 不创建 Session
- confirmUpdate 写入 requireConfirm 字段
- dismissUpdate 不写入

### 5.2 SplitGuard — 拆分保护机制

**文件**：`session/split-guard.ts`

SplitGuard 检查 Session 是否满足拆分条件，防止过早或过于频繁的拆分。

| 方法 | 功能 |
|------|------|
| `checkCanSplit(sessionId)` | 检查 turnCount >= minTurns 且冷却期满 |
| `recordSplit(sessionId, turnCount)` | 记录一次拆分的 turnCount，供冷却期计算 |

**冷却期实现**：内存 Map 记录每个 Session 上次拆分时的 turnCount，下次检查时比较差值。v0.1 不持久化（进程重启后重置），足够简单。

**附带变更**：`SessionTreeImpl.updateMeta` 扩展支持 `turnCount` 字段更新。

**测试覆盖（6 个）**：
- 轮次不足不允许拆分
- 轮次足够允许拆分
- 冷却期内不允许拆分
- 冷却期满后允许拆分
- Session 不存在返回不可拆分
- 不同 Session 冷却期独立

---

## 当前代码统计

| 指标 | 数量 |
|------|------|
| 类型接口文件 | 5 个（types/ 目录） |
| 实现文件 | 8 个（+confirm-manager, split-guard） |
| 测试文件 | 9 个 |
| 测试用例 | 82 个（全部通过） |
| 导出类型 | 26 个（+SplitCheckResult） |
| 导出实现 | 8 个（+ConfirmManager, SplitGuard） |

---

## 下一步：Phase 6 — Skill 插槽

实现 Skill 注册 + 手动调用（v0.1 不做意图路由）。
