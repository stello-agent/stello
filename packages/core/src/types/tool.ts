import type { StelloAgent } from '../agent/stello-agent'

/** Runtime context passed to every Tool's execute function */
export interface ToolExecutionContext {
  /** Full StelloAgent reference — tools may invoke any agent capability */
  agent: StelloAgent
  /** Session ID that triggered this tool call */
  sessionId: string
  /** LLM-provided tool call ID (for dedup / tracing); may be omitted */
  toolCallId?: string
  /** This tool's own name (debug, generic wrappers) */
  toolName: string
}
