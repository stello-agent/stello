# Demo

当前仓库的示例集中放在这个目录。

## 可用示例

### `stello-agent-basic`

最小 `StelloAgent` 使用示例，展示：

- 如何用当前的 `StelloAgentConfig` 初始化 Agent
- 如何通过 `enterSession / turn / forkSession` 与 AgentApp 交互
- 如何通过 `attachSession / detachSession` 管理 session runtime

运行方式：

```bash
node --import tsx demo/stello-agent-basic/demo.ts
```

也可以用根目录脚本：

```bash
pnpm demo:agent
```

### `stello-agent-chat`

真实大模型 + DevTools 调试入口示例，展示：

- `StelloAgent` 接真实 `@stello-ai/session`
- `chat-devtools.ts` 启动留学顾问 demo
- 会话树、聊天消息、L2 / insights、运行时设置调试

运行方式：

```bash
node --import tsx demo/stello-agent-chat/chat-devtools.ts
```

也可以用根目录脚本：

```bash
pnpm demo:chat
```

说明文档：

- [stello-agent-chat/README.md](/Users/bytedance/Github/stello/demo/stello-agent-chat/README.md)
