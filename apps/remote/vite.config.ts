import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Served by the church instance at /remote/.
export default defineConfig({
  base: '/remote/',
  plugins: [react(), tailwindcss()],
  build: { target: 'es2020' },
  server: {
    port: 1421,
    // During development the instance runs locally.
    proxy: { '/api': { target: 'http://localhost:8080', ws: true } },
  },
});
