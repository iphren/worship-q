/**
 * Turns the coordinator's snapshot and the workspace's output look into the frame the
 * renderer draws, as the desktop's session does from its database (plan M7.2). Pure, so it
 * is tested without a browser.
 */
import {
  EMPTY_FRAME,
  type LiveSnapshot,
  type OutputFrame,
  type OutputKind,
  type OutputView,
} from '@worship-q/protocol';

export interface FrameInput {
  kind: OutputKind;
  snapshot: LiveSnapshot | null;
  look: OutputView['look'];
  /** Where a workspace file can be fetched from, with the output token. */
  fileUrl: (fileName: string) => string;
  /** The look's font when the browser has it, else null for the documented fallback. */
  fontAvailable: boolean;
}

export function buildFrame(input: FrameInput): OutputFrame {
  const { kind, snapshot, look } = input;
  const frame: OutputFrame = {
    ...EMPTY_FRAME,
    layout: kind,
    fontFamily: look && input.fontAvailable ? look.fontFamily : null,
    scale: look?.scale ?? 1,
    // Subtitles keep source-line boundaries and are never wrapped.
    wrap: kind === 'slideshow' && (look?.wrapLongLines ?? true),
    background: {
      color: look?.backgroundColor ?? '#000000',
      media: look?.backgroundFile
        ? { kind: look.backgroundFile.kind, url: input.fileUrl(look.backgroundFile.fileName) }
        : null,
    },
  };
  if (!snapshot || snapshot.state.status !== 'live') return frame;
  frame.blank = snapshot.state.blank;
  const presented = snapshot.presented;
  if (!presented) return frame;
  if (presented.kind === 'deck' || presented.kind === 'website') {
    frame.background = { color: '#000000', media: null };
  } else if (presented.background) {
    frame.background = {
      color: presented.background.color,
      media: null,
    };
    if (presented.background.assetId) {
      // The song's own background file is named by its asset only; the look names files,
      // so a song background shows as its color here until files are named in the snapshot.
    }
  }
  if (presented.kind === 'website') {
    frame.pieceId = presented.pieceId;
    if (kind === 'slideshow' && !frame.blank && presented.websiteUrl) {
      frame.website = { url: presented.websiteUrl };
    }
    return frame;
  }
  if (presented.kind === 'deck') {
    const page = presented.pieces.find((piece) => piece.id === presented.pieceId);
    frame.pieceId = page ? page.id : null;
    if (page?.image && kind === 'slideshow' && !frame.blank) {
      frame.picture = { url: input.fileUrl(page.image) };
    }
    return frame;
  }
  frame.song = {
    id: presented.songId,
    pieces: presented.pieces.map((piece) => ({ id: piece.id, lines: piece.lines })),
  };
  frame.pieceId = presented.pieces.some((piece) => piece.id === presented.pieceId)
    ? presented.pieceId
    : null;
  return frame;
}

/** The fonts the page was asked for and does not have, for the connected-devices list (M7.4). */
export function missingFonts(
  look: OutputView['look'],
  check: (family: string) => boolean,
): string[] {
  const family = look?.fontFamily;
  return family && !check(family) ? [family] : [];
}
