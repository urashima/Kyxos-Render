import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.PAGES_BASE ?? (process.env.PAGES_BUILD ? '/Kyxos-Render/latest/' : '/'),
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1800,
  },
  optimizeDeps: {
    exclude: ['@kyxos/viewer'],
  },
});
