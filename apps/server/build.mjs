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
  // The shared packages are source, so they are bundled.
  alias: {
    '@worship-q/protocol': '../../packages/protocol/src/index.ts',
    '@worship-q/lyrics': '../../packages/lyrics/src/index.ts',
    '@worship-q/live-state': '../../packages/live-state/src/index.ts',
    '@worship-q/relay': '../../packages/relay/src/index.ts',
  },
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
