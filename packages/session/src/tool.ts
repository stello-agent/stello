import { z, type ZodRawShape } from 'zod'

/** 工具调用的结果 */
export interface CallToolResult<T = unknown> {
  output: T
  isError?: boolean
}

/** MCP 兼容的工具注解 */
export interface ToolAnnotations {
  /** 工具是否具有破坏性（只读 vs 写入） */
  readOnlyHint?: boolean
  /** 操作是否幂等 */
  idempotentHint?: boolean
  /** 工具标题（展示用） */
  title?: string
}

/** Tool 接口：tool() 工厂函数的返回类型 */
export interface Tool<S extends ZodRawShape = ZodRawShape> {
  name: string
  description: string
  /** Zod schema 对象（用于生成 JSON Schema） */
  inputSchema: z.ZodObject<S>
  /** 执行函数 */
  execute: (input: z.infer<z.ZodObject<S>>) => Promise<CallToolResult>
  annotations?: ToolAnnotations
}

/**
 * tool() — 工具定义工厂函数，通过 Zod schema 定义输入类型
 * 返回类型安全的 Tool 对象
 */
export function tool<S extends ZodRawShape>(
  name: string,
  description: string,
  inputSchema: S,
  execute: (input: z.infer<z.ZodObject<S>>) => Promise<CallToolResult>,
  extras?: { annotations?: ToolAnnotations }
): Tool<S> {
  return {
    name,
    description,
    inputSchema: z.object(inputSchema),
    execute,
    annotations: extras?.annotations,
  }
}
