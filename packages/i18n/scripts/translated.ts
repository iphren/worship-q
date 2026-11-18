/**
 * Records every English message as it is now, as translated (translation plan §6 question 1).
 * Run it once the Chinese catalogues are up to date with the English:
 *
 *   pnpm --filter @worship-q/i18n translated
 *
 * The test in src/index.test.ts then fails for any English message changed or added after
 * this, until it is translated and this is run again.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as admin from '../src/admin';
import * as desktop from '../src/desktop';
import * as output from '../src/output';
import * as remote from '../src/remote';

const record = Object.fromEntries(
  Object.entries({ desktop, remote, admin, output }).map(([app, { messages }]) => [
    app,
    Object.fromEntries(Object.entries(messages.en).sort(([a], [b]) => a.localeCompare(b))),
  ]),
);
writeFileSync(
  resolve(import.meta.dirname, '../src/translated.json'),
  `${JSON.stringify(record, null, 2)}\n`,
);
console.log('Recorded the English of every catalogue as translated.');
