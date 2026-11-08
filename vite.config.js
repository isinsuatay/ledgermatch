import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/@stellar/') || id.includes('/node_modules/buffer/')) return 'stellar';
        },
      },
    },
  },
});
