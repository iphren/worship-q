import type { ServerInfo } from '@worship-q/protocol';
import { describe, expect, it } from 'vitest';
import { installId, isPublicServer, PUBLIC_SERVER_URL, serviceOf } from './publicServer';

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
