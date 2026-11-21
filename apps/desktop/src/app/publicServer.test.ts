import type { ServerInfo } from '@worship-q/protocol';
import { describe, expect, it } from 'vitest';
import {
  adoptsInfo,
  beginChurchJoin,
  installId,
  isPublicServer,
  PUBLIC_SERVER_URL,
  publicAtLaunch,
  serviceOf,
  syncTarget,
} from './publicServer';

const state = (fields: Partial<Parameters<typeof serviceOf>[0]>) => ({
  server: 'https://s',
  deviceToken: 't',
  joinedAt: null,
  publicServer: false,
  ...fields,
});

describe('who answers a workspace’s server features (M3.3)', () => {
  it('is the church once joined', () => {
    expect(serviceOf(state({ joinedAt: '2026-11-18T00:00:00Z' }))).toEqual({
      kind: 'church',
      server: 'https://s',
      token: 't',
    });
  });

  it('is the public server when joined there, never synchronized', () => {
    expect(serviceOf(state({ publicServer: true }))).toMatchObject({ kind: 'public' });
  });

  it('is the church when both are set, as joining a church replaces the public server', () => {
    expect(serviceOf(state({ publicServer: true, joinedAt: '2026-11-18T00:00:00Z' }))?.kind).toBe(
      'church',
    );
  });

  it('is nobody without a token, or enrolled but not joined', () => {
    expect(serviceOf(state({ deviceToken: null, publicServer: true }))).toBeNull();
    expect(serviceOf(state({}))).toBeNull();
  });
});

describe('this copy of the app’s identifier (S2)', () => {
  const memory = () => {
    const kept = new Map<string, string>();
    return {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
    };
  };

  it('is made once and kept, shared by every workspace', () => {
    const storage = memory();
    const first = installId(storage, () => 'aaaaaaaa-0000-4000-8000-000000000000');
    expect(installId(storage, () => 'other-id-000')).toBe(first);
  });

  it('is made afresh when storage cannot keep it, or kept something unusable', () => {
    expect(installId(null, () => 'bbbbbbbb-1')).toBe('bbbbbbbb-1');
    const storage = memory();
    storage.setItem('worship-q.install', '<script>');
    expect(installId(storage, () => 'cccccccc-2')).toBe('cccccccc-2');
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => undefined,
    };
    expect(installId(throwing, () => 'dddddddd-3')).toBe('dddddddd-3');
  });
});

describe('the public server', () => {
  it('is at public.worship-q.com unless set otherwise (S1)', () => {
    expect(PUBLIC_SERVER_URL).toBe('https://public.worship-q.com');
  });

  it('is told apart by its info, so it is never joined as a church (S5)', () => {
    const info = { name: '', protocolVersion: 9, minProtocolVersion: 2 } as ServerInfo;
    expect(isPublicServer({ ...info, public: true })).toBe(true);
    expect(isPublicServer(info)).toBe(false);
    expect(isPublicServer(null)).toBe(false);
  });
});

describe('a public connection at launch (M3.6, S10)', () => {
  const onPublic = state({ server: 'https://public', deviceToken: 'p', publicServer: true });

  it('connects its relay, so its phones come back', () => {
    expect(publicAtLaunch(onPublic, false)).toBe('connect');
  });

  it('is kept, unused, in viewer mode, so leaving viewer mode keeps the phones’ link', () => {
    expect(publicAtLaunch(onPublic, true)).toBe('none');
  });

  it('is forgotten when its token is gone, to be joined again when needed', () => {
    expect(publicAtLaunch({ ...onPublic, deviceToken: null }, false)).toBe('forget');
    expect(publicAtLaunch({ ...onPublic, deviceToken: null }, true)).toBe('forget');
  });

  it('does nothing for a workspace that never used the public server', () => {
    expect(publicAtLaunch(state({ server: null, deviceToken: null }), false)).toBe('none');
  });
});

describe('joining a church from a public connection (M3.11)', () => {
  const onPublic = state({ server: 'https://public', deviceToken: 'p', publicServer: true });

  it('leaves the public connection and its phones as they are until the church enrols', () => {
    // A refused, expired or abandoned join leaves the same public workspace in use.
    expect(serviceOf(beginChurchJoin(onPublic, 'https://church'))).toEqual({
      kind: 'public',
      server: 'https://public',
      token: 'p',
    });
  });

  it('asks the church with no token, never the public server’s', () => {
    expect(syncTarget(onPublic, 'https://church')).toEqual({
      server: 'https://church',
      token: null,
    });
  });

  it('goes to the workspace’s own connection when no join is under way', () => {
    expect(syncTarget(onPublic, null)).toEqual({ server: 'https://public', token: 'p' });
  });

  it('aims a workspace without a server at the church, as before', () => {
    const local = state({ server: null, deviceToken: null });
    const begun = beginChurchJoin(local, 'https://church');
    expect(begun).toEqual({ ...local, server: 'https://church' });
    expect(syncTarget(begun, 'https://church')).toEqual({
      server: 'https://church',
      token: null,
    });
  });
});

describe('asking a server about itself while joining a church (M3.10)', () => {
  const church = { decks: true } as ServerInfo;

  it('keeps the public server’s info, and its limits, while on a public connection', () => {
    const service = { kind: 'public', server: 'https://public', token: 'p' } as const;
    expect(adoptsInfo(service, church)).toBe(false);
  });

  it('takes the church’s info for a workspace without a server, as before', () => {
    expect(adoptsInfo(null, church)).toBe(true);
  });

  it('never takes the public server’s info that way', () => {
    expect(adoptsInfo(null, { public: true } as ServerInfo)).toBe(false);
  });
});
