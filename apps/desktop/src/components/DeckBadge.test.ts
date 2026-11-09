import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { badgeKind, DeckBadge, PinnedMark } from './DeckBadge';

const POSITIONED = /\b(relative|absolute|fixed|sticky)\b/;

/**
 * The classes of the parent of each `sr-only` element. `sr-only` is absolutely positioned, so
 * it is placed against the nearest positioned ancestor; with none it escapes every scroll box
 * it sits in and stretches the whole window, which then scrolls far past the app.
 */
function srOnlyParents(element: ReactElement): string[] {
  const html = renderToStaticMarkup(element);
  const stack: string[] = [];
  const parents: string[] = [];
  for (const [tag, closing, name, attrs] of html.matchAll(/<(\/?)(\w+)([^>]*?)\/?>/g)) {
    if (closing) {
      stack.pop();
      continue;
    }
    const className = /class="([^"]*)"/.exec(attrs!)?.[1] ?? '';
    if (/\bsr-only\b/.test(className)) parents.push(stack.at(-1) ?? '');
    // React closes SVG shapes with end tags, so only HTML's void elements have none.
    const voidTag = tag.endsWith('/>') || ['input', 'img', 'br', 'hr'].includes(name!);
    if (!voidTag) stack.push(className);
  }
  return parents;
}

const song = { title: 'Welcome', deck: { source: 'a.pptx' }, website: null } as never;

describe('hidden labels stay inside their scroll box', () => {
  it('keeps the deck badge label within a positioned badge', () => {
    const parents = srOnlyParents(createElement(DeckBadge, { song }));
    expect(parents).toHaveLength(1);
    expect(parents[0]).toMatch(POSITIONED);
  });

  it('keeps the pinned label within a positioned mark', () => {
    const parents = srOnlyParents(createElement(PinnedMark));
    expect(parents).toHaveLength(1);
    expect(parents[0]).toMatch(POSITIONED);
  });
});

describe('badge colours (U12)', () => {
  const deck = (source: string, kind?: 'image') =>
    ({
      title: 'Offering',
      deck: { source, ...(kind ? { kind } : {}), width: 1, height: 1, pages: [] },
      website: null,
      video: null,
    }) as never;
  const website = { title: 'Welcome', deck: null, website: {}, video: null } as never;
  const video = {
    title: 'Clip',
    deck: null,
    website: null,
    video: { file: 'video-x.mp4' },
  } as never;
  const lyrics = { title: 'Song', deck: null, website: null, video: null } as never;
  const html = (song: never) => renderToStaticMarkup(createElement(DeckBadge, { song }));
  const passage = {
    title: 'Mark 15:5–6',
    deck: null,
    website: null,
    video: null,
    passage: { reference: 'MRK.15.5-MRK.15.6', texts: [] },
  } as never;

  it('gives a passage the Bible badge, in the slides’ cyan (P5.3)', () => {
    expect(badgeKind(passage)).toBe('bible');
    expect(html(passage)).toContain('text-[#00E6FF]');
    expect(html(passage)).toContain('Bible');
  });

  it('gives each kind its own colour and label', () => {
    expect(badgeKind(deck('a.pptx'))).toBe('slides');
    expect(badgeKind(deck('a.pdf'))).toBe('pdf');
    expect(badgeKind(deck('a.jpg', 'image'))).toBe('image');
    expect(badgeKind(video)).toBe('video');
    expect(badgeKind(website)).toBe('website');
    expect(badgeKind(lyrics)).toBeNull();
    expect(html(deck('a.pptx'))).toContain('text-orange-300');
    expect(html(deck('a.PDF'))).toContain('text-rose-300');
    expect(html(deck('a.png', 'image'))).toContain('text-emerald-300');
    expect(html(video)).toContain('text-violet-300');
    expect(html(website)).toContain('text-fuchsia-300');
    expect(html(lyrics)).toBe('');
    // The colour is never the only sign: each keeps its label.
    expect(html(video)).toContain('>Video</span>');
    expect(html(deck('a.pdf'))).toContain('title="PDF"');
  });

  it('reads a deck from before kinds as slides, or a PDF by its file', () => {
    expect(badgeKind({ deck: { source: 'Notes.PDF' }, website: null } as never)).toBe('pdf');
    expect(badgeKind({ deck: { source: 'talk.key' }, website: null } as never)).toBe('slides');
  });
});
