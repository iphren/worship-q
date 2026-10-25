# Worship Q — Phase 1 Task Breakdown: Local Desktop App

**Drafted:** 10 October 2026  
**Status:** Draft for review. Scope and decisions below are proposals until confirmed.  
**Source:** [Requirements and Architecture](worship-q-requirements-and-architecture.md), referred to here as "the spec".

## 1. Goal

A volunteer installs the desktop app on a laptop, and with no church instance, account, or network can:

1. enter songs as plain text,
2. build a run sheet for a meeting date,
3. present lyrics on a second screen and navigate freely,
4. fix a lyric during the service and see the screen update,
5. close the laptop and find everything as it was next week.

This is acceptance criterion 30 in the spec, plus the single-device parts of criteria 2, 3, 4, 7, 18, 19, 20, 22, 25 and 31.

## 2. Scope

| In phase 1 | Not in phase 1 |
| --- | --- |
| One local workspace on one desktop | Church instance, admin app, sign-in |
| Songs: create, edit, remove, search | Church Library, overrides, Share with church |
| Calendar, meeting days, dated run sheets | Pairing, QR joining, remote controllers |
| Go live, Edit run sheet, copy Append/Replace | LAN coordination, other devices, viewer mode |
| Live state: start, resume, end, expiry | Cloud relay, synchronization, instance backup |
| Slideshow on a second screen | Subtitle overlay and OBS page (see decision D2) |
| Font family, automatic fit, scale slider, wrapping | Phone and browser clients |
| Image, video, and solid-color backgrounds | Public website, link router |
| Live lyrics editing | Bible passages, slide decks, translation |
| Installers for the supported platforms | |

Viewer mode, the coordinator role, and LAN encryption do not appear in phase 1 because there is only one device. The live-state logic is still written as commands and events (milestone M6) so that later phases add devices without rewriting it.

## 3. Decisions needed before or during phase 1

Each has a recommendation so work can start; the milestone that is blocked without it is noted.

| # | Decision | Recommendation | Blocks |
| --- | --- | --- | --- |
| D1 | Supported desktop platforms | Windows and macOS; Linux later | M0 |
| D2 | Subtitle overlay in phase 1? | No; make it the first follow-up, since it needs a local web server in the native core | Scope |
| D3 | Record identity and revisions | Every record gets an identifier generated on the device and a revision counter, so local data can move into a church instance later | M2 |
| D4 | Lyrics parser edge cases | Leftover lines in a block form a shorter final piece; whitespace-only lines count as blank; several blank lines act as one separator; line endings are normalized; other spacing is kept | M3 |
| D5 | Fitting and wrapping method | Largest size at which every piece of the song fits the safe area, each source line wrapping at most once; below a minimum size, only the offending piece shrinks further | M7 |
| D6 | Live-state expiry and "kept too long" threshold | Expire a few hours after the app closes; show the notification once the live run sheet's date is no longer today | M6 |
| D7 | Song fields beyond lyrics | Title, lyrics, optional author, copyright note, CCLI number (digits) and year (up to next year). Author is one line combining writers, with roles labelled only when they differ (`词：A`, `曲：B`, `译：C`, or `Words: A; Music: B`), names separated by `, ` | M2 |
| D8 | App interface languages | Build with translatable text from the start; ship English first | M1 |
| D9 | Background file types | JPEG and PNG images; MP4 (H.264) video, looped and muted | M8 |
| D10 | Code signing and automatic updates | Ship automatic updates (Tauri updater, signed with its own key); defer OS code signing to save cost, with install steps for the first-run security warning on the download page | M10 |
| D11 | Open-source license | MIT (`LICENSE` at the repository root) | M10 |
| D12 | Where live-state logic lives | A shared TypeScript package run by the app's interface, with the Rust core limited to windows, files, and the database | M6 |
| D13 | Song search | Every word of the search must match the title or lyrics. Traditional and Simplified match each other, as do 祢/你 and 祂/他; spaces and punctuation are ignored. Chinese text also matches by sound (homophones on purpose), and any search matches by toneless pinyin or pinyin initials (`yhh` → 耶和华). Readings of 多音字 come from our worship-phrase list, then the dictionary's context, then our single-character defaults. Keys are derived per device and rebuilt when the search version changes | M2 |

## 4. Milestones

Sizes are relative (S, M, L), not time estimates. Each milestone ends in something that can be demonstrated.

### M0 — Technical spike (S)

Throwaway code to confirm Tauri 2 before committing to it; the spec leaves this pending validation.

- Open a borderless full-screen window on a chosen monitor, on each platform in D1.
- Play a looping, muted video background behind text in the system webview.
- List installed font families and render text in one.
- Measure text accurately enough to fit a block into an area.
- Read and write a SQLite database from the native core.
- Detect a monitor being unplugged and plugged back in.

**Done when:** each item works on every D1 platform, or the gaps are written down and the choice between Tauri and Electron is made.

### M1 — Repository and app foundation (S)

- Set up the monorepo with `apps/desktop`, `packages/protocol`, `packages/renderer`, and packages for lyrics and live state.
- Scaffold the desktop app: Tauri 2, React, TypeScript, Vite, Tailwind.
- Add linting, formatting, unit-test runner, and a CI build for each D1 platform.
- Add the translation mechanism for interface text (D8).
- App shell: main window, navigation between Songs, Calendar, Present, and Settings.

**Done when:** CI produces a runnable build on every D1 platform showing the empty shell.

### M2 — Local data layer (M)

- SQLite schema and migrations for workspace, song, song revision, run sheet, run-sheet item, settings, background asset, output profile, and live state.
- Identifiers and revision counters per D3; each run-sheet item has its own identity so a song can repeat.
- Shared schemas in `packages/protocol` for the same records.
- Data-access functions with tests; all writes go through them.
- First run creates one local workspace with Sunday as the meeting day and the workspace timezone taken from the computer.

**Done when:** records survive a restart, a schema migration runs on an existing database, and tests cover each record type.

### M3 — Lyrics engine (M)

A pure package with no interface, used by the editor, operator view, and renderer.

- Parse raw lyrics into blocks and source lines per D4, without changing the stored text.
- Group source lines into pieces by the configured count (default 2), never across a block boundary.
- Give pieces stable identities that survive edits elsewhere in the song.
- Report, for an edit, which pieces were kept, changed, added, or removed (needed by M9).
- Tests for every D4 edge case and the spec's two-language example.

**Done when:** the spec's example produces the three expected pieces, and editing a later line leaves earlier piece identities unchanged.

### M4 — Song library (M)

- Song list with search by title and lyrics, including Chinese text, pinyin and initials (D13).
- Create, edit, and remove songs with the fields in D7.
- Plain-text lyrics editor with a side preview of the generated pieces.
- Each save creates a song revision.
- Confirm before removing a song that a run sheet uses, and define what that run-sheet item shows afterwards.

**Done when:** a volunteer can paste lyrics, see the pieces, save, find the song by a word from its lyrics, and remove it.

### M5 — Calendar and run sheets (L)

- Meeting-day setting with the Sunday default and the Any day / Every day labels.
- Default date: next matching meeting day including today, in the workspace timezone.
- Run-sheet editor: search and add songs, reorder, remove.
- Calendar browsing; other dates open read-only.
- **Edit run sheet** and **Go live** as separate actions on a browsed date.
- Copy items from a browsed date into the open run sheet: immediate into an empty one, **Append** or **Replace** (with confirmation) into a non-empty one.
- Copies are new items pointing at the same songs; the source date is never changed.

**Done when:** spec criteria 18 (edit and browse parts), 19 and 20 pass on one device.

### M6 — Live state and operator view (L)

- Live-state package per D12: state holding the live run sheet link, presented piece, blank flag, and live/ended status; commands for play piece, next, previous, blank, unblank, go live, and end; each command has an identifier and is applied once.
- Start rules from the spec: resume an unexpired live state; otherwise start from today's run sheet with nothing presented; otherwise go live with the next meeting date, today included. With nothing live, editing a run sheet goes live with it.
- Persist the live state on every change so a crash or restart mid-service resumes it.
- Expiry and the "kept too long" notification per D6; manual **End presentation** clears the output and moves to the next meeting date.
- Operator view: live run sheet with every piece visible, click or tap any piece to present it, next/previous and blank controls, keyboard shortcuts.
- After **Go live** on another date, keep the presented piece and show **Still presenting previous content**.
- Run-sheet edits in live mode save to the dated run sheet and do not change what is on screen.

**Done when:** spec criterion 31 passes for one device, including killing the app mid-presentation and reopening it.

### M7 — Slideshow output (L)

- Shared renderer in `packages/renderer`: draws one piece into a given area with a font family, size, and background.
- Fitting and wrapping per D5: one size per song on this output, wrapping at most once per source line when enabled, scale slider applied on top.
- Presentation window on the chosen monitor, full screen, following the live state.
- Blank shows the background without lyrics.
- Small live preview of the output inside the operator view.
- Remember the output monitor by more than its index; if it is missing at start, show a clear choice and never present on the operator's own screen without being asked.
- Recalculate when the output size, font, slider, or song changes.

**Done when:** spec criteria 4, 22 and the slideshow half of 25 pass, and a long two-language song stays one consistent size throughout.

### M8 — Presentation settings and backgrounds (M)

- Slideshow font family chosen from installed fonts, with a warning when a font lacks characters used in the lyrics.
- Scale slider, long-line wrapping switch, and source lines per piece.
- Import image and video backgrounds per D9 into the app's own storage; remove them; no editing.
- Solid-color background.
- Select the slideshow background; if the selected file is missing, fall back to the solid color.
- Setting changes apply to the live output immediately.

**Done when:** every setting survives a restart and changes the live output without a reload.

### M9 — Live lyrics editing (M)

- Edit a song's lyrics from the operator view while it is presented.
- The output updates when the edit is saved.
- Keep the presented position using the piece identities from M3; editing a later piece never moves the current one.
- Defined behaviour when the presented piece itself is removed by the edit.
- Defined behaviour when source lines per piece changes while a song is presented.

**Done when:** spec criterion 7 passes, including a mid-song edit that adds a line above the presented piece.

### M10 — Persistence, packaging, and release (M)

- Reopening the app restores the workspace, output assignment, settings, and the right calendar date without any setup step (spec criterion 3, single-device part).
- Export and restore of the whole local workspace as one backup file.
- Installers for each D1 platform, signed per D10.
- Automatic update check and install per D10.
- Version shown in the app; license file per D11.
- Short volunteer guide: install, add a song, build a run sheet, present.

**Done when:** a fresh machine goes from download to presenting a song on a second screen using only the guide.

### M11 — Acceptance pass (S)

- Walk through spec criteria 2, 3, 4, 7, 18, 19, 20, 22, 25, 30 and 31 on every D1 platform and record results.
- Run one real meeting, or a rehearsal of one, with a volunteer who has not seen the app.
- Fix what blocks a volunteer; list the rest for the next phase.

**Done when:** every listed criterion passes or has a recorded, accepted exception.

## 5. Order and dependencies

| Milestone | Needs first |
| --- | --- |
| M0 | — |
| M1 | M0 |
| M2, M3 | M1 |
| M4 | M2, M3 |
| M5 | M4 |
| M6 | M5 |
| M7 | M3 |
| M8 | M7 |
| M9 | M6, M7 |
| M10 | M8, M9 |
| M11 | M10 |

- M0 comes first because it can change the desktop shell.
- M3 has no dependency on the database and can run alongside M2.
- M7 needs only M3 to start and can be developed against sample songs while M4–M6 proceed; it joins the main line at M6.
- A thin end-to-end slice (one hard-coded song presented on a second screen) is worth reaching as soon as M3 and the start of M7 exist, before the calendar work.

## 6. Carried into later phases

- Moving a local workspace into a church instance; D3 exists to keep this possible.
- Subtitle overlay and the localhost page for OBS (D2).
- Local-only presentation on a phone, including how the phone obtains the app.
- Everything in the right-hand column of section 2.
