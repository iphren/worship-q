# Bible Passages — Acceptance record

**Date:** 9 November 2026; built on the `bible-passages` branch, walkthrough not yet done
**Source:** [Bible Passages Plan](../bible-passages-plan.md), [task breakdown](../bible-passages-task-breakdown.md) P8.

Three kinds of evidence are kept apart here: automated tests that run in CI (`pnpm test`),
the spikes (P0, `docs/spikes/bible.md`, whose recorded provider answers are the fixtures in
`apps/server/src/bible/fixtures/`), and the walkthrough with real equipment (P8.1). The
desktop and phone interfaces have no automated tests; they are covered by the walkthrough.

## Milestones

| Milestone | Status | Evidence |
| --- | --- | --- |
| P0 spikes | Done | `docs/spikes/bible.md` |
| P1.1 books | Done | `packages/bible/src/bible.test.ts` “books”: 66 in order, every alias to one book, the forms of P1.1, 1,189 chapters |
| P1.2 references | Done | `bible.test.ts` “references”: both languages, one verse, a chapter, across chapters, USFM both ways, bad USFM refused |
| P1.3 parser | Done | `bible.test.ts` “parsing references (§3.1)”: every case of §3.1, half-typed references, names from contents, the song search's stricter rule |
| P1.4 contents | Done | `bible.test.ts` “tables of contents”: Psalm 151 refused, 3 John 15 in NIV not KJV, a range past the chapter, unknown chapters, joined and missing verses in the grid |
| P1.5 passage shape | Done | `bible.test.ts` “the passage shape”: round trip, no token read as none, more than two versions refused |
| P1.6 aligning | Done | `bible.test.ts` “aligning versions (§3.2)”: every case of §3.2, psalm titles, units outside the range, ranges across chapters |
| P1.7 slides | Done | `bible.test.ts` “slides (§3.3)”: every case of §3.3 |
| P1.8 catalogue | Done | `bible.test.ts` “the catalogue” |
| P2.1 keys | Done | `apps/server/src/bible/service.test.ts` “keys”; `apps/server/src/bible.test.ts` “never sends a key to a device”, “tells the admin app which keys are set” |
| P2.2 adapters | Done | `apps/server/src/bible/providers.test.ts` on the recorded answers: the same units for John 3:16–18 from all four providers and the same words within an edition, joined verses, poetry and psalm titles, a range across chapters, Matthew 17:21 and Revelation 12:18, Psalm 151 refused not clamped, 401/403 as refused |
| P2.3 availability | Done | `service.test.ts` “availability” |
| P2.4 contents | Done | `service.test.ts` “tables of contents”: built and read back, a chapter fetched once, a joined verse kept, the weekly refresh |
| P2.5 text and fallback | Done | `service.test.ts` “text and fallback”: fallback within the edition, a refused key, every provider failing, the cache's expiry, the ESV's 500 verses, nothing on disk, over 500 verses refused |
| P2.6 routes | Done | `apps/server/src/bible.test.ts` “the Bible's routes” |
| P2.7 search | Done | `service.test.ts` “text search” |
| P2.8 usage reporting | Done | `service.test.ts` “usage reporting”; `bible.test.ts` “takes a coordinator's stored tokens” |
| P3.1–P3.3 records and store | Done | `packages/protocol/src/index.test.ts` “passage songs”; `packages/store/src/store.test.ts` “passage songs” (round trip, revisions, never in library search, synchronized with its run sheet) |
| P3.2 out of the library | Done | `store.test.ts` as above; `apps/server/src/versions.test.ts` “older desktops and passage songs” (never in the Church Library or the admin app's workspace library) |
| P3.4 settings | Done | `index.test.ts` “the workspace's Bible versions”; `store.test.ts` “the workspace's Bible versions” |
| P3.5 protocol 6 | Done | `versions.test.ts` “older desktops and passage songs”; `relay.test.ts` “passage items through the relay” |
| P4.1 client | Done | `apps/desktop/src/app/bible.test.ts` “the Bible client” |
| P4.2 window state | Done | `bible.test.ts` “the Bible window (§3.4)” |
| P4.3–P4.5 window, chips, entry points | By walkthrough | `BibleWindow.tsx`, `RunSheetEditor.tsx`, `SettingsPage.tsx`; the chips' setting in `store.test.ts` |
| P4.6 song search | Done; by walkthrough | `bible.test.ts` “the song search's reference row”; `packages/bible` “offers references to the song search only for named books” |
| P5.1 adding | Done | `packages/session/src/index.test.ts` “Bible passages” |
| P5.2 editing | Done; by walkthrough | `session` “follows an edit to the passage in place”; `RunSheetEditor.test.ts` (the menu for a passage) |
| P5.3 badge and warnings | Done; by walkthrough | `DeckBadge.test.ts` (the Bible badge) |
| P6.1–P6.2 pieces and frames | Done | `session` “Bible passages”; `packages/renderer/src/frame.test.ts` “passage frames” |
| P6.3 drawing | Done; by walkthrough | `packages/renderer/src/layout.test.ts` “wrapping passage text”, “fitting a passage” |
| P6.4 browser outputs | By walkthrough | `frame.ts` |
| P6.5 usage on presenting | Done | `session` “usage reporting (B25)” |
| P7.1–P7.2 phones | Done | `packages/remote/src/index.test.ts` “the Bible on phones”; `relay.test.ts` (forwarded; refused below protocol 6) |
| P7.3 phone screen | By walkthrough | `apps/remote/src/Bible.tsx` |
| P8.1 walkthrough | To do | Checklist below |
| P8.2 deployment guide | Done | `server-deployment.md` “Bible passages”, the three keys, “Updating for Bible passages”; `apps/server/compose.yaml` |
| P8.3 volunteer guide | Done | `volunteer-guide.md` “Bible passages” |
| P8.4 spec write-back | After the walkthrough | |
| P8.5 release | After the walkthrough | |

## Changes from the plan

- **NLT on API.Bible** has no verified id, so the catalogue names it `abbr:NLT` and the
  server finds its id by abbreviation in the key's list of Bibles, in the one call that checks
  every API.Bible version.
- **Contents refresh:** the versions route says each version's contents hash, so a desktop
  asks for a version's contents only when they changed, with no request otherwise.
- **The second version** is asked for the reference trimmed to its own verses (Revelation
  12:17–18 becomes 12:17 in NIVUK), so its column shows what it has and the missing verse is
  warned of; the first version decides whether the reference exists.
- **A whole chapter** is what is added when a chapter is open with no verse chosen.
- **Text below 4 %:** a slide is drawn at 5 % of the height, shrinking to fit down to 4 %;
  only a slide that cannot fit even at 4 % (one very long verse) goes smaller, so no text is
  cut off.
- **Older desktops** are told apart by a `passages` capability, as videos were, rather than by
  protocol number: the relay sends them passage items as lyrics, refuses a phone's or a
  follower's passage for them, and answers a phone's Bible requests through them as offline.
- **The window's state** lives in `packages/bible` (`bibleWindow`), shared by the desktop's
  window and the phone's screen.
- **Phones** can also read and change the workspace's versions (`bibleVersions`,
  `bibleSetVersions`), as the desktop's chips do.

## Not yet proven against the live providers

The adapters are tested on the spike's recorded passages. These shapes were not recorded and
are read as the providers' documentation describes them, tested on hand-made answers; check
them in the walkthrough with the church's keys:

- YouVersion's `/bibles/{id}/index` (book, chapter and verse ids and titles; how a joined verse
  appears), and `/search-verses`.
- API.Bible's `/bibles`, `/books?include-chapters=true` and `/chapters/{id}/verses`, and
  `/search`.
- The ESV's `passage_meta.chapter_end` for a chapter's last verse, and `/passage/search/`.
- The Free Use Bible API's `books.json`.

## Walkthrough (P8.1)

Equipment: a coordinator desktop, a follower desktop and a phone, on macOS and Windows,
against a server with the church's three keys, offering at least NIVUK and 当代译本.

| Scenario | Result |
| --- | --- |
| The admin app's **Bible versions** lists the versions with their providers; tick NIVUK and 当代译本 | |
| A church default of 当代译本（简） then NIV (UK): a workspace that never chose shows them on its chips, desktop and phone; one that chose keeps its own | |
| The Bible button is disabled with its reason before any version is offered, and on a desktop not connected | |
| Typed: `Mark 15:5-6`, `mk15.5-6`, `马可福音15章5-6节`, `可１５：５`; `Jo` lists five books | |
| Browsed: book, chapter, first and last verse, one verse twice, a third click; **Continue into chapter 16**; the breadcrumb back | |
| Searched by words: `love your enemies`, `上帝爱世人`; a version with no search says so | |
| `马可福音15章5-6节` in the calendar's song search opens the window on Mark 15:5–6 with NIVUK and 当代译本 side by side; **Add to run sheet** adds it at the end (P4 milestone) | |
| During a live service, Present adds the passage right after the song on screen and shows it; with nothing on screen it goes at the end (§3.6) | |
| The slideshow and a browser slideshow show it side by side with verse numbers and credits; the subtitle overlay stays empty; OBS's slides scene shows it on the stream | |
| A long passage (John 3) splits into slides of whole verses; ⇧/⇩ and the phone step through them | |
| 1 Chronicles 16:13–14 with 当代译本: 12–13 shown whole in its column, the note in the window and on the item, never on screen; Revelation 12:17–18 with NIVUK first, then 当代译本 first | |
| Psalm 151 says NIVUK ends at 150 and offers Psalm 150; nothing is presented | |
| **Edit…** on a passage item: change the verses, then the versions; the item keeps its place; the workspace's chips are unchanged | |
| Chips: add, remove, reorder; the follower desktop and **Settings → Bible versions** show the change | |
| The phone: **Add a Bible passage**, browse, preview, Add and Present; its slides show both columns | |
| The phone's library search: `Mark 15:5` and `可15:5` offer **Open … in the Bible** above the songs, which opens the Bible screen there; `Amazing grace` does not | |
| The YouVersion key removed and the server restarted: NIVUK comes through API.Bible | |
| The server unreachable: the window says new passages need a connection; a passage item from last week presents | |
| A version 2.1 desktop beside these items: it shows the passage as lyrics, and renaming the item there keeps the passage | |
| API.Bible usage reported, as API.Bible's dashboard shows, for NKJV passages previewed and presented | |
