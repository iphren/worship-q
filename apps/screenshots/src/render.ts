// Renders screenshots of the desktop app from its code, with public-domain content.
//   pnpm screenshots [out-dir] [scene]
// Starts the desktop app's Vite server, opens it in headless Chromium with Tauri replaced by
// tauri.ts and a database seeded by seed.ts, and saves each scene in scenes.ts twice: a PNG at
// twice the window's size, and a WebP 1600 pixels wide for web pages.

import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';
import sharp from 'sharp';
import { createServer } from 'vite';
import { SCENES, type SceneTools } from './scenes';
import { seed } from './seed';
import { installTauriMock, nativeCommands, type Sent } from './tauri';

/** The Sunday morning the pictures are taken: mid-service, so the app opens live. */
const DATE = '2026-11-15';
const NOW = '2026-11-15T10:24:00Z';
const TIMEZONE = 'Europe/London';
/** Must match OUTPUT_WINDOW and FRAME_EVENT in apps/desktop/src/app/output.ts. */
const OUTPUT_WINDOW = 'output';
const FRAME_EVENT = 'output-frame';
/** The WebP's width in pixels. */
const WEB_WIDTH = 1600;

const root = resolve(import.meta.dirname, '../../desktop');
// pnpm runs this in its package's folder; INIT_CWD is where the command was typed.
const out = process.argv[2]
  ? resolve(process.env.INIT_CWD ?? process.cwd(), process.argv[2])
  : resolve(import.meta.dirname, '../out');
const only = process.argv[3];

const server = await createServer({
  root,
  configFile: resolve(root, 'vite.config.ts'),
  // The default loader resolves the config's imports through tsx's hooks, which fails.
  configLoader: 'runner',
  server: { port: 0, strictPort: false, hmr: false },
  logLevel: 'warn',
});
await server.listen();
const base = server.resolvedUrls!.local[0]!;

let failed = false;

/** Opens the app as the Tauri window `label`, and waits for it to load. */
async function openWindow(
  context: BrowserContext,
  label: string,
  viewport: { width: number; height: number },
): Promise<Page> {
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  await page.clock.setFixedTime(new Date(NOW));
  // As source text: tsx names functions with a `__name` helper the page does not have.
  await page.addInitScript({
    content: `var __name = (f) => f; (${installTauriMock.toString()})(${JSON.stringify(label)});`,
  });
  page.on('pageerror', (error) => {
    failed = true;
    console.error(`  ${label}: ${error.message}`);
  });
  await page.goto(base);
  return page;
}

const browser = await chromium.launch();
await mkdir(out, { recursive: true });
try {
  for (const scene of SCENES) {
    if (only && scene.name !== only) continue;
    console.log(scene.name);
    const driver = await seed(DATE, NOW, TIMEZONE);
    const sent: Sent = new Map();
    const viewport = scene.viewport ?? { width: 1440, height: 900 };
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 2,
      timezoneId: TIMEZONE,
      locale: 'en-GB',
      colorScheme: 'dark',
    });
    await context.exposeFunction(
      '__wqInvoke',
      nativeCommands(driver, sent, (cmd) => console.log(`  native: ${cmd}`)),
    );
    const page = await openWindow(context, 'main', viewport);
    const tools: SceneTools = {
      async slideshow(size = { width: 1920, height: 1080 }) {
        const output = await openWindow(context, OUTPUT_WINDOW, size);
        // Give the slideshow window the frame the main window last sent it.
        await output.waitForTimeout(300);
        await output.evaluate(
          ([event, payload]) =>
            (window.__TAURI_INTERNALS__.invoke as (cmd: string, args: unknown) => unknown)(
              'plugin:event|emit',
              { event, payload },
            ),
          [FRAME_EVENT, sent.get(FRAME_EVENT)] as const,
        );
        return output;
      },
    };
    const shot = (await scene.setup(page, tools)) ?? page;
    // Let fonts, images and transitions settle.
    await shot.evaluate(() => document.fonts.ready);
    await shot.waitForTimeout(800);
    const png = await shot.screenshot({ path: resolve(out, `${scene.name}.png`) });
    await sharp(png)
      .resize({ width: WEB_WIDTH, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(resolve(out, `${scene.name}.webp`));
    await context.close();
    driver.close();
  }
} finally {
  await browser.close();
  await server.close();
}
if (failed) process.exitCode = 1;
