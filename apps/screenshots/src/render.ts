// Renders screenshots of the desktop app from its code, with public-domain content.
//   pnpm screenshots [out-dir] [scene]
//   SCREENSHOT_LANG=zh-Hans pnpm screenshots [out-dir]   (in another language)
// Starts the desktop app's Vite server, opens it in headless Chromium with Tauri replaced by
// tauri.ts and a database seeded by seed.ts, and saves each scene in scenes.ts twice: a PNG at
// twice the window's size, and a WebP 1600 pixels wide for web pages.

import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';
import sharp from 'sharp';
import { createServer } from 'vite';
import { messages, type MessageKey } from '@worship-q/i18n/desktop';
import { contentFor } from './content-zh';
import { SCENES, type SceneTools } from './scenes';
import { seed } from './seed';
import { FILES_ORIGIN, installTauriMock, nativeCommands, type Sent } from './tauri';

/** The next Sunday from `from`, as an ISO day: `from` itself when it is a Sunday. */
function nextSunday(from: Date): string {
  const day = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  day.setUTCDate(day.getUTCDate() + ((7 - day.getUTCDay()) % 7));
  return day.toISOString().slice(0, 10);
}

/**
 * The Sunday morning the pictures are taken: the next Sunday from when they are rendered,
 * mid-service, so the app opens live on it. 10:24 UTC is mid-morning in London all year.
 */
const DATE = nextSunday(new Date());
const NOW = `${DATE}T10:24:00Z`;
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
/**
 * The interface language, such as `zh-Hans`; English if
 * unset. The content follows it: Chinese songs and Bible for Chinese.
 */
const language = process.env.SCREENSHOT_LANG;
const content = contentFor(language);
/** The app's words in that language, for the scenes to find buttons by. */
const catalogue: Record<string, string> =
  (Object.entries(messages).find(
    ([code]) => code.toLowerCase() === language?.toLowerCase(),
  )?.[1] as Record<string, string> | undefined) ?? messages.en;
const t = (key: MessageKey) => catalogue[key] ?? messages.en[key];
/** The browser's own language, which dates and the like follow. */
const browserLocale = language?.toLowerCase().startsWith('zh')
  ? language.toLowerCase() === 'zh-hant'
    ? 'zh-TW'
    : 'zh-CN'
  : 'en-GB';

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
  await page.goto(language ? `${base}?lang=${encodeURIComponent(language)}` : base);
  return page;
}

const browser = await chromium.launch();
await mkdir(out, { recursive: true });
try {
  for (const scene of SCENES) {
    if (only && scene.name !== only) continue;
    console.log(scene.name);
    const seeded = await seed(content, DATE, NOW, TIMEZONE);
    const sent: Sent = new Map();
    const viewport = scene.viewport ?? { width: 1440, height: 900 };
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 2,
      timezoneId: TIMEZONE,
      locale: browserLocale,
      colorScheme: 'dark',
    });
    await context.exposeFunction(
      '__wqInvoke',
      nativeCommands(seeded, sent, (cmd) => console.log(`  native: ${cmd}`)),
    );
    // The stored files the page asks for, such as a deck's slide images.
    await context.route(`${FILES_ORIGIN}/**`, (route) => {
      const name = decodeURIComponent(new URL(route.request().url()).pathname.slice(1));
      const file = seeded.files.get(name);
      return file
        ? route.fulfill({ body: file, contentType: 'image/jpeg' })
        : route.fulfill({ status: 404 });
    });
    const page = await openWindow(context, 'main', viewport);
    const tools: SceneTools = {
      content,
      t,
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
    seeded.driver.close();
  }
} finally {
  await browser.close();
  await server.close();
}
if (failed) process.exitCode = 1;
