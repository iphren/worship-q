/**
 * What a run sheet lists (media uploads plan, U16, U27): its items, with this computer's
 * uploads aimed at it shown at the place they will land, and the actions each item's menu
 * offers.
 */
import type { Song } from '@worship-q/protocol';
import { songMediaKind } from '../app/media';
import type { Upload } from '../app/uploads';

export type Row<Entry> =
  | { kind: 'item'; entry: Entry; number: number; index: number }
  | { kind: 'upload'; upload: Upload };

/**
 * The items in order, numbered, with each upload placed after the item it was aimed at (in
 * the order added when several are aimed at one place), first when aimed at the top, and
 * last when aimed at the end or at an item no longer there. Uploads are never numbered and
 * never shift the numbers of items.
 */
export function mergeRows<Entry extends { item: { id: string } }>(
  entries: readonly Entry[],
  uploads: readonly Upload[],
): Row<Entry>[] {
  const ids = new Set(entries.map((entry) => entry.item.id));
  const after = new Map<string | null, Upload[]>();
  const last: Upload[] = [];
  for (const upload of uploads) {
    if (upload.target.kind !== 'runSheet') continue;
    const anchor = upload.target.afterItemId;
    if (anchor === undefined || (anchor !== null && !ids.has(anchor))) last.push(upload);
    else after.set(anchor, [...(after.get(anchor) ?? []), upload]);
  }
  const rows: Row<Entry>[] = [];
  const place = (list: Upload[] | undefined) => {
    for (const upload of list ?? []) rows.push({ kind: 'upload', upload });
  };
  place(after.get(null));
  entries.forEach((entry, index) => {
    rows.push({ kind: 'item', entry, number: index + 1, index });
    place(after.get(entry.item.id));
  });
  place(last);
  return rows;
}

/** One action of a run sheet item's menu, and why it cannot be used now, if it cannot. */
export interface ItemAction {
  action: 'edit' | 'autoplay' | 'download' | 'replace' | 'reconvert' | 'remove';
  disabled: string | null;
  /** For Autoplay, a checkbox: whether it is on. */
  checked?: boolean;
}

export interface ItemActionState {
  /** The run sheet can be edited here: not a past date, not read-only. */
  editable: boolean;
  /** Joined to a church server. */
  connected: boolean;
  /**
   * No church server: videos stay on this computer and decks go to the public server, which
   * keeps no originals (public server plan §5). False in viewer mode, which uses neither.
   */
  churchless?: boolean;
  /** This computer has the video's own copy. */
  localVideo: boolean;
  /** The workspace may change the item's file (not a church item it only uses). */
  canReplace: boolean;
  /** The server said it did not keep the original. */
  notKept: boolean;
  /** The item's slides or PDF are being converted again now. */
  reconverting?: boolean;
  messages: { needsServer: string; notKept: string; reconverting: string };
}

/**
 * The actions a run sheet item's **⋯** menu offers (U27): Edit, an Autoplay checkbox (videos
 * only), Download original and Upload new version (media only), Reconvert (slides and PDFs
 * only), and Remove, last. A song removed from the library offers only Download original and
 * Remove; a run sheet that cannot be edited, only Download original.
 */
export function itemActions(
  song: Pick<Song, 'deck' | 'video' | 'website' | 'removedAt'>,
  state: ItemActionState,
): ItemAction[] {
  const kind = songMediaKind({ ...song, video: song.video ?? null });
  const media = kind !== null;
  const actions: ItemAction[] = [];
  const download: ItemAction = {
    action: 'download',
    disabled:
      state.notKept || (state.churchless && !song.video)
        ? state.messages.notKept
        : state.connected || (song.video && state.localVideo)
          ? null
          : state.messages.needsServer,
  };
  if (!state.editable) return media ? [download] : [];
  if (!song.removedAt) actions.push({ action: 'edit', disabled: null });
  if (song.video && !song.removedAt) {
    // Older video records may lack the field: they are off.
    actions.push({ action: 'autoplay', disabled: null, checked: song.video.autoplay === true });
  }
  if (media) {
    actions.push(download);
    if (!song.removedAt && state.canReplace) {
      const offline = state.connected || state.churchless ? null : state.messages.needsServer;
      actions.push({ action: 'replace', disabled: offline });
      if (kind === 'slides' || kind === 'pdf') {
        actions.push({
          action: 'reconvert',
          // Reconverting needs the original, which only a church server keeps.
          disabled: state.reconverting
            ? state.messages.reconverting
            : state.churchless
              ? state.messages.notKept
              : offline,
        });
      }
    }
  }
  actions.push({ action: 'remove', disabled: null });
  return actions;
}
