# Worship Q — Song Catalogue Plan

**Drafted:** 21 November 2026
**Status:** Parked on 22 November 2026. Nothing is built. Read from the code at version 2.13.0.
The checked hymns are saved in `apps/desktop/src/assets/hymns/` but not used by the app. Stream of
Praise has not been asked yet. To pick this up: ask them (discovery §6), and settle §13.
**Source:** the project owner's request of 21 November 2026 (ship confirmed English public-domain
hymns with the app; sync Stream of Praise songs from the public server to every copy of the app
that is online); the [Song lyrics discovery](song-lyrics-discovery.md); the [Public server
plan](public-server-plan.md); the [Phase 3 plan](phase-3-plan.md) (D31, D32, D36); `packages/store`
(`store.ts`, `sync.ts`, `migrations.ts`), `packages/sync` (`join`, `disconnect`),
`apps/desktop/src/app/cloud.ts`, `apps/server/src/db.ts`.

## 1. Why

A new workspace starts with an empty library, so the first service means typing every song in.
Two sets of songs can be given to every user without a licence fee (discovery §1):

- **English public-domain hymns.** Checked one by one and shipped inside the app. They work
  offline from the first launch. The list is in `apps/desktop/src/assets/hymns/`.
- **Stream of Praise (赞美之泉) songs.** Served by the public server and kept up to date on every
  copy of the app that is online. **This depends on written permission from Stream of Praise**
  (discovery §6). Nothing in that part ships until copyright@sop.org confirms it in writing.

These songs have to sit alongside the two kinds of song the app already has: the workspace's own,
and the Church Library's (D31). They also have to survive a workspace joining a church server and
leaving it again.

## 2. Terms

| Term | Meaning |
| --- | --- |
| **Song Catalogue** (user-facing) | Songs the app offers that are not in any library yet. One catalogue, with one section per source |
| **Source** | Where catalogue songs come from: `hymns` (built in, public domain) or `sop` (Stream of Praise, from the public server) |
| **Catalogue song** | One entry in a source, with a stable identifier and a version number |
| **Added song** | A catalogue song copied into a library. It is an ordinary song from then on, and it remembers which catalogue song it came from |

The Church Library and Workspace Library keep their meaning (spec §2 terminology table).

## 3. The rule: a catalogue is offered, a library is owned

**A catalogue song is never in a library until someone adds it. Adding copies it into the
library as an ordinary song. From then on the library owns the copy.**

- Nothing about run sheets, synchronization, the presentation log, backups or the phone changes.
  They only ever see ordinary songs.
- A catalogue never fills a library on its own. Hundreds of hymns are not pushed into every
  workspace, and no church server is sent songs nobody chose.
- Withdrawing a song from a catalogue (for example on a takedown request) removes the offer.
  Copies already added stay in their libraries, as songs the church chose to use (§8).

## 4. The three kinds of song, resolved

A workspace's searches and song lists show, in this order:

1. **The library**, as today: the workspace's own songs, the church's songs, and two-version songs
   resolved by `useChurchVersion` (D32).
2. **The Song Catalogue**, below the library results, one section per source and badged with it.
   A catalogue song is left out when the library already holds its copy (§5). That is matched by
   identifier, not by title.
3. **A possible duplicate:** when a catalogue result's title, ignoring case and punctuation, matches
   a library song's title, the catalogue result says "Maybe already in your library". Hand-typed
   copies have no identifier to match, so this is only a hint.

Choosing a catalogue song anywhere a library song can be chosen adds it first. That includes the
run sheet editor, search, and a phone's search (remote control already searches the visible library;
the catalogue is added to that search). **Add to library** on its own is also offered.

## 5. Identity: one stable identifier per catalogue song

An added song's identifier is **derived from its catalogue song**: `cat-<source>-<id>`, for
example `cat-hymns-amazing-grace`. It is not a fresh random identifier. Identifiers are already
plain strings (`IdSchema`), and records are already keyed by identifier, so no format changes.

That one choice resolves most cases with the code that exists:

| Situation | What happens, with no new mechanism |
| --- | --- |
| Two local workspaces each add *Amazing Grace* | Each has its own database, so each has its own `cat-hymns-amazing-grace` |
| Two workspaces of one church add it | The server keys workspace records by `(workspace, kind, id)` (`record` table), so each holds its own copy |
| The Church Library has it, and a normal workspace adds it | Same identifier as a church record, so it is **the workspace's version of the church song** (D31). Instead the app sees the church already has it and uses the church's (§4 step 2). No copy is made |
| A workspace that manages the Church Library adds it | It becomes a church song (`origin: 'church'`), as any song that workspace adds |
| A workspace removes an added song and adds it again | Removal is a tombstone (`removed_at`). Adding again revives the same record with a new revision, so every computer sees it return |
| A run sheet refers to it | By identifier, as for any song |

An added song also carries a **`source` field**: `{ catalogue: 'hymns' | 'sop', id, version }`,
the catalogue version it was copied from. The identifier tells what the song *is*; `source.version`
tells whether the copy is behind the catalogue (§7).

## 6. Where catalogues come from

### 6.1 Built-in hymns (`hymns`)

- Kept in the repository at `apps/desktop/src/assets/hymns/en.json`, bundled into the desktop.
  Each entry records its proof: the writers with their death years, and the pre-1931 source the
  words were taken from (`README.md` beside it).
- Updated only by an app release. Adding a hymn is a pull request that passes the check in the
  README: published in 1930 or earlier, every writer of the exact words died before 1956, and the
  words compared against the named source.
- Available in **every workspace**, local or church, online or not, because nothing is fetched.

### 6.2 Stream of Praise (`sop`), from the public server

- **Where the songs live.** On the public server's data volume, not in the repository. The
  permission is for display. It does not allow republishing the lyrics as open data under the
  repository's MIT licence. They are loaded with a server CLI command (`catalogue import sop
  <file>`), like the existing `settings set`.
- **The route.** `GET /api/v1/catalogue/sop`, anonymous: no token, no workspace, no install
  identifier. It returns the whole source, compressed (a few hundred songs is well under 1 MB).
  `ETag` and `If-None-Match` mean an unchanged catalogue costs one small request. A per-IP rate
  limit applies, as on the public server's other routes.
- **The app's copy.** One cache per copy of the app, in the app's data folder (`AppData`, beside
  the install identifier, public server discovery §4.4). All its workspaces share it. It is
  refreshed at launch and once a day while the app is open and online. A failed refresh keeps the
  last copy, so the catalogue works offline once it has been fetched.
- **The public server's rule** ("nothing is kept", public server plan §3) is about each user's
  content. A catalogue is the project's content, the same for everyone, and nothing a user sends is
  stored. The plan's §3 gains one sentence saying so.
- **Withdrawal.** A song removed on the server leaves every cache at its next refresh (§8).

### 6.3 Which workspaces see `sop`

The public server plan says a workspace connected to a church server never uses the public server.
**Recommended:** the catalogue download is treated like the update check, not as using the public
server. It is anonymous and app-wide, it carries nothing about the workspace, and the same cache
serves every workspace on the computer, church ones included. A church server gains one church
setting, `catalogues` (default: all), with which an administrator hides a source from its
workspaces. *Decision needed (§13).*

The alternative, `sop` only in local workspaces, makes a church workspace lose the songs it saw
before it joined. That is the transition this plan most wants to keep smooth.

## 7. Updates

A catalogue song's `version` increases when its words are corrected. When the app's catalogue
has a newer version than an added copy's `source.version`:

| The added copy | What happens |
| --- | --- |
| **Unchanged** since it was added (its fields equal that version's text) | Updated in place, as a new revision of the song, by the computer that notices first. It reaches the workspace's other computers through synchronization like any edit. Only a computer that may edit the song does this: a normal workspace never updates a church song |
| **Edited** by the workspace | Left alone. The song editor shows "The catalogue has a newer text" with **Use the catalogue's text** (which replaces the words and keeps the workspace's background) and **Dismiss** (which records the version, so the notice does not return for it) |

"Unchanged" is decided by comparing the copy's title, lyrics and author with the catalogue text of
`source.version`. The app keeps the previous version's text in its cache for this purpose (one back
is enough). No hash needs to be stored in the song.

## 8. Withdrawal and takedowns

- A song withdrawn from `sop` disappears from the catalogue at each copy's next refresh.
- **Added copies stay.** They are the church's songs now, used under Stream of Praise's terms for
  church use (free, discovery §6) or the church's own licence. Deleting a church's chosen songs
  remotely would break run sheets and be surprising. *Decision needed (§13)* if Stream of Praise
  asks for more.
- If the whole permission ends, the server's `sop` source is emptied. Caches empty at their next
  refresh, and the section disappears.
- The website and the app's About page give a contact address for takedown requests.

## 9. Joining a church server (local → church)

`SyncClient.join(mode)` today does `upload`, `merge` or `replace` (packages/sync `JoinMode`). Added
catalogue songs are ordinary songs, so they follow the mode. Four details need handling:

| Mode | Added catalogue songs | Change needed |
| --- | --- | --- |
| **upload** (church workspace empty) | Pushed as the workspace's songs, with their identifiers and `source` | `source` in the sync record (§11) |
| **merge** | Pushed as the workspace's songs. Where the **Church Library already has the same catalogue song**, the shared identifier makes the local copy the workspace's version of the church song (§5) | When the local copy is **unchanged** (§7), the join drops it before pushing, so the workspace uses the church's song and does not show two versions. An edited copy stays as the workspace's version, with the toggle defaulting to the workspace's (D32) |
| **replace** | Discarded with everything else, after the backup `join` already makes | None. The catalogue is still there to add them again |
| Any | The `sop` cache is app-wide, so it is unaffected by joining | None |

Run sheets need no repointing for the merge case. The identifier the run sheet holds is already the
church song's identifier.

**Later: a workspace starts managing the Church Library** (D36 conversion). Its added catalogue songs
become church songs like any other. `libraryPlan` lists them in "songs that become the church's" as
usual. Where two workspaces each added the same catalogue song, they share an identifier. The second
conversion then sees a church song with that identifier already, and its own copy shows as an
override, which is correct (D36 flags it when the texts differ).

## 10. Leaving a church server (church → local)

Today `disconnect()` only forgets the connection (`sync.forget()` deletes `sync_state` and the
church settings). Every song stays, **with its church markings**: `origin: 'church'`,
`use_church_version`, and the `church_version` rows. That causes problems in local mode:

- Editing a song marked `church` runs the "make our own version" path (`makesVersion` in
  `store.update`). It saves a church version that no church will ever update, and the song shows a
  version toggle with no church behind it.
- A song whose workspace chose the church's version presents the church's text from
  `church_version`. That table is never updated again, and the toggle stays.

**Plan: leaving flattens the library.** In the same transaction as `forget()`:

1. Every two-version song keeps **the version the workspace was presenting**. When
   `use_church_version` is set, the church's fields are copied into the song as a new revision.
   Then `use_church_version` is cleared.
2. `church_version` rows are deleted.
3. `origin` is set to null on every song and background, as on a computer that never had a church.
4. **Added catalogue songs keep their `source`**, so catalogue updates (§7) continue in local mode.
   A church song that was itself added from the catalogue (identifier `cat-…`) keeps that link too.

What stays is decided by the existing rule: **the content stays on this computer**, church songs
included. A church that does not want a departing computer to keep its library revokes that device
before it leaves. The plan does not change that rule.

Rejoining later (any mode) then works from a plain local library. On merge, the shared identifiers
rebuild the two-version songs and catalogue matches (§9).

## 11. Changes by part

**Protocol** (`packages/protocol`)
- `SongFieldsSchema` gains `source: { catalogue, id, version } | null`, default null.
- New `PROTOCOL_VERSION`, additive under D26's rules: the server sends `source` only to requests of
  that version or later, and stores it from them. An older server strips the field, so an added song
  synced through it becomes a plain song with a `cat-` identifier. It still matches by identifier,
  and only update notices are lost. Accepted.
- `Catalogue` schema for the route: `{ source, updatedAt, songs: [{ id, version, title, lyrics,
  author, copyright, ccli, year }] }`.

**Store** (`packages/store`)
- Migration 14: `source TEXT` on `song`, `song_revision` and `church_version`.
- `addFromCatalogue(workspaceId, entry)`: insert with the derived identifier, or revive the tombstone.
  It respects `managesChurch` for origin, as `create` does.
- `flattenChurch()` for §10, called from `SyncClient.disconnect`.
- `catalogueUpdates()`: unchanged and edited copies behind the cache (§7).

**Sync** (`packages/sync`)
- `join('merge')`: before the first push, drop unchanged added copies whose identifier the Church
  Library holds (§9). That needs the church's `cat-` song identifiers before pushing: a new field on
  the existing `workspace()` response, or the first pull done before the first push.
- `disconnect()`: `flattenChurch()` then `forget()`.

**Desktop** (`apps/desktop`)
- `catalogue.ts`: loads `hymns` from the bundle and `sop` from the native cache, refreshes `sop`
  (ETag), and answers search.
- Native core (`src-tauri`): the catalogue cache file in `AppData`, fetched over the existing HTTP
  client.
- Search and run sheet editor: the catalogue section and badges (§4), **Add to library**, and the
  update notice in the song editor (§7).
- Strings in all three languages (`@worship-q/i18n`). Source names stay as their publishers write
  them.

**Server** (`apps/server`)
- Public mode: `GET /api/v1/catalogue/:source` and the `catalogue import` CLI command. The table, or
  file, holds no user data.
- Church mode: the `catalogues` church setting (§6.3) and `source` in records. A church server
  serves no catalogue itself.

**Remote** (`packages/remote`): phone search includes catalogue results from the coordinator's
catalogue. Adding from a phone adds through the desktop, as Bible requests do (B26).

## 12. Milestones

| | Scope | Done when |
| --- | --- | --- |
| M1 | Built-in hymns: data file, `source`, derived identifiers, search section, Add to library, migration | A fresh local workspace, offline, finds *Amazing Grace* in search and puts it in a run sheet |
| M2 | Leaving a church flattens the library (§10) | After leaving, editing a former church song makes no version toggle, and a song that used the church's version presents that text as its own |
| M3 | Joining with catalogue songs (§9), protocol bump | A local workspace with added hymns merges into a church whose library has the same hymns, and shows one song each |
| M4 | Updates (§7) | A corrected hymn in a new release updates unchanged copies and shows the notice on edited ones |
| M5 | Stream of Praise source: server route, import CLI, app cache, `catalogues` setting. **Only after written permission** | An online local workspace sees Stream of Praise songs, and still sees them offline after a restart |

M1, M2 and M4 need no server change. M2 fixes a problem that exists today, with or without the
catalogue.

## 13. Decisions needed

1. Does a church workspace see the `sop` catalogue (§6.3)? Recommended: yes, through the app-wide
   cache, with a church setting to hide it.
2. Do added `sop` copies stay after a song is withdrawn (§8)? Recommended: yes, unless Stream of
   Praise's written terms say otherwise.
3. Is flattening on leave (§10) the wanted behaviour, rather than keeping church markings in case
   the computer rejoins? Recommended: flatten. Rejoining rebuilds the links from identifiers.
4. User-facing name: "Song Catalogue", or another term for the terminology table (spec §2)?
5. Simplified and Traditional Chinese for Stream of Praise songs: one catalogue entry with both
   texts, or two sources? It depends on what Stream of Praise provides and permits.

## 14. Not in this plan

- Chinese public-domain hymns (discovery §6: slow to prove, little used in today's wording).
- Other publishers' songs. Each one would be a new source behind its own written permission.
- Sheet music, chords and recordings. Lyrics only, as the app shows.
- A catalogue a church server publishes for other churches (spec: no cross-instance sharing).
