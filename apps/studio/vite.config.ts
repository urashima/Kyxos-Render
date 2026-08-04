import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  worker: { format: 'es' },
  build: {
    sourcemap: true,
    target: 'es2022',
    rollupOptions: {
      input: {
        studio: fileURLToPath(new URL('./index.html', import.meta.url)),
        'ui-lab': fileURLToPath(new URL('./ui-lab/index.html', import.meta.url)),
        'chat-lab': fileURLToPath(new URL('./chat-lab/index.html', import.meta.url)),
      },
    },
  },
});
