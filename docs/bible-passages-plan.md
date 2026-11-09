# Worship Q — Bible Passages Plan

**Drafted:** 9 November 2026
**Status:** Agreed with the project owner: the user-facing design (B1–B16) and how the APIs
serve it (B17–B26, §5, confirmed 9 November 2026). Tasks in the
[task breakdown](bible-passages-task-breakdown.md). Nothing is built.
**Source:** [Bible Passages Discovery](bible-passages-discovery.md) (rights, versions, agreed
direction in §9) and [Bible APIs — Technical Discovery](bible-apis-technical-discovery.md)
(how the APIs behave).

## 1. The moment it is designed for

The speaker says *"Mark's gospel, chapter 15, verses 5 to 6"*, and the passage is not in the
run sheet. The operator has a few seconds:

- **An experienced volunteer types it:** `Mark 15:5-6`, `Mar 15:5-6`.
- **An inexperienced volunteer browses:** a list of books, then chapters, then verses.
- **Either way**, the passage goes on screen right after the item being presented, and stays
  in the run sheet afterwards like any other item.

Speakers who have no slides sometimes send their verses in advance; the same window then
adds them while the run sheet is planned in the calendar.

## 2. Features

### The Bible window

One window, opened from a **Bible** button, from a matched reference in the song search
(§2, *Song search recognises references*), and from the run sheet editor in the calendar.
Typing and browsing drive the same control; each fills in the other.

```
┌ Bible ──────────────────────────────────────────────────────────────┐
│ [ Mark 15:5-6                                ]    NIVUK ✓  CUNP ✓  + │
│                                                                     │
│  Mark › 15 › 5–6                                                    │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  1  2  3  4 [5  6] 7  8  9 10 11 12 13 14 15 16 17 18 19 20 … │ │
│  └────────────────────────────────────────────────────────────────┘ │
│  ┌──────────────────────────────┬─────────────────────────────────┐ │
│  │ 5 But Jesus still made no    │ 5 耶稣仍不回答一句话，以致        │ │
│  │   reply, and Pilate was      │   彼拉多觉得希奇。               │ │
│  │   amazed.                    │                                 │ │
│  │ 6 Now it was the custom at   │ 6 每逢这节期，巡抚照众人所要的，   │ │
│  │   the festival …             │   释放一个囚犯给他们。            │ │
│  └──────────────────────────────┴─────────────────────────────────┘ │
│                                  [ Add to run sheet ]  [ Present ▶ ] │
└─────────────────────────────────────────────────────────────────────┘
```

- **Typing a reference.** Tolerant of the forms volunteers use: full names and abbreviations
  (`Mark`, `Mar`, `Mk`), Chinese names and abbreviations (`马可福音`, `可`), separators
  (`15:5-6`, `15 5-6`, `15.5-6`), and Chinese chapter/verse words (`马可福音15章5-6节`).
  The resolved reference and its text appear as the volunteer types, so they can check before
  showing it.
- **Partial input moves the browser on.** `Mark` opens the chapter grid; `Mark 15` opens the
  verse grid with nothing selected. An ambiguous prefix (`Jo`) lists the matching books (Job,
  Joel, John, Jonah, Joshua).
- **Browsing.** Books in Bible order, Old and New Testament apart and grouped (Law, History,
  Poetry, Prophets, Gospels, Letters …), named in the language of the first selected version.
  Then a grid of chapter numbers, then a grid of verse numbers.
- **Choosing a range, like booking a hotel.** Click the first verse, then the last; the
  verses in between are highlighted. Clicking one verse twice chooses that verse alone. A range
  into the next chapter is a small extra step ("continue into chapter 16"), since it is rare.
- **Breadcrumb.** `Mark › 15 › 5–6` shows each step; clicking a step goes back to it.

### Versions

- **Shown, not hidden.** The selected versions are chips beside the search box. **+** adds a
  version from those the church server allows; a chip can be removed or dragged to reorder.
- **A workspace setting.** The selected versions and their order belong to the workspace and
  are shared by all its computers, so every operator gets the same versions without choosing.
  Changing the chips in the Bible window changes the workspace setting; it is also shown in
  the workspace's settings.
- **Up to two versions, side by side.** Each version is a column in the order of the chips,
  on the preview and on the slides; not one version after another.
- **The church server decides what is offered.** It filters the versions its devices may use
  (discovery §9); a workspace selects from that list.

### Adding and presenting

- **Present ▶** (main action, Enter) is only on the Present tab, where something is always
  live, even if it is an empty live state. It adds the passage to the live run sheet **right
  after the item being presented** and presents it at once. When no item is being presented
  (an empty run sheet, or the screen was cleared), it adds the passage at the end of the live
  run sheet.
- **Add to run sheet** adds it in the same place without presenting it, for when the speaker
  announces a passage ahead of reading it.
- **In the calendar**, the window offers **Add to run sheet** only, adding the passage like a
  song is added there.
- **A passage is a run sheet item** in its own right: it appears in the run sheet, is kept
  after the service like any item, and can be moved and removed like one. Its title is the
  reference (`Mark 15:5–6`).

### Editing a passage item

- **Edit opens the Bible window** on the item's reference and versions, from the item's Edit
  button or its **⋯ → Edit…** menu action.
- **Everything can be changed:** book, chapter, verses and versions (for example, moving a
  prepared passage to a newer version). Saving replaces the item's passage in place, keeping
  its position in the run sheet.
- **A passage item keeps its own versions.** Changing the workspace's versions affects new
  passages only; an existing item changes only when it is edited.

### Not on the subtitle overlay

- The subtitle overlay implies the words are being spoken or sung at that moment, which is not
  always true for a passage on screen. **Passages are not shown on the subtitle overlay**; it
  stays empty while a passage item is live.
- To show a passage on the stream, the operator switches OBS to a scene with the slides (with
  the OBS control, where it is set up).

### Phone remote

- The remote can do **everything except edit an existing passage item**: search and browse,
  choose versions, **Present ▶**, **Add to run sheet**, and step through a passage's slides.

### Slides

- **Split automatically**, like lyrics: as many verses per slide as fit, never splitting a
  verse across slides.
- **Versions side by side** on each slide, kept in step: a slide shows the same verses in every
  column, so a slide boundary falls only where it falls in every version.
- **Joined verses, leniently.** When a version joins verses (当代译本 prints 1 Chronicles
  16:12–13 as one) and the chosen range cuts the joined verse in half, that version shows the
  whole joined verse, labelled `12-13`. The other version shows just the verses chosen. A slide
  boundary never falls inside a joined verse.
- **Missing verses are skipped.** When a verse exists in one version only (Revelation 12:18 is
  in 当代译本, not in NIVUK), the other column simply leaves it out. Nothing like "verse not
  found" is ever shown on screen.
- **The operator is told, the audience is not.** When a passage has a joined or missing verse,
  the operator sees a short warning in the Bible window's preview and on the item in the run
  sheet, for example *"当代译本 joins verses 12–13"* or *"NIVUK has no Revelation 12:18"*. If
  the speaker asks why the screen looks different from their Bible, the operator can explain.
  The warning never appears on the slideshow or any output.
- **Verse numbers** shown, and each column carries its version's credit (`NIVUK`, `CUNP`, …),
  as the publishers require (discovery §7).

### Song search recognises references

- The existing song search on the Present page and in the calendar's run sheet editor also
  recognises Bible references, by **local pattern matching only, with no API call**, so typing
  stays instant.
- When the text looks like a reference (`Mark 15:5`, `可15:5`), the results show a row for it,
  for example **📖 Mark 15:5 — open in Bible**. Choosing it opens the Bible window at that
  reference instead of adding anything; the volunteer checks the text there and presents or
  adds it.
- Songs still match as usual, so a song whose title looks like a reference is not lost.

## 3. Decisions

| # | Topic | Decision |
| --- | --- | --- |
| B1 | Entry points | A **Bible** button on the Present page next to song search, the same in the calendar's run sheet editor, and a reference typed into either song search |
| B2 | One control for typing and browsing | The search box, breadcrumb and grids show the same selection; changing one updates the others |
| B3 | Range selection | First and last verse, as in a date-range picker; one verse by choosing it twice; crossing a chapter is a separate small step |
| B4 | Versions are a workspace setting | Selected versions and their order are shared by the workspace's computers, editable from the Bible window's chips and from settings; not remembered per computer |
| B5 | Multiple versions | At most two, shown side by side as columns, in chip order, on preview and slides |
| B6 | Where Present adds | Present is only on the Present tab. It adds right after the item being presented in the live run sheet, or at the end when none is being presented |
| B7 | Passages live in the run sheet | Every shown passage is a run sheet item, kept after the service; no separate list of recent passages |
| B8 | Calendar | The Bible window is available in the calendar's run sheet editor, for verses sent in advance |
| B9 | Song search | Recognises references by local pattern matching only, never calling an API; a match opens the Bible window rather than adding an item |
| B10 | Slides | Split automatically by whole verses, versions kept in step, verse numbers and version credits shown |
| B11 | Editing an item | Edit (button or **⋯ → Edit…**) opens the Bible window; reference and versions can all change; the item keeps its place. An item keeps its own versions when the workspace setting changes |
| B12 | Subtitle overlay | Passages are never shown on it; it stays empty while a passage is live. The stream shows passages through an OBS scene with the slides |
| B13 | Joined verses | Lenient: a range that cuts a joined verse shows the whole joined verse in that version; slides never break inside one |
| B14 | Verse missing in one version | That column leaves it out; no "not found" text ever reaches the screen |
| B15 | Phone remote | Everything except editing an existing passage item |
| B16 | Operator warnings | Joined or missing verses are explained to the operator (Bible window preview, run sheet item), never on any output |

## 4. Open questions

None on the user-facing design at present; §5 is next.

## 5. Fitting the APIs

Proposed with the [task breakdown](bible-passages-task-breakdown.md) and confirmed by the
project owner on 9 November 2026. They follow the constraints already known: the window must
feel instant; the church holds the keys and Worship Q holds none (discovery §4); run sheet
text is the church's quotation while lookups follow each provider's cache rules (discovery
§9, point 5); credits, FUMS and fallback (discovery §7 and §9); references stored as USFM
and checked against each version's table of contents (technical discovery §5 and §6).

| # | Topic | Decision |
| --- | --- | --- |
| B17 | Who calls the providers | **The church server**, which holds the church's keys (set by the server administrator, like the sign-in settings) and answers desktops; keys never reach a desktop or a phone. The Bible needs a church connection; a desktop with no church server has no Bible in this release |
| B18 | Which versions exist | A **catalogue** in the code: each Worship Q version (for example `NIVUK`, `CUNP-S`) names one edition, its language and its providers in fallback order with their own identifiers. Fallback only ever moves between providers of the same edition. The server marks a version available when one of its providers answers with the church's keys |
| B19 | What a church offers | The administrator chooses the offered versions in the admin app (a church setting); a workspace picks up to two of those (B4) |
| B20 | Table of contents | The server builds each version's table of contents once from its first working provider (books with their names and abbreviations in the version's language, chapters, verses, joined verses) and keeps it; desktops save a copy, so grids and reference matching need no network. ESV's comes from a built-in English versification table, since its API has none |
| B21 | Finding references | Parsed on the computer by a shared package, from a built-in table of English and Chinese book names and abbreviations plus the names in each saved table of contents; the same parser serves the Bible window and the song search |
| B22 | Fetching text | The desktop asks the server for a passage in a version; the server tries the version's providers in order and answers one normalised shape: verse units (a verse, or a joined group with its label), lines kept for poetry, the copyright line, the provider, and its FUMS token. The server keeps fetched text in memory for a short time only, within every provider's cache rules |
| B23 | What a passage item stores | The reference, and per version: the version, the provider used, the copyright line and the verse units shown. Stored with the item and synchronized like any record, so presenting needs no network and an old run sheet still shows what was shown (discovery §9, point 5) |
| B24 | Slides | Split by a fixed text budget per slide (wide characters counting double), not by measuring a screen, so every output and phone has the same slides; the renderer then sizes the text to fit, as it does for lyrics |
| B25 | Usage reporting | When a passage with API.Bible text is first presented, the coordinator asks the server to report its FUMS token, once per item per live session; how the report is made is settled by spike P0.1 |
| B26 | Phones | Use the Bible through the desktop they are connected to, as song search does today; adding or presenting a passage is a new remote command carrying the passage, which the coordinator turns into an item |
