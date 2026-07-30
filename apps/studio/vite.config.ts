import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.STUDIO_BASE ?? './',
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1800,
  },
  optimizeDeps: {
    exclude: ['@kyxos/viewer'],
    noDiscovery: true,
  },
});
