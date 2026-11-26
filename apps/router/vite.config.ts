import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

/**
 * The page's script goes into the page itself: the router's Content-Security-Policy allows
 * inline scripts and nothing else, and the page loads nothing from anywhere.
 */
function inlineScripts(): Plugin {
  return {
    name: 'router-inline-scripts',
    enforce: 'post',
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type !== 'asset' || !file.fileName.endsWith('.html')) continue;
        let html = String(file.source);
        html = html.replace(
          /<script type="module" crossorigin src="\/([^"]+)"><\/script>/g,
          (_tag, path: string) => {
            const chunk = bundle[path];
            if (!chunk || chunk.type !== 'chunk') throw new Error(`no chunk for ${path}`);
            delete bundle[path];
            return `<script type="module">${chunk.code.replace(/<\/script/gi, '<\\/script')}</script>`;
          },
        );
        if (/<script[^>]+src=|<link[^>]+stylesheet/.test(html)) {
          throw new Error(`${file.fileName} still loads a file`);
        }
        file.source = html;
      }
    },
  };
}

// app.worship-q.com: the association files from public/, and the invitation page at /j.
export default defineConfig({
  root: 'src',
  publicDir: '../public',
  plugins: [inlineScripts()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2020',
    modulePreload: false,
    rollupOptions: { input: { j: fileURLToPath(new URL('./src/j/index.html', import.meta.url)) } },
  },
  server: { port: 1430 },
});
