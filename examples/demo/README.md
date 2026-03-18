# Stello Demo - 基础功能演示

这个 demo 演示了 Stello 的基础功能：创建根 Session 并查看生成的文件结构。

## 快速开始

```bash
# 1. 安装依赖（在 stello 根目录执行）
cd /Users/bytedance/Desktop/stello
pnpm install

# 2. 构建 core 包
cd packages/core
pnpm build

# 3. 回到 demo 目录并运行
cd ../../examples/demo
pnpm install
pnpm dev
```

## 运行后会看到什么？

1. **控制台输出**：显示创建的 Session 对象和生成的文件信息
2. **文件系统**：在 `./stello-data/sessions/{session-id}/` 下生成文件：
   - `meta.json` - Session 元数据（父子关系、状态、时间戳）
   - `memory.md` - Session 记忆摘要（初始为空）
   - `records.jsonl` - 对话记录（初始为空）

## 目录结构

```
examples/demo/
├── src/
│   └── basic.ts          # 基础演示脚本
├── stello-data/          # 自动生成的数据目录
│   └── sessions/
│       └── {uuid}/
│           ├── meta.json
│           ├── memory.md
│           └── records.jsonl
├── package.json
├── tsconfig.json
└── README.md
```

## 下一步

查看其他示例了解更多功能：
- [ ] 对话记录和记忆提取
- [ ] 创建子 Session（分支）
- [ ] 跨分支引用
- [ ] Agent Tools 使用
- [ ] 完整的对话流程
