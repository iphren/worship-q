/**
 * Where the church device token is kept (decision D23, plan M8.4): in the system keychain,
 * moved there from the database on first launch, and removed from the database only once
 * the keychain copy has been read back. If the keychain refuses, the token stays in the
 * database, the app keeps working, and Settings says it is not yet protected. Enrollment is
 * never reset by this move.
 *
 * Reading it back later can be refused too: macOS asks whether this build of the app may
 * read the entry, and the answer may be no. That is not a lost token, and is never treated
 * as one: the entry stays, nothing is changed, and Settings offers to ask again.
 */
import type { SyncState } from '@worship-q/store';

export interface Keychain {
  set(account: string, secret: string): Promise<void>;
  get(account: string): Promise<string | null>;
  delete(account: string): Promise<void>;
}

export interface CredentialStore {
  getState(): Promise<SyncState>;
  setState(patch: Partial<SyncState>): Promise<unknown>;
  /** Makes the token available to the rest of the app without it being in the database. */
  setMemoryToken(token: string | null): void;
}

/** One keychain entry per workspace folder on this computer. */
export function keychainAccount(workspaceFolder: string): string {
  return `${workspaceFolder}:device-token`;
}

/**
 * Where the token is after loading it: in the keychain or the database; `refused` when the
 * keychain would not give it back this time; `missing` when its entry is gone; null when
 * this computer is not enrolled.
 */
export type TokenLoad = NonNullable<SyncState['tokenStorage']> | 'refused' | 'missing' | null;

/** Loads the token for this run and moves it into the keychain when it is not there yet. */
export async function protectToken(
  store: CredentialStore,
  keychain: Keychain,
  account: string,
): Promise<TokenLoad> {
  const state = await store.getState();
  if (state.tokenStorage === 'keychain' && !state.deviceToken) {
    let token: string | null;
    try {
      token = await keychain.get(account);
    } catch {
      // Denied or locked this time; the entry is still there and is left alone.
      return 'refused';
    }
    if (token) {
      store.setMemoryToken(token);
      return 'keychain';
    }
    // The entry is gone: this computer must enroll again, as the plan's "never reset" rule
    // cannot be kept without the secret.
    return 'missing';
  }
  const token = state.deviceToken;
  if (!token) return null;
  store.setMemoryToken(token);
  try {
    await keychain.set(account, token);
    const back = await keychain.get(account);
    if (back !== token) throw new Error('read-back mismatch');
  } catch {
    await store.setState({ tokenStorage: 'database' });
    return 'database';
  }
  // Only now, with the keychain copy read back, does the database copy go.
  await store.setState({ deviceToken: null, tokenStorage: 'keychain' });
  return 'keychain';
}

/** Forgets the keychain copy, when the computer leaves the church workspace. */
export async function forgetToken(keychain: Keychain, account: string): Promise<void> {
  await keychain.delete(account).catch(() => undefined);
}
