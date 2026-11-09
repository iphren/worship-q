# Worship Q — Bible Passages Task Breakdown

**Drafted:** 9 November 2026
**Status:** Agreed 9 November 2026, with the plan's B17–B26. P0 done: see the
[spike results](spikes/bible.md), whose recorded responses are P2.2's fixtures. P1–P8.4 done
and accepted on the `bible-passages` branch; release (P8.5) follows merging. See the
[acceptance record](acceptance/bible-passages.md).
**Source:** [Bible Passages Plan](bible-passages-plan.md), referred to here as "the plan", the
[Bible Passages Discovery](bible-passages-discovery.md) and the
[Bible APIs — Technical Discovery](bible-apis-technical-discovery.md), and the code at version
2.1.0. Decisions (B1–B26) are the plan's.

## 1. How to read this

The plan says what the feature delivers and why. This document breaks it into tasks small
enough to be one pull request, says where in the repository each lands, and names the tests
that prove it. Task identifiers are `P<milestone>.<n>`; a task lists the tasks it needs first.
Sizes are S, M and L as in the phase plans.

Every task that changes business logic carries unit tests in its package. §3 lists the
business rules and edge cases those tests must cover; a task's Tests column names the main
cases, and §3 is the full list a pull request is checked against. Every server route carries a
test in `apps/server/src`, and every protocol change a case in `apps/server/src/versions.test.ts`.
Provider adapters are tested against recorded responses, never the live APIs, so the tests
need no keys. The desktop and phone interfaces have no automated tests; the P8 walkthrough
covers them.

### Where things live today

| Concern | Location |
| --- | --- |
| Record schemas: songs with `deck`, `website`, `video`; `libraryTypeOf`; run sheet items (`songId`); live state and commands | `packages/protocol/src/records.ts` |
| Protocol version (5, minimum 2), capabilities (`videos`), church settings, sync kinds, snapshot item kinds (`lyrics`, `deck`, `website`, `video`), remote commands (`addItem.afterItemId`), phone `search` | `packages/protocol/src/wire.ts` |
| Pieces of a song (`songPieces`, `songKind`, `snapshotPieces`), adding at a place (`addSong(date, songId, afterItemId)`), applying phone commands | `packages/session/src/index.ts` |
| Live state reducer | `packages/live-state/src/index.ts` |
| Frame building for browser outputs; slide drawing and text fitting | `packages/renderer/src/frame.ts`, `Slide.tsx`, `layout.ts` |
| Library search (folding, readings) | `packages/search/src/index.ts`, `readings.ts` |
| Local database, migrations, workspace and church settings (`setting` table, `getPresentationSettings`) | `packages/store/src/store.ts`, `migrations.ts` |
| Server routes, `/api/v1/info`, device authentication | `apps/server/src/app.ts` |
| Server configuration from the environment | `apps/server/src/main.ts` |
| Church settings, admin routes | `apps/server/src/instance.ts`, `admin.ts` |
| Admin app pages (Settings, Library) | `apps/admin/src/pages/` |
| Desktop's calls to the server | `apps/desktop/src/app/cloud.ts` |
| Present page (song search, run sheet column), calendar's run sheet editor, item menu | `apps/desktop/src/pages/PresentPage.tsx`, `CalendarPage.tsx`, `components/RunSheetEditor.tsx`, `Menu.tsx` |
| Workspace settings page | `apps/desktop/src/pages/SettingsPage.tsx` |
| Item badges | `packages/ui/src/ItemBadge.tsx`, `apps/desktop/src/components/DeckBadge.tsx` |
| Slideshow window, browser output pages | `apps/desktop/src/output/OutputApp.tsx`, `apps/output/src/` |
| Phone remote: host and page | `packages/remote/src/index.ts`, `apps/remote/src/RemoteApp.tsx` |
| Interface strings | `apps/desktop/src/i18n/en.ts` |

### Five facts that shape the tasks

- **A run sheet item can only name a song.** Media items are songs with a `deck` or `video`.
  A passage follows the same path: a song with a `passage` field, so run sheets, live state,
  pieces, snapshots and synchronization carry it unchanged. It must then be kept out of the
  library, its search and the Church Library (P3.2).
- **Phones add items by song.** `addItem` names an existing song, and phones cannot create
  songs. A phone's passage therefore travels as a new command carrying the passage, and the
  coordinator creates the song and the item (P7.2).
- **Pieces are decided once, for every screen.** The snapshot carries pieces, and every
  output and phone shows the same ones. Splitting a passage cannot measure a screen; it uses a
  text budget (B24), and each output then sizes the text, as for lyrics.
- **Older desktops read records with schemas.** They drop a `passage` field when they save the
  song, and do not know a `passage` snapshot kind. Protocol 6 and a `passages` capability
  follow the video precedent (U20, U21).
- **The providers disagree** on reference syntax, ranges, verse numbering and formats
  (technical discovery §2–§5). Everything provider-specific stays on the server, behind one
  normalised shape (B22); the desktop knows only Worship Q's versions.

## 2. Tasks by milestone

### P0 — Spikes (S)

Throwaway code on the `bible-spikes` branch, not merged. Done: [results](spikes/bible.md).

| # | Task | Where | Done when |
| --- | --- | --- | --- |
| P0.1 | FUMS from a server and a desktop: the reporting call (`fums.api.bible`), its parameters (token, device and session identifiers), whether one call per presented passage is what API.Bible expects for a slideshow and an OBS overlay; ask API.Bible if unclear | spike notes | B25's reporting mechanism chosen |
| P0.2 | Normalising text: for John 3:16–18, Psalm 23, 1 Chronicles 16:11–14 and Revelation 12:17–18, the HTML or JSON of YouVersion, API.Bible, ESV and the Free Use Bible API turned into verse units with poetry lines and joined verses; footnotes, headings and cross-references removed; record the fixtures for P2 tests | spike notes, fixtures | One normalised shape that every provider fills; fixtures recorded |
| P0.3 | Slide budget: two columns at the default scale on 16:9; how many Latin and Chinese characters fit per column at a readable size; the weight of a wide character | spike notes | B24's budget numbers chosen |
| P0.4 | Provider limits: YouVersion's rate limits and how a revised version's index is signalled (a version field, ETag); API.Bible's daily limit on Starter; recorded per provider | spike notes | Server cache and refresh rules (P2.4, P2.5) fixed |

### P1 — Bible package (M)

A new pure package, `packages/bible`, used by the server, the desktop and the phone.

| # | Task | Where | Needs | Tests | Done when |
| --- | --- | --- | --- | --- | --- |
| P1.1 | Books: the 66 USFM codes in order, with testament and group (Law, History, Poetry, Prophets, Gospels, Acts, Letters, Revelation) and a built-in alias table in English (names, common abbreviations: `Mark`, `Mar`, `Mk`, `1 Cor`, `1Co`, `Ps`, `Psa`, `Song`) and Chinese (simplified and traditional names and one-character abbreviations: `马可福音`, `可`, `約翰福音`, `約`) | new `packages/bible/src/books.ts` | — | Unit: every alias resolves to one book; no alias is shared by two books | One book list for everything |
| P1.2 | References: `Reference` (book, start chapter and verse, end chapter and verse, or a whole chapter), `formatReference(reference, language)` (`Mark 15:5–6`, `马可福音 15:5-6`), USFM conversion | `packages/bible/src/reference.ts` | P1.1 | Unit: formatting in both languages; one verse; whole chapter; across chapters | References stored as USFM (B23) |
| P1.3 | Parser (B21): `parseReference(input, names)` gives a complete reference, a partial one (book only; book and chapter), several candidate books for an ambiguous prefix, or nothing; accepts `:`, `.`, space and `-`, `–`, `—`, `~`; Chinese `章` and `节`/`節`; book names glued to numbers (`可15:5`, `mk15.5`); full-width digits and colons; extra names from tables of contents | `packages/bible/src/parse.ts` | P1.1, P1.2 | Unit: every case in §3.1 | One parser for the window and the song search |
| P1.4 | Tables of contents: `Toc` in the compact form of B20 (books with the version's names and abbreviations, a verse count per chapter, joined and missing verses as exceptions; chapters of API.Bible and ESV versions may be not yet known), `validate(reference, toc)` (exists, clamps nothing, says what is missing), `chapterVerses`, `nextChapter` | `packages/bible/src/toc.ts` | P1.2 | Unit: Psalm 151 refused; 3 John 15 valid in NIV, not in KJV; a range ending past the chapter refused | References checked against the chosen version (B20) |
| P1.5 | Passage shape (B22, B23): `PassageText` (version, provider, copyright, units: label, verse numbers, lines with indent, an optional psalm title, and API.Bible's usage token when there is one) and `Passage` (reference, up to two `PassageText`) as zod schemas, exported for records and the wire | `packages/bible/src/passage.ts`, re-exported by `packages/protocol` | P1.2 | Unit: schema round trips; more than two versions refused | One shape on the server, in records and on phones |
| P1.6 | Aligning two versions (B13, B14, B16): `align(passage)` gives rows of verse numbers with each version's unit; a joined unit cut by the range is widened to the whole unit in that version only; a verse missing in one version leaves that cell empty; the warnings list (`joined`, `missing`) for the operator | `packages/bible/src/align.ts` | P1.5 | Unit: every case in §3.2 | Side by side without "not found" |
| P1.7 | Splitting into slides (B10, B24): `passagePieces(aligned, budget)` gives pieces of whole rows within B24's budget (10 estimated lines per column; 30 Latin or 12 Chinese characters per line side by side, 55 and 25 for one version), never breaking a joined unit; a single row over the budget is a piece of its own; piece ids stable from the verse numbers | `packages/bible/src/pieces.ts` | P0.3, P1.6 | Unit: every case in §3.3 | Same slides on every screen |
| P1.8 | Catalogue (B18): Worship Q's versions (id, edition name, short credit, language, script) with their providers in fallback order and each provider's identifier, starting with the first church's versions (NIVUK, NKJV, NLT, ESV, KJV, BSB, CUNP simplified and traditional, CCB, CSB, and their verified provider ids from discovery §10) | `packages/bible/src/catalogue.ts` | — | Unit: ids unique; every provider entry names a known provider; no version lists one provider twice | Fallback stays within one edition |

**Milestone done:** in a unit test, `马可福音15章5-6节`, `Mar 15:5-6` and `mk15.5-6` parse to the
same reference, and NIVUK and CCB for 1 Chronicles 16:12 align with CCB widened to 12–13 and a
warning.

### P2 — Server: providers, catalogue and routes (L)

| # | Task | Where | Needs | Tests | Done when |
| --- | --- | --- | --- | --- | --- |
| P2.1 | Keys (B17): `WORSHIP_Q_YOUVERSION_KEY`, `WORSHIP_Q_API_BIBLE_KEY`, `WORSHIP_Q_ESV_KEY` read at start; never logged, never sent to a device or the admin app (the admin app sees only which are set) | `main.ts`, new `apps/server/src/bible/config.ts` | — | Unit: missing keys disable their providers; the info and admin answers contain no key | Keys stay on the server |
| P2.2 | Provider adapters: YouVersion, API.Bible, ESV and Free Use Bible API, each with `toc(id)` and `passage(id, reference)` returning the normalised shape; YouVersion splits ranges at chapter boundaries and joins them; ESV's passage parsed from its HTML with the canonical reference checked against the request (never clamped); API.Bible's copyright line and `fumsToken` kept; Free Use slices chapters | new `apps/server/src/bible/providers/*.ts` | P0.2, P1.5 | Against P0.2's recorded fixtures: every provider gives the same units for John 3:16–18; joined verses; poetry lines; a cross-chapter range; Psalm 151 refused, not clamped; a 401 or 403 marks the provider unusable for that version | One shape from four APIs |
| P2.3 | Availability (B18): at start and daily, each catalogue version is checked with its providers in order (one small request each); the result says which versions are available and through which provider | new `apps/server/src/bible/catalogue.ts` | P1.8, P2.2 | Unit with fake providers: first working provider chosen; a version with none is unavailable; a later recovery is noticed | The server knows what it can offer |
| P2.4 | Tables of contents (B20): kept in the compact form (B20): from YouVersion's index where it serves the version (one call, 196 KB compressed, refreshed weekly and kept when unchanged); otherwise from the provider's book list (API.Bible, Free Use, P1.1's English names for ESV), with a chapter's verses fetched when it is first opened (API.Bible's verse list, ESV's `passage_meta`, Free Use's chapter) and kept in the server's data folder | `apps/server/src/bible/toc.ts` | P1.4, P2.2, P0.4 | Unit: built and read back; a joined verse kept as one unit; a chapter fetched once and never again | Contents without repeated calls |
| P2.5 | Text and fallback (B22): providers tried in order; an error, a timeout (3 s) or a refused version moves to the next; text kept in memory for a short time only, within every provider's rules, bounded in size; nothing written to disk | `apps/server/src/bible/passages.ts` | P2.2, P2.3, P0.4 | Unit: fallback on failure; never across editions; cache expiry; an over-limit request (ESV's 500 verses) refused with a clear error | One call from a desktop, the best provider answers |
| P2.6 | Routes for devices: `GET /api/v1/bible/versions` (the versions the church offers, each with name, credit, language), `GET /api/v1/bible/:version/toc`, `GET /api/v1/bible/:version/passage?ref=` (USFM), `POST /api/v1/bible/fums` (B25); `ServerInfo.bible` true when at least one version is available | `app.ts`, `wire.ts` | P2.4, P2.5, P3.4 | Route: unauthenticated refused; a version the church does not offer refused; an unknown reference answers 404 with its reason | Desktops can use the Bible |
| P2.7 | Text search for the Bible window when the input is not a reference: `GET /api/v1/bible/:version/search?q=` through the first provider that searches that version (YouVersion, then API.Bible, then ESV); references only, up to 20 | `apps/server/src/bible/search.ts`, `app.ts` | P2.2 | Fixtures: `love your enemies`, `上帝爱世人`; a version with no searching provider answers an empty list with a flag | Words find verses |
| P2.8 | FUMS (B25): GET `https://fums.api.bible/f3` with the tokens (`t`, repeated), `dId` and `sId` (P0.1): for every API.Bible passage served, and for the tokens the coordinator sends (P6.5); batched, retried in the background | `apps/server/src/bible/fums.ts` | P0.1, P2.6 | Unit: a served passage reported once; a resent token reported again; a failure retried, never blocking the answer | Usage reported as API.Bible asks |

**Milestone done:** with `curl` and a device token, the server lists NIVUK and CCB, returns
their tables of contents, and returns 1 Chronicles 16:12–13 in both, with CCB as one joined
unit; with the YouVersion key removed, NIVUK still comes back through API.Bible.

### P3 — Records, settings and protocol (M)

| # | Task | Where | Needs | Tests | Done when |
| --- | --- | --- | --- | --- | --- |
| P3.1 | Passage songs (B23): `SongFieldsSchema.passage`, nullable and null when missing; `lyrics` holds the passage as plain text for older devices; `songKind` gives `passage` | `records.ts`, `packages/session` | P1.5 | Unit: an older song parses with null; a passage song's kind | One schema for all packages |
| P3.2 | Out of the library (B7): `libraryTypeOf` gives null for a passage song, so the Church Library never holds it; the library page, the library search (desktop and phone) and the admin app's Library leave passage songs out; the retention sweep keeps a passage song while a run sheet uses it | `records.ts`, `SongsPage.tsx`, `packages/search`, `packages/remote`, `instance.ts`, `retention.ts`, `apps/admin/src/pages/Library.tsx` | P3.1 | Unit: a passage song never in search results or library lists; `admin.test.ts`: not listed | Passages live only in run sheets |
| P3.3 | Store: `passage` column on `song` and `song_revision`; read, write, apply from remote | `migrations.ts`, `store.ts`, `sync.ts` | P3.1 | `store.test.ts`: round trip | Passage items synchronize |
| P3.4 | Settings (B4, B19): church setting `bibleVersions` (offered versions); workspace setting `bibleVersions` (up to two, ordered, from the offered ones); a workspace's choice no longer offered is shown greyed with a note | `wire.ts` (`ChurchSettingsSchema`), `records.ts`, `store.ts`, `admin.ts` | P1.8 | Unit: more than two refused; an unknown or no-longer-offered version left out of the effective setting | One setting per workspace |
| P3.5 | Protocol 6: `PROTOCOL_VERSION` 6, minimum 2; capability `passages`; snapshot kind `passage` (pieces carry each version's lines for phones); on a push from a device below 6, a song without `passage` keeps the stored one; devices without the capability are sent a passage item as lyrics from `lyrics` | `wire.ts`, `instance.ts`, `packages/session` | P3.1 | `versions.test.ts`: a version 5 device's edit keeps the passage; a version 5 follower gets lyrics; version 2–5 hellos still accepted | Older desktops cannot lose a passage |

**Milestone done:** a passage song made in a test synchronizes between two stores, never shows
in library search, and survives an edit from a version 5 device.

### P4 — Desktop: the Bible window (L)

| # | Task | Where | Needs | Tests | Done when |
| --- | --- | --- | --- | --- | --- |
| P4.1 | Bible client: `bibleVersions()`, `toc(version)`, `passage(version, reference)`, `search(version, q)`; tables of contents saved on this computer per version and refreshed when the server's changes; the workspace's two versions read from settings | `cloud.ts`, new `apps/desktop/src/app/bible.ts` | P2.6, P3.4 | Unit with a fake server: contents read from disk without a request; refreshed on change; offline gives the saved contents and a clear error for text | Grids need no network |
| P4.2 | Window state (B2, B3): one pure state for input text, breadcrumb, grid level, selected range and preview; typing updates the grids, clicking updates the text; first then last verse makes a range, the same verse twice one verse; "continue into chapter n+1"; text search used only when the input is not a reference | new `apps/desktop/src/app/bibleWindow.ts` | P1.3, P1.4, P4.1 | Unit: every case in §3.4 | Typing and browsing are one control |
| P4.3 | The window: search box, version chips (B4), breadcrumb, book grid (testaments and groups, in the first version's language), chapter grid, verse grid with range highlight, side-by-side preview with verse numbers and credits, operator warnings (B16), **Add to run sheet** and **Present ▶** (Present tab only, Enter); keyboard use throughout | new `components/BibleWindow.tsx`, `en.ts` | P4.2, P1.6 | Manual | The plan's window |
| P4.4 | Version chips (B4, B5): add from the offered versions, remove, reorder, at most two; saved as the workspace setting; the same setting in the workspace's settings page | `BibleWindow.tsx`, `SettingsPage.tsx` | P3.4, P4.3 | Unit: the setting's update; manual for the chips | Versions shared by the workspace |
| P4.5 | Entry points (B1, B8): a **Bible** button beside the song search on the Present page and in the calendar's run sheet editor; disabled with the reason when the church offers no Bible or is not connected | `PresentPage.tsx`, `RunSheetEditor.tsx` | P4.3 | Manual | Opened from both places |
| P4.6 | Song search recognises references (B9): local parsing only; a matching row **📖 Mark 15:5 — open in Bible** above the songs, which opens the window at that reference; songs still listed | `RunSheetEditor.tsx`, `packages/bible` | P1.3, P4.5 | Unit: a reference row for `Mark 15:5` and `可15:5`; none for `Amazing grace`; a song titled like a reference still listed | No API call while typing |

**Milestone done:** in the calendar, `马可福音15章5-6节` typed into the song search opens the
window on Mark 15:5–6 with NIVUK and CCB side by side, and **Add to run sheet** adds it.

### P5 — Desktop: passage items (M)

| # | Task | Where | Needs | Tests | Done when |
| --- | --- | --- | --- | --- | --- |
| P5.1 | Adding (B6, B7): `Session.addPassage(date, passage, { afterItemId, present })` creates the passage song and its item; on the Present tab it goes after the item being presented, or at the end when none is (B6), and **Present** presents its first piece; from a follower it is sent to the coordinator (P7.2's command) | `packages/session` | P3.1, P3.3 | Unit: placed after the presented item on the coordinator and from a follower; at the end when nothing is presented; Present shows its first piece; Add does not change the screen | Present and Add work |
| P5.2 | Editing (B11): **Edit…** in the item menu and the item's edit button open the Bible window on the item's reference and versions; saving makes the song's next revision in place; the menu has no Download original or Upload new version for passages | `RunSheetEditor.tsx`, `Menu.tsx`, `BibleWindow.tsx` | P4.3, P5.1 | Unit for the menu's actions by kind | Everything can change, the place stays |
| P5.3 | In the run sheet: a **Bible** badge, the reference as the title, and the operator warnings (B16) on the item | `ItemBadge.tsx`, `DeckBadge.tsx`, `RunSheetEditor.tsx`, `PresentPage.tsx` | P1.6 | `DeckBadge.test.ts`: the passage badge | Operators can explain the screen |

### P6 — Presenting (M)

| # | Task | Where | Needs | Tests | Done when |
| --- | --- | --- | --- | --- | --- |
| P6.1 | Pieces: `songPieces` and `snapshotPieces` use `passagePieces` for a passage song; each piece carries both columns' lines and verse labels | `packages/session` | P1.7, P3.1 | Unit: piece ids stable when the passage is unchanged; the same pieces from a snapshot and from the database | Same slides everywhere |
| P6.2 | Frames: `OutputFrame.passage` (columns with verse labels, lines and credits); the slideshow draws it; **the subtitle overlay draws nothing** (B12) | `wire.ts`, `frame.ts`, desktop session frame | P6.1 | `frame.test.ts`: a passage on the slideshow; nothing on the subtitle overlay; blank hides it | B12 |
| P6.3 | Drawing: two columns in chip order, verse numbers small and raised, each column's credit at its foot, text sized to fit both columns with one size, aiming at 5 % of the height, never below 4 % (B24) (`fitPassage` beside `fitSong`), the song background rules as for lyrics | `Slide.tsx`, `layout.ts` | P6.2, P0.3 | `layout.test.ts`: one size for both columns; a long column decides it | The plan's slide |
| P6.4 | Browser outputs: the output pages draw passages from the snapshot | `apps/output` | P6.2 | Manual | Every screen |
| P6.5 | FUMS (B25): when a passage piece with API.Bible text is first presented in a live session, the coordinator posts the item's stored tokens (B23) to the server, once per item per session | `packages/session`, `cloud.ts` | P2.8, P6.1 | Unit: one report per item per session; none for other providers | Usage reported |

**Milestone done:** Mark 15:5–6 in NIVUK and CCB is presented from the Bible window, appears
after the current song, shows side by side on the slideshow and the browser slideshow, and the
subtitle overlay stays empty.

### P7 — Phone remote (M)

| # | Task | Where | Needs | Tests | Done when |
| --- | --- | --- | --- | --- | --- |
| P7.1 | Bible through the host (B26): phone messages `bibleToc`, `biblePassage` and `bibleSearch`, answered by the desktop it is connected to from its saved contents and its server; the workspace's versions included in the answer | `wire.ts`, `packages/remote` | P4.1 | `remote` unit: each request answered; an unknown version refused | Phones can browse and preview |
| P7.2 | Adding and presenting (B15): remote command `addPassage` (passage, `afterItemId`, `present`), applied by the coordinator through P5.1; never an edit of an existing passage | `wire.ts`, `packages/session`, `packages/relay` | P5.1, P3.5 | Unit: a phone's passage lands after the presented item; `relay.test.ts`: forwarded; refused below protocol 6 | Phones add and present passages |
| P7.3 | The phone's Bible screen: search box, chips, grids, range, side-by-side preview, warnings, **Add** and **Present**; a passage item on the phone shows no Edit | `apps/remote/src/RemoteApp.tsx` | P7.1, P7.2 | Manual | Everything except editing (B15) |

### P8 — Acceptance (S)

| # | Task | Where | Needs | Done when |
| --- | --- | --- | --- | --- |
| P8.1 | Walkthrough on macOS and Windows with a coordinator, a follower and a phone: a passage typed, browsed, searched by words and reached from the song search; Present during a live service and Add in the calendar; editing an item to another version; joined and missing verses with their warnings; one provider's key removed (fallback); the server unreachable (saved items still present); an older desktop next to passage items; the §3.6 checks | `docs/acceptance/bible-passages.md` | P1–P7 | Every scenario passes or has a recorded, accepted exception |
| P8.2 | Deployment guide: the three key variables, where to get each key, that keys belong to the church (discovery §4), and the admin app's offered versions | `docs/server-deployment.md` | P2.1, P3.4 | Reviewed |
| P8.3 | Volunteer guide: finding and presenting a passage, versions, warnings | `docs/volunteer-guide.md` | P4–P7 | Reviewed by a volunteer |
| P8.4 | Spec write-back: Bible passages in the requirements and the scope table | `docs/worship-q-requirements-and-architecture.md` | P8.1 | Spec matches the release |
| P8.5 | Release by release-please | — | P8.1 | Released |

## 3. Business rules and edge cases to test

### 3.1 Parsing references (P1.3, P4.6)

- English: `Mark 15:5-6`, `Mar 15:5-6`, `Mk 15:5-6`, `mark 15 5-6`, `Mark 15.5-6`,
  `mk15.5-6`, `Mark 15:5–6` (en dash), `Mark 15:5 - 6`, `Mark 15` (chapter), `Mark` (book
  only), `Ps 23`, `Psalm 23:1-6`, `1 Cor 13:4-7`, `1Co 13:4-7`, `I Corinthians 13`,
  `Song of Songs 2:4`, `Gen 1:31-2:3` (across chapters).
- Chinese: `马可福音15:5-6`, `可15:5-6`, `马可福音 15 章 5-6 节`, `馬可福音15章5至6節`,
  `約3:16`, full-width `：` and digits (`可１５：５`).
- Ambiguous and partial: `Jo` lists Job, Joel, John, Jonah, Joshua (and 1–3 John only after
  a number); `John 3` is a chapter, `1 John 3` another book; `Phil` is Philippians, `Phm`
  Philemon.
- Not references: `Amazing grace`, `10000 reasons`, `Psalm` alone in a song title search still
  lists songs; a number alone is nothing.
- Order kept: a range written backwards (`Mark 15:6-5`) is refused, not reversed.

### 3.2 Aligning versions (P1.6, B13, B14, B16)

- Same numbering: rows one to one, no warnings.
- Joined in one version (CCB 1 Chronicles 16:12–13): a range starting at 13 shows CCB's whole
  12–13 and NIVUK's 13 only, with the `joined` warning; a range 12–13 needs no widening but
  still warns.
- Missing in one version (Revelation 12:18 in CCB, not NIVUK): NIVUK's cell empty, `missing`
  warning naming NIVUK.
- A verse omitted by a version (Matthew 17:21 where a version omits it): the cell is empty,
  warned, never "not found".
- One version only: no alignment, warnings only for that version's joined verses.

### 3.3 Slides (P1.7, P6.1, B10, B24)

- Short passage: one piece.
- Long passage: pieces of whole rows; no row split; a joined unit never split.
- One row over the budget (a long verse in Chinese and English): its own piece.
- The longer column decides where a piece ends.
- Wide characters count double; mixed text counts each character by its width.
- Piece ids stay the same when the passage is saved again unchanged, so the live slide is kept.

### 3.4 The Bible window (P4.2)

- Typing a book shows chapters; typing a chapter shows verses with nothing selected.
- Clicking a verse then another selects the range, in either order; the same verse twice
  selects one verse; a third click starts again.
- The breadcrumb's book or chapter goes back to that grid and keeps the input in step.
- A reference not in the version (Psalm 151) says so in the window and offers the nearest
  chapter; nothing is presented.
- Text search runs only when the input is not a reference, after a pause in typing.
- Changing a chip changes the workspace setting for every computer of the workspace.

### 3.5 Server (P2)

- No keys: the Bible is offered only through the Free Use Bible API's versions, if the
  administrator offers them.
- A provider answering 401 or 403 is marked unusable for that version until the daily check.
- Fallback never moves to a provider of another edition.
- The memory cache never holds more than a provider allows (ESV ≤ 500 verses).
- Devices never receive a key, in any answer or error.

### 3.6 Checks for the walkthrough (manual)

- A passage presented while a song is live lands right after the song.
- With nothing presented, Present adds at the end.
- The subtitle overlay stays empty while a passage is live; switching OBS to the slides scene
  shows it on the stream.
- The operator sees the joined and missing verse warnings; the audience never does.
- A passage item from last month still presents with the internet unplugged.

## 4. Order and dependencies

| Work | Tasks | When |
| --- | --- | --- |
| Spikes | P0 | First; P0.2 and P0.3 decide the shapes and the slide budget |
| Bible package | P1 | P1.1–P1.5 and P1.8 on day one; P1.7 after P0.3 |
| Server | P2 | After P0.2 and P1.5 |
| Records and protocol | P3 | After P1.5; P3.4 can start on day one |
| Bible window | P4 | After P2.6 and P3.4 |
| Passage items and presenting | P5, P6 | After P3 and P4.3 |
| Phone | P7 | After P5.1 |
| Acceptance | P8 | After everything |

P1–P6 make a release on their own; the phone's Bible screen (P7) can follow in the next.

Four tasks can begin on day one: the spikes (P0), the book table and parser (P1.1–P1.3), the
catalogue (P1.8) and the settings (P3.4).

## 5. Rollout

The server update comes first. A church sets its keys and chooses the offered versions in the
admin app; until then the desktop's **Bible** button explains that the church offers no Bible.
Desktops below protocol 6 show a passage item as plain lyrics (P3.5) and cannot lose it, so
churches can update desktops at their own pace; the Bible window appears only on updated
desktops connected to an updated server.

## 6. Risks tied to tasks

| Risk | Task | Mitigation |
| --- | --- | --- |
| A provider changes its format or IDs | P2.2 | Adapters tested on recorded fixtures; fallback to the next provider; the daily check notices |
| A provider withdraws a version or a key is revoked | P2.3, P2.5 | Fallback; saved run sheet items keep their text (B23) |
| The venue loses internet during a service | P4.1, P5.1 | Saved items present offline; the window says new passages need a connection |
| Providers' verse numbering surprises the speaker | P1.6, P5.3 | Lenient alignment and operator warnings (B13, B14, B16) |
| Rate limits during a busy service | P2.5, P0.4 | Short memory cache; contents saved on desktops; one fetch per preview |
| FUMS rules do not fit a slideshow | P0.1, P2.8 | Asked of API.Bible before P2.8; reporting is server-side and can change without a desktop update |
| A song search that looks like a reference hides songs | P4.6 | The reference row is added above songs, never instead of them |
| CUNP's rights are disputed (discovery §10) | P1.8 | Listed in the catalogue only through providers the church chooses; the admin decides whether to offer it |
