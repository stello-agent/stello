# Stello Demo 测试发现

> 本文档记录在 Demo 测试过程中发现的问题、限制和潜在改进点

---

## 📋 问题分类

| # | 类型 | 严重程度 | 状态 | 发现时间 |
|---|------|----------|------|----------|
| 1 | [设计限制](#1-refs-记忆注入未实现-v01-已知限制) | 🟡 中等 | 已知 | 2026-03-18 |
| 2 | [文件设计](#2-scopemd-为空文件) | 🟢 低 | 正常 | 2026-03-18 |

---

## 📝 详细记录

### 1. refs 记忆注入未实现 (v0.1 已知限制)

**发现于**: Demo 4 - cross-reference
**严重程度**: 🟡 中等
**状态**: 已知设计限制，v0.2 计划实现

#### 问题描述

当 Session A 通过 `addRef()` 引用 Session B 时：
- ✅ `meta.json` 的 `refs` 数组正确更新
- ✅ 引用关系持久化成功
- ❌ `bootstrap()` / `assemble()` 时，**不会注入被引用 Session 的记忆**

#### 复现步骤

```typescript
// 1. Session A 引用 Session B
await sessionTree.addRef(sessionA.id, sessionB.id);

// 2. Bootstrap Session A
const { context } = await lifecycle.bootstrap(sessionA.id);

// 3. 检查 context.memories
console.log(context.memories.length); // 只有 1 条（来自父节点）
// 预期应该包含 Session B 的 memory.md，但实际没有
```

#### 根本原因

`LifecycleManager.collectMemories()` 方法只处理了四种继承策略：
- `minimal`: 不继承任何记忆
- `summary`: 继承父节点记忆
- `full`: 继承所有祖先记忆
- `scoped`: 继承父节点 + 同 scope 兄弟记忆

**没有处理 `session.refs` 字段**：

```typescript
// packages/core/src/lifecycle/lifecycle-manager.ts: 174-217
private async collectMemories(sessionId: string, session: SessionMeta): Promise<string[]> {
  switch (this.inheritancePolicy) {
    case 'minimal': return [];
    case 'summary': { /* 只读父节点 */ }
    case 'full': { /* 只读祖先链 */ }
    case 'scoped': { /* 只读父节点 + 同 scope 兄弟 */ }
  }
  // ⚠️ 缺少对 session.refs 的处理
}
```

#### 影响范围

- ✅ **不影响基本功能**：引用关系的存储、校验都正常
- ⚠️  **影响高级功能**：跨分支知识关联、横向记忆召回
- 📊 **使用场景**：
  - 场景 1：讨论"前端架构"时引用"后端 API 设计"的结论 → 无法自动获取后端上下文
  - 场景 2：讨论"逻辑谬误识别"时引用"批判性思维方法"的要点 → 无法自动整合相关知识

#### 设计依据

这是 v0.1 的**已知降级项**（CLAUDE.md 第 232 行）：
> **scope 横向召回**（只做父子继承，scope 字段保留）

**设计权衡**：
- v0.1 优先实现**树状结构**（父子关系）的记忆继承
- 横向引用（refs）的记忆召回留待 v0.2 实现
- 这样可以先验证核心架构，再迭代高级功能

#### 建议修复方案（v0.2）

**方案 A: 扩展继承策略**

添加一个新的继承策略 `with-refs`：

```typescript
case 'with-refs': {
  const results: string[] = [];

  // 1. 继承父节点记忆
  if (session.parentId) {
    const parentMem = await this.sessionMemory.readMemory(session.parentId);
    if (parentMem) results.push(parentMem);
  }

  // 2. 继承被引用 Session 的记忆
  for (const refId of session.refs) {
    try {
      const refMem = await this.sessionMemory.readMemory(refId);
      if (refMem) results.push(refMem);
    } catch (err) {
      // 引用的 Session 可能已归档或删除，忽略错误
    }
  }

  return results;
}
```

**方案 B: 独立的 refs 处理（推荐）**

在所有继承策略之后，统一处理 refs：

```typescript
private async collectMemories(sessionId: string, session: SessionMeta): Promise<string[]> {
  // 1. 按继承策略收集记忆
  const memories = await this.collectByPolicy(session);

  // 2. 追加被引用 Session 的记忆
  for (const refId of session.refs) {
    try {
      const refMem = await this.sessionMemory.readMemory(refId);
      if (refMem) {
        memories.push(`\n## 引用: ${refId}\n${refMem}`);
      }
    } catch (err) {
      // 忽略无效引用
    }
  }

  return memories;
}
```

**方案 C: 配置化控制**

在 `StelloConfig` 中添加配置项：

```typescript
interface StelloConfig {
  // ... 现有配置
  includeRefsInContext?: boolean; // 默认 false（v0.1），v0.2 改为 true
  maxRefsDepth?: number;          // 限制引用深度，防止循环引用
}
```

#### 测试用例（待 v0.2 实现）

```typescript
describe('refs memory injection', () => {
  it('should inject referenced session memory in bootstrap', async () => {
    // 1. 创建 Session A 和 B
    const sessionA = await tree.createChild({ parentId: root.id, label: 'A' });
    const sessionB = await tree.createChild({ parentId: root.id, label: 'B' });

    // 2. B 中写入一些记忆
    await memory.writeMemory(sessionB.id, '# B 的记忆\n- 关键点 1\n- 关键点 2');

    // 3. A 引用 B
    await tree.addRef(sessionA.id, sessionB.id);

    // 4. Bootstrap A，应该包含 B 的记忆
    const { context } = await lifecycle.bootstrap(sessionA.id);
    expect(context.memories).toContainEqual(expect.stringContaining('B 的记忆'));
    expect(context.memories).toContainEqual(expect.stringContaining('关键点 1'));
  });

  it('should handle circular refs gracefully', async () => {
    // A → B → C → A (循环)
    await tree.addRef(sessionA.id, sessionB.id);
    await tree.addRef(sessionB.id, sessionC.id);
    await tree.addRef(sessionC.id, sessionA.id);

    // 应该不会死循环，maxRefsDepth 限制深度
    const { context } = await lifecycle.bootstrap(sessionA.id);
    expect(context.memories.length).toBeLessThan(10);
  });
});
```

#### 优先级

- 🟡 **中等优先级**
- 理由：虽然影响高级功能，但不阻塞基本使用
- 建议在 v0.2 中实现，配合 `scoped` 策略完善横向召回能力

---

### 2. scope.md 为空文件

**发现于**: Demo 3 - branching
**严重程度**: 🟢 低
**状态**: 正常设计，非问题

#### 问题描述

创建子 Session 时，`scope.md` 文件被创建但内容为空：

```bash
$ cat sessions/{child-id}/scope.md
# (空文件)
```

而 `scope` 信息实际存储在 `meta.json` 中：

```json
{
  "id": "...",
  "scope": "专注讨论批判性思维的核心方法..."
}
```

#### 分析

查看代码后发现这是**设计决策**：

**当前设计**（meta.json 存储）：
- ✅ 优点：scope 是结构化元数据，和其他元数据（id, parentId, status）放在一起便于查询
- ✅ 优点：Session 树操作（如 listAll, getSiblings）可以直接过滤 scope，不需要读取额外文件
- ❌ 缺点：scope.md 文件冗余（创建但不使用）

**备选设计**（scope.md 存储）：
- ✅ 优点：LLM 原生理解 markdown，可以写更详细的 scope 描述（如多段、列表）
- ✅ 优点：用户可以直接编辑 scope.md 文件
- ❌ 缺点：查询性能下降（需要读取文件而不是 JSON 字段）

#### 建议

**短期（v0.1）**：保持现状
- scope.md 保留但为空，未来可能使用
- scope 继续存储在 meta.json 中

**长期（v0.2+）**：考虑以下方案之一

**方案 A：删除 scope.md**
```typescript
// session-tree.ts
async createChild(options: CreateSessionOptions): Promise<SessionMeta> {
  // ...
  await this.fs.writeFile(`sessions/${meta.id}/memory.md`, '');
  // 删除这行：await this.fs.writeFile(`sessions/${meta.id}/scope.md`, '');
  await this.fs.writeFile(`sessions/${meta.id}/index.md`, '');
}
```

**方案 B：将 scope 写入 scope.md**
```typescript
async createChild(options: CreateSessionOptions): Promise<SessionMeta> {
  // ...
  const scopeContent = options.scope ? `# Scope\n\n${options.scope}` : '';
  await this.fs.writeFile(`sessions/${meta.id}/scope.md`, scopeContent);
  // meta.json 中保留 scope 字段作为缓存/索引
}
```

**方案 C：混合模式（推荐）**
- meta.json 存储简短 scope（用于查询过滤）
- scope.md 存储详细 scope 描述（LLM 可读，用户可编辑）
- assemble 时优先读 scope.md，回退到 meta.json

#### 优先级

- 🟢 **低优先级**
- 理由：不影响功能，只是设计风格问题
- 建议在 v0.2 架构评审时统一决策

---

## 📊 统计

**总计**: 2 个发现
**需要修复**: 1 个（#1，v0.2）
**设计讨论**: 1 个（#2，v0.2+）

**最后更新**: 2026-03-18 13:15

---

## 💡 贡献指南

如果你在测试中发现新问题，请按以下格式添加：

### N. 问题标题

**发现于**: Demo X - 名称
**严重程度**: 🔴 高 / 🟡 中 / 🟢 低
**状态**: 待修复 / 进行中 / 已知限制 / 正常

#### 问题描述
[简要描述问题]

#### 复现步骤
```typescript
// 代码示例
```

#### 根本原因
[技术分析]

#### 建议修复方案
[具体建议]

#### 优先级
[评估和理由]
