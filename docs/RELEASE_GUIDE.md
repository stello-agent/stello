# 发布指南（维护者）

本指南面向 Stello 项目的维护者，详细说明如何管理版本发布流程。即使你是第一次接触 npm 包发布，也能轻松掌握。

## 📋 目录

- [发布流程概览](#发布流程概览)
- [核心概念](#核心概念)
- [自动发布流程](#自动发布流程)
- [Version PR 审查与合并](#version-pr-审查与合并)
- [验证发布](#验证发布)
- [手动发布（紧急情况）](#手动发布紧急情况)
- [发布 Beta/Alpha 版本](#发布-betaalpha-版本)
- [常见问题排查](#常见问题排查)

---

## 发布流程概览

Stello 使用 **Changesets + GitHub Actions** 实现全自动发布流程。整个流程分为 3 个阶段：

```
阶段 1: 贡献者提交代码
  ├─ 编写代码
  ├─ 添加 changeset 文件
  └─ 提交 PR 并合并到 main

阶段 2: 自动创建 Version PR
  ├─ GitHub Actions 检测到新的 changeset
  ├─ 自动更新包版本号
  ├─ 自动生成 CHANGELOG
  └─ 创建 "chore: release packages" PR

阶段 3: 维护者操作（你的工作）
  ├─ 审查 Version PR
  ├─ 合并 Version PR
  └─ 自动触发 npm 发布
```

**你的主要职责：审查并合并 Version PR。**

---

## 核心概念

### 什么是 Changeset？

Changeset 是一个描述代码变更的 Markdown 文件，包含：

- 受影响的包名
- 版本变更类型（patch/minor/major）
- 变更描述（会出现在 CHANGELOG 中）

示例 changeset 文件（`.changeset/quick-lions-dance.md`）：

```markdown
---
"@stello-ai/core": minor
"@stello-ai/session": patch
---

feat(core): 添加自动分支保护机制

- 新增 `maxDepth` 配置限制 Session 树深度
- 修复 Session.consolidate() 的异步竞态问题
```

### 什么是 Version PR？

Version PR 是由 GitHub Actions 自动创建的特殊 Pull Request，标题固定为：

```
chore: release packages
```

它会自动完成：

1. **更新版本号** - 修改所有受影响包的 `package.json`
2. **生成 CHANGELOG** - 汇总所有 changeset 到 `CHANGELOG.md`
3. **删除已处理的 changeset** - 清空 `.changeset/*.md` 文件

### 语义化版本（Semver）

版本号格式：`MAJOR.MINOR.PATCH`（如 `0.2.1`）

| 类型 | 何时使用 | 示例 |
|------|---------|------|
| **patch** | Bug 修复、小改进、不影响 API | 0.2.0 → 0.2.1 |
| **minor** | 新功能、向后兼容的 API 变更 | 0.2.0 → 0.3.0 |
| **major** | 破坏性变更、不兼容的 API 修改 | 0.2.0 → 1.0.0 |

**注意：** 在 `0.x.y` 阶段，minor 版本也可以包含破坏性变更（符合 Semver 规范）。

---

## 自动发布流程

### 工作流程触发条件

GitHub Actions 工作流（`.github/workflows/release.yml`）在以下情况触发：

- 有新代码被推送到 `main` 分支

### 工作流程行为

1. **如果 `.changeset/` 目录下有未处理的 changeset 文件**：
   - 创建或更新 Version PR

2. **如果 Version PR 被合并**：
   - 构建所有包
   - 发布到 npm
   - 创建 Git tag

### Version PR 示例

当你在 GitHub 上看到这样的 PR 时，就是 Version PR：

**标题：** `chore: release packages`

**描述：** 自动生成的版本变更汇总

**文件变更：**
```
modified: packages/core/package.json
modified: packages/core/CHANGELOG.md
modified: packages/session/package.json
modified: packages/session/CHANGELOG.md
deleted:  .changeset/quick-lions-dance.md
```

---

## Version PR 审查与合并

### 审查清单

在合并 Version PR 前，请逐项检查：

#### 1. 版本号是否合理

打开 `packages/*/package.json`，检查版本号变更：

- [ ] 版本号符合 Semver 规范
- [ ] 如果包含破坏性变更，`major` 版本号应该递增
- [ ] 如果只是 Bug 修复，`patch` 版本号应该递增
- [ ] 各包版本号递增符合 changeset 中声明的类型

#### 2. CHANGELOG 是否完整且格式正确

打开 `packages/*/CHANGELOG.md`，检查：

- [ ] 所有重要变更都已记录
- [ ] 描述清晰易懂（面向最终用户）
- [ ] 没有重复或遗漏的条目
- [ ] 格式符合 Markdown 规范
- [ ] 包名使用完整的 `@stello-ai/*` 格式
- [ ] 没有包含内部实现细节（应聚焦用户可见的改动）

#### 3. Changeset 文件是否已删除

- [ ] `.changeset/` 目录下的所有 `.md` 文件（除了 `README.md` 和 `config.json`）都已被删除
- [ ] 确认被删除的 changeset 文件内容已正确合并到 CHANGELOG

#### 4. 依赖关系是否正确更新

如果发布了多个包，检查包之间的依赖版本：

- [ ] `@stello-ai/server` 依赖的 `@stello-ai/core` 版本已更新
- [ ] `@stello-ai/server` 依赖的 `@stello-ai/session` 版本已更新
- [ ] `@stello-ai/devtools` 依赖的包版本已更新
- [ ] 所有 `workspace:^` 协议已被替换为实际版本号

#### 5. CI 检查是否通过

- [ ] GitHub Actions 中的所有检查都显示绿色 ✅
- [ ] 构建成功（所有包）
- [ ] 测试通过（所有包）
- [ ] 类型检查通过

### 何时合并 Version PR

✅ **可以合并的情况：**

- 所有审查清单项都已通过
- 距离上次发布已有足够的变更积累
- 当前 `main` 分支稳定（没有已知的严重 Bug）

❌ **不应该合并的情况：**

- 正在进行大规模重构（等重构完成后一起发布）
- 发现 CHANGELOG 中描述不准确（手动编辑后再合并）
- CI 检查失败

### 如何合并 Version PR

1. 访问 Version PR 页面
2. 点击 "Squash and merge" 按钮（推荐）或 "Merge pull request"
3. 确认合并

**注意：** 不要选择 "Rebase and merge"，这会导致提交历史混乱。

### 合并后会发生什么

合并 Version PR 后，GitHub Actions 会自动：

1. ✅ 安装依赖（`pnpm install --frozen-lockfile`）
2. ✅ 构建所有包（`pnpm build`）
3. ✅ 发布到 npm（`pnpm release`）
4. ✅ 为每个发布的包创建 Git tag（如 `@stello-ai/core@0.3.0`）

整个过程约需 3-5 分钟。

---

## 验证发布

### 检查 GitHub Actions 执行状态

1. 访问 [Actions 页面](https://github.com/stello-agent/stello/actions)
2. 找到最新的 "Release" 工作流运行
3. 确认所有步骤都显示绿色 ✅

### 检查 npm 包

在终端运行：

```bash
npm view @stello-ai/core version
npm view @stello-ai/session version
npm view @stello-ai/server version
```

确认输出的版本号与 Version PR 中的一致。

### 检查 npm 网站

访问 npm 包页面：

- [@stello-ai/core](https://www.npmjs.com/package/@stello-ai/core)
- [@stello-ai/session](https://www.npmjs.com/package/@stello-ai/session)
- [@stello-ai/server](https://www.npmjs.com/package/@stello-ai/server)
- [@stello-ai/devtools](https://www.npmjs.com/package/@stello-ai/devtools)

确认：

- [ ] "Latest version" 显示正确的版本号
- [ ] 发布时间是最近几分钟内
- [ ] README 和 CHANGELOG 已更新

### 本地测试安装

创建一个测试项目并安装最新版本：

```bash
mkdir test-stello
cd test-stello
npm init -y
npm install @stello-ai/core@latest
```

检查 `node_modules/@stello-ai/core/package.json` 中的版本号。

---

## 手动发布（紧急情况）

如果自动发布失败，你可以手动发布。**仅在紧急情况下使用。**

### 前提条件

1. 你的 npm 账号已加入 `stello-agent` 组织
2. 你有 `@stello-ai/*` 包的发布权限
3. 你已在本地登录 npm：

```bash
npm login
```

### 手动发布步骤

1. **确保代码最新**

```bash
git checkout main
git pull origin main
```

2. **清理并安装依赖**

```bash
rm -rf node_modules pnpm-lock.yaml
pnpm install --frozen-lockfile
```

3. **构建所有包**

```bash
pnpm build
```

4. **确认版本号已更新**

检查 `packages/*/package.json`，确保版本号已经在 Version PR 中更新过。

5. **手动发布**

```bash
pnpm release
```

这会调用 `changeset publish`，发布所有有版本变更的包。

6. **创建 Git tags**

```bash
git tag @stello-ai/core@0.3.0
git tag @stello-ai/session@0.2.1
git push origin --tags
```

（替换为实际的版本号）

---

## 发布 Beta/Alpha 版本

Beta/Alpha 版本用于提前测试即将发布的功能，不影响 `latest` 标签。

### 1. 创建预发布 changeset

```bash
pnpm changeset pre enter beta
```

这会在 `.changeset/pre.json` 中标记进入预发布模式。

### 2. 添加正常的 changeset

```bash
pnpm changeset
```

选择包和版本类型，填写描述。

### 3. 更新版本并发布

```bash
pnpm changeset version
```

这会生成类似 `0.3.0-beta.0` 的版本号。

### 4. 构建并发布

```bash
pnpm build
pnpm release --tag beta
```

`--tag beta` 会将包发布到 `beta` 标签，而不是 `latest`。

### 5. 退出预发布模式

```bash
pnpm changeset pre exit
```

### 安装 Beta 版本

用户可以通过以下方式安装 Beta 版本：

```bash
npm install @stello-ai/core@beta
# 或指定具体版本
npm install @stello-ai/core@0.3.0-beta.0
```

---

## 审查普通 PR 时的 Changeset 检查

作为维护者，在审查普通 PR（非 Version PR）时，需要确保 changeset 格式正确。

### Changeset 格式检查清单

对于每个包含功能改动的 PR：

1. **确认 changeset 文件存在**

   查看 PR 的 "Files changed"，应该能看到：
   ```
   .changeset/xxx-xxx-xxx.md
   ```

2. **检查包名格式**

   打开 changeset 文件，确认包名使用完整的 scoped 格式：

   ✅ 正确：
   ```markdown
   ---
   "@stello-ai/core": minor
   "@stello-ai/session": patch
   ---
   ```

   ❌ 错误：
   ```markdown
   ---
   "core": minor        # 缺少 @stello-ai/ 前缀
   "session": patch     # 缺少 @stello-ai/ 前缀
   ---
   ```

3. **检查版本类型**

   确认版本类型合理：

   - `patch` - Bug 修复、小改进、文档更新
   - `minor` - 新功能、向后兼容的 API 变更
   - `major` - 破坏性变更、不兼容的 API 修改

   如果 PR 添加了新功能但 changeset 标记为 `patch`，需要要求修改。

4. **检查描述质量**

   Changeset 描述会直接出现在 CHANGELOG 中，确认：

   - [ ] 描述清晰，用户能理解
   - [ ] 使用面向用户的语言（不是内部实现细节）
   - [ ] 格式规范（建议使用 `feat(模块): 描述` 格式）

   ✅ 好的描述：
   ```markdown
   feat(core): 添加 Session 树深度限制配置

   - 新增 `maxDepth` 配置项，防止无限递归分支
   - 深度超限时抛出明确的错误提示
   ```

   ❌ 不好的描述：
   ```markdown
   更新了一些东西
   ```

5. **纯文档/测试 PR 是否误加 changeset**

   如果 PR 只修改了文档或测试，不应该包含 changeset：

   - 仅修改 `*.md` 文件 → 不需要 changeset
   - 仅修改 `*.test.ts` 文件 → 不需要 changeset
   - 仅修改 CI 配置 → 不需要 changeset

### 如果 changeset 格式错误怎么办

**选项 1：要求贡献者修改（推荐）**

在 PR 中评论：

```markdown
感谢你的贡献！请修改 changeset 格式：

1. 包名需要使用完整格式 `@stello-ai/core` 而不是 `core`
2. 建议描述格式：`feat(模块): 功能描述`

可以删除当前的 changeset 文件，重新运行 `pnpm changeset` 生成。
```

**选项 2：自行修正（小问题）**

如果只是描述不够清晰，可以直接在 GitHub 网页编辑 changeset 文件。

**选项 3：合并后补充**

如果 PR 已经合并但忘记添加 changeset，可以：

1. 在本地运行 `pnpm changeset`
2. 创建一个新的 PR 补充 changeset
3. 合并后会被包含在下一个 Version PR 中

---

## 常见问题排查

### 问题 1: GitHub Actions 构建失败

**症状：** Release 工作流显示红色 ❌

**排查步骤：**

1. 点击失败的步骤查看日志
2. 常见原因：
   - TypeScript 类型错误 → 本地运行 `pnpm typecheck`
   - 测试失败 → 本地运行 `pnpm test`
   - 依赖安装失败 → 检查 `pnpm-lock.yaml` 是否提交

**解决方案：**

在本地修复问题，提交新的 PR 到 `main`。Version PR 会自动更新。

### 问题 2: npm 发布 403 Forbidden

**症状：** 发布步骤失败，错误信息包含 `403 Forbidden`

**可能原因：**

1. NPM_TOKEN 过期或无效
2. NPM_TOKEN 权限不足
3. NPM_TOKEN 未启用 "Bypass 2FA"

**解决方案：**

重新生成 NPM_TOKEN（需要 npm 账号管理员权限）：

1. 访问 [npm Access Tokens](https://www.npmjs.com/settings/stello-agent/tokens)
2. 点击 "Generate New Token" → "Granular Access Token"
3. 配置：
   - **Packages and scopes** → Select packages → 选中所有 `@stello-ai/*` 包
   - **Permissions** → Read and write
   - ✅ **勾选 "Bypass two-factor authentication (2FA)"**（重要！）
4. 复制生成的 token
5. 访问 [GitHub Secrets](https://github.com/stello-agent/stello/settings/secrets/actions)
6. 更新 `NPM_TOKEN` Secret

### 问题 3: 包发布成功但 tag 未创建

**症状：** npm 上有新版本，但 GitHub 没有对应的 Git tag

**解决方案：**

手动创建并推送 tag：

```bash
git tag @stello-ai/core@0.3.0
git tag @stello-ai/session@0.2.1
git push origin --tags
```

### 问题 4: 错误发布了包，如何撤回？

**24 小时内：**

```bash
npm unpublish @stello-ai/core@0.3.0
```

**24 小时后：**

npm 不允许 unpublish。只能发布新的修复版本（如 `0.3.1`）。

**预防措施：**

- 在 Beta 环境充分测试
- 合并 Version PR 前仔细审查 CHANGELOG

### 问题 5: Version PR 一直不出现

**可能原因：**

1. `.changeset/` 目录下没有未处理的 changeset 文件
2. 最近的 commit 没有触发 GitHub Actions

**排查步骤：**

1. 检查 `.changeset/` 目录：

```bash
ls -la .changeset/
```

应该有除了 `README.md` 和 `config.json` 之外的 `.md` 文件。

2. 检查 [Actions 页面](https://github.com/stello-agent/stello/actions)，确认 Release 工作流已运行

**解决方案：**

如果确认有 changeset 但 Version PR 未创建，可以手动触发：

1. 在本地运行 `pnpm changeset version`
2. 提交生成的版本更新
3. 推送到 `main` 分支

### 问题 6: 依赖包版本不一致

**症状：** `@stello-ai/server` 依赖 `@stello-ai/core@workspace:^`，但发布后版本不匹配

**解决方案：**

确保在 Version PR 中，所有依赖关系已正确更新。Changesets 会自动处理 `workspace:^` 协议，将其替换为实际版本号。

如果发现问题，手动编辑 Version PR，更新依赖版本。

---

## 最佳实践

### 发布频率

- **Patch 版本**：随时发布（Bug 修复）
- **Minor 版本**：每周或双周（功能积累到一定程度）
- **Major 版本**：慎重规划（有充分的迁移文档）

### 发布时机

- ✅ 工作日白天（方便快速响应问题）
- ✅ `main` 分支稳定（CI 全绿）
- ✅ 团队成员在线（紧急情况可快速协调）
- ❌ 周五晚上或周末（出问题没人修）
- ❌ 重大节假日（用户可能无法及时升级）

### 沟通

- 发布前在团队内部通知（"准备发布 0.3.0"）
- 发布后更新 GitHub Discussions 或社区渠道
- Major 版本发布后发布 Release Notes

---

## 相关资源

- [Changesets 官方文档](https://github.com/changesets/changesets)
- [Semantic Versioning 规范](https://semver.org/lang/zh-CN/)
- [npm 发布文档](https://docs.npmjs.com/cli/v10/commands/npm-publish)
- [GitHub Actions 文档](https://docs.github.com/en/actions)

---

如有任何疑问，请在团队内部沟通渠道询问，或查阅 [CONTRIBUTING.md](../CONTRIBUTING.md)。
