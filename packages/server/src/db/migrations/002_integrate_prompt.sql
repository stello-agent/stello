-- 新增 integrate_prompt 列，用于自定义 integration 提示词
ALTER TABLE spaces ADD COLUMN IF NOT EXISTS integrate_prompt TEXT;
