# Stello SDK PRD
## 产品需求文档 v0.4 · 内部开发
> 更新时间：2026年3月18日

---

## 一、产品概述

**产品名称**：Stello
**形态**：开源 TypeScript SDK（npm 包）
**npm**：@stello-ai/core · @stello-ai/visualizer
**仓库**：github.com/stello-agent/stello
**协议**：Apache-2.0

**定位**：首个开源对话拓扑引擎。让 AI Agent 自动将线性对话分裂为树状 Session，跨分支继承记忆，整个拓扑渲染为可交互的星空图。

**核心体验目标**：让终端用户获得一次深入、连贯、有结构的研究或咨询体验。不是"对话工具"，而是"思考空间"。

---

## 二、核心原则

1. **场景无关**：不含任何业务逻辑，留学/法律/研究/创作都是上层配置
2. **开发者定规则，框架管生命周期**：拆分规则、记忆结构、引导逻辑由开发者注册
3. **渐进式采用**：Session 系统、记忆系统、文件系统、可视化四个能力独立可用
4. **存储无关**：默认文件系统，可换 adapter
5. **可扩展**：Session 元数据、记忆字段、Skill 插槽全部开放

---

## 三、产品架构

```
┌─────────────────────────────────────────┐
│              @stello-ai/core            │
│                                         │
│   Session 系统（结构层）                │
│   管理对话的空间结构：谁是谁的子节点    │
│         ↕                               │
│   记忆系统（内容层）                    │
│   管理每个 Session "知道什么"           │
│         ↕                               │
│   文件系统（持久化层）                  │
│   管理数据"存在哪、怎么存"             │
│                                         │
│   + Skill 插槽 + 生命周期钩子          │
│   + Agent Tools + 确认协议             │
│   + DX 辅助函数                        │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│           @stello-ai/visualizer         │
│   星空图渲染 + 交互 + React 组件       │
│   + 对话面板 + 文件浏览器              │
│   + 节点拖拽 + Liquid Glass 视觉风格   │
└─────────────────────────────────────────┘
```

---

## 四、Session 系统

### 做什么

管理对话的空间结构。Session 是 Stello 的原子单元——一个独立的对话空间。Session 之间形成树状父子关系，支持跨分支横向引用。

### Session 元数据

**框架内置字段**：id, parentId, children, refs, label, index, scope, status(active/archived), depth, turnCount(afterTurn 自动递增), isRoot(v0.2 预留), metadata, tags, createdAt/updatedAt/lastActiveAt

### Session 内置文件

| 文件 | 用途 | 谁生成 | 谁消费 |
|------|------|--------|--------|
| meta.json | 结构化元数据 | 框架 | 框架 |
| memory.md | 记忆摘要 | Agent（afterTurn） | Agent（bootstrap） |
| scope.md | 对话边界 | Agent（创建时） | Agent（每轮读取） |
| index.md | 子节点目录 | 框架自动维护 | Agent + 用户 |
| records.jsonl | 原始对话 | 框架追加 | 按需检索 |

JSON 管结构，Markdown 管内容。开发者可加自定义文件。

### Session 拆分（双路径）

**路径 A（被动）**：embedder 漂移检测 → 超阈值触发建议。可选，v0.1 只预留接口。

**路径 B（主动）**：Agent 调 `stello_create_session` tool。v0.1 完整实现。

**保护机制**：最少 N 轮（默认 3）+ 冷却期（默认 5 轮）+ `testMode` 可跳过。

### 跨分支引用

A→B 引用，不能引用自己/直系祖先/后代，星空图渲染为虚线。

### Session 访问规则

- 父通过 index.md 查看子概况，按需加载子 memory.md
- 子不能读兄弟内容
- Agent 可通过 tool 主动读任意 Session 的 memory.md

### 产品决策

不支持删除只支持归档，归档不连带子 Session。

---

## 五、记忆系统

### 三层结构

| 层 | 文件 | 格式 | 说明 |
|----|------|------|------|
| L1 核心档案 | core.json | JSON | 全局唯一，schema 由开发者定义 |
| L2 Session 记忆 | memory.md | Markdown | 每 Session 一份，afterTurn 自动提炼 |
| L3 原始记录 | records.jsonl | JSONL | 每 Session 一份，追加写入 |

### L1 核心档案（CoreMemory）

- schema 定义字段类型、默认值、`bubbleable`、`requireConfirm` 标记
- 点路径读写：`readCore('profile.gpa')` / `writeCore('profile.gpa', 3.6)`
- 别名方法：`getAll()` / `get(path)`
- 写入校验 schema，不符抛错
- `onChange` 字段级事件
- `requireConfirm` 字段 → emit updateProposal，确认后 `confirmWrite()` 写入
- 内存缓存 + 每次写刷盘

### scope.md（对话边界）

创建子 Session 时 Agent 通过 callLLM 生成。定义能聊什么、不能聊什么。Agent 每轮读取判断是否跑偏。

### index.md（子节点目录）

框架自动维护。子 Session 创建/归档/memory 更新时重新生成。

### 上下文组装（AssembledContext）

```
{ core, memories: string[], currentMemory, scope }
```

### 继承策略（inheritancePolicy）

`full`(所有祖先) / `summary`(只父，默认) / `minimal`(只L1) / `scoped`(父+同scope兄弟)

### 冒泡（bubblePolicy）

afterTurn L1 变更 → 只有 `bubbleable` 字段冒泡写入 core.json，非 bubbleable 跳过。500ms debounce。

---

## 六、文件系统

### 目录结构

```
stello-data/
├── core.json
└── sessions/
    └── {session-id}/
        ├── meta.json
        ├── memory.md
        ├── scope.md
        ├── index.md
        ├── records.jsonl
        └── ...（开发者自定义）
```

平铺不嵌套，adapter 模式。FileSystemAdapter 接口：readJSON/writeJSON/readFile/writeFile/appendLine/readLines/mkdir/exists/listDirs。

---

## 七、生命周期钩子

| 钩子 | 触发时机 | 做什么 |
|------|----------|--------|
| bootstrap | 进入 Session | 读 L1 + memory.md + scope.md，按继承策略组装上下文 |
| ingest | 消息进来 | 意图识别，匹配 Skill |
| assemble | 组装 prompt | 筛选 memory.md + scope.md 注入 |
| afterTurn | 每轮结束 | 写 L1(走冒泡) + 更新 memory.md + 追加 L3 + 更新父 index.md + **自动递增 turnCount** |
| compact | context 接近上限 | 压缩存入 memory.md（v0.1 只留接口） |
| onSessionSwitch | 切换 Session | 旧 Session 更新 memory.md → 新 Session bootstrap |
| prepareChildSpawn | 创建子 Session | 建文件夹 + meta.json + 空 memory.md + **Agent 生成 scope.md** + **更新父 index.md** |

三层独立写入，某层失败不影响其他层。

---

## 八、Skill 插槽

v0.1：注册接口（Map 存储，同名覆盖）+ 关键词匹配路由（不区分大小写）。

---

## 九、Agent Tools

8 个 tool，通过 `getToolDefinitions()` 导出。stello_create_session 受 SplitGuard 保护，缺 parentId 返回友好错误提示。统一 try/catch，成功 `{ success, data }`，失败 `{ success: false, error }`。

---

## 十、确认协议

splitProposal / updateProposal 事件 + confirm/dismiss API。框架只管协议，不提供 UI。

---

## 十一、可视化引擎（@stello-ai/visualizer）

独立包，不依赖 core（鸭子类型兼容）。

### 视觉风格：Apple Liquid Glass

毛玻璃面板、深色渐变星空背景、节点发光、冷色调配色、theme.ts 集中管理。

### 功能

- **星空图**：环形布局 + Canvas 渲染 + 渐变背景 + 节点发光
- **交互**：缩放/画布平移/节点拖拽（不改数据）/点击展开侧边栏/悬浮预览
- **ChatPanel**：对话面板，消息气泡 + 输入框，props 传入数据和回调
- **FilePanel**：文件浏览器，显示 memory.md/scope.md/index.md，只读
- **StelloGraph**：React 主组件，侧边栏 tab 切换（对话/文件），响应式

---

## 十二、DX 辅助函数

- `toVisualizerFormat(sessions)`：SessionMeta[] → VisualizerNode[]
- `exportForBrowser(tree, sessionMemory, coreMemory)`：一次性导出给浏览器（Record 类型，可 JSON 序列化）
- `CoreMemory.getAll()` / `.get(path)`：别名方法
- `SplitGuard testMode`：跳过保护限制

---

## 十三、不做什么（v0.2+）

Main Session 管理、Projection、Skill Pipeline/权限、时间轴回溯、L3 语义搜索、多布局模式、scope 横向召回、refs 自动注入、框架适配器、Cloud、模板市场、文件编辑功能。

---

## 十四、设计决策记录

1. 平铺不嵌套 2. 双路径拆分 3. adapter 模式 4. 确认协议不含 UI 5. afterTurn 三层独立 6. 即时冒泡+debounce 7. onChange 字段级 8. v0.1 不做锁 9. JSON+Markdown 混合 10. Session 三个.md 11. Main Session 预留 12. visualizer 不依赖 core 13. afterTurn 自动递增 turnCount 14. CoreMemory 别名 15. SplitGuard testMode 16. exportForBrowser 用 Record 17. inline styles 零依赖
