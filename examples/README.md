# Stello Examples

这个目录包含了 Stello 的各种使用示例和演示。

## 📚 示例列表

### [demo/](./demo) - 基础功能演示

最小化示例，演示 Stello 的核心功能。

**已完成的示例**:
- ✅ `basic.ts` - 创建根 Session + 文件系统验证
- ✅ `conversation.ts` - 对话记录和记忆提取
- ✅ `branching.ts` - Session 分支和继承
- ✅ `cross-reference.ts` - 跨分支引用（⚠️  refs 记忆注入未实现，v0.1 已知限制）
- ✅ `agent-tools.ts` - Agent Tools 使用

**计划中的示例**:
- ⏳ `lifecycle.ts` - 生命周期钩子
- ⏳ `bubble.ts` - 记忆冒泡机制
- ⏳ `full-flow.ts` - 端到端完整流程

## 🚀 快速开始

```bash
# 1. 在 Stello 根目录安装依赖
cd /path/to/stello
pnpm install

# 2. 构建 core 包
cd packages/core
pnpm build

# 3. 运行示例
cd ../../examples/demo
pnpm dev
```

## 📋 进度追踪

详细的测试进度和结果请查看 [DEMOS.md](./DEMOS.md)

**当前进度**: 5 / 8 完成 (62.5%)

## 📁 目录结构

```
examples/
├── README.md           # 本文件
├── DEMOS.md            # 详细的 Demo 清单和测试记录
└── demo/               # 基础功能演示
    ├── src/
    │   ├── basic.ts              # ✅ 已完成
    │   ├── conversation.ts       # ✅ 已完成
    │   ├── branching.ts          # ✅ 已完成
    │   ├── cross-reference.ts    # ✅ 已完成
    │   ├── agent-tools.ts        # ✅ 已完成
    │   ├── lifecycle.ts          # ⏳ 待完成
    │   ├── bubble.ts             # ⏳ 待完成
    │   └── full-flow.ts          # ⏳ 待完成
    ├── stello-data/              # 自动生成的数据目录
    ├── package.json
    ├── tsconfig.json
    └── README.md
```

## 🎯 学习路径

建议按以下顺序学习和运行示例：

1. **basic** - 理解 Session 的基本概念和文件系统
2. **conversation** - 学习如何记录对话和提取记忆
3. **branching** - 掌握 Session 分支和继承策略
4. **agent-tools** - 了解 LLM 如何通过 tools 操作 Session
5. **lifecycle** - 深入理解生命周期钩子
6. **cross-reference** - 学习跨分支引用
7. **bubble** - 理解记忆冒泡机制
8. **full-flow** - 综合运用所有功能

## 📝 贡献指南

如果你想添加新的示例：

1. 在 `demo/src/` 下创建新的 `.ts` 文件
2. 在 `demo/package.json` 的 `scripts` 中添加对应的运行命令
3. 在 `DEMOS.md` 中添加详细的测试记录
4. 更新本 README 的示例列表

## 🔗 相关资源

- [项目 README](../README.md)
- [CLAUDE.md](../CLAUDE.md) - 项目完整文档
- [API 文档](https://github.com/stello-agent/stello)
