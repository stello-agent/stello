## 概述

<!-- 请简要描述这个 PR 解决了什么问题或添加了什么功能 -->

## 改动类型

请勾选适用的类型：

- [ ] 🐛 Bug 修复
- [ ] ✨ 新功能
- [ ] 📝 文档更新
- [ ] ♻️ 代码重构
- [ ] ⚡️ 性能优化
- [ ] ✅ 测试相关
- [ ] 🔧 构建/配置

## 改动内容

<!-- 列出主要的改动点 -->

-
-
-

## Changeset 确认 ⚠️

<!--
功能代码改动必须添加 changeset！
运行 `pnpm changeset` 并按提示操作。
详见：https://github.com/stello-agent/stello/blob/main/CONTRIBUTING.md#️-重要pr-格式要求
-->

请确认以下其中一项：

- [ ] **已添加 changeset**（功能代码改动）
  - Changeset 文件路径：`.changeset/___-___-___.md`
  - 影响的包：
  - 版本类型：patch / minor / major

- [ ] **不需要 changeset**（以下情况勾选）
  - [ ] 仅修改文档（README、注释、.md 文件）
  - [ ] 仅修改测试代码
  - [ ] 仅修改 CI/CD 配置

## Changeset 格式检查

如果你添加了 changeset，请确认：

- [ ] 包名使用完整格式（如 `"@stello-ai/core"` 而不是 `"core"`）
- [ ] 版本类型正确（patch/minor/major）
- [ ] 描述清晰，面向用户（会出现在 CHANGELOG 中）
- [ ] 使用推荐格式：`feat(模块): 功能描述` 或 `fix(模块): 问题描述`

**正确的 changeset 示例：**

```markdown
---
"@stello-ai/core": minor
---

feat(core): 添加 Session 树深度限制配置

- 新增 `maxDepth` 配置项，防止无限递归分支
- 深度超限时抛出明确的错误提示
```

## 测试

- [ ] 添加了单元测试
- [ ] 添加了集成测试（如需要）
- [ ] 本地测试全部通过（`pnpm test`）
- [ ] 类型检查通过（`pnpm typecheck`）

## 提交前检查清单

- [ ] 代码已通过 `pnpm typecheck`
- [ ] 代码已通过 `pnpm lint`
- [ ] 代码已通过 `pnpm test`
- [ ] 已添加必要的 changeset 或确认不需要
- [ ] Changeset 格式正确（如已添加）
- [ ] Commit 消息符合规范（`feat/fix/docs/test/chore(scope): 描述`）
- [ ] 文档已更新（如需要）

## 相关 Issue

<!-- 如果解决了某个 issue，请使用 "Closes #123" 格式 -->

Closes #

---

📖 **贡献指南**：请查看 [CONTRIBUTING.md](https://github.com/stello-agent/stello/blob/main/CONTRIBUTING.md) 了解详细的贡献流程。
