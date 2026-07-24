# 发布指南（维护者）

本仓库不再使用 Changesets。版本号和 CHANGELOG 由维护者在发布提交中直接更新。

## 发布对象

| 包 | 是否发布 | 依赖关系 |
| --- | --- | --- |
| `@stello-ai/session` | 是 | 基础 Session 包 |
| `@stello-ai/core` | 是 | 依赖 `@stello-ai/session` |
| `@stello-ai/devtools` | 按需单独发布 | 依赖 `@stello-ai/core` |
| `@stello-ai/devtools-web` | 否 | private workspace |

根包 `stello` 也是 private，不会发布。

`@stello-ai/core` 和 `@stello-ai/session` 可以使用不同版本号。全局 `vX.Y.Z` tag 跟随 Core 版本。

## 当前发布机制

仓库提供两条互斥的发布路径，一次发布只能选择其中一条。

### Tag 自动发布

推送任意 `v*` tag 会触发 [`.github/workflows/release.yml`](.github/workflows/release.yml)：

1. 使用 frozen lockfile 安装依赖；
2. 构建并测试 Session 和 Core；
3. 将两个包发布到 npm；
4. 创建 GitHub Release。

该 workflow 会无条件发布两个包，因此打 tag 前必须同时给两个包设置尚未发布的新版本。

### 维护者手动发布

维护者也可以在本地运行 `pnpm release`。该命令会先完成 lint、build、typecheck 和 test，然后严格按以下顺序发布：

1. `@stello-ai/session`
2. `@stello-ai/core`

手动发布后不要再推送同版本的 `v*` tag，否则 tag workflow 会尝试重复发布并失败。若需要在手动发布后补建标准 `v*` tag/GitHub Release，应先调整 workflow，使其跳过 npm 上已经存在的版本。

`.github/workflows/npm-publish.yml` 是可手动触发的 GitHub Actions fallback，可选择发布两个包或单个包，也支持 dry run。

## 版本规则

项目仍处于 `0.x` 阶段：

| 变更 | 版本升级 |
| --- | --- |
| Breaking API 或运行时语义变化 | minor，例如 `0.10.2 → 0.11.0` |
| 向后兼容的修复或小改进 | patch，例如 `0.10.2 → 0.10.3` |

发布时需要同步检查：

- `packages/session/package.json`
- `packages/session/CHANGELOG.md`
- `packages/core/package.json`
- `packages/core/CHANGELOG.md`
- `packages/core/src/index.ts` 中公开的 `VERSION` 常量

Core 对 Session 的依赖应保留为 `workspace:^`。pnpm 打包 Core 时会把它转换成当前 Session 版本对应的范围，例如 `^0.9.0`，不要手工改成固定版本。

仅修改 workspace 包自身版本通常不需要更新 `pnpm-lock.yaml`；仍应运行 `pnpm install --frozen-lockfile` 验证 lockfile 一致。

## 发布准备

### 1. 确认基线

发布应基于最新且干净的 `main`：

```bash
git switch main
git fetch origin main --tags
git status --short --branch
git rev-list --left-right --count origin/main...HEAD
```

如果本地落后，先以 fast-forward 方式同步；如果出现分叉，先解决分支关系，不要直接打 tag 或发布。

同时确认准备使用的版本尚未存在：

```bash
npm view @stello-ai/session version
npm view @stello-ai/core version
```

### 2. 更新发布元数据

1. 更新两个 `package.json` 的版本；
2. 把两个 CHANGELOG 的 `Unreleased` 内容归档到实际版本标题；
3. 更新 Core 的 `VERSION` 常量；
4. 确认公开 API 的 breaking change 和迁移方式已经写入 CHANGELOG。

如果新 Core 依赖本次新增的 Session API，两个包都必须发布，并且 Session 必须先于 Core。

### 3. 完整验证

```bash
pnpm install --frozen-lockfile
pnpm release:dry-run
```

`release:dry-run` 会执行：

- ESLint
- Session/Core build
- Session/Core typecheck
- Session/Core test
- 两个包的 `pnpm publish --dry-run`

Dry run 不会写入 npm registry。重点检查 Core 的打包输出，确认依赖已经从 `workspace:^` 转换为期望的 Session npm 版本范围。

### 4. 提交并进入 main

```bash
git add package.json \
  packages/session/package.json \
  packages/session/CHANGELOG.md \
  packages/core/package.json \
  packages/core/CHANGELOG.md \
  packages/core/src/index.ts \
  RELEASE_GUIDE.md
git commit -m "chore(release): prepare core and session"
git push origin main
```

推送后等待 main 的 CI 全部通过。普通 CI 包含 lint、build、typecheck 和 test；不要仅依赖 tag workflow，因为 tag workflow 当前不运行 lint 和 typecheck。

## 路径 A：通过 tag 自动发布

仅在发布提交已经位于 `origin/main` 且 main CI 全绿后执行：

```bash
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push origin vX.Y.Z
```

不要提前手动运行 `pnpm release`。推送 tag 后，在 GitHub Actions 中观察 Release workflow，确认 npm publish 和 GitHub Release 都成功。

## 路径 B：维护者本地发布

如果 npm publish 由维护者自己执行：

```bash
pnpm release:dry-run
pnpm release
```

`pnpm release` 会重新执行全部发布检查，然后先发布 Session、再发布 Core。也可以显式逐包执行：

```bash
pnpm release:check
pnpm --filter @stello-ai/session publish --no-git-checks --access public
pnpm --filter @stello-ai/core publish --no-git-checks --access public
```

本地发布需要：

- npm 账号拥有 `@stello-ai/*` 发布权限；
- 已完成 `npm login`；
- npm 的 2FA 或 access token 配置满足 publish 要求。

Session 发布成功但 Core 发布失败时，不要重复发布 Session。修复问题后只重试 Core；若 Core 的目标版本尚未进入 registry，可以继续使用同一版本。

## 发布后验证

```bash
npm view @stello-ai/session version
npm view @stello-ai/core version
npm view @stello-ai/core dependencies --json
```

确认：

- npm 上的版本与发布提交一致；
- Core 依赖的是刚发布的 Session minor 范围；
- 从一个空目录安装 `@stello-ai/core@latest` 能正常解析 Session；
- ESM 和 CommonJS 入口均存在，类型声明包含在包内。

建议再做一次最小安装验证：

```bash
release_smoke_dir="$(mktemp -d)"
cd "$release_smoke_dir"
npm init -y
npm install @stello-ai/core@latest
node -e "import('@stello-ai/core').then((m) => console.log(m.VERSION))"
```

## 预发布版本

Beta/Alpha 版本需要手工设置预发布版本，例如 Session `0.9.0-beta.0`、Core `0.11.0-beta.0`，然后使用相同 dist-tag 逐包发布：

```bash
pnpm release:check
pnpm --filter @stello-ai/session publish --tag beta --no-git-checks --access public
pnpm --filter @stello-ai/core publish --tag beta --no-git-checks --access public
```

预发布不要推送普通 `v*` tag；当前 tag workflow 没有设置 beta dist-tag。

用户可通过以下方式安装：

```bash
npm install @stello-ai/core@beta
```

## 常见故障

### npm 返回 403

检查 npm 组织权限、token 有效期、2FA，以及 token 是否允许发布对应 scope。GitHub Actions 发布时还要检查仓库的 `NPM_TOKEN` secret。

### npm 提示版本已存在

npm 版本不可覆盖。确认是否已经部分发布：

```bash
npm view @stello-ai/session versions --json
npm view @stello-ai/core versions --json
```

如果目标版本确实存在，未发布的包应选择新的版本；不要尝试覆盖 registry 中的 tarball。

### Tag workflow 在 publish 阶段失败

先判断两个包是否已经部分发布。修复后不要盲目重跑整个 workflow，因为它会再次尝试发布已经成功的包；可使用 `npm-publish.yml` 只发布缺失的包，或在本地逐包发布。

### 发布了有问题的版本

优先发布新的 patch 修复版本并通过 npm deprecate 标记问题版本。只有在符合 npm unpublish 政策且影响范围明确时才考虑撤回。
