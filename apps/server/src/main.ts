/** Starts the church instance. Configured through environment variables; see the README. */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildServer } from './app';
import { Bible, bibleKeysFromEnv } from './bible';
import { openDatabase } from './db';
import { convertDeck, deckTools, deckToolsAvailable } from './decks/convert';
import { Instance } from './instance';
import { iceConfigFromEnv } from './ice';
import { askRelay, RelayHealth, relayTarget } from './relayHealth';
import { mediaLimitsFromEnv } from './media';
import { OidcClient, oidcConfigFromEnv } from './oidc';
import { retentionDaysFromEnv, sweepDeletedFiles } from './retention';
import { recordingDaysFromEnv } from './recordings';
import { backfillStoredUploads } from './storedUploads';
import { buildLocalServer, localPortFromEnv } from './local';
import { checkDataKind, PUBLIC_MEDIA_LIMITS, publicConfigFromEnv } from './public';

const dataDir = process.env.WORSHIP_Q_DATA ?? '/data';
mkdirSync(dataDir, { recursive: true });

// Public mode (public server plan): a bad setting stops the server here, naming it.
const publicMode = publicConfigFromEnv(process.env);
const instance = new Instance(openDatabase(join(dataDir, 'instance.db')));
// One kind of server per data folder (S11): never a church's content on a public server.
checkDataKind(instance, !!publicMode);
if (publicMode) {
  console.log(
    `Public mode: ${publicMode.limits.phones} phones and ${publicMode.limits.listeners} listeners per workspace, ${publicMode.limits.mediaPerDay} decks and images a day per copy of the app`,
  );
}
const tools = deckTools();
const decks = await deckToolsAvailable(tools);
if (!decks) console.warn('LibreOffice or Ghostscript not found: slide decks cannot be imported.');
// A public server has no administrators: nobody signs in to it.
const oidcConfig = publicMode ? null : oidcConfigFromEnv(process.env);
if (!oidcConfig && !publicMode) {
  console.warn(
    'Administrator sign-in is not configured (WORSHIP_Q_OIDC_ISSUER, WORSHIP_Q_OIDC_CLIENT_ID, WORSHIP_Q_PUBLIC_URL): the admin app is unavailable.',
  );
}
const retentionDays = retentionDaysFromEnv(process.env);
const recordingDays = recordingDaysFromEnv(process.env);
// The local API reads a church's run sheets and records; a public server has none.
const localPort = publicMode ? null : localPortFromEnv(process.env);
// The church's Bible keys stay on this server (B17); only whether each is set is logged.
// A public server ignores keys (S6): a church's key may not be shared with every user.
const bibleKeys = publicMode ? {} : bibleKeysFromEnv(process.env);
if (publicMode && Object.values(bibleKeysFromEnv(process.env)).some(Boolean)) {
  console.warn('Public mode ignores the Bible keys set: only versions needing no key are offered.');
}
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
// Whether the relay really answers: being set up does not mean coturn is running.
const relayAt = relayTarget(ice, process.env.WORSHIP_Q_TURN_LISTEN_IP);
const relayHealth = relayAt ? new RelayHealth(() => askRelay(relayAt)) : null;
await relayHealth?.start();
const { app, recordings, presentationLog } = await buildServer({
  instance,
  dataDir,
  oidc: oidcConfig ? new OidcClient(oidcConfig) : null,
  publicUrl: process.env.WORSHIP_Q_PUBLIC_URL?.replace(/\/+$/, ''),
  administrators: (process.env.WORSHIP_Q_ADMINS ?? '').split(',').filter((e) => e.trim()),
  retentionDays,
  recordingDays,
  // A public server's limits are its own unless set (videos are never taken there).
  mediaLimits: publicMode
    ? publicMediaLimits(mediaLimitsFromEnv(process.env))
    : mediaLimitsFromEnv(process.env),
  public: publicMode,
  bible,
  ice,
  relayHealth,
  adminDir: publicMode
    ? undefined
    : (process.env.WORSHIP_Q_ADMIN_DIR ?? new URL('../admin', import.meta.url).pathname),
  convertDeck: decks
    ? (source, outDir, workDir) =>
        convertDeck(source, outDir, {
          ...tools,
          workDir,
          profileDir: join(dataDir, 'libreoffice'),
        })
    : undefined,
  remoteDir: process.env.WORSHIP_Q_REMOTE_DIR ?? new URL('../remote', import.meta.url).pathname,
  outputDir: publicMode
    ? undefined
    : (process.env.WORSHIP_Q_OUTPUT_DIR ?? new URL('../output', import.meta.url).pathname),
  name: process.env.WORSHIP_Q_NAME ?? 'Worship Q',
  logger: true,
});

// A chunk half-written when the server last stopped is cut off; the desktop sends it again.
const repaired = recordings.repair();
if (repaired > 0) console.log(`Recordings: cut back ${repaired} files to their last whole chunk`);
console.log(
  publicMode
    ? 'Live audio recordings: never on a public server'
    : `Live audio recordings: ${recordings.enabled() ? 'on' : 'off'}, kept ${
        recordingDays === 0 ? 'for ever' : `${recordingDays} days`
      }`,
);

const port = Number(process.env.PORT ?? 8080);
await app.listen({ port, host: process.env.HOST ?? '0.0.0.0' });
// The local API (R20) listens on a port of its own, which must never be proxied: Compose
// publishes it on 127.0.0.1 only. An empty WORSHIP_Q_LOCAL_PORT turns it off.
const local =
  localPort === null
    ? null
    : await buildLocalServer({
        instance,
        dataDir,
        recordings,
        presentationLog,
        name: process.env.WORSHIP_Q_NAME ?? 'Worship Q',
        logger: true,
      });
if (local) {
  await local.listen({ port: localPort!, host: process.env.HOST ?? '0.0.0.0' });
  console.log(`Local API on port ${localPort}; it has no key and must not be proxied.`);
} else {
  console.log('Local API off (WORSHIP_Q_LOCAL_PORT is empty).');
}
// Files kept before uploads were remembered are hashed once, in the background, so the
// same file uploaded again is found (U28). A public server remembers no upload.
void (publicMode ? Promise.resolve(0) : backfillStoredUploads(instance, dataDir)).then(
  (remembered) => {
    if (remembered) console.log(`Uploads stored once: remembered ${remembered} files already kept`);
  },
  (error: unknown) => console.error(error),
);
// The first sweep runs soon after start; later ones daily (D34). A public server runs its
// own sweep, hourly, from `buildServer`.
setTimeout(() => {
  if (publicMode) return;
  try {
    const swept = sweepDeletedFiles(instance, dataDir, retentionDays);
    if (swept.files > 0) console.log(`Retention sweep removed ${swept.files} files`);
    const removed = recordings.sweep(recordingDays);
    if (removed > 0) console.log(`Retention sweep removed ${removed} recordings`);
    presentationLog.closeExpired();
  } catch (error) {
    console.error(error);
  }
}, 60_000).unref();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void Promise.all([app.close(), local?.close()]).then(() => {
      instance.db.close();
      process.exit(0);
    });
  });
}

/** The public server's own limits, unless a setting asks otherwise; never videos. */
function publicMediaLimits(fromEnv: ReturnType<typeof mediaLimitsFromEnv>) {
  const set = (name: string) => !!process.env[name];
  return {
    image: set('WORSHIP_Q_MAX_IMAGE_MB') ? fromEnv.image : PUBLIC_MEDIA_LIMITS.image,
    deck: set('WORSHIP_Q_MAX_DECK_MB') ? fromEnv.deck : PUBLIC_MEDIA_LIMITS.deck,
    video: 0,
  };
}
