import { defineConfig } from 'tsup';
import { cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  onSuccess: async () => {
    /* 构建后把前端产物拷贝到 dist/web/ */
    const webDist = resolve('dist', 'web');
    const webSrc = resolve('web', 'dist'); // vite build --outDir 默认输出到这里
    /* Vite 配置 outDir: '../dist/web'，所以产物已经在 dist/web/ 了 */
    if (existsSync(webDist)) {
      console.log('✓ Frontend assets found in dist/web/');
    } else if (existsSync(webSrc)) {
      cpSync(webSrc, webDist, { recursive: true });
      console.log('✓ Copied frontend assets to dist/web/');
    } else {
      console.log('⚠ No frontend build found. Run: cd web && pnpm exec vite build');
    }
  },
});
