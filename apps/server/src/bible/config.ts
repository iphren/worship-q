/**
 * The church's provider keys (B17), read from the environment at start. They stay on the
 * server: never logged, never sent to a device or the admin app, which sees only which are set.
 */
import type { Provider } from '@worship-q/bible';
import { ApiBible } from './providers/apibible';
import { Esv } from './providers/esv';
import { FreeUse } from './providers/freeuse';
import type { Fetch, ProviderAdapter } from './providers/types';
import { YouVersion } from './providers/youversion';

export interface BibleKeys {
  youversion?: string;
  apibible?: string;
  esv?: string;
}

export function bibleKeysFromEnv(env: Record<string, string | undefined>): BibleKeys {
  const key = (name: string) => env[name]?.trim() || undefined;
  return {
    youversion: key('WORSHIP_Q_YOUVERSION_KEY'),
    apibible: key('WORSHIP_Q_API_BIBLE_KEY'),
    esv: key('WORSHIP_Q_ESV_KEY'),
  };
}

/** Which keys are set, and nothing more, for the admin app and the start-up log. */
export function keysSet(keys: BibleKeys): Record<'youversion' | 'apibible' | 'esv', boolean> {
  return { youversion: !!keys.youversion, apibible: !!keys.apibible, esv: !!keys.esv };
}

export type Adapters = Record<Provider, ProviderAdapter>;

export function makeAdapters(keys: BibleKeys, fetch: Fetch = globalThis.fetch): Adapters {
  return {
    youversion: new YouVersion(keys.youversion, fetch),
    apibible: new ApiBible(keys.apibible, fetch),
    esv: new Esv(keys.esv, fetch),
    freeuse: new FreeUse(fetch),
  };
}
