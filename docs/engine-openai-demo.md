# StelloEngine 真实 LLM Demo

## 说明

这个 demo 用真实的 OpenAI 兼容接口驱动 `StelloEngine`。

当前默认接入的是 MiniMax 的 OpenAI 兼容接口：

```bash
export OPENAI_BASE_URL=https://api.minimaxi.com/v1
export OPENAI_API_KEY=
export OPENAI_MODEL=MiniMax-M2.7
```

`OPENAI_API_KEY` 留给你自己填写。

如果你不设置 `OPENAI_MODEL`，脚本默认也会使用：

```bash
MiniMax-M2.7
```

---

## 脚本位置

脚本在：

- `scripts/engine-openai-demo.ts`

虽然文件名叫 `openai-demo`，但它走的是 OpenAI 兼容协议，不限定具体厂商。

---

## 怎么运行

推荐直接这样跑：

```bash
export OPENAI_BASE_URL=https://api.minimaxi.com/v1
export OPENAI_API_KEY=你自己的key
export OPENAI_MODEL=MiniMax-M1

node --import tsx scripts/engine-openai-demo.ts
```

也可以传两段自定义 prompt：

```bash
node --import tsx scripts/engine-openai-demo.ts \
  "我想做一个 AI 编程工作台，先帮我梳理方向。" \
  "继续只讨论 UI 方向，给我一个首页信息架构。"
```

---

## 它会做什么

脚本会依次跑这几步：

1. root session 跑一次真实 LLM `turn()`
2. fork 一个 child session
3. 切换到 child session
4. child session 再跑一次真实 LLM `turn()`
5. archive child session

其中真实走模型的是：

- `turn()` 里的模型回答
- `turn()` 里的工具调用决策

其中仍然是最小 in-memory 实现的是：

- session tree
- lifecycle
- split guard
- memory 持久化

所以这个 demo 的目标不是完整产品集成，而是验证：

- `StelloEngine` 的编排入口能不能和真实 LLM 配合工作
- tool loop 能不能跑起来
- fork / switch / archive 的时序是不是通的

---

## 当前支持的工具

这个 demo 里目前只给模型暴露了两个工具：

- `stello_read_core`
- `stello_list_sessions`

这样可以比较容易观察模型是否会：

- 读取全局目标信息
- 感知当前已有 session

---

## 常见问题

### 1. 报 `缺少 OPENAI_API_KEY 环境变量`

说明你还没设置 key。

先执行：

```bash
export OPENAI_BASE_URL=https://api.minimaxi.com/v1
export OPENAI_API_KEY=你自己的key
export OPENAI_MODEL=MiniMax-M1
```

再运行脚本。

### 2. 为什么不用 `pnpm demo:engine:openai`

可以用，但某些环境里 `tsx` 的默认 IPC 机制可能被限制。

更稳妥的是直接运行：

```bash
node --import tsx scripts/engine-openai-demo.ts
```

### 3. 如果 MiniMax 的模型名不是 `MiniMax-M1` 怎么办

直接改环境变量：

```bash
export OPENAI_MODEL=你的模型名
```

脚本会优先使用你传入的值。
