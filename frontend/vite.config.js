import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  server: {
    host: '0.0.0.0',
    port: 6173,
    strictPort: false,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:9000',
        changeOrigin: true,
      },
      // The meeting signalling socket. `ws: true` is what makes Vite forward
      // the upgrade rather than answering it as an ordinary request, which is
      // why the path needs its own entry instead of riding along with /api.
      '/rtc': {
        target: 'ws://127.0.0.1:9000',
        ws: true,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
});
