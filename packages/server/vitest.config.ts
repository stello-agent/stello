import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // 测试文件串行执行，避免共享 PG 时 TRUNCATE 死锁
    fileParallelism: false,
  },
})
