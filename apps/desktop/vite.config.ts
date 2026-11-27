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

/** Set by `tauri ios dev` and `tauri android dev`: where a phone reaches this computer. */
const devHost = process.env.TAURI_DEV_HOST;

// Port and options expected by the Tauri CLI.
export default defineConfig({
  plugins: [react(), tailwindcss(), reloadOnLogicChange],
  clearScreen: false,
  // `TAURI_ENV_PLATFORM` tells the interface whether it is the phone and tablet app.
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  server: {
    port: 1420,
    strictPort: true,
    host: devHost || false,
    hmr: devHost ? { protocol: 'ws', host: devHost, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      // The subtitle overlay and the slideshow are further pages, served on localhost for OBS
      // and browsers on this computer, as is the page the slideshow window plays YouTube on.
      input: {
        main: 'index.html',
        overlay: 'overlay.html',
        slideshow: 'slideshow.html',
        youtube: 'youtube.html',
      },
    },
  },
});
