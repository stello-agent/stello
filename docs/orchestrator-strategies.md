# Orchestrator 策略说明

## 当前状态

当前 `SessionOrchestrator` 已支持显式注入编排策略：

- `MainSessionFlatStrategy`
- `HierarchicalOkrStrategy`（仅占位，未实现）

策略接口是：

```ts
interface OrchestrationStrategy {
  resolveForkParent(source: SessionMeta, sessions: SessionTree): Promise<string>
}
```

它回答的问题是：

- 当某个 session 发起 `fork` 时，新节点最终应该挂到哪个父节点下面

---

## 已实现策略

### MainSessionFlatStrategy

规则：

- 根节点下直接创建子节点
- 任意子节点继续 fork 时，也默认挂回根节点
- 结果是 MainSession 的下一层保持平铺

适用场景：

- 中心协调型 agent
- 多 topic 并列展开
- MainSession 统一汇总多个子节点结果

---

## 预留策略

### HierarchicalOkrStrategy

当前只保留接口和 TODO，不提供实现。

预期方向：

- 上层节点代表更抽象目标
- 下层节点代表更具体任务
- 子节点继续 fork 时，默认沿当前层级继续向下展开
- 汇报和 summary 沿层级逐步上卷

当前代码行为：

- 如果直接实例化这个策略，会抛出未实现错误

---

## 当前建议

当前默认使用：

- `MainSessionFlatStrategy`

第二种层叠式 OKR 策略先保留接口，等 session / memory / integrate 的层级语义更稳定后再实现。
