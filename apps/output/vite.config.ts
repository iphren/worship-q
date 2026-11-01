import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Served by the church instance at /output/slideshow and /output/subtitle (decision D22).
export default defineConfig({
  base: '/output/',
  plugins: [react()],
  build: { target: 'es2020' },
  server: {
    port: 1422,
    // During development the instance runs locally.
    proxy: { '/api': { target: 'http://localhost:8080', ws: true } },
  },
});
