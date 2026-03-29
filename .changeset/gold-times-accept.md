---
"@stello-ai/core": patch
"@stello-ai/session": patch
"@stello-ai/devtools": patch
"@stello-ai/server": patch

---

fix(stello): 修复近期稳定性与 devtools 交互问题

- 修复 OpenAI 兼容适配器在推理模型下的默认输出上限问题
- 修复 integration 中 insight 回写与 sessionId 校验问题
- 修复 devtools 的历史工具调用展示、拓扑 fork 来源显示和节点拖拽位置持久化
- 修复 server/core 对 fork 来源展示信息的透传
