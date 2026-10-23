// Bundles the server and its admin command into plain JavaScript for Node.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/main.ts', 'src/cli.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  // Installed in the image; bundling them breaks their dynamic requires.
  packages: 'external',
  // The shared protocol package is source, so it is bundled.
  alias: { '@worship-q/protocol': '../../packages/protocol/src/index.ts' },
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
