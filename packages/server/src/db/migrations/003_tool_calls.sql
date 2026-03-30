-- 为 records 表添加 tool_calls 列，存储 assistant 消息中的工具调用列表
ALTER TABLE records ADD COLUMN IF NOT EXISTS tool_calls JSONB;
