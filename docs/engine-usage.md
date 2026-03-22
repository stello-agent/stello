# StelloEngine 使用说明

## 这是什么

`StelloEngine` 是当前 `core` 里的编排层主入口。

它的职责不是自己实现底层对话，而是把这些角色串起来：

- 当前 session
- main session
- tool loop
- 调度器
- lifecycle
- tool 执行器
- split guard

你可以把它理解成一个 orchestration façade。

当前实现位于：

- `packages/core/src/engine/stello-engine.ts`

相关配套组件：

- `packages/core/src/engine/turn-runner.ts`
- `packages/core/src/engine/scheduler.ts`

---

## 它现在能做什么

当前 `StelloEngineImpl` 已经支持这些主入口：

- `turn(input)`
- `ingest(message)`
- `assemble()`
- `afterTurn(userMsg, assistantMsg)`
- `switchSession(targetId)`
- `switchSessionWithSchedule(targetId)`
- `archiveSession(sessionId?)`
- `forkSession(options)`
- `getToolDefinitions()`
- `executeTool(name, args)`

通俗理解：

- `turn()`：跑一轮 session 对话，如果模型要调工具，就循环执行工具
- `switchSessionWithSchedule()`：切换 session，并执行切换阶段调度
- `archiveSession()`：归档 session，并执行归档阶段调度
- `forkSession()`：创建子 session，并走 split guard 检查

---

## 先理解它依赖什么

`StelloEngine` 不是“自己什么都有”，它依赖你传入几类对象。

### 1. `sessionResolver`

负责把 `sessionId` 解析成 engine 可用的运行时对象。

最少要提供：

- `getSession(sessionId)`
- 可选 `getMainSession()`

`getSession()` 返回的对象要同时满足：

- `TurnRunnerSession`
- `SchedulerSession`

也就是既能：

- `send()`
- `consolidate()`

最小形状大概是：

```ts
const runtimeSession = {
  meta: {
    id: 'sess-1',
    turnCount: 4,
    consolidatedTurn: 2,
  },
  async send(input: string) {
    return { content: 'reply', toolCalls: [] };
  },
  async consolidate(fn: unknown) {
    // 你的 session consolidate 实现
  },
};
```

---

### 2. `tools`

负责两件事：

- 给模型暴露工具定义
- 真正执行工具

最少要提供：

```ts
const tools = {
  getToolDefinitions() {
    return [
      {
        name: 'stello_read_core',
        description: 'Read core field',
        parameters: { type: 'object', properties: { path: { type: 'string' } } },
      },
    ];
  },
  async executeTool(name: string, args: Record<string, unknown>) {
    return { success: true, data: 'value' };
  },
};
```

---

### 3. `lifecycle`

负责旧版 lifecycle 能力的适配。

当前 engine 仍然会委托这些方法：

- `bootstrap(sessionId)`
- `assemble(sessionId)`
- `afterTurn(sessionId, userMsg, assistantMsg)`
- `onSessionSwitch(fromId, toId)`
- `prepareChildSpawn(options)`

如果你们暂时只想验证编排层，完全可以先 mock：

```ts
const lifecycle = {
  async bootstrap(sessionId) {
    return {
      context: { core: {}, memories: [], currentMemory: null, scope: null },
      session: { id: sessionId },
    };
  },
  async assemble(sessionId) {
    return { core: {}, memories: [], currentMemory: null, scope: null };
  },
  async afterTurn(sessionId, userMsg, assistantMsg) {
    return { coreUpdated: false, memoryUpdated: true, recordAppended: true };
  },
  async onSessionSwitch(fromId, toId) {
    return {
      context: { core: {}, memories: [], currentMemory: null, scope: null },
      session: { id: toId },
    };
  },
  async prepareChildSpawn(options) {
    return {
      id: 'child-1',
      parentId: options.parentId,
      children: [],
      refs: [],
      label: options.label,
      index: 0,
      scope: options.scope ?? null,
      status: 'active',
      depth: 1,
      turnCount: 0,
      metadata: options.metadata ?? {},
      tags: options.tags ?? [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    };
  },
};
```

---

### 4. `splitGuard`

这是可选项。

如果你希望 `forkSession()` 先做“能不能拆”的保护判断，就传它。

最少要提供：

```ts
const splitGuard = {
  async checkCanSplit(sessionId: string) {
    return { canSplit: true };
  },
  recordSplit(sessionId: string, turnCount: number) {
    // 记录本次 split
  },
};
```

如果不传，`forkSession()` 会直接创建子 session，不做 guard 检查。

---

### 5. `sessions` / `memory` / `skills` / `confirm`

这几个对象是为了让 engine 同时满足旧 `StelloEngine` 接口和现有 `core` 结构。

- `sessions`：session tree
- `memory`：memory engine
- `skills`：skill router
- `confirm`：confirm protocol

它们有些入口会直接被 `StelloEngineImpl` 透传或引用。

如果你只是先做最小集成，可以先给 mock。

---

## 最小组装示例

下面是最小可读版本。

```ts
import {
  Scheduler,
  TurnRunner,
  createStelloEngine,
} from '../packages/core/src/index';

const engine = createStelloEngine({
  currentSessionId: 'root',
  sessions,
  memory,
  skills,
  confirm,
  lifecycle,
  tools,
  sessionResolver,
  splitGuard,
  turnRunner: new TurnRunner(),
  scheduler: new Scheduler({
    consolidation: { mode: 'everyNTurns', everyNTurns: 2 },
    integration: { mode: 'afterConsolidate' },
  }),
});
```

完整 mock 版本可以直接看：

- `scripts/engine-smoke.ts`

---

## 具体怎么调用

### 1. 跑一轮对话

```ts
const result = await engine.turn('Plan the feature');
```

返回结构：

```ts
{
  turn: {
    finalContent: '...',
    toolRoundCount: 1,
    toolCallsExecuted: 1,
  },
  schedule: {
    consolidated: true,
    integrated: true,
  },
}
```

它内部会做两步：

1. `TurnRunner.run()` 执行 tool loop
2. `Scheduler.afterTurn()` 判断要不要 `consolidate / integrate`

---

### 2. 技能匹配

```ts
const result = await engine.ingest({
  role: 'user',
  content: 'please translate this',
  timestamp: new Date().toISOString(),
});
```

返回：

```ts
{ matchedSkill: 'translate' }
```

这一步只是把消息交给 `skills.match()`。

---

### 3. 创建子 session

```ts
const result = await engine.forkSession({
  label: 'UI Session',
  scope: 'design',
});
```

内部顺序是：

1. 取当前 `currentSessionId` 作为默认父 session
2. 如果有 `splitGuard`，先 `checkCanSplit()`
3. 调 `lifecycle.prepareChildSpawn()`
4. 创建成功后，如果有 `splitGuard`，再 `recordSplit()`

返回：

```ts
{ child: SessionMeta }
```

如果你想指定父 session：

```ts
await engine.forkSession({
  parentId: 'some-session-id',
  label: 'Child Topic',
});
```

---

### 4. 切换 session

如果你只想切换，不关心调度结果：

```ts
const bootstrap = await engine.switchSession('child-ui');
```

如果你想同时拿到调度结果：

```ts
const result = await engine.switchSessionWithSchedule('child-ui');
```

返回：

```ts
{
  bootstrap: BootstrapResult,
  schedule: {
    consolidated: boolean,
    integrated: boolean,
  },
}
```

---

### 5. 归档 session

归档当前 session：

```ts
const result = await engine.archiveSession();
```

归档指定 session：

```ts
const result = await engine.archiveSession('child-ui');
```

返回：

```ts
{
  sessionId: 'child-ui',
  schedule: {
    consolidated: boolean,
    integrated: boolean,
  },
}
```

---

### 6. 透传工具定义和工具执行

```ts
const defs = engine.getToolDefinitions();
const result = await engine.executeTool('stello_read_core', { path: 'goal' });
```

这两个入口本质上就是透传给 `tools`。

---

## 调度器怎么配

### 例子 1：每 2 轮 consolidate，一旦 consolidate 就 integrate

```ts
const scheduler = new Scheduler({
  consolidation: { mode: 'everyNTurns', everyNTurns: 2 },
  integration: { mode: 'afterConsolidate' },
});
```

### 例子 2：切换 session 时 consolidate + integrate

```ts
const scheduler = new Scheduler({
  consolidation: { mode: 'onSwitch' },
  integration: { mode: 'onSwitch' },
});
```

### 例子 3：归档时只 consolidate，不 integrate

```ts
const scheduler = new Scheduler({
  consolidation: { mode: 'onArchive' },
  integration: { mode: 'manual' },
});
```

---

## `turn()` 里 tool loop 的输入输出约定

当前 `TurnRunner` 的约定是：

1. 先调用一次 `session.send(userInput)`
2. 如果模型返回 `toolCalls`
3. engine 逐个执行工具
4. 把工具结果编码成下一轮 `send()` 的输入

当前编码格式是：

```json
{
  "toolResults": [
    {
      "toolCallId": "tool-1",
      "name": "stello_read_core",
      "success": true,
      "data": "..."
    }
  ]
}
```

这是当前编排层内部约定，后续如果接真实 `packages/session` 原语层，可以再统一协议。

---

## 推荐验证方式

### 1. 跑最小集成示例

```bash
node --import tsx scripts/engine-smoke.ts
```

这个脚本会依次演示：

- `turn()`
- `ingest()`
- `forkSession()`
- `switchSessionWithSchedule()`
- `archiveSession()`

### 2. 跑编排层测试

```bash
pnpm --filter @stello-ai/core test -- --run \
  src/engine/__tests__/turn-runner.test.ts \
  src/engine/__tests__/scheduler.test.ts \
  src/engine/__tests__/stello-engine.test.ts
```

### 3. 跑 `core` 全量测试

```bash
pnpm --filter @stello-ai/core test
```

---

## 当前限制

### 1. 还没有完全接回真实 `packages/session`

当前 `StelloEngine` 是编排层骨架，底层 session 能力主要还是通过最小接口 mock 或适配。

### 2. `LifecycleManager` 仍然是旧路径

`assemble / afterTurn / onSessionSwitch / prepareChildSpawn` 现在仍是委托给 lifecycle。

### 3. `types/engine.ts` 里的公开接口还没完全收口

实现类 `StelloEngineImpl` 现在比旧的 `StelloEngine` 类型接口更丰富。

---

## 一句话理解怎么用

如果你只是想开始用：

1. 先准备 `sessionResolver / tools / lifecycle`
2. 再用 `createStelloEngine(...)` 组装 engine
3. 正常对话走 `turn()`
4. 创建分支走 `forkSession()`
5. 切换分支走 `switchSessionWithSchedule()`
6. 结束分支走 `archiveSession()`

如果你只想看一个现成最小例子，直接看：

- `scripts/engine-smoke.ts`
