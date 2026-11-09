import type { ServerInfo } from '@worship-q/protocol';
import { describe, expect, it } from 'vitest';
import { INFO_EVERY_TICKS, infoDue } from './serverInfo';

const info = (bible?: boolean): ServerInfo => ({
  name: 'Church',
  protocolVersion: 6,
  minProtocolVersion: 2,
  decks: true,
  outputs: true,
  ...(bible === undefined ? {} : { bible }),
});

describe('asking the server’s info again', () => {
  it('asks every minute while the server could not be asked, or offered no Bible', () => {
    for (const tick of [1, 2, 3]) {
      expect(infoDue(null, tick)).toBe(true);
      expect(infoDue(info(false), tick)).toBe(true);
      // A server from before the Bible may have been updated since.
      expect(infoDue(info(), tick)).toBe(true);
    }
  });

  it('asks every ten minutes once it offers everything', () => {
    const due = Array.from({ length: 20 }, (_, i) => infoDue(info(true), i + 1));
    expect(due.filter(Boolean)).toHaveLength(2);
    expect(infoDue(info(true), INFO_EVERY_TICKS)).toBe(true);
  });
});
