import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:4800',
      '/ws': { target: 'ws://localhost:4800', ws: true },
    },
  },
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
  },
})
