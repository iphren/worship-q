import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * The session and the slideshow controller are created once and kept while the app runs, so
 * a hot update of the logic they are built from would leave the old code in use. Reloading
 * the page instead starts them again from the new code.
 */
const reloadOnLogicChange: Plugin = {
  name: 'reload-on-logic-change',
  handleHotUpdate({ file, server }) {
    if (!/\/packages\/[^/]+\/src\/|\/apps\/desktop\/src\/(app|lib|platform)\//.test(file)) return;
    server.hot.send({ type: 'full-reload' });
    return [];
  },
};

// Port and options expected by the Tauri CLI.
export default defineConfig({
  plugins: [react(), tailwindcss(), reloadOnLogicChange],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: { target: 'es2022' },
});
