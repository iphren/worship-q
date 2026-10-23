/** Starts the church instance. Configured through environment variables; see the README. */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildServer } from './app';
import { openDatabase } from './db';
import { Instance } from './instance';

const dataDir = process.env.WORSHIP_Q_DATA ?? '/data';
mkdirSync(dataDir, { recursive: true });

const instance = new Instance(openDatabase(join(dataDir, 'instance.db')));
const { app } = await buildServer({
  instance,
  dataDir,
  remoteDir: process.env.WORSHIP_Q_REMOTE_DIR ?? new URL('../remote', import.meta.url).pathname,
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
