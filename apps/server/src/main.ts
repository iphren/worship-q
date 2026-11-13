/** Starts the church instance. Configured through environment variables; see the README. */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildServer } from './app';
import { Bible, bibleKeysFromEnv } from './bible';
import { openDatabase } from './db';
import { convertDeck, deckTools, deckToolsAvailable } from './decks/convert';
import { Instance } from './instance';
import { iceConfigFromEnv } from './ice';
import { mediaLimitsFromEnv } from './media';
import { OidcClient, oidcConfigFromEnv } from './oidc';
import { retentionDaysFromEnv, sweepDeletedFiles } from './retention';

const dataDir = process.env.WORSHIP_Q_DATA ?? '/data';
mkdirSync(dataDir, { recursive: true });

const instance = new Instance(openDatabase(join(dataDir, 'instance.db')));
const tools = deckTools();
const decks = await deckToolsAvailable(tools);
if (!decks) console.warn('LibreOffice or Ghostscript not found: slide decks cannot be imported.');
const oidcConfig = oidcConfigFromEnv(process.env);
if (!oidcConfig) {
  console.warn(
    'Administrator sign-in is not configured (WORSHIP_Q_OIDC_ISSUER, WORSHIP_Q_OIDC_CLIENT_ID, WORSHIP_Q_PUBLIC_URL): the admin app is unavailable.',
  );
}
const retentionDays = retentionDaysFromEnv(process.env);
// The church's Bible keys stay on this server (B17); only whether each is set is logged.
const bibleKeys = bibleKeysFromEnv(process.env);
const bible = new Bible({ dataDir, keys: bibleKeys });
console.log(
  `Bible keys set: YouVersion ${!!bibleKeys.youversion}, API.Bible ${!!bibleKeys.apibible}, ESV ${!!bibleKeys.esv}`,
);
bible.start((message) => console.log(message));
// Live audio's ICE servers (A10). A bad setting stops the server here, naming it; the relay's
// secret is never logged, only whether a relay is offered.
const ice = iceConfigFromEnv(process.env);
console.log(
  `Live audio: STUN ${ice.stun.length ? ice.stun.join(', ') : 'none'}, relay ${ice.turn ? 'on' : 'off'}`,
);
const { app } = await buildServer({
  instance,
  dataDir,
  oidc: oidcConfig ? new OidcClient(oidcConfig) : null,
  publicUrl: process.env.WORSHIP_Q_PUBLIC_URL?.replace(/\/+$/, ''),
  administrators: (process.env.WORSHIP_Q_ADMINS ?? '').split(',').filter((e) => e.trim()),
  retentionDays,
  mediaLimits: mediaLimitsFromEnv(process.env),
  bible,
  ice,
  adminDir: process.env.WORSHIP_Q_ADMIN_DIR ?? new URL('../admin', import.meta.url).pathname,
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
// The first sweep runs soon after start; later ones daily (D34).
setTimeout(() => {
  try {
    const swept = sweepDeletedFiles(instance, dataDir, retentionDays);
    if (swept.files > 0) console.log(`Retention sweep removed ${swept.files} files`);
  } catch (error) {
    console.error(error);
  }
}, 60_000).unref();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => {
      instance.db.close();
      process.exit(0);
    });
  });
}
