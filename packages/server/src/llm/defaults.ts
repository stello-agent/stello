// 从 core 重新导出，保持 server 包的向后兼容
export {
  createDefaultConsolidateFn,
  createDefaultIntegrateFn,
  DEFAULT_CONSOLIDATE_PROMPT,
  DEFAULT_INTEGRATE_PROMPT,
  type LLMCallFn,
} from '@stello-ai/core'
