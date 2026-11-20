# Worship Q — Public Server Task Breakdown

**Drafted:** 18 November 2026  
**Status:** M1–M6, M6b and M8 built on the `public-server` branch on 18 November 2026, with their tests; M7's files (the Compose file, the guide to running it) are written, its infrastructure (host, CloudFront, monitoring) and privacy notice are not; the M9 walkthrough waits for a deployed public server. Of the decisions added here (§1), S1, S3–S6, S10 and S11 were made by the project owner on 18 November 2026; S2 and S7–S9 were built as proposed. §7 lists where the build differs from the tasks.  
**Source:** the [Public Server Plan](public-server-plan.md) (P1–P6, the rule in §3), referred to here as "the plan"; the [technical discovery](public-server-discovery.md), referred to as "the discovery", with the owner's decisions of 18 November 2026 (§8 there); the [Media Uploads Plan](media-uploads-plan.md) (U26, U29, U30); and the code at version 2.10.1 (protocol version 8, minimum 2).

## 1. How to read this

The plan says what the public server gives a computer in local mode; the discovery says how to build it with the least change to the app. This document breaks that into tasks small enough to be one pull request each, says where each lands, and names the tests that prove it. Task identifiers are `M<milestone>.<n>`; a task lists the tasks it needs first. Sizes are S, M and L as in the phase plans.

Every task that changes business logic carries unit tests in its package. §3 lists the business rules and edge cases those tests must cover, area by area; a task's Tests column names the main cases, and §3 is the full list a pull request is checked against. Every server route gets a test in `apps/server/src`, every relay change an integration test in `apps/server/src/relay.test.ts`, and every protocol change a case in `apps/server/src/versions.test.ts`.

**Church servers must not change behaviour.** Every server task runs the whole existing server suite with public mode off; a task that needs an existing test changed explains why in its pull request.

### Where things live today

| Concern | Location |
| --- | --- |
| Server start, settings from the environment | `apps/server/src/main.ts` |
| Routes, `requireDevice`, media handlers, relay sockets | `apps/server/src/app.ts` |
| Workspaces, devices, enrolment, church settings | `apps/server/src/instance.ts`, `db.ts` |
| Deck and image conversion, kept originals, "stored once" | `apps/server/src/decks/convert.ts`, `images.ts`, `storedUploads.ts` |
| Retention sweep | `apps/server/src/retention.ts` |
| Bible service, offered versions | `apps/server/src/bible/` |
| ICE and TURN credentials; coturn profile | `apps/server/src/ice.ts`; `apps/server/compose.yaml` |
| Relay, `RelayDirectory`, `RelayOptions` | `packages/relay/src/index.ts` |
| Wire types, `ServerInfo`, protocol version | `packages/protocol/src/wire.ts` |
| Desktop church connection: state, relay, media, Bible, ICE | `apps/desktop/src/app/cloud.ts` |
| Connection state per workspace (`SyncState`) | `packages/store/src/sync.ts` |
| Church connection screen; how to join | `apps/desktop/src/components/ChurchConnection.tsx`, `app/joinMethod.ts` |
| Upload queue; video cache | `apps/desktop/src/app/uploads.ts`, `app/videoCache.ts` |
| Native video copies and the localhost page server | `apps/desktop/src-tauri/src/media.rs`, `overlay.rs` |
| Remote host (phone view, grants kept on this computer) | `packages/remote/src/index.ts` |
| Phone page | `apps/remote/src/RemoteApp.tsx`, `connection.ts` |
| Live audio sessions, the listener limit (`AUDIO_LISTENER_LIMIT`, ten) | `packages/audio/src/broadcaster.ts` |
| Remote-control panel, Bible window, banners | `apps/desktop/src/components/RemoteControl.tsx`, `BibleWindow.tsx`, `LiveBanners.tsx`, `UpdateBanner.tsx` |
| Strings in three languages | `packages/i18n` |

### Facts that shape the tasks

- **Everything on the server hangs off a device token.** `requireDevice` turns it into a workspace; the relay, Bible, media and ICE need nothing else. A public workspace is an ordinary workspace with one device, made without an administrator (discovery §4.1).
- **The desktop's features read only `server` and `deviceToken`.** `connected` (`cloud.ts:340`) gates synchronization and must keep meaning *joined a church*; the new `service` getter is what features read (discovery §4.2).
- **Phone grants already live on the desktop** (`RemoteHost.localGrants`, `store.listRemoteGrants`). The server's copy in `PUT /api/v1/live` is a backup for other computers, which a public workspace never has.
- **Videos never go to the public server** (discovery §5.1). They play from a copy in the app's folder, removed only by U29 and U30.
- **The phone page is served by the server it talks to,** so on the public server it always matches the public server's version; only the desktop can be older or newer.
- **Nothing is kept** (plan §3): every server task that writes a file says when it is deleted.

### Decisions added here

Decided ones say so; the rest are proposed.

| # | Topic | Decision |
| --- | --- | --- |
| S1 | Address | **Decided.** The desktop's public server address is a build-time constant, `https://public.worship-q.com`, overridden by `WORSHIP_Q_PUBLIC_SERVER` in development and tests. |
| S2 | Install identifier header | `x-worship-q-install`, a UUID made on first use and kept in the app's data folder (`AppData`), shared by all local workspaces. Sent on `public/join` and every request to the public server. Never sent to a church server. |
| S3 | Rate-limit numbers | Each a `WORSHIP_Q_PUBLIC_*` setting. **Decided:** slide decks and images together 100 a day per install; phones 2 at once per workspace; listeners 2 at once per workspace. **Proposed:** joins 5 an hour per IP; 25 MB per image, 100 MB per deck; Bible requests 600 an hour per install; IP ceiling 5 × each per-install limit. |
| S4 | Idle workspaces | **Decided.** A public workspace whose device was last seen more than 90 days ago is removed with its folder. When the app is opened again after that, a new public workspace is made by itself: a workspace that has used the public server connects its relay at launch, the server refuses the old token, and the desktop joins again (M3.8) with no question to the operator. Everything on the computer is untouched (songs, run sheets, slides, videos, passages); only the phone link changes, so phones approved before must scan the new QR code and be approved again. A workspace that never used the public server is never swept, because it never joined. |
| S5 | Refusal codes | **Decided.** In public mode `/api/v1/pair` and `/api/v1/pair/poll` answer `403 public-server`; `/api/v1/enroll` answers `403 invalid-code`, the least misleading message older desktops know (discovery §5.7). |
| S6 | Bible keys on the public server | **Decided.** Ignored, with a warning at start: a church's key may not be shared by every user (Bible passages discovery §4). |
| S7 | Thumbnail messages | Protocol version 9. `RemoteToHost` gains `{ type: 'thumbnail', name }`; `HostToRemote` gains `{ type: 'thumbnail', name, data }` (base64 JPEG, at most 256 KB) and `{ type: 'thumbnail', name, missing: true }`. A piece carries `thumbnailVia: 'host'` on a public connection. |
| S8 | Phone thumbnail requests | At most 4 in flight per phone; only pieces on screen; answers kept as blob URLs for the page's life. |
| S9 | Deck conversions | One at a time per process, as today, with a queue of 5; a sixth answers `503 busy` with `retryAfter`. |
| S10 | Viewer mode | **Decided.** A computer in viewer mode never joins the public server: it has no remote control and presents nothing of its own. |
| S11 | One kind per data folder | **Decided.** A server started in public mode on a data folder that holds church content (any synchronized record or administrator) refuses to start, and the reverse, so a mistyped setting can never expose or sweep a church's data. |

## 2. Tasks by milestone

### M1 — Videos without a server; delayed removal (M)

Useful on its own, for church computers too (U29, U30). Can ship before the public server exists.

| # | Task | Where | Needs | Tests | Done when |
| --- | --- | --- | --- | --- | --- |
| M1.1 | Adding a video without a church server: probe as today, make `video-<uuid>.<ext>` on the desktop, copy with `store_video`, create the song; no network. The queue skips the upload stage for this case | `app/uploads.ts`, `app/cloud.ts` (`uploadDeps`) | — | §3.1: the name passes `checked_video`; the source file is unchanged; probe failure refuses as today; no `fetch` is made | A video added in local mode presents and plays in the localhost slideshow page |
| M1.2 | **Use new version…** for video items without a church server, through M1.1; other media keep **Upload new version…** and stay disabled without a server | `MediaActions.tsx`, run sheet item menu, `i18n` | M1.1 | §3.1: label by kind and connection; the item keeps its title, Autoplay and places (U26) | U26 works for videos in local mode |
| M1.3 | Removal moment, pure: from elapsed time since launch (not timer ticks), say when the once-per-launch moment is reached at 30 minutes | `app/videoCache.ts` | — | §3.2: 30 minutes of elapsed time with a slowed timer; once only; a restart starts again | — |
| M1.4 | Candidates, pure: copies used only by past run sheets (a), or named by no song (b); kept when used by a current, upcoming or live run sheet, or by no run sheet yet | `app/videoCache.ts`, `packages/store` (a query for every song's video and its run sheet dates) | M1.3 | §3.2 | U29's rule in one place; `once()` no longer deletes on every pass |
| M1.5 | Server check: `HEAD /api/v1/files/<name>` for each candidate when connected to a church; 200 → silent, 404 → local-only, anything else → stop the whole step for this launch. Without a church server every candidate is local-only and nothing is asked | `app/videoCache.ts`, `cloud.ts` | M1.4 | §3.3 with a fake fetch | Silent removals happen only after a 200 |
| M1.6 | Snoozes: per workspace on this computer, file name → day kept; a kept file is not offered for 30 days. Survives restarts; a damaged entry reads as empty | new `app/videoSnooze.ts` | — | §3.3 | — |
| M1.7 | Banner: "Old videos on this computer use *X*…" with **Review…** and **Dismiss**, only when local-only, not-snoozed candidates total ≥ 100 MB; **Dismiss** snoozes every listed file | `LiveBanners.tsx` or a new `VideoCleanupBanner.tsx`, `i18n` | M1.5, M1.6 | §3.3 | — |
| M1.8 | Review window: title, the copy's path in the app's folder, size, **Open** (the system's player, a native command on the copy's path only); all ticked; **Select all**, **Select none**, total of ticked; **Remove selected**, **Cancel** | new `VideoCleanupWindow.tsx`, `src-tauri/src/media.rs` (`open_video`), `platform/native.ts` | M1.7 | §3.3; Rust: `open_video` refuses a name failing `checked_video` | **Open** plays the copy on macOS and Windows (manual) |
| M1.9 | Remove selected: check each again (M1.4), delete, snooze the unticked, hide the banner, notice "Freed *X* of disk space" with the total actually freed | `app/videoCache.ts`, the window | M1.8 | §3.3: a file that became needed is kept; a failed delete is not counted | — |
| M1.10 | A video item whose copy is gone, without a church server: the item and the editor say the video is no longer on this computer and offer **Use new version…**; presenting it shows the existing missing-video state | `runSheetRows.ts`, `SongForm.tsx`, output | M1.2 | §3.1 | — |

**Milestone done:** a local workspace adds, plays and replaces videos with no network; a church computer removes copies silently only when the server has them; a local-only copy is removed only after the operator ticks it.

### M2 — Server public mode (L)

| # | Task | Where | Needs | Tests | Done when |
| --- | --- | --- | --- | --- | --- |
| M2.1 | `WORSHIP_Q_PUBLIC=1` read in `main.ts`, passed as `config.public`; the local API, OIDC, admin files, recordings repair and `backfillStoredUploads` not started; Bible keys ignored with a warning (S6) | `main.ts`, `app.ts` | — | §3.4: what starts in each mode | Logs say "Public mode" and which features are on |
| M2.2 | Protocol: `ServerInfo.public?: boolean`, `limits?: { listeners, phones, decksPerDay, ... }`; `info` in public mode says `public: true`, `pairing: false`, `admin: false`, `codes: false`, `outputs: false`, `records: { audio: false, log: false }`, `media.videos: false` | `packages/protocol/src/wire.ts`, `app.ts` | — | `versions.test.ts`: an older desktop parses the new `info`; a church `info` has no `public` | — |
| M2.3 | Routes off in public mode (404): sync, `PUT /files`, backups, claim, live, obs, audio reports, recordings, presentation log, outputs and output pages, videos, deck original and reconvert, `remote/files`, bible FUMS, lan-credentials, admin, auth | `app.ts` | M2.1 | §3.4: each route 404 in public mode and unchanged in church mode, table-driven | The table in discovery §2 is the test's table |
| M2.4 | Joining refused (S5): pair, pair poll, enroll | `app.ts` | M2.1 | §3.5 | An older desktop typing the address sees "invalid code" |
| M2.5 | `POST /api/v1/public/join`: protocol check (426), per-IP limit (429), `createWorkspace` + `enroll`, device name "Worship Q", returns `{ deviceId, deviceToken, workspace: { id } }`; absent on a church server | `app.ts`, `instance.ts` | M2.1 | §3.5 | The token works on the relay, Bible, decks, images and ICE |
| M2.6 | Decks and images in public mode: no original kept; "stored once" neither consulted nor written; conversion queue (S9) | `app.ts` (`makeDeck`, `storedDeck`), `storedUploads.ts` | M2.1 | §3.6 | The same file twice converts twice, under two ids |
| M2.7 | `DELETE /api/v1/decks/:id`: removes the deck's images and thumbnails from this workspace's folder only; 204 when there was nothing; 400 for a malformed id. Public mode only | `app.ts` | M2.6 | §3.6 | — |
| M2.8 | Sweeps in public mode, hourly: files in workspace folders and `work/` older than 24 hours; workspaces idle over 90 days (S4) with their rows and folders; the retention sweep of church mode not run | new `apps/server/src/publicSweep.ts`, `main.ts` | M2.1 | §3.7 | `/data` holds nothing older than a day but the database |
| M2.9 | Bible on the public server: offered versions set with the existing CLI (`settings set bibleVersions [...]`); a start-up check that warns when none is set | `main.ts`, `docs/server-deployment.md` | M2.1 | §3.8 | A public desktop lists the keyless versions |
| M2.10 | Request log: no tokens, no `installId`, no query strings of Bible searches; IPs kept as the privacy notice says (M7.5) | `main.ts` (Fastify logger serializers) | M2.1 | §3.4: a logged request carries none of these | — |

**Milestone done:** a public server in a test harness serves the relay, Bible, decks, images and ICE to a token from `public/join`, refuses every other route and every way of joining as a church device, and keeps no file over a day.

### M3 — The desktop's public connection (L)

| # | Task | Where | Needs | Tests | Done when |
| --- | --- | --- | --- | --- | --- |
| M3.1 | `SyncState.publicServer: boolean` (default false); store migration | `packages/store/src/sync.ts` | — | Round-trip; an old database reads false | — |
| M3.2 | Install identifier (S2): native, made once, read by the app | `src-tauri/src/db.rs`, `platform/native.ts` | — | Rust: made once, stable across opens; shared by workspaces | — |
| M3.3 | `service` getter: `church` when `connected`; `public` when `publicServer` and a token; null otherwise | `app/cloud.ts` | M3.1 | §3.9 | — |
| M3.4 | Features read `service`: `bibleServer`, `call`, `uploadDeps().credentials`, `mediaOffer`, ICE, `remoteLink`, `RelayTransport.url`; requests to the public server add the install header | `app/cloud.ts` | M3.3, M3.2 | §3.9 with a fake fetch: the install header never reaches a church server | — |
| M3.5 | `ensurePublic()`: once, deduplicated; checks `info.public` (S1 address); `public/join`; token to the keychain through `protectToken` (D23 fallback); then starts the relay. Never in viewer mode (S10) | `app/cloud.ts`, `app/credentials.ts` | M3.4, M2.5 | §3.10 | — |
| M3.6 | Triggers: opening the phone panel, the Bible window, **Add media…** for decks and images, **Broadcast live audio**, OBS sharing with phones | `RemoteControl.tsx`, `BibleWindow.tsx`, `SongsPage.tsx`, `AudioSettings.tsx`, `ObsSettings.tsx` | M3.5 | §3.10: nothing joins at launch for a workspace that never used a feature | No request leaves the computer until a feature is used |
| M3.7 | `start()` and `startLive({ public: true })`: relay, live link, remote host, audio and OBS sharing; none of sync, backups, live backup (a backup that keeps nothing), OBS and audio reports, presentation log, recording uploads, outputs, LAN host and transport, LAN credentials, font checks, `considerOffline` | `app/cloud.ts` | M3.4 | §3.11: a fake fetch and socket record every call; the forbidden paths are never called | — |
| M3.8 | Token refused (401) by the public server: forget it and join again once; a second refusal stops and shows the connection problem | `app/cloud.ts` | M3.5 | §3.10 | — |
| M3.9 | Decks and images on a public connection: after the images, also fetch thumbnails; then `DELETE /api/v1/decks/:id`, fire and forget; **Download original** and **Reconvert** say there is no original | `app/uploads.ts`, `cloud.ts` | M3.4, M2.7 | §3.12 | — |
| M3.10 | Church connection refuses the public server: `probe()` first; `info.public` → the public-server message, before `aim()`; a new error class and strings | `ChurchConnection.tsx`, `app/cloud.ts` | M2.2 | §3.13 | — |
| M3.11 | Joining a church from a public connection: the church fields replace the public ones, `publicServer` false, the public token forgotten in the keychain, relay reconnected to the church; leaving the church goes back to local mode, which joins the public server again only when a feature is used, as a new workspace | `app/cloud.ts` | M3.5 | §3.13 | — |

**Milestone done:** a local workspace looks up a passage and imports a deck through the public server, with no other request made, and a workspace that never uses a feature makes no request at all.

### M4 — Remote control and thumbnails (M)

| # | Task | Where | Needs | Tests | Done when |
| --- | --- | --- | --- | --- | --- |
| M4.1 | Remote-control panel on a public connection: the QR code once `ensurePublic` succeeds; **Disconnect** per phone; no church-only controls | `RemoteControl.tsx` | M3.6 | Unit on what the panel shows by `service` | A phone controls a local workspace through the public server |
| M4.2 | Protocol version 9 with S7's messages and `thumbnailVia` | `packages/protocol/src/wire.ts`, `versions.test.ts` | — | Schema tests; 8-against-9 both ways; a 300 KB `data` refused | — |
| M4.3 | Host answers thumbnails: only names of deck pages in the live run sheet, read from this computer's files folder by name pattern; `missing` otherwise; marks pieces `thumbnailVia: 'host'` on a public connection | `packages/remote/src/index.ts`, `app/cloud.ts` (file reader) | M4.2 | §3.14 | — |
| M4.4 | Phone asks over the connection when `thumbnailVia` is `host` (S8), HTTP otherwise; text button for `missing` | `apps/remote/src/RemoteApp.tsx`, `connection.ts` | M4.2 | §3.14 with a fake connection | — |
| M4.5 | Grants without the server: a restarted desktop lets an approved phone back without approval; **Disconnect all** clears them | `liveLink.ts` (public backup), `packages/remote` | M3.7 | §3.15 | Discovery §5.5 confirmed |

**Milestone done:** a phone on mobile data controls a local workspace through the public server, sees deck thumbnails sent by the desktop, and comes back after the desktop restarts without asking again.

### M5 — Limits (M)

| # | Task | Where | Needs | Tests | Done when |
| --- | --- | --- | --- | --- | --- |
| M5.1 | Limit windows in memory: fixed windows per key (device, install, IP), forgotten when the window ends; `429 { error: 'rate-limited', retryAfter }` | new `apps/server/src/limits.ts` | M2.1 | §3.16 with a fake clock | — |
| M5.2 | Applied to join, decks, images and Bible routes (S3); sizes through `mediaLimits` | `app.ts` | M5.1 | §3.16 | — |
| M5.3 | Relay caps through `RelayOptions`: phones at once per workspace; listeners at once per workspace, counted by listener identity from `listen` signals (A20); a refused phone gets a reason | `packages/relay/src/index.ts`, `app.ts` | M2.1 | §3.17 integration | — |
| M5.4 | Desktop obeys `info.limits.listeners`: the broadcaster's limit is the smaller of ten and the server's; the refused listener's message names the public server | `packages/audio/src/broadcaster.ts`, `app/audioShare.ts`, `i18n` | M2.2 | §3.17 | — |
| M5.5 | Desktop messages for `429` and `503 busy`, with the time to wait | `app/uploads.ts`, `app/bible.ts`, `i18n` | M5.2 | Unit on the error-to-text mapping | — |

### M6 — Interface and guides (S)

| # | Task | Where | Needs | Tests | Done when |
| --- | --- | --- | --- | --- | --- |
| M6.1 | Workspace button shown on a public connection; amber ring and dot with the reason when the relay is not connected (plan §2) | `WorkspaceSwitcher.tsx`, `App.tsx` | M3.7 | Unit on visibility and label by `service` and `RelayStatus` | — |
| M6.2 | One-computer notes in the media and Bible windows (plan §5) | `SongsPage.tsx`, `BibleWindow.tsx` | M3.6 | — | — |
| M6.3 | Every new string in the three languages | `packages/i18n` | M1–M5 | The i18n completeness test | — |
| M6.4 | Volunteer guide and its translations: what works without a church server, the one-computer rule, the cleanup banner | `docs/volunteer-guide.md`, `docs/zh-hans`, `docs/zh-hant` | M6.1 | — | — |

### M6b — Website and descriptions (M)

Everywhere the site, the README and the app's descriptions say a feature needs a church server. What still needs one afterwards: several computers sharing one presentation, sharing content between computers, the Church Library, backups, browser outputs, Bible versions that need a key (NIV, NKJV, NLT, ESV), recordings, the presentation log and the admin app. Videos need no server at all. The site deploys whenever it changes (`.github/workflows/website.yml`), so these changes wait on a branch and merge with the release that turns the public server on (§5).

| # | Task | Where | Needs | Tests | Done when |
| --- | --- | --- | --- | --- | --- |
| M6b.1 | Home page: the Bible and media feature texts ("With your church's server…") and the "No account or internet needed…" text, to say they work out of the box through the free public server, and what a church's own server adds | `apps/website/src/content.ts` | — | Site build | — |
| M6b.2 | FAQ: "Do I need internet or an account?", the Bible, slides and videos, and phone answers; new questions: what the public server is, what it keeps (nothing; the plan's §3), why a church would still run its own; the several-computers answer stays church-only | `apps/website/src/faq.ts` | — | Site build; the FAQ's structured data still validates | — |
| M6b.3 | Feature pages: Bible (keyless versions through the public server; keyed versions need the church's server), phone remote (through the public server, two phones; internet at the venue as before), OBS (phones through the public server; browser outputs still need the church's server), compare (free public server beside the church server); several computers unchanged | `apps/website/pages/bible.md`, `phone-remote.md`, `obs.md`, `compare.md` | — | Site build | — |
| M6b.4 | Descriptions: `llms.ts` summary, page meta descriptions in `pages.ts`, the README's opening paragraph and docs table (add the discovery and this breakdown); the GitHub repository description needs no change (it names no server) | `apps/website/src/llms.ts`, `pages.ts`, `README.md` | — | Site build | — |
| M6b.5 | The same changes in Simplified and Traditional Chinese, in their own files only: English pages stay free of Chinese text | `apps/website/src/zh-hans.ts`, `zh-hant.ts`, `apps/website/pages/zh-hans/`, `zh-hant/` (`bible.md`, `phone-remote.md`, `obs.md`, `compare.md`) | M6b.1–M6b.4 | Site build | Each English change has its two counterparts ([translation plan](translation-plan.md) §8) |
| M6b.6 | Server guide: a short section saying local workspaces use the public server by themselves, and what running your own adds; the privacy notice (M7.5) linked from the FAQ and the footer | `docs/server-deployment.md`, `docs/zh-hans/`, `docs/zh-hant/`, `apps/website/src/layout.ts` | M7.5 | Site build | — |

### M7 — Deployment (M)

| # | Task | Where | Needs | Tests | Done when |
| --- | --- | --- | --- | --- | --- |
| M7.1 | Compose for public mode: the same image, `WORSHIP_Q_PUBLIC=1`, no local API port, limits in `.env` | `apps/server/compose.public.yaml` or a profile | M2 | `docker compose config` in CI | — |
| M7.2 | TURN for the public relay: wide port range, `user-quota=2`, `total-quota`, own host or managed service; `WORSHIP_Q_TURN_*` set | compose, `docs/server-deployment.md` | M7.1 | Manual: a `relay` candidate from Trickle ICE | — |
| M7.3 | Host, TLS (DNS straight to nginx, no CDN; decided 20 November 2026); `/` explains the public server in one sentence | infrastructure; `app.ts` | M7.1 | Manual: `curl /api/v1/info` shows `public: true` | — |
| M7.4 | Monitoring: up check, disk, conversion queue length, relay connections, 429 counts | infrastructure | M7.3 | — | Alerts reach the owner |
| M7.5 | Privacy notice on the website: what passes through, the deletion rule, logs, where it runs; English page, and the Chinese pages under `/zh-hans/` and `/zh-hant/` only | `apps/website` | M2.10 | — | Linked from the app's one-computer notes |

### M8 — Joining a church later (M)

| # | Task | Where | Needs | Tests | Done when |
| --- | --- | --- | --- | --- | --- |
| M8.1 | Server: `PUT /api/v1/files/:name` also takes deck images, thumbnails and videos (by their patterns) into the workspace's slides folder, within the media limits; church mode only | `app.ts` | — | §3.18 | — |
| M8.2 | Desktop: **Upload** and **Keep both** send every deck's images and thumbnails and every video copy the records name, before the records, as background files are sent today | `packages/sync`, `app/cloud.ts` | M8.1 | §3.18 | — |
| M8.3 | Server makes missing thumbnails for an uploaded deck; **Download original** on such a deck says there is none | `app.ts`, `images.ts` | M8.1 | §3.18 | — |

### M9 — Acceptance (S)

| # | Task | Where | Needs | Tests | Done when |
| --- | --- | --- | --- | --- | --- |
| M9.1 | Walkthrough on macOS and Windows against the deployed public server, with the manual checks of §3.19 | `docs/acceptance/public-server.md` | M1–M7 | §3.19 | The owner accepts |

## 3. Business rules and edge cases to test

Each subsection names the rules, then the cases that prove them, and the files they live in. Cases are unit or integration tests unless marked **manual**, in which case they belong to the M9.1 walkthrough.

### 3.1 Videos without a server (M1.1, M1.2, M1.10)

`apps/desktop/src/app/uploads.test.ts`, `src-tauri/src/media.rs`

Rules: no network; the user's file is only read; the copy plays as a church copy would.

- A video added in local mode gets a name that passes `checked_video`, and `store_video` copies it; the source's bytes and modification time are unchanged afterwards.
- No `fetch` or native upload is made, with or without a public connection.
- A file the computer cannot play is refused with the U14 message, as before; nothing is copied.
- The same file added twice makes two items and two copies (no "stored once" on the desktop).
- The disk is full while copying: the `.partial` is removed, the item is not created, the message is the existing `disk-full` one.
- A video dropped on a run sheet in local mode is added and placed in that run sheet.
- **Use new version…** on a video item without a church server; **Upload new version…** on a video item with one, and on decks, PDFs and images always; for decks, PDFs and images without any server it stays disabled.
- **Use new version…** keeps the title, Autoplay and every run sheet place; the old copy is not deleted then, but by U29 (b) later.
- A video item whose copy is gone: run sheet row and editor say so; presenting it shows the missing-video state, not a black screen; **Use new version…** brings it back.
- With a church server, a missing copy is fetched as today (U8); no "no longer on this computer" state.

### 3.2 When copies are removed (U29; M1.3, M1.4)

`apps/desktop/src/app/videoCache.test.ts`

Rules: once per launch, 30 minutes after it opens; only copies used by past run sheets alone, or by no song.

- Nothing is removed before 30 minutes, whatever passes run (after a pull, after edits).
- The moment comes after 30 minutes of elapsed time even when the window is hidden and the timer fires at half rate.
- The moment comes once: at 31 and 90 minutes nothing more is removed, even if new candidates appear.
- The app quits at 29 minutes: nothing removed; the next launch starts its own 30 minutes.
- Last week's run sheet made live within the 30 minutes: its copies are kept at the moment, and stay while it is live.
- A video item from last week copied into today's or a future run sheet within the 30 minutes: kept.
- A video both on last week's and next week's run sheets: kept.
- A video on no run sheet (just added to the library): kept, however old.
- A song deleted: its copy is a candidate (b). The song restored from history before the moment: kept.
- A song deleted but still on a current, upcoming or live run sheet, which presents it marked removed: kept.
- **Use new version…** or **Upload new version…** replaced a file: the old file is a candidate (b); the new one is not.
- A copy named by two songs, one deleted: kept while the other uses it as U29 allows.
- Today's run sheet, the app open across midnight: nothing removed during that run.
- The live run sheet is dated before today: its videos count as current.
- A copy uploaded today and on no run sheet (U14's day rule): kept (it is on no run sheet).
- A `.partial` file is never listed and never removed by U29.

### 3.3 Asking before removing (U30; M1.5–M1.9)

`apps/desktop/src/app/videoCache.test.ts`, `videoSnooze.test.ts`, the window's test

Rules: silent only when the church server has the file; nothing at all when it cannot be asked; the operator chooses for local-only copies.

- Church server answers 200 for a candidate: deleted silently, not in the banner.
- Answers 404: local-only; in the banner, not deleted.
- One answer is 500, a timeout, or the server is unreachable: nothing is deleted, silently or otherwise, and no banner, for this launch.
- A 401 (revoked computer): treated as unreachable.
- Without a church server, or on a public connection: no `HEAD` request is made; every candidate is local-only.
- Local-only candidates total 99 MB: no banner. 100 MB or more: banner with the total.
- Snoozed files are left out of the total and the list; a snooze of 29 days is still on, of 31 days is over.
- **Dismiss**: banner hidden; every listed file snoozed for 30 days; the next launch shows no banner unless new files bring the total to 100 MB.
- **Review…**: every file ticked; the total follows the ticks; **Select none** disables **Remove selected**.
- **Cancel**: the window closes, the banner stays, nothing is snoozed.
- **Remove selected** with some unticked: the ticked are removed, the unticked snoozed, banner hidden, notice with the size actually freed.
- A ticked file that became needed while the window was open (put on today's run sheet): kept, not counted, not snoozed.
- A delete fails (the file is open in the system's player on Windows): kept, not counted, the notice says how many could not be removed.
- **Open** on a copy that has since vanished: an error in the window, nothing else changes.
- The path shown is the copy's path in the app's folder; the original's path is never shown.
- Two local workspaces: each has its own list, banner and snoozes.
- A damaged snooze entry reads as empty, so files are offered again rather than never.

### 3.4 Public mode on the server (M2.1–M2.3, M2.10)

`apps/server/src/public.test.ts`, the existing suites with public mode off

Rules: the same server; only the listed features are on; church mode is unchanged.

- Each route of the discovery's §2 table answers as the table says in public mode, and as today in church mode (table-driven).
- The local API port is not listened on; the admin app and `/auth/*` answer 404.
- `info` carries the public fields of M2.2; a church `info` has no `public` and no `limits`.
- A Bible key set in the environment is ignored and a warning is logged without the key.
- A logged request carries no `Authorization`, no install identifier, and no Bible search text.
- Starting with `WORSHIP_Q_PUBLIC=1` on a data folder with church content refuses to start, naming the setting; a church server on a public data folder likewise (S11).

### 3.5 Joining (M2.4, M2.5)

`apps/server/src/public.test.ts`

Rules: anyone may join anonymously; nobody may join as a church device.

- `public/join` with the current protocol: a workspace and a device; the token authenticates on Bible, decks, images, ICE and the relay.
- With an old protocol: 426 with the server's version.
- The sixth join in an hour from one IP: 429 with `retryAfter`; another IP still joins.
- Two joins from one install make two workspaces (one per local workspace).
- The public token on `sync/pull`, `backups` or `live`: 404 (routes absent), not 401.
- `pair` and `pair/poll`: `403 public-server`. `enroll` with any code: `403 invalid-code`, with no delay to exploit.
- `public/join` on a church server: 404.

### 3.6 Decks and images, kept until confirmed (M2.6, M2.7)

`apps/server/src/media.test.ts` (public cases), `storedUploads.test.ts`

Rules: no original; no memory of uploads; deleted on confirmation.

- A deck converts as in church mode; no `deck-<id>-original.*` exists afterwards.
- An image becomes a one-page deck; no original.
- The same file uploaded twice converts twice; nothing is written to `stored_upload`.
- `DELETE /decks/:id` removes every image and thumbnail of that deck and nothing else.
- `DELETE` of another workspace's deck id: 204 and its files remain.
- `DELETE` twice: 204 both times.
- `DELETE` with a malformed id, or one with `../`: 400, nothing removed.
- A sixth conversion while five wait: `503 busy` with `retryAfter`; the queue drains in order.
- An upload over the deck or image limit: 413 while receiving, nothing left in `work/`.
- A conversion failing: 422 as today; `work/` cleaned.
- HEIC: refused as today.
- `POST /videos`: 404 in public mode.

### 3.7 Sweeps (M2.8)

`apps/server/src/publicSweep.test.ts` with a fake clock and a temporary folder

Rules: nothing older than a day; idle workspaces forgotten.

- A deck image 23 hours old stays; 25 hours old is removed.
- A `work/` folder over 24 hours old (a conversion that crashed) is removed; a fresh one is not.
- A file being written (`.partial`) under 24 hours is left alone.
- A workspace whose device was last seen 91 days ago: rows and folder removed; 89 days: kept.
- A device seen through the relay only (no HTTP) still counts as seen.
- The sweep never touches the database file, `bible/` or `libreoffice/`.
- The church retention sweep does not run in public mode, and the public sweep does not run in church mode.

### 3.8 Bible on the public server (M2.9)

`apps/server/src/bible.test.ts` (public cases)

- With no keys, the offered versions are those set in `bibleVersions` that the Free Use Bible API serves.
- A keyed version listed in `bibleVersions` (NIV) is not offered.
- No `bibleVersions` set: a warning at start; `info.bible` is false; the desktop's Bible window says none is offered.
- `bible/fums`: 404.
- A passage looked up on a public connection is saved in the run sheet item and presents offline afterwards (desktop, regression).

### 3.9 The service getter (M3.3, M3.4)

`apps/desktop/src/app/cloud.test.ts`

- Joined a church: `church`, with the church's address and token.
- Public token and not joined: `public`.
- Neither: null; Bible window, media and remote panel behave as in local mode today.
- `connected` stays false on a public connection; synchronization is never scheduled.
- The install header is on every public request and on none to a church server.

### 3.10 Joining the public server from the desktop (M3.5, M3.6, M3.8)

`apps/desktop/src/app/cloud.test.ts`

Rules: lazily; once; never in viewer mode; self-healing.

- A workspace that never opens a feature makes no request at launch or later.
- Opening the phone panel joins; so do the Bible window, **Add media…** for a deck or image, **Broadcast live audio**, and sharing OBS with phones.
- **Add media…** for a video does not join (M1.1).
- Two features opened at once: one `public/join`.
- No internet: the feature shows the connection problem; the next opening tries again; no retry loop in the background.
- The address answers `info` without `public: true`: no join, an error saying the public server cannot be reached.
- Keychain refuses the token: kept in the database as D23; works.
- After a restart with a token: the relay connects at launch; no new join.
- The public server answers 401 (workspace swept after 90 days, S4): at launch, with no operator action, one new join; the new workspace's QR code differs; previously approved phones must ask again; songs, run sheets, slides, videos and passages on the computer are unchanged.
- The new join is refused too: stop; the workspace button shows the problem.
- Viewer mode: no join from any trigger; the phone panel says remote control is not available in viewer mode.

### 3.11 What a public connection never does (M3.7)

`apps/desktop/src/app/cloud.test.ts` with a fake fetch and socket recording every call

- None of these are ever requested: `/sync/*`, `/files` PUT, `/backups`, `/live`, `/obs`, `/audio`, `/audio/recordings*`, `/presentation-log`, `/outputs`, `/workspace/lan-credentials`, `/claim`.
- No LAN listener is started and no mDNS lookup is made.
- The desktop is the coordinator as soon as the relay says ready; presenting before the relay connects works as in local mode.
- The relay drops mid-service: presenting continues; phones reconnect when it returns; no offline-coordinator switch.
- Live audio recording is never started on a public connection (records are false).

### 3.12 Decks and images from the desktop (M3.9)

`apps/desktop/src/app/uploads.test.ts`

Rules: the song exists only when every image is here; the server is told to delete afterwards.

- Upload, then every image and thumbnail fetched, then `DELETE`, then the song created.
- `DELETE` fails: the song is still created; no retry (the sweep deletes within a day).
- An image fetch fails halfway: no song, no `DELETE`; the item shows the failure; the images fetched so far are left for the local file cleanup.
- Cancelled during upload or conversion: no song, no `DELETE`.
- The app quits between the fetch and the `DELETE`: on next launch nothing is retried.
- **Upload new version…** on a deck on a public connection: the same sequence; the item keeps its places.
- **Download original** and **Reconvert** on a public connection: disabled with "The original file was not kept for this item."
- The public server answers 429 or `503 busy`: the item shows the wait, and nothing is created.

### 3.13 Church connections and the public server (M3.10, M3.11)

`apps/desktop/src/components/ChurchConnection.test.tsx`, `cloud.test.ts`

Rules: the public server cannot be joined as a church; a church replaces the public connection completely.

- Typing the public server's address: the public-server message; the stored state is unchanged; the public connection keeps working.
- Typing it with `https://`, a trailing slash, or in capitals: the same.
- A church server that is down when probed: the existing error, not the public-server message.
- Joining a church from a public connection: `publicServer` false, the public keychain entry removed, the relay reconnected to the church, phones approved through the public server must ask again.
- **Upload** or **Keep both** while joining: decks and videos travel (M8).
- Leaving the church: local mode; no public join until a feature is used; a new public workspace.
- One local workspace on the public server and another joined to a church: each keeps its own connection; switching workspaces never mixes tokens.

### 3.14 Thumbnails through the desktop (M4.2–M4.4)

`packages/remote/src/index.test.ts`, `apps/remote/src/connection.test.ts`, `apps/server/src/relay.test.ts`

Rules: only what the phone is shown; never a path.

- A phone asks for a thumbnail of a deck in the live run sheet: answered with the JPEG.
- A name of a deck not in the live run sheet, a background's name, or `../db.sqlite`: `missing`.
- The file is gone from this computer: `missing`; the phone shows the text button.
- A thumbnail over 256 KB: `missing`, never sent.
- A phone without a grant asks: nothing is answered.
- Five requests at once from the phone: four in flight, the fifth after one answers.
- The phone scrolls: only pieces on screen are asked for; each name is asked once per page load.
- The phone reconnects: thumbnails already shown stay; missing ones are asked again.
- On a church connection pieces carry no `thumbnailVia` and the phone fetches over HTTP, as today.
- A version 8 desktop on a version 9 public server: no `thumbnailVia`; the phone uses HTTP, which answers 404, and falls back to the text button.
- The relay passes both messages without reading `data`; a 300 KB message is refused and the socket stays open.

### 3.15 Phone approvals (M4.5)

`apps/desktop/src/app/liveLink.test.ts`, `packages/remote`

- An approved phone reconnects after the desktop restarts, without a code.
- **Disconnect** on one phone, and **Disconnect all**: the phone must ask again, also after a restart.
- Nothing about grants is sent to the public server beyond what the relay carries while connected.
- An invitation older than its life (it changes every few minutes): refused as today.

### 3.16 Rate limits (M5.1, M5.2, M5.5)

`apps/server/src/limits.test.ts` with a fake clock

Rules: per device, per install and per IP; forgotten after the window.

- The 100th deck or image in a day for one install is accepted, the 101st refused with `retryAfter` to the window's end; decks and images share the one count.
- A new install identifier from the same IP gets its own count, until the IP ceiling.
- No install header: counted by IP only.
- The window ends: counts are gone from memory (asserted by inspecting the store's size).
- Bible requests over the limit: 429; the desktop's Bible window says when to try again; a passage already in a run sheet still presents.
- Limits are read from settings; a bad setting stops the server at start, naming it.

### 3.17 Relay caps (M5.3, M5.4)

`apps/server/src/relay.test.ts`, `packages/audio/src/broadcaster.test.ts`

Rules: two listeners and two phones per public workspace; a reconnecting listener never refuses itself.

- Third listener: `full`; one of the two leaves; the third can then listen.
- A listener connecting afresh (A17) with its old session still open: not refused.
- A modified desktop ignoring `limits.listeners`: the relay refuses the third `listen` itself.
- Third phone: refused with a reason the phone page shows, naming the public server's limit; when one of the two disconnects, the third can be approved. An approved phone reconnecting with its grant while its old connection lingers is not refused by itself.
- Church mode: no caps beyond today's ten listeners.
- The desktop's refusal message names the public server's limit and that a church server has none.

### 3.18 Joining a church later (M8)

`packages/sync/src/index.test.ts`, `apps/server/src/sync.test.ts`

- **Upload** into an empty church workspace: every deck image, thumbnail and video copy named by a record is sent before the records; the records then sync.
- **Keep both**: the same for this computer's media.
- **Use the church's copy**: nothing is sent; local copies are left for U29.
- A video copy missing locally (removed by U30): its record is sent; the church shows it as missing; no failure.
- An upload over the church's video limit: that item is reported; the join completes.
- `PUT /files/:name` with a deck image name in church mode: stored in the slides folder; with a name matching no pattern: 400; in public mode: 404.
- A deck arriving without thumbnails gets them made on the server.

### 3.19 Checks for the walkthrough (manual)

- A new install on macOS and on Windows: no network traffic at launch (checked with a proxy) until a feature is used.
- A phone on mobile data scans the QR code, is approved, moves slides, sees deck thumbnails, and listens to live audio through TURN.
- A third phone listening is refused with the message, and a third phone asking for control is refused too.
- A 100-slide deck imports through the public server; the server's folder is empty a minute later.
- The public server is stopped mid-service: the presentation continues; the workspace button turns amber with the reason; phones come back when it returns.
- Typing the public address in Church connection shows the message.
- A local workspace with 150 MB of videos on past run sheets shows the banner after 30 minutes; **Open** plays one; **Remove selected** frees the space and the notice says how much.
- A church computer with old copies removes them silently after 30 minutes.

## 4. Order and dependencies

| Work | Tasks | When |
| --- | --- | --- |
| Videos and removal | M1 | First; ships on its own |
| Server public mode | M2.1–M2.10 | Day one, in parallel with M1 |
| Desktop public connection | M3.1–M3.3 | Day one; M3.4 onwards after M2.5 |
| Thumbnails protocol | M4.2 | Day one |
| Remote control and thumbnails | M4.1, M4.3–M4.5 | After M3.7 and M4.2 |
| Limits | M5.1–M5.3 after M2.1; M5.4, M5.5 after M2.2 | Before M7 |
| Interface | M6 | After M3 |
| Website and descriptions | M6b | Written any time after M3's behaviour is settled; merged with the release |
| Deployment | M7.1–M7.4 after M2 and M5; M7.5 after M2.10 | Before the release that turns it on |
| Joining a church later | M8 | Before the public release, so no workspace is stranded |
| Acceptance | M9 | Last |

Five tasks can begin on day one: M1.1, M1.3, M2.1, M3.1 and M4.2.

## 5. Rollout

1. **M1 ships first**, in an ordinary release: it changes video handling on church computers too (U29, U30) and is useful without the public server.
2. **The public server is deployed before any desktop knows its address.** Church servers update as usual; public mode is off on them, and protocol 9 changes nothing for them except the thumbnail messages, which church desktops do not send.
3. **The release with M3–M6 and M8** points desktops at the public server. Older desktops never contact it. The website and README changes (M6b) merge at the same time, not before, since the site deploys on every change.
4. **Turning it off** is possible from the server: `info` without `public` makes new desktops show the connection problem rather than join; existing local content is untouched, since everything the app received is cached on the computer.

## 6. Risks tied to tasks

| Risk | Task | Mitigation |
| --- | --- | --- |
| A church-mode route is accidentally left on in public mode, keeping content | M2.3 | One table-driven test over every route; a new route must be added to the table or the test fails on the route count |
| A change for public mode alters church servers | M2 | The whole existing suite runs with public mode off on every server pull request |
| Abuse: the public server as free conversion or TURN | M5, M7.2 | Per-install and per-IP limits; coturn quotas; credentials only for joined devices; monitoring of 429s |
| An operator removes a video they still need | M1.8, M1.9 | 100 MB threshold, 30-day snooze, **Open** to check, re-check before deleting, the user's own file never touched |
| Copies removed while a church server is unreachable | M1.5 | Nothing removed at all that launch |
| The thumbnail channel used to read files | M4.3 | Answers only names of the live run sheet's deck pages, by pattern; test with path-like names |
| Desktop and public server on different protocol versions | M4.2 | The phone falls back to HTTP and then to text; negotiation as D26 |
| A swept workspace loses phones' approvals | M3.8 | Only after 90 days unseen; the desktop rejoins by itself; phones ask again |
| The website promises features before the release that delivers them | M6b | Kept on a branch, merged with the release |
| Users treat the public server as backup | M6.2, M7.5 | One-computer notes where media and Bible are added; privacy notice; the plan's §5 in the guide |

## 7. Where the build differs

Built on 18 November 2026; each point is what the code does, and why.

- **S2, the install identifier,** is kept in the webview's storage (`worship-q.install`), not in the app's data folder: the storage is shared by every local workspace and survives restarts, and no native code is needed. A cleared webview makes a new one, which only resets that copy's counts.
- **S6:** with no `bibleVersions` set, a public server offers every version a provider serves without a key, rather than none; nothing needs setting with the CLI.
- **M2.3** is an allowlist (`PUBLIC_ROUTES` in `apps/server/src/public.ts`), checked before any handler: a route added later is off in public mode until listed.
- **M3.6:** sharing OBS with phones joins nothing by itself; phones reach OBS only once the phone panel has joined the public server.
- **M5.5:** a Bible request over the public server's hourly limit shows as the Bible being unavailable, without the wait: the phone and window share one error code, unchanged.
- **M7.2:** coturn's `user-quota` is not used: the relay's credentials are named by their expiry time, shared by every device, so it would limit everyone together. The relay's own limit of two listeners per workspace, coturn's `total-quota` and `max-bps` bound it instead.
- **M7.5,** the privacy notice, is not written: it must say where the server runs and how long logs are kept, which are the owner's to decide (plan §7.2).
- **M8.3:** the small copy is made when a slide image arrives without one, as the desktop sends each image before its small copy.
- **Phones over the limit** see a page saying how many phones the public server allows, and connect by themselves when one leaves.

