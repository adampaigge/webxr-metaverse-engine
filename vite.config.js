import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    https: true, // Required for WebXR
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    }
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      input: {
        main: 'index.html',
        'service-worker': 'src/sw.js'
      }
    }
  },
  optimizeDeps: {
    exclude: ['@fails-components/webtransport']
  }
});
