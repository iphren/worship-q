import { EMPTY_SYNC_STATE, type SyncState } from '@worship-q/store';
import { describe, expect, it } from 'vitest';
import { keychainAccount, protectToken, type CredentialStore, type Keychain } from './credentials';

function fakeStore(initial: Partial<SyncState>) {
  let state: SyncState = { ...EMPTY_SYNC_STATE, ...initial };
  let memory: string | null = null;
  const store: CredentialStore = {
    getState: async () => state,
    setState: async (patch) => {
      state = { ...state, ...patch };
    },
    setMemoryToken: (token) => (memory = token),
  };
  return { store, state: () => state, memory: () => memory };
}

function fakeKeychain(options: { refuse?: boolean; lossy?: boolean } = {}): Keychain & {
  entries: Map<string, string>;
} {
  const entries = new Map<string, string>();
  return {
    entries,
    set: async (account, secret) => {
      if (options.refuse) throw new Error('keychain locked');
      if (!options.lossy) entries.set(account, secret);
    },
    get: async (account) => entries.get(account) ?? null,
    delete: async (account) => void entries.delete(account),
  };
}

describe('device token in the keychain (D23)', () => {
  it('moves the token out of the database only after reading it back', async () => {
    const { store, state, memory } = fakeStore({ deviceToken: 'secret-1', joinedAt: 'x' });
    const keychain = fakeKeychain();
    expect(await protectToken(store, keychain, keychainAccount('ws-a'))).toBe('keychain');
    expect(state().deviceToken).toBeNull();
    expect(state().tokenStorage).toBe('keychain');
    expect(keychain.entries.get('ws-a:device-token')).toBe('secret-1');
    expect(memory()).toBe('secret-1');
    // The next launch reads it from the keychain alone.
    const again = fakeStore({ ...state() });
    expect(await protectToken(again.store, keychain, keychainAccount('ws-a'))).toBe('keychain');
    expect(again.memory()).toBe('secret-1');
  });

  it('keeps the database copy when the keychain refuses, and says so', async () => {
    const { store, state, memory } = fakeStore({ deviceToken: 'secret-2' });
    expect(await protectToken(store, fakeKeychain({ refuse: true }), 'ws:device-token')).toBe(
      'database',
    );
    expect(state().deviceToken).toBe('secret-2');
    expect(state().tokenStorage).toBe('database');
    expect(memory()).toBe('secret-2');
  });

  it('keeps the database copy when the keychain does not give the token back', async () => {
    const { store, state } = fakeStore({ deviceToken: 'secret-3' });
    expect(await protectToken(store, fakeKeychain({ lossy: true }), 'ws:device-token')).toBe(
      'database',
    );
    expect(state().deviceToken).toBe('secret-3');
  });

  it('does nothing for a computer that is not enrolled', async () => {
    const { store, state } = fakeStore({});
    expect(await protectToken(store, fakeKeychain(), 'ws:device-token')).toBeNull();
    expect(state().tokenStorage).toBeNull();
  });
});
