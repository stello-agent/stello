# RFC: Consolidate / Integrate 机制重设计

> 来源：KitKit 项目实践中对 stello 框架 consolidate/integrate 机制的改进需求。
> 日期：2026-04-17

## 背景

KitKit 是基于 stello 的 SaaS 应用，每个 Space（Kit）对应一个 StelloAgent。在实际接入中遇到以下问题：

1. **`consolidateFn` 是 per-agent 的，但实际需要 per-session**：每个子 session 可以有独立的 consolidate prompt，需要在 session 级别绑定不同的 consolidateFn。
2. **consolidateFn / integrateFn 在调用时传入，而非创建时绑定**：当前 `session.consolidate(fn)` 和 `mainSession.integrate(fn)` 在调用时接收函数，导致调用方需要持有 fn 引用并做路由，增加了不必要的复杂度。
3. **Scheduler 抽象过度**：Scheduler 在 EngineHooks 之上加了一层 policy routing table，但实际上 hooks 本身已足够灵活。
4. **`manual` trigger 语义空洞**：`manual` 作为 trigger 类型意味着"什么都不做"，但 Scheduler 上没有手动触发方法，真正的手动触发得绕过 Scheduler。
5. **`onLeave` 等事件属于应用层**：框架提供了 `onSessionLeave` 等 hooks，何时调用 `leaveSession()` 是应用决定的。Scheduler 把"在 onLeave 时 consolidate"做成框架层 policy 不合适，这应该是应用在 hooks 里自己编排。
6. **StelloAgent 没有暴露 `consolidateSession()` / `integrate()` 方法**：没有一等公民的手动触发 API。

---

## 核心改动

### 1. Session / MainSession：fn 在创建时绑定，不在调用时传入

**现状：**

```typescript
// @stello-ai/session
interface Session {
  consolidate(fn: ConsolidateFn): Promise<void>;
}

interface MainSession {
  integrate(fn: IntegrateFn): Promise<IntegrateResult>;
}
```

**改为：**

```typescript
interface Session {
  consolidate(): Promise<void>;  // 使用创建时绑定的 fn
}

interface MainSession {
  integrate(): Promise<IntegrateResult>;  // 使用创建时绑定的 fn
}
```

fn 在 `loadSession` / `createSession` / `loadMainSession` / `createMainSession` 时通过 options 传入并绑定：

```typescript
// loadSession options 新增 consolidateFn
interface LoadSessionOptions {
  storage: SessionStorage;
  llm?: LLMAdapter;
  systemPrompt?: string;
  tools?: LLMCompleteOptions['tools'];
  compressFn?: CompressFn;
  consolidateFn?: ConsolidateFn;  // 新增
}

// loadMainSession options 新增 integrateFn
interface LoadMainSessionOptions {
  storage: MainStorage;
  llm?: LLMAdapter;
  systemPrompt?: string;
  tools?: LLMCompleteOptions['tools'];
  compressFn?: CompressFn;
  integrateFn?: IntegrateFn;  // 新增
}

// createSession / createMainSession 同理
```

Session 内部实现：

```typescript
// create-session.ts 内部
function buildSession(meta, options) {
  const boundConsolidateFn = options.consolidateFn;

  return {
    // ...
    async consolidate(): Promise<void> {
      if (!boundConsolidateFn) throw new Error('No consolidateFn configured for this session');
      // 原有逻辑，只是把 fn 参数改为 boundConsolidateFn
      const messages = await storage.listRecords(currentMeta.id);
      const currentMemory = await storage.getMemory(currentMeta.id);
      const newMemory = await boundConsolidateFn(currentMemory, messages);
      await storage.putMemory(currentMeta.id, newMemory);
    },
  };
}
```

MainSession 同理：

```typescript
function buildMainSession(meta, options) {
  const boundIntegrateFn = options.integrateFn;

  return {
    // ...
    async integrate(): Promise<IntegrateResult> {
      if (!boundIntegrateFn) throw new Error('No integrateFn configured for this main session');
      const childSummaries = await storage.getAllSessionL2s();
      const currentSynthesis = await storage.getMemory(currentMeta.id);
      const result = await boundIntegrateFn(childSummaries, currentSynthesis);
      // ... 写入 synthesis 和 insights（逻辑不变）
      return result;
    },
  };
}
```

### 2. StelloAgent 新增一等 API

```typescript
class StelloAgent {
  // 已有方法...

  /** 对指定 session 执行 consolidation */
  async consolidateSession(sessionId: string): Promise<void>;

  /** 对 main session 执行 integration */
  async integrate(): Promise<IntegrateResult>;
}
```

实现思路：通过 `sessionResolver` / `mainSessionResolver` 获取已绑定 fn 的 session，直接调用 `session.consolidate()` / `mainSession.integrate()`。

### 3. StelloAgentConfig 调整

**现状：**

```typescript
interface StelloAgentSessionConfig {
  sessionResolver?: (sessionId: string) => Promise<SessionCompatible>;
  mainSessionResolver?: () => Promise<MainSessionCompatible | null>;
  consolidateFn?: SessionCompatibleConsolidateFn;       // agent 级
  integrateFn?: SessionCompatibleIntegrateFn;            // agent 级
  compressFn?: SessionCompatibleCompressFn;
  serializeSendResult?: ...;
  toolCallParser?: ...;
}
```

**改为：**

```typescript
interface StelloAgentSessionConfig {
  sessionResolver?: (sessionId: string) => Promise<SessionCompatible>;
  mainSessionResolver?: () => Promise<MainSessionCompatible | null>;
  // consolidateFn 和 integrateFn 从这里移除
  // 它们现在跟着 session 走，在 resolver 内部通过 loadSession/loadMainSession 绑定
  compressFn?: SessionCompatibleCompressFn;
  serializeSendResult?: ...;
  toolCallParser?: ...;
}
```

`consolidateFn` 和 `integrateFn` 不再是 agent 级配置。每个 session 在 `sessionResolver` 里加载时自行绑定。

> **注意**：agent 配置中保留 `consolidateFn` / `integrateFn` 作为可选的默认值也可以接受（方便 resolver 内部做 fallback），但框架本身不再直接使用它们——只有 resolver 可以在 `loadSession` 时引用。是否保留这两个字段由实现者决定。

### 4. SessionCompatible 接口同步调整

```typescript
// 现状
interface SessionCompatible {
  consolidate(fn: SessionCompatibleConsolidateFn): Promise<void>;
}

// 改为
interface SessionCompatible {
  consolidate(): Promise<void>;
}

// 现状
interface MainSessionCompatible {
  integrate(fn: SessionCompatibleIntegrateFn): Promise<unknown>;
}

// 改为
interface MainSessionCompatible {
  integrate(): Promise<unknown>;
}
```

### 5. adaptSessionToEngineRuntime 简化

**现状：**

```typescript
// SessionRuntimeAdapterOptions
interface SessionRuntimeAdapterOptions {
  consolidateFn: SessionCompatibleConsolidateFn;  // 必填
  compressFn?: SessionCompatibleCompressFn;
  serializeResult?: ...;
}

// 适配器内部
async consolidate(): Promise<void> {
  await session.consolidate(options.consolidateFn);  // 传入 fn
}
```

**改为：**

```typescript
interface SessionRuntimeAdapterOptions {
  // consolidateFn 移除，不再需要
  compressFn?: SessionCompatibleCompressFn;
  serializeResult?: ...;
}

// 适配器内部
async consolidate(): Promise<void> {
  await session.consolidate();  // session 自带 fn
}
```

### 6. resolveRuntimeResolver 简化

**现状**（`stello-agent.ts`）：

```typescript
function resolveRuntimeResolver(config: StelloAgentConfig): SessionRuntimeResolver {
  if (config.runtime?.resolver) return config.runtime.resolver;

  if (config.session?.sessionResolver && config.session.consolidateFn) {
    // 要求 consolidateFn 存在才能构建 resolver
    return {
      async resolve(sessionId) {
        const session = await config.session!.sessionResolver!(sessionId);
        return adaptSessionToEngineRuntime(session, {
          consolidateFn: config.session!.consolidateFn!,  // 传入 agent 级 fn
          // ...
        });
      },
    };
  }
  throw new Error('...');
}
```

**改为：**

```typescript
function resolveRuntimeResolver(config: StelloAgentConfig): SessionRuntimeResolver {
  if (config.runtime?.resolver) return config.runtime.resolver;

  if (config.session?.sessionResolver) {
    // 不再要求 consolidateFn 存在
    return {
      async resolve(sessionId) {
        const session = await config.session!.sessionResolver!(sessionId);
        return adaptSessionToEngineRuntime(session, {
          // consolidateFn 不再需要传
          compressFn: config.session?.compressFn,
          serializeResult: config.session?.serializeSendResult,
        });
      },
    };
  }
  throw new Error('...');
}
```

### 7. resolveMainSession 简化

**现状：**

```typescript
function resolveMainSession(config: StelloAgentConfig): SchedulerMainSession | null | undefined {
  if (config.orchestration?.mainSession) return config.orchestration.mainSession;

  if (config.session?.mainSessionResolver && config.session.integrateFn) {
    return {
      async integrate(): Promise<void> {
        const mainSession = await config.session!.mainSessionResolver!();
        if (!mainSession) return;
        const adapted = adaptMainSessionToSchedulerMainSession(mainSession, {
          integrateFn: config.session!.integrateFn!,  // 传入 agent 级 fn
        });
        await adapted.integrate();
      },
    };
  }
  return null;
}
```

**改为：**

```typescript
function resolveMainSession(config: StelloAgentConfig): SchedulerMainSession | null | undefined {
  if (config.orchestration?.mainSession) return config.orchestration.mainSession;

  if (config.session?.mainSessionResolver) {
    return {
      async integrate(): Promise<void> {
        const mainSession = await config.session!.mainSessionResolver!();
        if (!mainSession) return;
        await mainSession.integrate();  // mainSession 自带 fn
      },
    };
  }
  return null;
}
```

### 8. ForkProfile 适配

ForkProfile 当前支持 `consolidateFn`：

```typescript
interface ForkProfile {
  consolidateFn?: SessionCompatibleConsolidateFn;
  // ...
}
```

这个保留。fork 时如果 ForkProfile 指定了 `consolidateFn`，子 session 用这个 fn；否则由 resolver 加载时决定。

fork 内部实现中，需要确保 `consolidateFn` 被绑定到新建的子 session 上。

### 9. Scheduler 降级

Scheduler 不删除，但降级为可选辅助。不再是 consolidate/integrate 的唯一触发路径。

应用层可以直接用 hooks 编排：

```typescript
orchestration: {
  hooks: (sessionId) => ({
    onSessionLeave: () => {
      agent.consolidateSession(sessionId).catch(() => {});
    },
  }),
}
```

或者继续用 Scheduler（如果 declarative config 有需要）。两种方式不冲突。

---

## 对 KitKit 的影响

以下是 KitKit 侧的配套改动，供参考（不属于 stello 仓库的工作）：

### 数据模型

```
spaces 表（已有列）
├── consolidate_prompt   TEXT  — 子 session 默认 consolidate prompt
├── integrate_prompt     TEXT  — main session 的 integrate prompt
└── config               JSONB — 调度策略等扩展配置

session_data 表（已有结构，新增 key）
└── key='consolidate_prompt'  — 子 session 独立 consolidate prompt
    空 = 采用 space 的默认值
```

### Agent 创建

```typescript
const defaultConsolidateFn = createDefaultConsolidateFn(
  space.consolidate_prompt ?? DEFAULT_CONSOLIDATE_PROMPT,
  llmCallFn,
);
const integrateFn = createDefaultIntegrateFn(
  space.integrate_prompt ?? DEFAULT_INTEGRATE_PROMPT,
  llmCallFn,
);

agent = createStelloAgent({
  sessions: sessionTree,
  memory: memoryEngine,
  capabilities: { /* ... */ },
  session: {
    sessionResolver: async (sid) => {
      const root = await sessionTree.getRoot();
      const storage = root.id === sid ? mainStorage : sessionStorage;

      // per-session prompt 解析：session_data → space default → stello default
      const sessionPrompt = await sessionStorage.getSessionData(sid, 'consolidate_prompt');
      const fn = sessionPrompt
        ? createDefaultConsolidateFn(sessionPrompt, llmCallFn)
        : defaultConsolidateFn;

      return (await loadSession(sid, { storage, llm, consolidateFn: fn }))!;
    },
    mainSessionResolver: async () => {
      const root = await sessionTree.getRoot();
      return loadMainSession(root.id, { storage: mainStorage, llm, integrateFn });
    },
  },
  orchestration: {
    hooks: (sessionId) => ({
      onSessionLeave: () => {
        agent.consolidateSession(sessionId).catch(() => {});
      },
    }),
  },
});
```

### API

```
POST /spaces/:id/integrate           — 手动触发 integration
POST /spaces/:id/sessions/:sid/consolidate  — 手动触发 consolidation（可选）
```

### Fork 流程

fork 时若前端传入 `consolidatePrompt`：
1. 写入 `session_data` 表（key='consolidate_prompt'）
2. 后续 `sessionResolver` 加载该 session 时自然读到，绑定独立的 fn

---

## 改动清单（stello 仓库）

### @stello-ai/session

| 文件 | 改动 |
|------|------|
| `src/types/functions.ts` | `LoadSessionOptions` / `CreateSessionOptions` 新增 `consolidateFn?`；`LoadMainSessionOptions` / `CreateMainSessionOptions` 新增 `integrateFn?` |
| `src/types/session-api.ts` | `Session.consolidate()` 移除 fn 参数 |
| `src/types/main-session-api.ts` | `MainSession.integrate()` 移除 fn 参数 |
| `src/create-session.ts` | `buildSession` 内部绑定 `consolidateFn`，`consolidate()` 使用绑定的 fn |
| `src/create-main-session.ts` | `buildMainSession` 内部绑定 `integrateFn`，`integrate()` 使用绑定的 fn |

### @stello-ai/core

| 文件 | 改动 |
|------|------|
| `src/adapters/session-runtime.ts` | `SessionCompatible.consolidate()` 移除 fn 参数；`MainSessionCompatible.integrate()` 移除 fn 参数；`SessionRuntimeAdapterOptions` 移除 `consolidateFn`；`MainSessionAdapterOptions` 移除 `integrateFn`；`adaptSessionToEngineRuntime` / `adaptMainSessionToSchedulerMainSession` 简化 |
| `src/agent/stello-agent.ts` | `StelloAgentSessionConfig` 移除 `consolidateFn` / `integrateFn`；`resolveRuntimeResolver` 不再要求 `consolidateFn`；`resolveMainSession` 不再要求 `integrateFn`；新增 `StelloAgent.consolidateSession(sessionId)` 和 `StelloAgent.integrate()` 方法 |
| `src/engine/fork-profile.ts` | `ForkProfile.consolidateFn` 保留，fork 时绑定到子 session |

### 测试

所有调用 `session.consolidate(fn)` 和 `mainSession.integrate(fn)` 的测试需要更新为创建时绑定 fn + 调用时不传参。
