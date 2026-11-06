import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DeckBadge, PinnedMark } from './DeckBadge';

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

const song = { title: 'Welcome', deck: {}, website: null } as never;

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
