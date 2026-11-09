import { describe, expect, it } from 'vitest';
import type { Upload, UploadTarget } from '../app/uploads';
import { itemActions, mergeRows, type ItemActionState } from './runSheetRows';

const entry = (id: string) => ({ item: { id } });
const upload = (id: string, target: UploadTarget): Upload => ({
  id,
  path: `/p/${id}.jpg`,
  name: `${id}.jpg`,
  kind: 'image',
  target,
  stage: { kind: 'uploading', sent: 0, total: 1 },
});
const at = (afterItemId?: string | null): UploadTarget => ({
  kind: 'runSheet',
  date: '2026-11-08',
  afterItemId,
});
const shape = (rows: ReturnType<typeof mergeRows<{ item: { id: string } }>>) =>
  rows.map((row) => (row.kind === 'item' ? `${row.number}:${row.entry.item.id}` : row.upload.id));

describe('upload rows in a run sheet (U16)', () => {
  const entries = [entry('a'), entry('b'), entry('c')];

  it('shows each upload where it will land, without numbering it', () => {
    expect(
      shape(
        mergeRows(entries, [upload('u1', at('a')), upload('u2', at(null)), upload('u3', at())]),
      ),
    ).toEqual(['u2', '1:a', 'u1', '2:b', '3:c', 'u3']);
  });

  it('keeps uploads aimed at one place in the order added', () => {
    expect(shape(mergeRows(entries, [upload('u1', at('b')), upload('u2', at('b'))]))).toEqual([
      '1:a',
      '2:b',
      'u1',
      'u2',
      '3:c',
    ]);
  });

  it('puts an upload last when its item was removed', () => {
    expect(shape(mergeRows([entry('a')], [upload('u1', at('gone'))]))).toEqual(['1:a', 'u1']);
  });

  it('shows an upload alone in an empty run sheet', () => {
    expect(shape(mergeRows([], [upload('u1', at(null))]))).toEqual(['u1']);
  });

  it('leaves out uploads aimed elsewhere', () => {
    expect(shape(mergeRows([entry('a')], [upload('u1', { kind: 'library' })]))).toEqual(['1:a']);
  });
});

describe('the run sheet item menu (U27)', () => {
  const state: ItemActionState = {
    editable: true,
    connected: true,
    localVideo: false,
    canReplace: true,
    notKept: false,
    messages: { needsServer: 'connect', notKept: 'not kept' },
  };
  const deck = { source: 'a.pptx', width: 1, height: 1, pages: [] };
  const video = {
    file: 'video-x.mp4',
    source: 'a.mp4',
    width: 1,
    height: 1,
    durationSeconds: 1,
    bytes: 1,
    autoplay: false,
  };
  const song = (fields: object) =>
    ({ deck: null, video: null, website: null, removedAt: null, ...fields }) as never;
  const names = (actions: ReturnType<typeof itemActions>) => actions.map((a) => a.action);

  it('offers lyrics songs and websites Edit and Remove only', () => {
    expect(names(itemActions(song({}), state))).toEqual(['edit', 'remove']);
    expect(names(itemActions(song({ website: { url: 'https://x' } }), state))).toEqual([
      'edit',
      'remove',
    ]);
  });

  it('offers a passage Edit and Remove, never Download original or Upload new version (P5.2)', () => {
    const passage = { reference: 'MRK.15.5', texts: [] };
    expect(names(itemActions(song({ passage }), state))).toEqual(['edit', 'remove']);
    expect(names(itemActions(song({ passage }), { ...state, editable: false }))).toEqual([]);
  });

  it('offers media all four, Remove last', () => {
    for (const fields of [{ deck }, { deck: { ...deck, kind: 'image' } }, { video }]) {
      expect(names(itemActions(song(fields), state))).toEqual([
        'edit',
        'download',
        'replace',
        'remove',
      ]);
    }
  });

  it('offers a song removed from the library Download original and Remove', () => {
    expect(names(itemActions(song({ deck, removedAt: 'x' }), state))).toEqual([
      'download',
      'remove',
    ]);
  });

  it('offers only Download original on a run sheet that cannot be edited', () => {
    const readOnly = { ...state, editable: false };
    expect(names(itemActions(song({ deck }), readOnly))).toEqual(['download']);
    expect(names(itemActions(song({}), readOnly))).toEqual([]);
    expect(names(itemActions(song({ website: { url: 'https://x' } }), readOnly))).toEqual([]);
  });

  it('disables the file actions when not connected, except a video this computer has', () => {
    const offline = { ...state, connected: false };
    expect(itemActions(song({ deck }), offline)).toEqual([
      { action: 'edit', disabled: null },
      { action: 'download', disabled: 'connect' },
      { action: 'replace', disabled: 'connect' },
      { action: 'remove', disabled: null },
    ]);
    const local = itemActions(song({ video }), { ...offline, localVideo: true });
    expect(local.find((a) => a.action === 'download')!.disabled).toBeNull();
  });

  it('says when the original was not kept', () => {
    const actions = itemActions(song({ deck }), { ...state, notKept: true });
    expect(actions.find((a) => a.action === 'download')!.disabled).toBe('not kept');
  });

  it('does not offer Upload new version for a church item the workspace only uses', () => {
    expect(names(itemActions(song({ deck }), { ...state, canReplace: false }))).toEqual([
      'edit',
      'download',
      'remove',
    ]);
  });
});
