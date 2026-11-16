# Spike M0 — Horizontal present layout

**Status:** done on the `horizontal-layout-spike` branch (local, commit `e045db2`), 16 November 2026, in the desktop app under `tauri dev` on a Mac (macOS 27.2) with a 2560 × 1440 external display and the built-in Retina display, using a trackpad and a mouse. Windows was not tried; see "Not covered". Source: [Horizontal Present Layout Task Breakdown](../horizontal-present-layout-task-breakdown.md) M0; the decisions (H1–H7) are the breakdown's.

The spike code is throwaway and lives on the branch only: a dashed **SPIKE** bar on the Present page switched the slides column between the vertical layout and a row of columns, set the column width, turned the wheel redirect on and off, and ran the nested scrolling test. A `.spike-row` class gave the row its own thicker scroll bar.

## Choices

| Concern | Choice | Why |
| --- | --- | --- |
| Column width (H3) | **16rem** (256 px) | Lyric lines and deck slides read well at 16rem (M0.1), and it fits the most columns |
| Fallback point (H4) | Horizontal from **3 columns**: a slides area of at least 3 × 256 + 2 × 12 = **792 px** (12 px gaps) | At 1440 × 900 a full-screen window has room for about 3; the 2560-wide display fits 6 or more |
| Wheel (H5) | A vertical wheel movement over a column header or the bare row (not over a column's slides) scrolls the row sideways; movements that are mostly sideways are left alone | Works with a mouse and leaves trackpad scrolling as it was (M0.2) |
| Scroll bar (H6) | The row's bar is 18 px high with a 3 px border and a lighter thumb; it is **highlighted while dragged** (`::-webkit-scrollbar-thumb:active`) | Visible and easy to grab (M0.3); the highlight was asked for during the trial |
| Scrolling into view (H7) | M2 scrolls the row and the column itself, with `scrollTo` and the M2.1 geometry, instead of relying on one `scrollIntoView` | See M0.4: the row part is proven, the column part was not exercised, and the locate button needs centring, which `nearest` does not give |
| Locate button (M2.4) | In the horizontal layout it **centres the presented item's column** in the row, and the slide in its column; the button sits above the row's scroll bar | Asked for during the trial: the vertical code was "not too off", and centring would be better; the button was too close to the scroll bar |
| In-view check (M2.4) | One `IntersectionObserver` with the row as its root is enough | It reports a slide hidden inside its column as not in view (M0.4) |

## M0.1 — Column width

Tried 16, 18, 20 and 24rem. **16rem is good enough**: lyrics cards stay readable with their lines cut where they are cut today, and deck slides fill the width at their own aspect ratio. Wider columns gain little and fit fewer: in a 760 px window (a 340 px slides area) none of the widths fit even two columns, which is what the fallback is for.

## M0.2 — Mouse wheel

With the redirect on, the mouse wheel over a header scrolls the row sideways, and over a column's slides scrolls that column. With the trackpad, sideways swipes scroll the row everywhere as before, and vertical swipes over the slides scroll the column. Turning the redirect off and on behaved as expected. Kept as in the spike.

## M0.3 — Scroll bar

A per-element `::-webkit-scrollbar` (`.spike-row::-webkit-scrollbar { height: 18px }`) overrides the app's global 10 px bar for the row only, in the Tauri web view on macOS. It shows, is easy to drag, and the other scroll bars are unchanged. Cosmetic request: highlight the thumb while it is dragged.

## M0.4 — Nested scrolling

The test ran in a narrow window (one column fits, a 340 px slides area):

> smooth scrollIntoView: row 0→2860, column top →0; in view: row true, column true · IO(root=row) on last slide of longest column: ratio 0.00 (clipped by its column: true)

- **Row:** a smooth `scrollIntoView({ inline: 'nearest' })` on a slide in the last column scrolled the row the whole way (0 → 2860 px) and left the slide in view.
- **Column:** that last column was short, so its slide was in view without scrolling, and the vertical part of a nested `scrollIntoView` was not exercised. M2 does not depend on it (see Choices).
- **Observer:** an `IntersectionObserver` rooted at the row gives a ratio of 0 for a slide that its column clips, so the observer takes both containers into account.

## Found during the trial

- Left and Right no longer bring the browsed item into view in the horizontal layout, as the spike kept the vertical scrolling code; Up and Down still step through an item's slides. This is M2.3.
- The locate button was "not too off" with the vertical code; centring the column would be better, and the button should move up from the scroll bar. Added to M2.4.

## Not covered

- **Windows.** The scroll bar styling and the wheel redirect use only what WebView2 also supports (`::-webkit-scrollbar`, `wheel` events), but they were not tried there. The M3.3 walkthrough includes a Windows computer.
- **A nested vertical scroll into view** (see M0.4); M2.2 tests it in the app.
