# StelloAgent Chat DevTools Demo

这个 demo 现在的定位不是“最小聊天页”，而是一个带 DevTools 的调试入口，主要展示：

1. 用真实 OpenAI 兼容模型接入当前 `StelloAgent`
2. 通过 `chat-devtools.ts` 启动留学顾问 demo 和调试面板
3. 在浏览器里观察 session 树、L2/consolidation、integration/insights、工具调用和运行时配置

## 运行前准备

至少需要配置：

```bash
export OPENAI_BASE_URL=https://api.minimaxi.com/v1
export OPENAI_API_KEY=你的 key
export OPENAI_MODEL=MiniMax-M1
```

如果你用别的 OpenAI 兼容服务，也可以改 `OPENAI_BASE_URL` 和 `OPENAI_MODEL`。

## 启动

在仓库根目录执行：

```bash
node --import tsx demo/stello-agent-chat/chat-devtools.ts
```

默认会启动 DevTools：

```text
http://127.0.0.1:4800
```

你也可以自定义：

```bash
export DEMO_HOST=127.0.0.1
export DEVTOOLS_PORT=4800
node --import tsx demo/stello-agent-chat/chat-devtools.ts
```

如果你想用根目录脚本：

```bash
pnpm demo:chat
```

## DevTools 功能

当前页面支持：

- 查看 session 列表，主 session 固定置顶
- 查看 session 树和 inspector 详情
- 发送消息并实时看到流式响应和工具调用
- 右上角按当前 session 展示实际可用的 tools / skills
- 手动触发 consolidation / integration
- 查看和编辑 system prompt / insights scope
- 通过设置页调整 live runtime 项
- 导出 / 导入调试设置快照

设置页里现在区分两类信息：

- `Live Runtime`
  - 会立即作用于当前运行中的 demo，例如 LLM、prompts、scheduler、split guard、runtime recycle
- `Read-only Bootstrap`
  - 展示启动时接线和能力状态，用于观察，不用于热更新

当前 demo 还会把一部分调试状态持久化到本地：

- DevTools 全局状态：LLM、全局 prompts、tools/skills 开关、hot config
- session 级 system prompt 编辑

默认持久化目录：

```text
./tmp/stello-agent-chat
```

## 对话里创建子 session

你可以直接在聊天框里输入类似：

```text
帮我创建一个子 session，名字叫美国选校，并给它一个只负责美国选校的系统提示词
```

或者：

```text
创建一个子会话，名字叫英国选校，并让它先从“英国 CS 硕士申请”开始分析
```

当前 `stello_create_session` 走的是 `@stello-ai/session` 内置的 `createSessionTool` 语义，模型调用时主要使用这些字段：

- `label`
  - 子会话显示名称
- `systemPrompt`
  - 子会话系统提示词；不提供时继承父会话
- `prompt`
  - demo 中会作为子会话的第一条 assistant 开场消息，用来让新会话立即进入某个具体任务

现在这条链已经走真实 tool call：

- 模型调用 `stello_create_session`
- 工具内部通过 `session.fork()` 派生子 session
- 前端把 tool 调用过程渲染成单独组件
- integration 会基于已有 L2 生成定向 insights，并写回子 session

## Per-Session Skills 验证

当前 demo 额外内置了两条 skills 和两个 profile，用来验证 `ForkProfile.skills` 白名单：

- 全局 skills：
  - `meow-protocol`
  - `haiku-mode`
- profiles：
  - `poet`
    - `skills: ['meow-protocol']`
  - `researcher`
    - 不限制 skills，继承全局 skills

在 DevTools 中切到不同 session 时，右上角 `Skills` / `Tools` badge 会显示该 session engine 实际可见的能力，而不是全局静态列表。

如果你想不依赖真实 LLM，直接验证 session 级 skills 过滤是否生效，可以运行：

```bash
cd demo/stello-agent-chat
OPENAI_API_KEY=fake node --import tsx verify-per-session-skills.ts
```

预期输出：

```text
Per-session skills verification passed.
  main: meow-protocol, haiku-mode
  poet: meow-protocol
  researcher: meow-protocol, haiku-mode
```

## 实现方式

这个 demo 仍然只依赖 `@stello-ai/core` 和 `@stello-ai/session`：

- 入口：`chat-devtools.ts`
- 调试面板：`@stello-ai/devtools`
- 大模型：`@stello-ai/session` 的 OpenAI 兼容 adapter

它不是 `@stello-ai/server`，而是当前 agent + devtools 这条接入路径的调试样例。

## 干跑验证

如果你只想验证装配是否成功，不想真的监听端口，可以：

```bash
DEMO_DRY_RUN=1 node --import tsx demo/stello-agent-chat/chat-devtools.ts
```

或直接：

```bash
OPENAI_API_KEY=fake DEMO_DRY_RUN=1 node --import tsx demo/stello-agent-chat/chat-devtools.ts
```

这会完成：

- session / main session 恢复或初始化
- StelloAgent 装配
- DevTools provider 装配前的 dry-run

然后直接退出。
