# 贡献指南

欢迎为 Stello 贡献代码！本指南将帮助你完成从开发环境搭建到提交 Pull Request 的全过程。

## 📋 目录

- [⚠️ 重要：PR 格式要求](#️-重要pr-格式要求)
- [开发环境要求](#开发环境要求)
- [快速开始](#快速开始)
- [项目结构](#项目结构)
- [开发流程](#开发流程)
- [代码规范](#代码规范)
- [测试要求](#测试要求)
- [提交规范](#提交规范)
- [Pull Request 流程](#pull-request-流程)
- [常见问题](#常见问题)

---

## ⚠️ 重要：PR 格式要求

Stello 使用 **Changesets 自动发布工作流**。为了确保你的改动能被正确发布，**所有包含功能代码改动的 PR 都必须包含 changeset 文件**。

### 什么情况需要 changeset？

✅ **必须添加 changeset：**
- 修复 Bug
- 添加新功能
- 修改公开 API
- 性能优化
- 依赖版本更新（如果影响使用者）

❌ **不需要 changeset：**
- 仅修改文档（README、注释、Markdown 文件）
- 仅修改测试代码（不改功能）
- 仅修改构建配置（不影响使用者）
- 仅修改 CI/CD 配置

### Changeset 格式要求

**标准格式：**

```markdown
---
"包名": 版本类型
---

变更描述标题

- 详细变更点 1
- 详细变更点 2
```

**具体规则：**

1. **包名**：必须使用完整的 scoped 包名
   - ✅ `"@stello-ai/core"`
   - ✅ `"@stello-ai/session"`
   - ❌ `"core"` （错误：缺少 scope）

2. **版本类型**：必须是 `patch`、`minor` 或 `major` 之一
   - `patch` - Bug 修复、小改进（0.2.0 → 0.2.1）
   - `minor` - 新功能、向后兼容（0.2.0 → 0.3.0）
   - `major` - 破坏性变更（0.2.0 → 1.0.0）

3. **变更描述**：
   - 第一行是标题，简洁明了
   - 建议使用 `feat(模块): 功能描述` 或 `fix(模块): 问题描述` 格式
   - 后续使用列表详细说明改动点
   - 支持 Markdown 格式
   - 这些内容会直接出现在 CHANGELOG 中，面向最终用户

**正确示例：**

```markdown
---
"@stello-ai/core": minor
"@stello-ai/session": patch
---

feat(core): 添加 Session 树深度限制配置

- 新增 `maxDepth` 配置项，防止无限递归分支
- 修复 `SessionEngine.fork()` 的深度检查逻辑
- 更新相关类型定义
```

**错误示例：**

```markdown
---
"core": minor          ❌ 缺少 @stello-ai/ scope
---

更新了一些东西         ❌ 描述不清晰
```

### 如何添加 changeset

在提交 PR 之前，运行：

```bash
pnpm changeset
```

按提示操作：
1. 空格选中受影响的包，回车确认
2. 为每个包选择版本类型（patch/minor/major）
3. 输入变更描述（支持多行，Ctrl+D 结束）

这会在 `.changeset/` 目录生成一个随机命名的 `.md` 文件，**必须将其一起提交到 PR 中**。

### 检查你的 changeset

提交前检查 `.changeset/` 目录下新生成的文件：

```bash
cat .changeset/你的changeset文件.md
```

确认：
- [ ] 包名正确（带 `@stello-ai/` 前缀）
- [ ] 版本类型合理（patch/minor/major）
- [ ] 描述清晰（其他开发者能看懂）
- [ ] 文件已被 git 添加（`git status` 能看到）

---

## 开发环境要求

在开始之前，请确保你的开发环境满足以下要求：

- **Node.js**: >= 20.0.0
- **pnpm**: >= 9.15.4
- **TypeScript**: >= 5.0.0
- **Git**: 最新稳定版

### 安装 pnpm

如果你还没有安装 pnpm，可以通过以下命令安装：

```bash
npm install -g pnpm@9.15.4
# 或使用 corepack（推荐）
corepack enable
corepack prepare pnpm@9.15.4 --activate
```

---

## 快速开始

### 1. Fork 仓库

访问 [github.com/stello-agent/stello](https://github.com/stello-agent/stello) 并点击右上角的 "Fork" 按钮。

### 2. Clone 你的 Fork

```bash
git clone https://github.com/YOUR_USERNAME/stello.git
cd stello
```

### 3. 添加上游仓库

```bash
git remote add upstream https://github.com/stello-agent/stello.git
```

### 4. 安装依赖

```bash
pnpm install
```

这会安装所有包的依赖，包括 `packages/devtools/web` 子项目的依赖。

### 5. 构建项目

```bash
pnpm build
```

这会按拓扑顺序构建所有包（`core`, `session`, `server`, `devtools`）。

### 6. 运行测试

```bash
pnpm test
```

确保所有测试通过后再开始开发。

---

## 项目结构

Stello 是一个 pnpm monorepo，包含以下核心包：

```
stello/
├── packages/
│   ├── core/          # 编排引擎 - Session 树调度、全局意识整合
│   ├── session/       # 独立对话单元 - 三层记忆的最小实现
│   ├── server/        # 服务化层 - PostgreSQL + HTTP/WebSocket
│   ├── devtools/      # 开发调试工具 - 星空图可视化
│   │   └── web/       # devtools 的前端界面（独立 Vite 项目）
├── demo/              # 示例代码
├── docs/              # 设计文档
├── .changeset/        # Changesets 配置和变更日志
└── .github/           # GitHub Actions 工作流
    └── workflows/
        └── release.yml # 自动发布工作流
```

### 包之间的依赖关系

```
server → core → session
devtools → core + session
```

---

## 开发流程

### 1. 创建功能分支

始终从 `main` 分支的最新代码创建新分支：

```bash
git checkout main
git pull upstream main
git checkout -b feat/your-feature-name
```

分支命名规范：

- `feat/xxx` - 新功能
- `fix/xxx` - Bug 修复
- `docs/xxx` - 文档更新
- `test/xxx` - 测试相关
- `refactor/xxx` - 重构
- `chore/xxx` - 构建、配置等杂项

### 2. 进行开发

#### 选择合适的包

根据你的改动性质选择对应的包：

- **只需要单个对话 + 记忆** → 修改 `packages/session`
- **需要多分支对话 + 全局整合** → 修改 `packages/core`
- **需要生产级部署 + 多租户** → 修改 `packages/server`
- **开发调试界面** → 修改 `packages/devtools`

#### 开发时的常用命令

```bash
# 在特定包中运行命令
pnpm --filter @stello-ai/core build
pnpm --filter @stello-ai/session test

# 在所有包中运行命令
pnpm -r build        # 递归构建所有包
pnpm -r test         # 递归运行所有测试
pnpm -r typecheck    # 类型检查

# 运行示例
pnpm demo:agent      # 基础 Agent 示例
pnpm demo:chat       # 带 Devtools 的聊天示例
```

### 3. 添加 Changeset（必需）

**这是自动发布流程的关键步骤，所有功能代码改动都必须添加！**

详细的格式要求请查看 [PR 格式要求](#️-重要pr-格式要求) 章节。

快速步骤：

```bash
pnpm changeset
```

按提示选择包、版本类型、填写描述，然后将生成的文件提交到 Git

### 4. 编写测试

所有新功能和 Bug 修复都必须包含测试。Stello 使用 [Vitest](https://vitest.dev/) 作为测试框架。

测试文件命名：

- 单元测试：`*.test.ts`
- 集成测试：`*.integration.test.ts`

测试要求：

- ✅ 正常路径（happy path）
- ✅ 错误输入（invalid inputs）
- ✅ 边界条件（edge cases）
- ✅ 异步逻辑的正确性

示例测试结构：

```typescript
import { describe, it, expect } from 'vitest'

describe('SessionEngine', () => {
  describe('turn()', () => {
    it('应该正确处理单次工具调用', async () => {
      // Arrange
      const engine = createTestEngine()

      // Act
      const result = await engine.turn('session-id', 'test message')

      // Assert
      expect(result.messages).toHaveLength(2)
    })

    it('应该在工具调用失败时抛出错误', async () => {
      // ...
    })
  })
})
```

运行测试：

```bash
# 运行所有测试
pnpm test

# Watch 模式（开发时推荐）
pnpm --filter @stello-ai/core test:watch

# 运行特定测试文件
pnpm --filter @stello-ai/core test src/engine.test.ts
```

---

## 代码规范

Stello 遵循严格的代码规范，详细规范请参考 [CLAUDE.md](./CLAUDE.md#代码规范)。

### 核心原则

1. **TypeScript 严格模式** - 启用所有严格检查
2. **禁止使用 `any`** - 始终明确类型
3. **KISS 原则** - 保持简单，避免过度抽象
4. **模块间通过 interface 通信** - 不允许跨包 import 内部文件

### 注释规范

每个函数需要一行中文注释：

```typescript
// 组装 Session 的完整上下文（system prompt + insights + L3 + msg）
function assembleContext(session: Session, message: string): Message[] {
  // ...
}
```

每个 interface 需要 JSDoc 注释：

```typescript
/**
 * Session 的持久化接口
 *
 * 负责存储单个 Session 的所有数据：L3 对话记录、system prompt、insight、L2 记忆
 */
export interface SessionStorage {
  // ...
}
```

### 代码格式化

项目使用 ESLint + Prettier 进行代码检查和格式化：

```bash
# 检查代码风格
pnpm lint

# 自动修复格式问题
pnpm format
```

**重要：** 提交前请确保运行 `pnpm lint` 和 `pnpm format`。

---

## 提交规范

### Commit 消息格式

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Type（必填）：**

- `feat` - 新功能
- `fix` - Bug 修复
- `docs` - 文档更新
- `test` - 测试相关
- `chore` - 构建、配置等杂项
- `refactor` - 重构（既不修复 Bug 也不添加功能）
- `perf` - 性能优化
- `style` - 代码格式（不影响逻辑）

**Scope（可选）：**

包名或模块名，如 `core`, `session`, `server`, `devtools`

**Subject（必填）：**

简短的中文描述（50 字以内）

**示例：**

```bash
git commit -m "feat(core): 添加 Session 树深度限制配置"
git commit -m "fix(session): 修复 consolidate() 的异步竞态问题"
git commit -m "docs: 更新 README 中的快速开始示例"
git commit -m "test(server): 添加 AgentPool 的集成测试"
```

### 提交前检查清单

在提交代码前，请确认：

- [ ] 代码已通过 `pnpm typecheck`
- [ ] 代码已通过 `pnpm lint`
- [ ] 代码已通过 `pnpm test`
- [ ] 已添加必要的测试
- [ ] **已添加 changeset（如果修改了功能代码）** ⚠️
- [ ] Changeset 格式正确（包名带 `@stello-ai/` 前缀）
- [ ] Changeset 描述清晰（面向用户，会出现在 CHANGELOG）
- [ ] Commit 消息符合规范

可以使用以下命令一次性检查：

```bash
pnpm typecheck && pnpm lint && pnpm test
```

检查 changeset 是否已添加：

```bash
git status | grep .changeset
```

应该能看到类似 `.changeset/xxx.md` 的文件。

---

## Pull Request 流程

### 1. 推送到你的 Fork

```bash
git push origin feat/your-feature-name
```

### 2. 创建 Pull Request

1. 访问 [github.com/stello-agent/stello/pulls](https://github.com/stello-agent/stello/pulls)
2. 点击 "New pull request"
3. 选择 `base: main` ← `compare: feat/your-feature-name`
4. 填写 PR 描述

### PR 描述模板

**必填项已用 ⚠️ 标记**

```markdown
## 概述 ⚠️

简要描述这个 PR 解决了什么问题或添加了什么功能。

## 改动类型 ⚠️

请勾选适用的类型：

- [ ] 🐛 Bug 修复
- [ ] ✨ 新功能
- [ ] 📝 文档更新
- [ ] ♻️ 代码重构
- [ ] ⚡️ 性能优化
- [ ] ✅ 测试相关
- [ ] 🔧 构建/配置

## 改动内容

- 修改了 xxx
- 添加了 xxx
- 修复了 xxx

## Changeset ⚠️

请确认以下其中一项：

- [ ] 已添加 changeset（功能代码改动）
  - Changeset 文件：`.changeset/xxx-xxx-xxx.md`
  - 影响的包：`@stello-ai/core`, `@stello-ai/session` 等
  - 版本类型：patch / minor / major
- [ ] 不需要 changeset（仅文档/测试/配置改动）

## 测试

- [ ] 添加了单元测试
- [ ] 添加了集成测试
- [ ] 本地测试全部通过（`pnpm test`）
- [ ] 类型检查通过（`pnpm typecheck`）

## Checklist ⚠️

- [ ] 代码已通过 `pnpm typecheck`
- [ ] 代码已通过 `pnpm lint`
- [ ] 代码已通过 `pnpm test`
- [ ] 已添加必要的 changeset 或确认不需要
- [ ] Changeset 格式正确（包名带 `@stello-ai/` 前缀）
- [ ] Commit 消息符合规范
- [ ] 文档已更新（如需要）

## 相关 Issue

Closes #xxx
```

**PR 提交后，维护者会检查：**

1. ✅ Changeset 是否已添加（功能改动必需）
2. ✅ Changeset 格式是否正确
3. ✅ CI 检查是否全部通过
4. ✅ 代码质量和测试覆盖率

如果缺少 changeset，维护者会要求补充后才能合并。

### 3. 等待 Code Review

维护者会审查你的代码并提供反馈。请耐心等待，并及时响应评审意见。

### 4. 合并

当 PR 被批准后，维护者会将其合并到 `main` 分支。

**注意：** 不要自行合并 PR，即使你有权限。

---

## 常见问题

### Q: 我需要添加新的依赖怎么办？

A: 在对应包的目录下运行：

```bash
cd packages/core
pnpm add <package-name>
```

注意：添加新依赖需要在 PR 中说明理由。

### Q: 构建失败怎么办？

A: 按以下顺序排查：

1. 确保 pnpm 版本正确：`pnpm --version`
2. 清除缓存：`rm -rf node_modules pnpm-lock.yaml && pnpm install`
3. 确保按拓扑顺序构建：`pnpm -r build`
4. 检查是否有 TypeScript 错误：`pnpm typecheck`

### Q: 测试失败怎么办？

A:

1. 单独运行失败的测试文件查看详细错误
2. 检查是否有异步问题（未 await、竞态条件）
3. 检查测试环境是否被污染（共享状态、未清理的副作用）

### Q: 我应该如何处理破坏性变更？

A:

1. 在 changeset 中选择 `major` 版本
2. 在 PR 描述中明确说明破坏性变更的内容
3. 在 changeset 描述中添加迁移指南
4. 与维护者讨论是否有向后兼容的方案

### Q: 如何同步上游的最新代码？

A:

```bash
git checkout main
git fetch upstream
git merge upstream/main
git push origin main
```

在功能分支上同步：

```bash
git checkout feat/your-feature-name
git rebase main
```

### Q: 我忘记添加 changeset 了怎么办？

A: 在提交代码后任何时候都可以添加：

```bash
pnpm changeset
git add .changeset/xxx.md
git commit -m "chore: 添加 changeset"
```

---

## 获得帮助

如果你在贡献过程中遇到任何问题：

- 📖 阅读 [CLAUDE.md](./CLAUDE.md) - 项目架构和设计理念
- 📖 阅读 [docs/](./docs/) - 详细设计文档
- 💬 在 [GitHub Issues](https://github.com/stello-agent/stello/issues) 提问
- 💬 在 [GitHub Discussions](https://github.com/stello-agent/stello/discussions) 讨论

---

## 行为准则

请遵守开源社区的基本行为准则：

- 尊重所有贡献者
- 接受建设性批评
- 专注于对项目最有利的事情
- 保持友善和包容

---

感谢你为 Stello 做出贡献！🎉
