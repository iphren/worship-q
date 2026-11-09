# Spike P0 — Bible passages

**Status:** done on the `bible-spikes` branch, 9 November 2026, on a MacBook (Apple M1, macOS
27.2) with headless Chrome for the measurements. P0.3's measurements are macOS only; Windows
fonts are expected to differ by a few per cent (see P0.3). Source:
[Bible Passages Task Breakdown](../bible-passages-task-breakdown.md) P0, and API.Bible's
[Understanding FUMS](https://care.api.bible/article/417-understanding-fums); the decisions
(B1–B26) are the [plan's](../bible-passages-plan.md).

The spike code is throwaway and lives on the branch only, under `spikes/bible/`:
`record.sh` records the provider responses with the first church's keys (from
`~/.worship-q-bible-keys`, never committed), `normalise.mjs` and `compare.mjs` are P0.2's
prototype, and `measure.sh` with `measure.html` is P0.3's measurement. The short passages'
responses are committed as fixtures for P2's tests, with FUMS tokens removed; whole chapters
are not committed, being more than a quotation.

## Choices so far

| Concern | Choice | Why |
| --- | --- | --- |
| FUMS (B25) | Report from the church server: GET `https://fums.api.bible/f3?t=<token>&t=…&dId=<device>&sId=<session>`, no `uId`. The server reports the token of every API.Bible passage it serves (the Bible window's preview, or presenting). The token is stored with the run sheet item, and when a saved item is presented in a live session the coordinator asks the server to report it again, once per item per session. `dId` is a random, stable identifier per computer (not its device id); `sId` is new for each Bible window opening and each live session | Required for web and hybrid apps; manual reporting from a server is allowed; a token "can be reused whenever that content is displayed, including from cache"; a view counts whether by an operator or the congregation (P0.1) |
| Normalised shape (B22) | A **unit** per verse or joined group: `{ chapter, verses: number[], label, lines: { text, indent }[] }`, plus an optional **title** unit for a psalm's title. Headings, footnotes, cross-references, pilcrows and links dropped; poetry keeps one line per poetic line with indent 0 or 1; prose keeps one line per verse | All four providers fill it from what they send, and give the same units for the same edition (P0.2) |
| Joined verses | Taken from the provider where it marks them (YouVersion `ev`, API.Bible `verseOrgIds` and labels like `12-13`). The Free Use Bible API drops the joined numbers (CUNP's 1 Chronicles 16:12–13 arrives as 12, with no 13), so a gap in its numbering is read as a join into the verse before | CCB and CUNP both join 1 Chronicles 16:12–13 (P0.2) |
| Omitted verses | A verse with no text (NIVUK's Matthew 17:21, which has only a footnote) is no unit, so it counts as missing for B14 | YouVersion sends the verse marker with only a footnote (P0.2) |
| Psalm titles | Kept as a title unit before verse 1 when a range starts at verse 1; shown without a number | NIVUK, CCB, KJV, ESV and CUNP all have them outside verse 1; YouVersion's BSB puts its title inside verse 1, which is shown as is (P0.2) |
| Slide budget (B24) | Target text size **5 % of the output height**; estimate each line's wrapped lines from its width with **Latin 30 and Chinese 12 characters per line** in a two-column layout (Latin 55, Chinese 25 in one column); pack whole units while the estimate stays within **10 lines per column** (11 fit; one is spare for estimation error and other fonts); the renderer then sizes the text to fit, never below 4 % | Measured at 1920 × 1080 with the renderer's margins (P0.3) |
| Provider calls (P2.4, P2.5) | API.Bible: never build a whole table of contents from it. Its books and chapters come in one call; a chapter's verses are fetched the first time anyone opens that chapter and kept on the server for good. YouVersion's index is refreshed weekly and compared by hash. ESV's whole-book use is bounded by its own rules | API.Bible's Starter plan allows **5,000 calls a month** for the whole church, with no extra calls for sale; a full verse list would cost 1,190 calls per version (P0.4) |

## P0.1 — FUMS

- [x] **Required?** API.Bible's *Fair Use (View Tracking)* page: FUMS is required for web
  apps; apps that are only mobile, with no user-accessible web functionality, can skip it.
  Worship Q serves browser pages (the phone remote, browser outputs), so it reports.
- [x] **How, without a browser:** the page documents manual reporting: `GET
  https://fums.api.bible/f3` with `t` (the `meta.fumsToken` of a Scripture response, repeated
  for several), `dId` (a random, anonymous device identifier kept for the life of the device),
  `sId` (random, new each session) and optional `uId` (never personal data).
- [x] **From a server:** API.Bible's *Understanding FUMS* article: "If your app runs on a
  server rather than in a browser, you can report FUMS manually via a GET request." It also
  says hybrid apps rendering Scripture in an embedded web view must report, which covers the
  Tauri desktop.
- [x] **What counts:** a view is Scripture viewed through the application, whether by an
  operator or the congregation, and a token "can be reused whenever that content is displayed,
  including from cache". Decided by the project owner (9 November 2026): report on the fly
  when the server serves a passage, store the token with the run sheet item, and report it
  again when the saved item is presented, without further confirmation from API.Bible.

## P0.2 — Normalising text

Recorded: John 3:16–18, Psalm 23, 1 Chronicles 16:11–14, Revelation 12:17–18 and Matthew
17:20–22 from YouVersion (NIVUK, CCB, BSB), API.Bible (NIVUK, NKJV, KJV, open CCB), ESV and the
Free Use Bible API (BSB, CUNP), and Genesis 1:31–2:3 from ESV. `node spikes/bible/compare.mjs`
prints them side by side.

- [x] **YouVersion** (`format=html`): USFM paragraph classes (`p`, `q1`, `q2`, `d` for a
  psalm's title, `s1`/`yv-h` for headings), verse markers `<span class="yv-v" v="12"
  ev="13">` and the printed label in `yv-vlbl`, footnotes in `yv-n`. `format=text` loses poetry
  lines, so HTML is used. Ranges stop at the chapter (technical discovery §3).
- [x] **API.Bible** (`content-type=json`): a tree of `para` (with the USFM style), `verse`
  (`number` "12-13", `sid` "1CH 16:12-13") and text items carrying `verseOrgIds`; notes are
  `note` nodes. Ranges may cross chapters. The KJV keeps pilcrows (¶), which are dropped.
- [x] **ESV** (`/passage/html/`): `<b class="verse-num|chapter-num" id="v13016012-1">` gives
  book, chapter and verse; poetry lines are `<span class="line">` or `indent line`; headings
  are `h2`–`h4`, the psalm title `h4.psalm-title`; the closing `(ESV)` link is dropped and the
  credit added by Worship Q. Ranges may cross chapters.
- [x] **Free Use Bible API**: whole chapters; a verse's `content` mixes strings, `{ text,
  poem }` and `{ noteId }`. A note between two words of prose loses the space between them
  ("only" + "Son"), which the normaliser restores; joined verses lose their second number (see
  the choices).
- [x] **Result:** for each edition, every provider gives the same units and words (NIVUK from
  YouVersion and API.Bible; BSB from YouVersion and Free Use; open CCB and CCB). Fallback
  between them (B18) changes nothing on screen.
- [x] **Versification seen:** CCB and CUNP join 1 Chronicles 16:12–13; NIVUK, BSB, KJV and ESV
  do not. Revelation 12:18 exists in CCB, CUNP; NIVUK, BSB, KJV and ESV end at 17 (ESV puts its
  words at the end of 17). NIVUK omits Matthew 17:21 (footnote only); CCB has it.

## P0.3 — Slide budget

Measured by laying the text out in headless Chrome at 1920 × 1080 with the renderer's margins
(6 % each side, `SAFE_MARGIN`), line height 1.5, two columns 3 % of the width apart, one small
line kept for each column's credit, and the system font (San Francisco and PingFang SC on
macOS). Text: John 3, Romans 8 and Psalm 103 in NIVUK and CCB. `spikes/bible/measure.sh`
repeats it.

| Text size (of height) | Lines per column | NIVUK weight per line, two columns | CCB weight per line, two columns | Slides for John 3, NIVUK ∥ CCB |
| --- | --- | --- | --- | --- |
| 4.5 % (49 px) | 12 | 32 (prose), 28 (poetry) | 26 (prose), 22 (poetry) | 11 |
| **5 % (54 px)** | **11** | **30, 25** | **23.5, 21** | **14** |
| 5.5 % (59 px) | 10 | 27, 22 | 21, 19 | 16 |
| 6 % (65 px) | 9 | 25, 20 | 20, 18 | 25 |

Weight counts a Chinese character as 2 and a Latin one as 1. Two Chinese characters take
about the width of 2.4 Latin ones, so the weights alone mis-estimate Chinese by about a fifth;
the budget therefore estimates lines per script (30 Latin or 12 Chinese characters per line at
5 %), rather than one weight. Poetry's short lines waste the end of each line, which the
per-line estimate captures.

- [x] **At 5 %**, 11 lines fit per column; John 3 makes 14 slides side by side, Psalm 103 7.
  Single-version slides hold about twice as much (55 Latin, 25 Chinese characters per line).
- [x] **Spare line:** the budget packs to 10, so a misjudged wrap or a slightly wider font only
  makes the renderer shrink the text a little, never below the 4 % floor.
- [x] **Windows** (9 November 2026, Windows 11, headless Edge, which is WebView2's engine;
  Segoe UI and Microsoft YaHei), with the same NIVUK and CCB chapters from YouVersion: the
  spare line absorbs the difference, and no slide needs the text smaller than 5 %. At 5 % in
  two columns, Chinese fits as on macOS (23.2–23.6 weight per line for prose, 20.8 for poetry,
  against 23.5 and 21); English fits about an eighth less (25.3–26.5 for prose and 20.5 for
  poetry, against 30 and 25), Segoe UI being wider than San Francisco. Packing John 3,
  Romans 8 and Psalm 103 with P1.7's budget (10 estimated lines, 30 Latin or 12 Chinese
  characters per line side by side, 55 and 25 alone; rows paired in verse order) and measuring
  every slide: 102 slides, side by side and in each version alone, all fit at 5 %. The fullest
  side-by-side slides take exactly the 11 lines that fit, so on Windows the spare line is used
  up there and the budget should not be loosened.
- [x] **Windows at 6 %** (after passages moved to 6 %, with the budget of 8 estimated lines,
  25 Latin or 10 Chinese characters per line side by side, 46 and 21 alone), measured the same
  way: 150 slides; all but one are drawn at 6 %, the fullest taking exactly the 9 lines that
  fit. One side-by-side slide of Psalm 103 needs 10 lines, English poetry's short lines each
  wrapping on their own, and is drawn at 5.7 %, well above the 4 % floor. Accepted rather than
  tightening the budget, which would add slides on both systems for a barely visible
  difference.

## P0.4 — Provider limits

| Provider | Limit | Signalled | Caching hints | Index changes |
| --- | --- | --- | --- | --- |
| YouVersion | Not documented on the pages read | No rate-limit headers | `cache-control: public, max-age=3600` | No version field or ETag on a Bible or its index; refresh weekly and compare a hash |
| API.Bible (Starter) | **5,000 calls a month**, resetting monthly; no overage on Starter | No rate-limit headers seen | Docs recommend caching metadata (books, chapters, verse lists); cached Scripture refreshed within 30 days (discovery §4) | — |
| ESV | 5,000 a day, 1,000 an hour, 60 a minute (discovery §4) | Throttling | `ETag` on responses; ≤ 500 verses stored | — |
| Free Use Bible API | Not published | — | `cache-control: max-age=86400`, `ETag`, `last-modified` (static files on S3) | ETag per file |

- [x] **API.Bible's monthly cap shapes P2.4:** a table of contents from verse lists would use a
  quarter of the month for one version. Books and chapters cost one call; verses are fetched
  per chapter on first use and kept (metadata, as its docs recommend). A busy month, with every
  passage previewed and presented through API.Bible, stays well under the cap.
- [x] **YouVersion's index** has no change signal; the server refreshes it weekly and keeps the
  old one when nothing changed.
- [ ] **YouVersion's rate limits** are not published; to ask YouVersion support before release.
  The server's short memory cache and the desktops' saved contents keep calls low meanwhile.

## Checked afterwards: anything missed?

Reviewed against the task breakdown on 9 November 2026. No further spike is needed; three
points are settled by what is already known:

- **Tables of contents for desktops and phones:** YouVersion's index lists all 31,000 verses
  by name: 1.6 MB as JSON, 196 KB as it arrives (gzip); asking for fewer fields does not shrink
  it. Only the church server fetches it, once per version and then weekly. The server keeps and
  serves a compact form instead: books with their names and abbreviations and a verse count per
  chapter, plus the joined and missing verses as exceptions. NIVUK's is 7.3 KB (2.4 KB
  compressed) and CCB's 7.4 KB. P1.4 uses this compact form.
- **Verse counts without a full table of contents:** for versions served only by API.Bible
  (NKJV, NLT) or ESV, a chapter's verses are fetched when the chapter is first opened and kept:
  API.Bible's verse list, or ESV's `passage_meta.chapter_end`. This replaces the built-in
  English versification table P2.4 planned for ESV; versions differ (3 John has 14 verses in
  KJV, 15 in NIV and ESV), so one table would be wrong for some. Book names for ESV come from
  P1.1's English table.
- **Text search and API.Bible's monthly cap:** search runs only when the input is not a
  reference, after a pause in typing (§3.4), and through YouVersion first; API.Bible is used
  only for a version no other provider searches.

## Effect on the plan and the task breakdown

- **B20** gains: API.Bible's and ESV's verses are fetched per chapter on first use and kept,
  never all at once and never from a built-in table; tables of contents travel in the compact
  form above (P1.4, P2.4).
- **B25** becomes: the server reports every API.Bible passage it serves, with the `dId` and
  `sId` above (P2.8); the item stores its token (B23) and the coordinator asks the server to
  report it again on first presentation in each live session (P6.5).
- **P1.7 and P6.3** take the budget above: 5 % target, 4 % floor, 10 estimated lines per
  column, 30 Latin or 12 Chinese characters per line in two columns.
