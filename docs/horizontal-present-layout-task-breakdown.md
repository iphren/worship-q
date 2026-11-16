# Worship Q — Horizontal Present Layout Task Breakdown

**Drafted:** 15 November 2026  
**Status:** M0 done, 16 November 2026: see the [spike notes](spikes/horizontal-present-layout.md). M1, M2 and M3.2 implemented on the `feat/horizontal-present-layout` branch, 16 November 2026; M3.1 and M3.3 wait for the walkthrough.  
**Source:** the code at version 2.7.0, and the request that came with the arrow key swap (`790d15d`). There is no separate plan; the decisions are in §2.

## 1. How to read this

Today the Present page's slides column stacks the run sheet items from top to bottom, and each item lays its slides out in a grid that fills the width. On a large screen the slides of an item run left to right while the items run down, so the default arrow keys (Up and Down for slides, Left and Right for items) do not match what the operator sees. The arrow key swap fixed this by changing the keys. This feature fixes it by changing the layout: each item becomes a column, the columns run left to right, and the slides of an item stack down its column. With the default keys, Left and Right then move across the columns and Up and Down move down a column. A second benefit is that several items are always in view, however many slides one of them has.

Task identifiers are `M<milestone>.<n>`; a task lists the tasks it needs first. Sizes are S, M and L as in the phase plans. Pure logic (the layout choice and the scroll geometry) gets unit tests in `apps/desktop`. The desktop interface has no automated tests, so the M3 walkthrough covers the rest.

### Where things live today

| Concern | Location |
| --- | --- |
| Slides column: one `<section>` for each item, with a header and a grid of slide buttons | `apps/desktop/src/pages/PresentPage.tsx` (`<main ref={slidesRef}>`) |
| Following the presented slide, moving to the browsed item, the locate button, the run sheet click flash | `PresentPage.tsx`: the effects around `activeRef`, `scrollToTop`, `showItem`, the `IntersectionObserver` |
| Scroll position kept across page and tab switches | `apps/desktop/src/lib/scrollMemory.ts` (vertical only, `scrollTop`) |
| Per-computer settings (viewer mode, simple view, swapped arrows) | `apps/desktop/src/app/deviceSettings.ts` |
| Settings page, **Arrow keys** section (to become **Present layout and keys**) | `apps/desktop/src/pages/SettingsPage.tsx` |
| Scroll bar styling, always visible | `apps/desktop/src/styles.css` (`::-webkit-scrollbar`) |
| Keys and their labels | `apps/desktop/src/lib/shortcuts.ts` (`presentAction`, `arrowLabels`) |
| Interface strings | `apps/desktop/src/i18n/en.ts` |

## 2. Decisions

| # | Decision |
| --- | --- |
| H1 | **A per-computer setting**, `presentLayout: 'vertical' \| 'horizontal'` in `deviceSettings`, **`horizontal` by default**. Like the arrow keys, it depends on who sits at the screen and how big the screen is, not on the workspace. Viewers can use it too. The horizontal layout was first planned as an option, off by default; after trying it in the spike it became the default for the version that ships it, so every computer that has not chosen a layout switches to it on that update, and **Vertical** stays in Settings for anyone who prefers the old layout. Narrow windows still fall back to vertical (H4). |
| H2 | **The keys do not change with the layout, and Settings warns when they do not match it.** The arrow key swap stays a separate setting, but the two are one section in Settings, **Present layout and keys**, which replaces today's **Arrow keys** section. The matching combinations are horizontal with the default keys and vertical with the swapped keys. The other two (vertical with the default keys, horizontal with the swapped keys) show a warning in the section saying what does not match and which change would fix it. The defaults are horizontal with the default keys (H1), a matching combination, so there is no warning until someone changes one of the two settings. The warning stays in Settings: the Present page shows nothing extra. |
| H3 | **Fixed-width columns.** Each column is one slide card wide: **16rem**, chosen in the spike (M0.1). Lyrics cards keep their current look; deck and image slides fill the column width at their own aspect ratio; a video item is a column with one tile. |
| H4 | **Fall back to vertical on a narrow window.** When the slides area is too narrow for at least two columns (524 px at 16rem with 12 px gaps; three at first, lowered after trying it), it uses the vertical layout, even with the horizontal setting on. This is measured with a `ResizeObserver`, so resizing the window switches between the layouts. Only the layout changes; the keys stay the same (H2). |
| H5 | **Two directions of scrolling.** The row of columns scrolls left and right; each column scrolls up and down on its own. A trackpad does both natively. A mouse wheel scrolls a column when the pointer is over its slides, and scrolls the row sideways when the pointer is over a column header or the horizontal scroll bar. |
| H6 | **A large horizontal scroll bar.** The row's scroll bar is thicker than the default one and always visible, so it can be grabbed with a mouse. The global `::-webkit-scrollbar` styles already keep scroll bars visible on macOS; this one gets its own size (18 px) and a thumb that is highlighted while it is dragged. |
| H7 | **Following works on both axes.** Where the vertical layout brings an item's title to the top, the horizontal layout brings its column to the middle of the row (the left edge at first, changed after trying it). Within a column, the presented slide is scrolled into view with `nearest`. The page scrolls the row and the column itself (`scrollTo` with the M2.1 geometry) rather than relying on one `scrollIntoView` (M0.4). |

## 3. Tasks by milestone

### M0 — Spike (S)

Throwaway code on a branch that is not merged. Ends in `docs/spikes/horizontal-present-layout.md`.

| # | Task | Where | Done when |
| --- | --- | --- | --- |
| M0.1 | A rough horizontal layout of a real run sheet at 1440 and 2560 pixels wide, with column widths of 16, 18, 20 and 24rem | spike branch | A width is chosen (H3), and the number of columns that fit at each window size is recorded |
| M0.2 | Sending a mouse wheel's vertical movement over the headers and scroll bar to the row's sideways scroll; checking that it does not fight a trackpad's own sideways scrolling | spike branch | It feels right on a Mac with a mouse and with a trackpad, and on Windows with a mouse |
| M0.3 | A thicker scroll bar on the row only (a class with its own `::-webkit-scrollbar` height) in the Tauri webview on macOS and Windows | spike branch | It shows, can be dragged, and does not change the other scroll bars |
| M0.4 | Nested scrolling: `scrollIntoView` on a slide in a column inside the row, and `IntersectionObserver` with nested scroll containers | spike notes | It is known whether one `scrollIntoView` scrolls both containers smoothly, or whether M2 scrolls each one itself |

**Exit:** the spike notes record the column width, the wheel handling and the scrolling approach for M2.

### M1 — Setting and layout (M)

| # | Task | Where | Needs | Tests | Done when |
| --- | --- | --- | --- | --- | --- |
| M1.1 | The setting: `presentLayout` in `DeviceSettings`, `horizontal` by default, read back from storage as `horizontal` for anything other than `vertical` | `deviceSettings.ts` | — | Unit: it is kept across a restart; storage saved before the setting existed reads as horizontal; the default and damaged-storage cases include it | H1 |
| M1.2 | Settings: the **Arrow keys** section becomes **Present layout and keys**, with the layout choice (Vertical, Horizontal) and the **Swap the arrow keys** checkbox. A pure `layoutKeysMismatch(layout, swapArrows)` says whether the combination does not match, and in which way; while it does not, a warning in the section names what does not match and the change that would fix it (H2) | `SettingsPage.tsx`, `lib/presentLayout.ts`, `en.ts` | M1.1 | Unit: the two matching combinations, the defaults among them, give no warning; the two others give their own warning | The settings can be changed; the warning shows for a combination that does not match, goes away when either setting is changed to a match, and changes as the settings change; the Present page shows the change when reopened |
| M1.3 | Refactor, with no change in behaviour: move one item's `<section>` (header, warnings, slides, flash) out of `PresentPage` into an `ItemSlides` component that takes the arrangement of its slides (`grid` or `stack`) as a prop | `PresentPage.tsx`, `components/ItemSlides.tsx` | — | — | The vertical layout looks and behaves exactly as before |
| M1.4 | The layout choice: a pure `presentLayoutFor(width, setting, columnWidth)` returning `vertical` or `horizontal` (H4), and a hook that measures the slides area with a `ResizeObserver` | `lib/presentLayout.ts` | M1.1 | Unit: vertical when the setting is vertical; horizontal only from two columns wide; the switch point has no gap and no overlap | H4 |
| M1.5 | The horizontal layout: the slides area becomes a row (`flex`, `overflow-x-auto`, `overflow-y-hidden`) of fixed-width columns; each column is `ItemSlides` in `stack` arrangement with its header fixed at the top and its slides in their own `overflow-y-auto` area | `PresentPage.tsx`, `ItemSlides.tsx` | M1.3, M1.4, M0.1 | — | A run sheet shows as columns; every slide can be reached and clicked; the keyed header, slide key labels, **Last shown** chip, shading of alternate blocks and blank/live borders look as they do now |
| M1.6 | The row's large scroll bar (H6), with the thumb highlighted while dragged (`::-webkit-scrollbar-thumb:active`) | `styles.css` | M1.5, M0.3 | — | The bar is visible and can be dragged on macOS and Windows, and lights up while dragged |

**Milestone done:** by default, with a wide window, the run sheet shows as columns and every slide can be presented by clicking; narrowing the window below two columns brings back the vertical layout.

### M2 — Scrolling and following (M)

All of this applies only to the horizontal layout; the vertical layout keeps its current code paths.

| # | Task | Where | Needs | Tests | Done when |
| --- | --- | --- | --- | --- | --- |
| M2.1 | Scroll geometry: generalise `scrollToTop(section, keep)` into a pure function that takes the axis, the container's and the elements' rectangles, and returns the scroll offset, or null when `keep` would leave view | `lib/presentLayout.ts`, `PresentPage.tsx` | M1.5 | Unit: both axes; the `keep` case; an element already at the start | One rule for both layouts (H7) |
| M2.2 | Follow the presented slide: on a change made on this computer, bring a new item's column to the middle of the row, and scroll the column so the presented slide is in view | `PresentPage.tsx` | M2.1, M0.4 | — | Presenting with the keys, the buttons or a click on this computer keeps the slide in view; changes from phones leave the view where it is, as now |
| M2.3 | Browsing with Left and Right (or Up and Down when swapped) brings the browsed item's column to the middle of the row | `PresentPage.tsx` | M2.1 | — | The keyed column is always in view after a key press |
| M2.4 | The locate button: in view means the presented slide is visible in both its column and the row (one `IntersectionObserver` rooted at the row does this, M0.4); the button centres the presented item's column in the row and the slide in its column; it sits higher, clear of the row's scroll bar | `PresentPage.tsx`, `lib/presentLayout.ts` | M2.2, M0.4 | Unit: the centring offset, clamped at both ends of the row | The button shows when the slide is scrolled out of view in either direction, brings it back to the centre, and does not cover the scroll bar |
| M2.5 | A click on a run sheet item scrolls its column to the middle of the row and flashes it, as it now scrolls the item to the top | `PresentPage.tsx`, `ItemSlides.tsx` | M2.1 | — | Same behaviour as the vertical layout, turned sideways |
| M2.6 | Mouse wheel over a column header or the scroll bar scrolls the row sideways (H5) | `PresentPage.tsx` or a small hook | M1.5, M0.2 | — | A mouse can reach every column without dragging the scroll bar; trackpad scrolling is unchanged |
| M2.7 | Scroll memory: `useScrollMemory` learns an axis (or keeps both `scrollTop` and `scrollLeft`), so the row's position is kept across page and tab switches; the columns are not remembered and start at the presented slide or the top | `lib/scrollMemory.ts` | M1.5 | Unit, if the helper's restore logic is split out | Leaving and reopening the Present page keeps the row where it was |

**Milestone done:** a whole service can be run in the horizontal layout with the default keys, without touching the mouse, and the presented slide never goes out of view.

### M3 — Viewers, guide and walkthrough (S)

| # | Task | Where | Needs | Done when |
| --- | --- | --- | --- | --- |
| M3.1 | Viewers: a viewer with the horizontal setting follows the presented slide in both directions, as a viewer always follows now; simple view is unchanged | `PresentPage.tsx` | M2.2 | A viewer computer follows a whole service in the horizontal layout |
| M3.2 | Volunteer guide: a short section on the new default layout, how to go back to the vertical one, the arrow key swap, and which combinations match; the release notes say the layout changed | `docs/volunteer-guide.md` | M1.2 | The guide explains both settings in a few lines |
| M3.3 | Walkthrough on a large screen and on a laptop: a song with many slides, a deck, a video item (with its control bar below the row), a passage, a removed song, an empty run sheet, the keyed item moving off screen, window resizing across the fallback point, and both key settings | `docs/acceptance/horizontal-present-layout.md` | M2 | Each case is recorded as passing or fixed |

## 4. Out of scope

- Changing the arrow keys automatically with the layout or the window size (H2).
- Columns whose width the operator can drag, or a width setting. If the fixed width does not suit, this is the first follow-up.
- A horizontal layout on the phone remote.
