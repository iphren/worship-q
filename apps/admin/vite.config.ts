import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Served by the church instance at /admin/ (decision D35).
export default defineConfig({
  base: '/admin/',
  plugins: [react(), tailwindcss()],
  build: { target: 'es2020' },
  server: {
    port: 1422,
    // During development the instance runs locally; sign-in redirects go through it too.
    proxy: {
      '/api': { target: 'http://localhost:8080' },
      '/auth': { target: 'http://localhost:8080' },
    },
  },
});
