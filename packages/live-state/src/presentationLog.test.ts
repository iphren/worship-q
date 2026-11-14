/** Log events from snapshots (service records M4.1; rules §5.3). */
import type { LiveSnapshot, SnapshotPiece } from '@worship-q/protocol';
import { describe, expect, it } from 'vitest';
import { createLiveState } from './index';
import { logEvents, showingOf, type RevisedShowing } from './presentationLog';

const NOW = '2026-11-15T10:00:00.000Z';

const lyrics: SnapshotPiece[] = [
  { id: 'l1', lines: ['Amazing grace', 'How sweet the sound'], block: 0 },
  { id: 'l3', lines: ['That saved a wretch', 'Like me'], block: 1 },
  { id: 'l5', lines: ['I once was lost'], block: 1 },
];

function snapshot(
  presented: { itemId: string; pieceId: string; songId?: string; runSheetId?: string } | null,
  options: {
    blank?: boolean;
    status?: 'live' | 'ended';
    kind?: 'lyrics' | 'deck' | 'passage' | 'video' | 'website';
    pieces?: SnapshotPiece[];
    previous?: boolean;
    devices?: LiveSnapshot['devices'];
    background?: { color: string; assetId: string | null } | null;
    video?: LiveSnapshot['state']['video'];
  } = {},
): LiveSnapshot {
  const state = createLiveState('rs1', NOW);
  const songId = presented?.songId ?? 's1';
  return {
    revision: 1,
    coordinatorId: 'desk',
    state: {
      ...state,
      status: options.status ?? 'live',
      blank: options.blank ?? false,
      video: options.video ?? null,
      presented: presented
        ? {
            runSheetId: presented.runSheetId ?? 'rs1',
            itemId: presented.itemId,
            songId,
            pieceId: presented.pieceId,
            index: 0,
          }
        : null,
    },
    date: '2026-11-15',
    items: [],
    presented: presented
      ? {
          itemId: presented.itemId,
          pieceId: presented.pieceId,
          songId,
          title: 'Amazing Grace',
          kind: options.kind ?? 'lyrics',
          pieces: options.pieces ?? lyrics,
          background: options.background ?? null,
          websiteUrl: null,
          previous: options.previous ?? false,
        }
      : null,
    devices: options.devices ?? [],
  };
}

const revised = (snap: LiveSnapshot, revision = 1): RevisedShowing | null => {
  const showing = showingOf(snap);
  return showing ? { ...showing, revision } : null;
};

const events = (a: LiveSnapshot, b: LiveSnapshot, ra = 1, rb = 1) =>
  logEvents(revised(a, ra), revised(b, rb));

describe('log events from snapshots (§5.3)', () => {
  it('opens one entry when a piece is presented from nothing', () => {
    const result = events(snapshot(null), snapshot({ itemId: 'i1', pieceId: 'l1' }));
    expect(result.close).toBe(false);
    expect(result.open).toMatchObject({ itemId: 'i1', songId: 's1', runSheetId: 'rs1' });
  });

  it('closes one and opens one when a piece replaces another', () => {
    const result = events(
      snapshot({ itemId: 'i1', pieceId: 'l1' }),
      snapshot({ itemId: 'i1', pieceId: 'l3' }),
    );
    expect(result.close).toBe(true);
    expect(result.open?.pieceId).toBe('l3');
  });

  it('closes on clear, blank, end and expiry, and opens nothing', () => {
    const on = snapshot({ itemId: 'i1', pieceId: 'l1' });
    for (const off of [
      snapshot(null),
      snapshot({ itemId: 'i1', pieceId: 'l1' }, { blank: true }),
      snapshot({ itemId: 'i1', pieceId: 'l1' }, { status: 'ended' }),
    ]) {
      expect(events(on, off)).toEqual({ close: true, open: null });
    }
    expect(logEvents(revised(on), null)).toEqual({ close: true, open: null });
  });

  it('opens one for the piece that is there on unblank', () => {
    const result = events(
      snapshot({ itemId: 'i1', pieceId: 'l3' }, { blank: true }),
      snapshot({ itemId: 'i1', pieceId: 'l3' }),
    );
    expect(result).toMatchObject({ close: false, open: { pieceId: 'l3' } });
  });

  it('marks a slide carried over by Go live as previous, from the run sheet that was live', () => {
    const showing = showingOf(
      snapshot({ itemId: 'i1', pieceId: 'l1', runSheetId: 'rs0' }, { previous: true }),
    );
    expect(showing).toMatchObject({ previous: true, runSheetId: 'rs0', date: null });
  });

  it('makes no event for a new snapshot, devices, a video’s position or the background', () => {
    const on = snapshot({ itemId: 'i1', pieceId: 'l1' });
    const changed = [
      { ...on, revision: 9 },
      snapshot({ itemId: 'i1', pieceId: 'l1' }, { background: { color: '#ffffff', assetId: 'x' } }),
      snapshot(
        { itemId: 'i1', pieceId: 'l1' },
        {
          devices: [
            { id: 'p', name: 'Phone', role: 'phone', connection: 'relay', lastSeenAt: NOW },
          ],
        },
      ),
      {
        ...on,
        items: [
          {
            itemId: 'i9',
            songId: 's9',
            title: 'New',
            removed: false,
            kind: 'lyrics' as const,
            pieces: [],
          },
        ],
      },
    ];
    for (const next of changed) expect(events(on, next)).toEqual({ close: false, open: null });
    const video = (position: number) =>
      snapshot(
        { itemId: 'v', pieceId: 'video', songId: 'sv' },
        {
          kind: 'video',
          pieces: [{ id: 'video', lines: ['1:00'] }],
          video: {
            itemId: 'v',
            playing: true,
            position,
            at: NOW,
            durationSeconds: 60,
            resumeOnUnblank: false,
          },
        },
      );
    expect(events(video(0), video(30))).toEqual({ close: false, open: null });
  });

  it('makes two entries for the same piece of one song in two items', () => {
    const result = events(
      snapshot({ itemId: 'i1', pieceId: 'l1' }),
      snapshot({ itemId: 'i2', pieceId: 'l1' }),
    );
    expect(result).toMatchObject({ close: true, open: { itemId: 'i2' } });
  });

  it('closes and opens another when the song on screen is edited', () => {
    const on = snapshot({ itemId: 'i1', pieceId: 'l1' });
    const result = events(on, on, 1, 2);
    expect(result).toMatchObject({ close: true, open: { revision: 2 } });
  });

  it('names the part shown by position, by kind, with no text', () => {
    expect(showingOf(snapshot({ itemId: 'i1', pieceId: 'l3' }))!.part).toEqual({
      kind: 'lyrics',
      line: 2,
      count: 2,
    });
    expect(showingOf(snapshot({ itemId: 'i1', pieceId: 'l5' }))!.part).toEqual({
      kind: 'lyrics',
      line: 4,
      count: 1,
    });
    const deck: SnapshotPiece[] = [
      { id: 'a.jpg', lines: ['One'], image: 'a.jpg' },
      { id: 'b.jpg', lines: ['Two'], image: 'b.jpg' },
    ];
    expect(
      showingOf(snapshot({ itemId: 'd', pieceId: 'b.jpg' }, { kind: 'deck', pieces: deck }))!.part,
    ).toEqual({ kind: 'deck', page: 1 });
    const unit = (label: string) => ({ label, lines: [{ text: label, indent: 0 }] });
    const column = (labels: string[]) => ({ version: 'V', credit: 'V', units: labels.map(unit) });
    const passage: SnapshotPiece[] = [
      { id: 'v1', lines: [], passage: { columns: [column(['1', '2']), column(['1-2'])] } },
      { id: 'v3', lines: [], passage: { columns: [column(['3']), column(['3', '4'])] } },
    ];
    expect(
      showingOf(snapshot({ itemId: 'p', pieceId: 'v3' }, { kind: 'passage', pieces: passage }))!
        .part,
    ).toEqual({
      kind: 'passage',
      slide: 1,
      units: [
        { start: 2, count: 1 },
        { start: 1, count: 2 },
      ],
    });
    for (const kind of ['video', 'website'] as const) {
      const part = showingOf(
        snapshot({ itemId: 'x', pieceId: 'only' }, { kind, pieces: [{ id: 'only', lines: [] }] }),
      )!.part;
      expect(part).toEqual({ kind });
    }
    const text = JSON.stringify(showingOf(snapshot({ itemId: 'i1', pieceId: 'l3' })));
    expect(text).not.toContain('wretch');
  });
});
