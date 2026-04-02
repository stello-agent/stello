# 贡献指南

## 快速开始

```bash
git clone https://github.com/YOUR_USERNAME/stello.git
cd stello
pnpm install
pnpm build
pnpm test
```

要求：Node.js >= 20，pnpm >= 9.15.4

## 项目结构

```
packages/
  session/    # 独立对话单元 - 三层记忆的最小实现
  core/       # 编排引擎 - Session 树调度、全局意识整合
  server/     # 服务化层 - PostgreSQL + HTTP/WebSocket
  devtools/   # 开发调试工具 - 星空图可视化
```

依赖关系：`server → core → session`

## 开发

```bash
pnpm --filter @stello-ai/session test    # 单包测试
pnpm --filter @stello-ai/core build      # 单包构建
pnpm test                                 # 全量测试
pnpm typecheck                            # 类型检查
```

## 代码规范

- TypeScript 严格模式，不允许 `any`
- 模块间通过 interface 通信，不跨包 import 内部文件
- 每个函数一行中文注释，每个 interface 写 JSDoc
- 详见 [CLAUDE.md](./CLAUDE.md#代码规范)

## 测试

所有新功能和 Bug 修复必须包含测试（Vitest）：

- 单元测试：`*.test.ts`
- 集成测试：`*.integration.test.ts`
- 覆盖正常路径、错误输入、边界条件

## 提交规范

```
<type>(<scope>): <简短中文描述>
```

type: `feat` | `fix` | `docs` | `test` | `chore` | `refactor` | `perf`
scope: `session` | `core` | `server` | `devtools`（可选）

## Pull Request

1. 从 `main` 创建功能分支（`feat/xxx`、`fix/xxx` 等）
2. 提交前确认：`pnpm typecheck && pnpm lint && pnpm test`
3. PR 描述包含：概述、改动内容、关联 Issue
4. 等待 Code Review，不要自行合并

## 获得帮助

- 项目架构：[CLAUDE.md](./CLAUDE.md)
- 提问：[GitHub Issues](https://github.com/stello-agent/stello/issues)
- 讨论：[GitHub Discussions](https://github.com/stello-agent/stello/discussions)
