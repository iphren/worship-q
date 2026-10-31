/** Starts the church instance. Configured through environment variables; see the README. */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildServer } from './app';
import { openDatabase } from './db';
import { convertDeck, deckTools, deckToolsAvailable } from './decks/convert';
import { Instance } from './instance';

const dataDir = process.env.WORSHIP_Q_DATA ?? '/data';
mkdirSync(dataDir, { recursive: true });

const instance = new Instance(openDatabase(join(dataDir, 'instance.db')));
const tools = deckTools();
const decks = await deckToolsAvailable(tools);
if (!decks) console.warn('LibreOffice or Ghostscript not found: slide decks cannot be imported.');
const { app } = await buildServer({
  instance,
  dataDir,
  convertDeck: decks
    ? (source, outDir, workDir) =>
        convertDeck(source, outDir, {
          ...tools,
          workDir,
          profileDir: join(dataDir, 'libreoffice'),
        })
    : undefined,
  remoteDir: process.env.WORSHIP_Q_REMOTE_DIR ?? new URL('../remote', import.meta.url).pathname,
  outputDir: process.env.WORSHIP_Q_OUTPUT_DIR ?? new URL('../output', import.meta.url).pathname,
  name: process.env.WORSHIP_Q_NAME ?? 'Worship Q',
  logger: true,
});

const port = Number(process.env.PORT ?? 8080);
await app.listen({ port, host: process.env.HOST ?? '0.0.0.0' });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => {
      instance.db.close();
      process.exit(0);
    });
  });
}
