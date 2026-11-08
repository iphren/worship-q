/** Video playback in the live state (media uploads plan §3.10, U22, U23). */
import { LiveStateSchema } from '@worship-q/protocol';
import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  createLiveState,
  forgetVideoPosition,
  videoPosition,
  type Command,
  type CommandInput,
  type LiveState,
  type PlayablePiece,
} from './index';
import { followPresentation } from './video';

const T0 = '2026-10-11T09:00:00.000Z';
const at = (seconds: number) => new Date(Date.parse(T0) + seconds * 1000).toISOString();

const sequence = (autoplay = false, second = false): PlayablePiece[] => [
  { itemId: 'song', songId: 's1', pieceId: 'a' },
  { itemId: 'v1', songId: 'video', pieceId: 'video', video: { durationSeconds: 60, autoplay } },
  { itemId: 'reading', songId: 's2', pieceId: 'r' },
  {
    itemId: 'v2',
    songId: 'video',
    pieceId: 'video',
    video: { durationSeconds: 60, autoplay: second },
  },
];

let n = 0;
/** Applies commands one after another, each at its own second. */
function run(
  state: LiveState,
  steps: [number, CommandInput][],
  pieces: PlayablePiece[] = sequence(),
): LiveState {
  for (const [second, command] of steps) {
    state = applyCommand(state, { id: `c${++n}`, ...command } as Command, {
      now: at(second),
      sequence: pieces,
    }).state;
  }
  return state;
}

const enter = (itemId = 'v1'): CommandInput => ({
  type: 'playPiece',
  itemId,
  pieceId: itemId.startsWith('v') ? 'video' : itemId === 'song' ? 'a' : 'r',
});
const leave: CommandInput = { type: 'playPiece', itemId: 'reading', pieceId: 'r' };
const play: CommandInput = { type: 'videoPlay', itemId: 'v1' };
const pause: CommandInput = { type: 'videoPause', itemId: 'v1' };
const seek = (seconds: number): CommandInput => ({ type: 'videoSeek', itemId: 'v1', seconds });
const fresh = () => createLiveState('rs1', T0);
const shownAt = (state: LiveState, second: number) => videoPosition(state.video!, at(second));

describe('entering a video item (U23)', () => {
  it('waits paused at 0 without Autoplay', () => {
    const state = run(fresh(), [[0, enter()]]);
    expect(state.video).toMatchObject({ itemId: 'v1', playing: false, position: 0 });
  });

  it('plays from 0 with Autoplay, counted from the entry', () => {
    const state = run(fresh(), [[5, enter()]], sequence(true));
    expect(state.video).toMatchObject({ playing: true, position: 0, at: at(5) });
    expect(shownAt(state, 8)).toBe(3);
  });

  it('keeps a video’s state when its item is presented again', () => {
    let state = run(fresh(), [
      [0, enter()],
      [1, play],
    ]);
    state = run(state, [[11, enter()]]);
    expect(state.video).toMatchObject({ playing: true });
    expect(shownAt(state, 11)).toBe(10);
  });
});

describe('remembering where a video was left (U22)', () => {
  it('restores 42 s when the operator comes back, paused or playing by Autoplay', () => {
    let state = run(fresh(), [
      [0, enter()],
      [0, play],
      [42, leave],
    ]);
    expect(state.video).toBeNull();
    expect(state.videoPositions).toEqual({ v1: 42 });
    expect(run(state, [[50, enter()]]).video).toMatchObject({ position: 42, playing: false });
    state = run(
      fresh(),
      [
        [0, enter()],
        [42, leave],
        [50, enter()],
      ],
      sequence(true),
    );
    expect(state.video).toMatchObject({ position: 42, playing: true });
  });

  it.each([
    ['Next', { type: 'next' }],
    ['Previous', { type: 'previous' }],
    ['Next item', { type: 'nextItem' }],
    ['Previous item', { type: 'previousItem' }],
    ['a click', { type: 'playPiece', itemId: 'song', pieceId: 'a' }],
    ['Clear', { type: 'clear' }],
  ] as [string, CommandInput][])('saves the position when leaving by %s', (_name, command) => {
    const state = run(fresh(), [
      [0, enter()],
      [0, play],
      [42, command],
    ]);
    expect(state.videoPositions.v1).toBe(42);
  });

  it('keeps a paused or seeked position', () => {
    expect(
      run(fresh(), [
        [0, enter()],
        [0, play],
        [42, pause],
        [60, leave],
      ]).videoPositions.v1,
    ).toBe(42);
    expect(
      run(fresh(), [
        [0, enter()],
        [1, seek(10)],
        [20, leave],
      ]).videoPositions.v1,
    ).toBe(10);
  });

  it('starts again from 0 when it was left at its end', () => {
    const state = run(fresh(), [
      [0, enter()],
      [0, play],
      [70, leave],
      [80, enter()],
    ]);
    expect(state.video).toMatchObject({ position: 0 });
    const nearly = run(fresh(), [
      [0, enter()],
      [1, seek(59.7)],
      [2, leave],
      [3, enter()],
    ]);
    expect(nearly.video!.position).toBe(0);
  });

  it('remembers each item of the same video on its own', () => {
    const state = run(fresh(), [
      [0, enter('v1')],
      [0, play],
      [10, enter('v2')],
      [11, { type: 'videoPlay', itemId: 'v2' }],
      [31, enter('v1')],
    ]);
    expect(state.videoPositions).toEqual({ v1: 10, v2: 20 });
    expect(state.video).toMatchObject({ itemId: 'v1', position: 10 });
  });

  it('keeps the position across slides of other items', () => {
    const state = run(fresh(), [
      [0, enter()],
      [0, play],
      [5, leave],
      [6, enter('song')],
      [7, enter()],
    ]);
    expect(state.video!.position).toBe(5);
  });

  it('forgets every position on End, and on Go live with another run sheet', () => {
    let state = run(fresh(), [
      [0, enter()],
      [0, play],
      [42, leave],
    ]);
    expect(run(state, [[50, { type: 'end' }]]).videoPositions).toEqual({});
    state = run(state, [[50, { type: 'goLive', runSheetId: 'rs2' }]]);
    expect(state.videoPositions).toEqual({});
  });

  it('keeps positions on Go live with the same run sheet', () => {
    const state = run(fresh(), [
      [0, enter()],
      [0, play],
      [42, leave],
      [50, { type: 'goLive', runSheetId: 'rs1' }],
    ]);
    expect(state.videoPositions).toEqual({ v1: 42 });
  });

  it('forgets an item’s position when it is removed from the run sheet', () => {
    const state = run(fresh(), [
      [0, enter()],
      [0, play],
      [42, leave],
    ]);
    expect(forgetVideoPosition(state, 'v1', at(50)).videoPositions).toEqual({});
  });

  it('starts at 0 when the remembered position is past a shorter new version', () => {
    const state = run(fresh(), [
      [0, enter()],
      [0, play],
      [50, leave],
    ]);
    const shorter = sequence().map((p) =>
      p.video ? { ...p, video: { durationSeconds: 30, autoplay: false } } : p,
    );
    expect(run(state, [[60, enter()]], shorter).video!.position).toBe(0);
  });

  it('reads a live state from before videos with no positions', () => {
    const { video, videoPositions, ...older } = fresh();
    void video;
    void videoPositions;
    const parsed = LiveStateSchema.parse(older);
    expect(parsed.videoPositions).toEqual({});
    expect(run(parsed, [[0, enter()]]).video).toMatchObject({ itemId: 'v1' });
  });
});

describe('play, pause and seek', () => {
  it('moves the position on with the clock while playing', () => {
    const state = run(fresh(), [
      [0, enter()],
      [10, play],
      [15, pause],
    ]);
    expect(state.video).toMatchObject({ playing: false, position: 5 });
  });

  it('keeps seeks within the video, and pauses at the end', () => {
    expect(
      run(fresh(), [
        [0, enter()],
        [1, seek(-3)],
      ]).video!.position,
    ).toBe(0);
    const end = run(fresh(), [
      [0, enter()],
      [0, play],
      [1, seek(500)],
    ]);
    expect(end.video).toMatchObject({ position: 60, playing: false });
  });

  it('reports a video that played past its end as paused there', () => {
    const state = run(fresh(), [
      [0, enter()],
      [0, play],
    ]);
    expect(shownAt(state, 90)).toBe(60);
    const later = run(state, [[90, { type: 'blank' }]]);
    expect(later.video).toMatchObject({ playing: false, position: 60 });
  });

  it('starts again from 0 when played at its end', () => {
    const state = run(fresh(), [
      [0, enter()],
      [0, play],
      [90, play],
    ]);
    expect(state.video).toMatchObject({ playing: true, position: 0, at: at(90) });
  });

  it('applies a repeated command once', () => {
    let state = run(fresh(), [[0, enter()]]);
    const command = { id: 'same', type: 'videoSeek', itemId: 'v1', seconds: 10 } as Command;
    state = applyCommand(state, command, { now: at(1), sequence: sequence() }).state;
    const again = applyCommand(state, { ...command, seconds: 20 } as Command, {
      now: at(2),
      sequence: sequence(),
    });
    expect(again.result).toBe('duplicate');
    expect(again.state.video!.position).toBe(10);
  });

  it('ignores a video command while something else is presented, or for another item', () => {
    const song = run(fresh(), [[0, enter('song')]]);
    expect(run(song, [[1, play]]).video).toBeNull();
    const other = run(fresh(), [
      [0, enter()],
      [1, { type: 'videoPlay', itemId: 'v2' }],
    ]);
    expect(other.video).toMatchObject({ itemId: 'v1', playing: false });
  });
});

describe('blanking during a video (U22, U23)', () => {
  it('pauses a playing video and plays it again on unblank', () => {
    let state = run(fresh(), [
      [0, enter()],
      [0, play],
      [10, { type: 'blank' }],
    ]);
    expect(state.video).toMatchObject({ playing: false, position: 10, resumeOnUnblank: true });
    state = run(state, [[20, { type: 'unblank' }]]);
    expect(state.video).toMatchObject({ playing: true, position: 10, at: at(20) });
    expect(state.video!.resumeOnUnblank).toBe(false);
  });

  it('leaves a paused video paused through blank and unblank', () => {
    const state = run(fresh(), [
      [0, enter()],
      [5, { type: 'blank' }],
      [9, { type: 'unblank' }],
    ]);
    expect(state.video).toMatchObject({ playing: false, position: 0 });
  });

  it('never undoes the operator’s own pause with unblank', () => {
    const state = run(fresh(), [
      [0, enter()],
      [0, play],
      [10, { type: 'blank' }],
      [12, pause],
      [20, { type: 'unblank' }],
    ]);
    expect(state.video).toMatchObject({ playing: false, position: 10 });
  });

  it('plays while blank when the operator plays it, and unblank changes nothing', () => {
    const state = run(fresh(), [
      [0, enter()],
      [0, play],
      [10, { type: 'blank' }],
      [12, play],
      [20, { type: 'unblank' }],
    ]);
    // It played on, hidden, from 12 s: at 20 s it is 8 s further.
    expect(state.video).toMatchObject({ playing: true, resumeOnUnblank: false });
    expect(shownAt(state, 20)).toBe(18);
  });

  it('saves the paused position when the item is left while blank, not carrying the resume', () => {
    const state = run(fresh(), [
      [0, enter()],
      [0, play],
      [10, { type: 'blank' }],
      [30, leave],
    ]);
    expect(state.videoPositions.v1).toBe(10);
    expect(state.video).toBeNull();
  });

  it('turning Autoplay on while a video is paused starts nothing; the next entry plays', () => {
    let state = run(fresh(), [[0, enter()]]);
    state = run(state, [[5, enter()]], sequence(true));
    expect(state.video!.playing).toBe(false);
    state = run(
      state,
      [
        [6, leave],
        [7, enter()],
      ],
      sequence(true),
    );
    expect(state.video!.playing).toBe(true);
  });

  it('turning Autoplay off while a video plays keeps it playing; the next entry waits', () => {
    let state = run(fresh(), [[0, enter()]], sequence(true));
    state = run(state, [[5, enter()]], sequence(false));
    expect(state.video!.playing).toBe(true);
    state = run(
      state,
      [
        [6, leave],
        [7, enter()],
      ],
      sequence(false),
    );
    expect(state.video!.playing).toBe(false);
  });
});

describe('an Autoplay video entered while blank (U23)', () => {
  // Presenting unblanks today, so this is reached only through the rule itself.
  const before = createLiveState('rs1', T0);
  const presented = {
    runSheetId: 'rs1',
    itemId: 'v1',
    songId: 'video',
    pieceId: 'video',
    index: 1,
  };
  const blankAfter = { ...before, presented, blank: true };

  it('waits paused at its remembered position and plays on unblank', () => {
    const entered = followPresentation(
      before,
      { ...blankAfter, videoPositions: { v1: 12 } },
      { durationSeconds: 60, autoplay: true },
      at(0),
    );
    expect(entered.video).toMatchObject({ playing: false, position: 12, resumeOnUnblank: true });
    const state = { ...blankAfter, ...entered };
    const unblanked = run(state, [[5, { type: 'unblank' }]]);
    expect(unblanked.video).toMatchObject({ playing: true, position: 12, at: at(5) });
  });

  it('stays paused on unblank when the operator paused it meanwhile', () => {
    const entered = followPresentation(
      before,
      blankAfter,
      { durationSeconds: 60, autoplay: true },
      at(0),
    );
    const state = run({ ...blankAfter, ...entered }, [
      [1, pause],
      [5, { type: 'unblank' }],
    ]);
    expect(state.video!.playing).toBe(false);
  });

  it('without Autoplay, stays paused on unblank', () => {
    const entered = followPresentation(
      before,
      blankAfter,
      { durationSeconds: 60, autoplay: false },
      at(0),
    );
    const state = run({ ...blankAfter, ...entered }, [[5, { type: 'unblank' }]]);
    expect(state.video!.playing).toBe(false);
  });
});
