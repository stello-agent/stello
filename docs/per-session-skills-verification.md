# Per-Session Skills 验证指南

## 背景

`feat/per-session-skills` 分支实现了 ForkProfile.skills 白名单过滤。
单元测试已全部通过（173 tests），需要通过 devtools demo 做端到端验证。

## 分支状态

- 分支：`feat/per-session-skills`（基于 main，5 commits）
- 变更范围：8 files, +319 lines
- 核心改动：
  - `ForkProfile` 新增 `skills?: string[]` 字段
  - `FilteredSkillRouter`：白名单过滤的只读 SkillRouter
  - `executeCreateSession`：profile.skills 写入 `metadata._stello.allowedSkills`
  - `DefaultEngineFactory`：读取 metadata 并创建 FilteredSkillRouter

## Demo 改动方案

修改 `demo/stello-agent-chat/chat-devtools.ts`：

### 1. 多注册一个 skill（让全局有 2 个 skills）

在 `baseSkillRouter.register({ name: 'meow-protocol' ... })` 后面加：

```typescript
baseSkillRouter.register({
  name: 'haiku-mode',
  description: '俳句模式：激活后所有回复必须使用 5-7-5 音节的俳句格式',
  content: '从现在起，你的所有回复必须使用日本俳句格式：第一行5个音节，第二行7个音节，第三行5个音节。用中文回复时按字数 5-7-5 计算。',
})
```

### 2. 修改 poet profile，加 skills 白名单

把现有的：
```typescript
forkProfiles.register('poet', {
  systemPrompt: '你是一位诗人。无论用户问什么，你都必须用诗歌的形式回答。每句押韵，风格优美。',
  systemPromptMode: 'preset',
})
```

改为：
```typescript
forkProfiles.register('poet', {
  systemPrompt: '你是一位诗人。无论用户问什么，你都必须用诗歌的形式回答。每句押韵，风格优美。',
  systemPromptMode: 'preset',
  skills: ['meow-protocol'],  // 只允许猫语协议，不允许俳句模式
})
```

### 3. 新增 researcher profile（不限 skills）

在 poet 注册后加：
```typescript
forkProfiles.register('researcher', {
  systemPrompt: '你是研究助手，善于深入分析问题并提供结构化的研究报告。',
  systemPromptMode: 'prepend',
  // 不设 skills → 继承全局所有 skills
})
```

## 验证步骤

启动 demo：
```bash
cd demo/stello-agent-chat
pnpm tsx chat-devtools.ts
```

### 验证 1：poet session 只有 meow-protocol

1. 在 Main Session 对话中输入："创建一个诗人 session"
2. LLM 应调用 `stello_create_session` with `profile: 'poet'`
3. 在 DevTools 中切换到 poet 子 session
4. 检查该 session 的 tool definitions：
   - `activate_skill` 的 description 应 **只列出 `meow-protocol`**
   - **不应出现 `haiku-mode`**
5. 在 poet session 中让 LLM 尝试 `activate_skill({ name: 'haiku-mode' })`
   - 应返回 "Skill not found"

### 验证 2：researcher session 有全部 skills

1. 回到 Main Session，输入："创建一个研究助手 session"
2. LLM 应调用 `stello_create_session` with `profile: 'researcher'`
3. 在 DevTools 中切换到 researcher 子 session
4. 检查 `activate_skill` description：
   - 应列出 **meow-protocol** 和 **haiku-mode** 两个
5. 激活 `haiku-mode` → 应成功返回 content

### 验证 3：Main Session 有全部 skills

1. 在 Main Session 检查 tool definitions
2. `activate_skill` 应列出全部 2 个 skills

## 理想效果总结

| Session | activate_skill 可见 skills | haiku-mode 可用？ |
|---------|--------------------------|------------------|
| Main Session | meow-protocol, haiku-mode | 是 |
| poet (profile skills: ['meow-protocol']) | meow-protocol | 否 (Skill not found) |
| researcher (无 skills 限制) | meow-protocol, haiku-mode | 是 |

## 设计意图补充

Per-session skills 的典型使用场景是 **通过 skill 来定制子 session 的创建行为**。例如：

```typescript
// 注册一个「美国留学」skill
skillRouter.register({
  name: 'us-study-assistant',
  description: '美国留学专属助手：创建子 session 时使用 us-child preset',
  content: `你是美国留学助手。创建子 session 时：
    - 使用 preset 'us-child'
    - 确保子 session 继承当前学生的背景信息
    - ...`,
})

// 注册对应的 ForkProfile
forkProfiles.register('us-child', {
  systemPrompt: (vars) => `你是${vars.university}的申请顾问...`,
  systemPromptMode: 'preset',
  contextFn: async (records) => {
    // 用 LLM 压缩上下文，只保留关键申请信息
    return compressedRecords
  },
  skills: ['us-study-assistant'],  // 子 session 也能用这个 skill
})
```

这样 skill 控制了「怎么创建子 session」，ForkProfile.skills 控制了「子 session 能用哪些 skill」，
形成了一个完整的 skill → fork → skill 链路。
