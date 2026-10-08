import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [preact()],
  // Relative URLs everywhere: the Ingress base path is only known at runtime.
  base: './',
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 600 },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8099' },
  },
});
