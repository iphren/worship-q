import { describe, expect, it } from 'vitest';
import { canPair, joinMethod } from './joinMethod';

const info = {
  name: 'Church',
  protocolVersion: 3,
  minProtocolVersion: 2,
  decks: false,
  outputs: false,
};

describe('how a new computer joins (D29, D30)', () => {
  it('pairs when the instance has sign-in and an administrator', () => {
    expect(joinMethod({ ...info, pairing: true, admin: true, codes: false })).toBe('pairing');
  });

  it('uses a code while the instance has no administrator yet, even with sign-in configured', () => {
    expect(joinMethod({ ...info, pairing: true, admin: true, codes: true })).toBe('code');
  });

  it('uses a code when sign-in is not configured: nobody could approve', () => {
    expect(joinMethod({ ...info, pairing: true, admin: false, codes: false })).toBe('code');
    expect(canPair({ ...info, pairing: true, admin: false })).toBe(false);
  });

  it('uses a code with a version 2 instance, which says nothing about pairing', () => {
    expect(joinMethod({ ...info, protocolVersion: 2 })).toBe('code');
    expect(joinMethod(null)).toBe('code');
    expect(canPair(null)).toBe(false);
  });

  it('lets the operator ask for approval instead of a code whenever someone could approve', () => {
    expect(canPair({ ...info, pairing: true, admin: true, codes: true })).toBe(true);
  });
});
