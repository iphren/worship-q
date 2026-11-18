# Worship Q — Public Server Technical Discovery

**Date:** 18 November 2026
**Status:** Discovery. Nothing is built. Read from the code at version 2.10.1.
**Source:** the [Public server plan](public-server-plan.md) (requirements P1–P6 and the rule in §3); `apps/server`, `apps/desktop/src/app/cloud.ts`, `packages/relay`, `packages/protocol`.

The question: how to give a computer in local mode remote control, Bible passages, slide decks, videos, live audio and shared OBS controls through a server the project runs, while changing the current app as little as possible.

## 1. Answer in short

**Run the church server itself in a "public mode", and let each local workspace join it as an anonymous, one-computer workspace that never synchronizes.**

- The church server already keys everything by *device token → workspace*. A public server is the same process with one new route that hands out a workspace and a token without an administrator, a switch that turns off every route that keeps content, and a sweep that deletes files after 24 hours.
- The desktop already does everything P1–P6 need against a church server. It needs a second kind of connection ("public") that uses the same credentials for those features and skips synchronization, backups, live-state backup, records and reports.
- The phone page, the relay, the Bible service, deck conversion, image processing and the ICE/TURN set-up are reused unchanged.
- **Videos (P4) need no server at all.** The desktop already keeps its own copy of every video it uploads; the server adds nothing a local-mode computer needs. They can be offered in local mode without the public server (§5.4).

Rough size: server about 600–900 lines with tests, desktop about 500–800, protocol a few fields, one new deployment. No database migration on church servers; no change to the phone page beyond one small fallback.

## 2. What exists today

### Server (`apps/server`)

One Fastify process, one SQLite database (`db.ts`), files under `/data`. Everything a desktop does goes through `requireDevice` (`app.ts:338`), which turns a bearer token into a `DeviceRow { id, workspaceId, name }`. The routes, grouped by what the public server needs:

| Group | Routes | Public server |
| --- | --- | --- |
| Info | `GET /api/v1/info` | Keep; say it is public |
| Joining | `/api/v1/pair*`, `/api/v1/enroll`, `/api/v1/claim` | Off; replaced by one anonymous route |
| Relay | WebSockets `/api/v1/coordinator`, `/api/v1/remote` | Keep (P1, P5, P6) |
| Browser outputs | `/api/v1/output*`, `/api/v1/outputs*` | Off (not in P1–P6) |
| Bible | `/api/v1/bible/*` | Keep (P2); FUMS route off |
| Media | `POST /api/v1/decks`, `/images`, `/videos`; `GET /api/v1/files/:name` | Decks and images kept (P3); delete after confirmation |
| Deck originals | `/api/v1/decks/:id/original`, `/reconvert` | Off: originals are not kept |
| Phone slide thumbnails | `GET /api/v1/remote/files/:ws/:name` | See §5.3 |
| Live audio | `GET /api/v1/ice` | Keep (P5) |
| Synchronization, backups | `/api/v1/sync/*`, `PUT /api/v1/files/:name`, `/api/v1/backups*` | Off |
| Live-state backup | `PUT/GET /api/v1/live` | Off: it stores snapshots and phone grants |
| Reports and records | `/api/v1/obs`, `/api/v1/audio`, `/api/v1/audio/recordings*`, `/api/v1/presentation-log` | Off |
| Admin app, sign-in, local API | `/admin`, `/auth/*`, `/api/v1/admin/*`, port 8081 | Off |

Useful pieces already in place:

- **The relay** (`packages/relay`) takes a `RelayDirectory` interface (authenticate a token, look up a workspace, check a device is active). It holds no presentation state and makes no approval decisions: phone approval is decided on the desktop (D25). It already carries phone control, Bible requests from phones (through the desktop, B26), live audio signalling and OBS sharing.
- **`ServerInfo`** (`packages/protocol/src/wire.ts:104`) already has capability flags the desktop obeys: `decks`, `outputs`, `media`, `bible`, `audioRelay`, `records`. A public server can say `outputs: false`, `records: { audio: false, log: false }`, `admin: false`.
- **The Bible service** works with no keys: the Free Use Bible API serves CUNP-S, CUNP-T, KJV and BSB. Which versions are offered is a church setting (`bibleVersions`), which can be set once with the existing CLI (`settings set bibleVersions [...]`). P2 needs **no Bible code change**.
- **ICE** (`ice.ts`) hands out STUN and short-lived TURN credentials per device token; coturn runs as a Compose profile already.

### Desktop (`apps/desktop/src/app/cloud.ts`)

`CloudController` holds the church connection. Its state is `SyncState` (`packages/store/src/sync.ts:36`), kept in each workspace's own database: `server`, `deviceId`, `deviceToken`, `workspaceServerId`, `joinedAt`, and so on.

- `connected` (`cloud.ts:340`) is `deviceToken && joinedAt`. It gates synchronization, backups, the relay, media, the video cache, browser outputs and the remote-control panel.
- `start()` (`cloud.ts:522`) returns early when not connected; otherwise it negotiates, starts the live link (`startLive`, `cloud.ts:1210`), syncs, backs up, refreshes outputs and LAN credentials.
- The Bible (`bibleServer()`), media (`uploadDeps().credentials`), ICE, `remoteLink()` and the relay all read `server` and `deviceToken` from the state, and nothing more. **That is the seam**: give them a public server's address and token and they work.

## 3. Options considered

| | A. Church server in public mode (recommended) | B. A new, separate public service | C. Stateless relay only, features done locally |
| --- | --- | --- | --- |
| Server work | A mode switch, one route, a sweep, rate limits | New service re-implementing relay, deck conversion, Bible, ICE | New relay; desktop gets LibreOffice, Bible client |
| Desktop work | A second kind of connection; skip sync | New client for a new API | Large: bundle converters, keyless Bible client |
| Phone page | Unchanged | Changed or duplicated | Changed |
| Drift risk | None: one codebase, one protocol, tested together | Two servers to keep in step with each protocol bump | Two code paths per feature |
| Isolation of public traffic from church servers | By configuration | Complete | Complete |

B and C cost far more and buy nothing the requirements ask for. A keeps one server, one protocol and the existing version negotiation (D26), so a public server updated with each release keeps working with older desktops exactly as a church server does.

## 4. The design

### 4.1 Server: public mode

A new setting, `WORSHIP_Q_PUBLIC=1`, read in `main.ts` and passed to `buildServer` as `config.public`.

**Joining.** One new route, only in public mode:

```
POST /api/v1/public/join   { protocolVersion, installId }
→ { deviceId, deviceToken, workspace: { id } }
```

It calls the existing `instance.createWorkspace(...)` and `instance.enroll(...)` back to back, so the result is an ordinary workspace with one device. No name is asked; the device name is fixed ("Worship Q"). `installId` is the random identifier of §4.4. Limited per IP address (a handful an hour), like `startPairing` already is.

**Routes turned off.** In public mode the route groups marked *Off* in §2 are not registered, so they answer 404. This is one `if (!config.public)` around each group in `app.ts`; `buildLocalServer`, the OIDC client and the admin static files are not started in `main.ts`. `/api/v1/info` adds `public: true` and the limits.

**Media: delete after confirmation.** Decks and images are converted exactly as today (`makeDeck`), with three differences in public mode:

1. **No original kept.** `makeDeck` stops copying the upload beside the images (`deck-<id>-original.*`).
2. **No "stored once" memory** (`storedUploads.ts`, U28): it remembers hashes so the same file is not kept twice, which would point at files already deleted. Skip `rememberDeck`/`rememberVideo`/`storedDeck` and the start-up backfill.
3. **Confirmation.** A new route, `DELETE /api/v1/decks/:id`, removes the deck's images and thumbnails from the workspace folder. The desktop calls it after it has fetched the images.

**The 24-hour sweep.** A new function beside `sweepDeletedFiles`, run hourly in public mode: delete any file in a workspace's files folder, and any `work/` folder, older than 24 hours. It goes by file time, so it needs no records.

**Forgetting workspaces.** A public server accumulates one workspace and device row per local workspace that ever used it. Rows hold no content (a name, a token hash, dates), but they should not grow for ever: the same sweep removes workspaces whose only device was last seen more than, say, 90 days ago. A desktop whose token is refused simply joins again (§4.2), so nothing is lost.

**Rate limits.** In memory, per device and per `installId`, with a per-IP ceiling behind them, as the plan's §7 asks. Kept outside SQLite so the server forgets them when the window ends. Upload limits reuse `mediaLimits` (`WORSHIP_Q_MAX_*_MB`), likely set lower. Concurrency limits (phones, listeners) are counted in the relay through `RelayOptions`, which is already how the server passes policy into it.

**Database.** No migration. A public server uses the same schema; the tables it does not use stay empty.

### 4.2 Desktop: a "public" connection

Keep `connected` meaning *joined a church workspace*, because it gates synchronization and too many places read it that way. Add one more idea next to it:

```ts
/** Who answers the server features of this workspace: its church, the public server, or nobody. */
get service(): { kind: 'church' | 'public'; server: string; token: string } | null
```

- `kind: 'church'` when `connected`, as today.
- `kind: 'public'` when not connected and the workspace holds a public token.
- The Bible (`bibleServer`), media (`uploadDeps().credentials`, `mediaOffer`), ICE, `remoteLink()` and the relay read `service` instead of `state.server`/`state.deviceToken`. About a dozen call sites, all in `cloud.ts`.

**Where the public token lives.** In the same `SyncState`, with `server` set to the public address and `joinedAt` left null, so `connected` stays false. Add one field, `publicServer: boolean`, so leaving it is unambiguous. Joining a church server (`enroll`/`pollPairing` → `joined`) overwrites these fields as it does today, so §6 of the plan ("once connected, the workspace no longer uses the public server") follows without extra code. The token goes into the keychain through the existing `protectToken` path.

**Joining lazily.** The plan says no network until a feature is used. `ensurePublic()` runs `POST /api/v1/public/join` the first time any of these is opened: the phone panel, the Bible window, **Add media…**, **Broadcast live audio**, or OBS sharing. After that, `start()` connects the relay at launch like a church connection, so phones that were approved can come back.

**What `startLive()` skips for a public connection:**

| Part | Why skipped |
| --- | --- |
| `sync()`, `backupIfDue()`, the sync timers, `checkFonts()` | No content on the public server |
| `LiveBackupApi` (`PUT/GET /api/v1/live`) | Stores snapshots and phone grants; give `LiveLink` a backup that keeps nothing |
| `ObsReporter`, `AudioReporter`, `PresentationLogger`, `RecordingUploader` | Reports for the admin app and records; `records` is false anyway |
| `refreshOutputs()`, `refreshLanCredentials()`, `LanHost`, `LanTransport` | One computer; browser outputs are not offered |
| `considerOffline()` | One computer is always its own coordinator; it already presents without a connection |

So `startLive()` gains one parameter, and the relay's `hello`, the `LiveLink`, the `RemoteHost` and the audio and OBS sharing stay as they are.

**The coordinator role.** With one computer in the workspace the relay gives it the coordinator role on its first hello (D14), which is what local mode does today on its own. Two copies of the app never share a public workspace, because each local workspace joins separately.

**UI.**

- **Remote control** (`RemoteControl.tsx:115`): shows the QR code when `service` is set or can be set, instead of only when `connected`. Its **Disconnect all** stays church-only.
- **Bible window** (`BibleWindow.tsx:267`) and **run sheet** (`RunSheetEditor.tsx:233`) read `status.server`, which a public connection fills in.
- **Media** (`SongsPage.tsx:357`, `UploadProgress.tsx:127`): read `mediaOffer()`, which follows `service`.
- **Workspace button** (plan §2): shown when `service.kind === 'public'`; its amber state comes from the existing `RelayStatus`.
- **One-computer notes** (plan §5) in the media and Bible windows: new strings in `@worship-q/i18n`, in all three languages.

### 4.3 Media on the desktop

`MediaUploads` (`uploads.ts`) already does upload → fetch images (`fetchDeckImages`) → create the song. For a public connection, add one step after `fetchDeckImages`: `DELETE /api/v1/decks/:id`. If that call fails, the 24-hour sweep deletes the files anyway, so the step needs no retry.

**Download original** and **Reconvert** (`downloadOriginal`, `reconvert`): already fall back to a local copy for videos; for decks they should say there is no original (plan §5), which is the existing `no-original` error.

### 4.4 The install identifier

Rate limits need an identity for each copy of the app without accounts (plan §7.1). Make a random UUID on first use and keep it in the app's data folder (`AppData` in `src-tauri/src/db.rs`), shared by all its local workspaces, sent in `public/join` and as a header on public requests. The server keeps it only in its in-memory limit windows. It is easily reset by reinstalling, so the per-IP ceiling is the real backstop.

### 4.5 Where the public address comes from

A build-time constant (`https://public.worship-q.com` or similar), overridable with an environment variable for development and tests. The desktop should check `GET /api/v1/info` says `public: true` before joining, so a wrong address fails clearly.

## 5. Findings that change the plan

### 5.1 P4 Videos do not need a server

A video upload (`POST /api/v1/videos`) only receives the file, hashes it and stores it; the duration check is done on the desktop (`probeVideo`), and the desktop already keeps its own copy (`storeVideo`). For one computer the server adds nothing. **Recommendation:** in local mode, name the file `video-<uuid>.<ext>` on the desktop, store it, and create the song, without any network. This removes P4 from the public server, with its 200 MB uploads and their bandwidth.

### 5.2 The video cache would delete the only copy

`VideoCache.once()` (`videoCache.ts:110–125`) removes every local video not on today's or an upcoming run sheet, *before* it checks whether it is connected, and expects to fetch it back from the church server when needed. In local or public mode that local copy is the only one. **Must change** before videos are offered without a church server: without one, keep every video a song in the library uses, and remove only those no song uses.

### 5.3 Phones would lose slide thumbnails

Phones show deck slides as thumbnails fetched from the server (`apps/remote/src/RemoteApp.tsx:293`, `/api/v1/remote/files/...`). After the desktop confirms and the public server deletes them, those links answer 404. Choices:

1. **Phones show text only for decks on a public connection** (recommended). The desktop's `RemoteHost` leaves `thumbnail` out of pieces (`packages/remote/src/index.ts:208`); the phone already shows a text button then. Smallest change; slide decks already carry each slide's text.
2. Desktop sends small thumbnails over the relay. Works, but adds traffic to the relay and a protocol message.
3. Keep thumbnails 24 hours. Breaks "deleted as soon as confirmed" and fails the next week.

### 5.4 Live audio's real cost is TURN

The audio goes peer-to-peer; the server only signals. Phones on mobile networks often need TURN, and every relayed listener costs about 29 MB an hour of the public server's bandwidth both ways. The coturn profile and its 21 ports are sized for one church: a public relay needs a larger port range and a per-workspace listener cap. Running STUN only at first, with TURN later, is a reasonable step: listeners that cannot connect are already told whether a relay was offered.

### 5.5 Phone approvals are not kept on the server

Today the coordinator backs up its live state and phone grants with `PUT /api/v1/live`, so phones stay approved across restarts and on other computers (D25). A public connection must not send that. With one computer the grants live on the desktop; **to confirm when building** that a restarted desktop still recognises its approved phones from its own storage without the server's copy, or the phone asks for approval again, which is acceptable.

### 5.6 Bible usage reporting is already off

Keyless versions carry no FUMS token, so `bible.fums.report` never runs; turning the `/api/v1/bible/fums` route off is only tidiness.

## 6. Hosting

- **Same Docker image**, `WORSHIP_Q_PUBLIC=1`, behind the same reverse proxy and CloudFront set-up as a church server (`docs/server-deployment.md`). LibreOffice and Ghostscript are already in the image.
- **One instance first.** The relay keeps rooms in memory, so a workspace's desktop and phones must reach the same process. When one machine is not enough, route by workspace (the phone link already carries `w=<workspace>`, and the desktop's token names it) to sticky backends.
- **Deck conversion** runs one deck at a time per process; a queue limit and a "busy, try again" answer are needed before it is public.
- **Disk** stays small: only files waiting for confirmation, never more than 24 hours old.
- **Logs**: Fastify's request log includes paths with workspace ids and the client IP; decide what to keep for the privacy notice (plan §7.2).

## 7. Milestones

| # | Work | Size | Depends on |
| --- | --- | --- | --- |
| M1 | Local videos without a server; video cache keeps every used video (§5.1, §5.2) | S | — |
| M2 | Server public mode: switch, `public/join`, routes off, no originals or stored-once memory, deck `DELETE`, 24-hour and idle-workspace sweeps, `ServerInfo.public` | M | — |
| M3 | Desktop `service` and the public connection: lazy join, keychain, `startLive` without sync, backup or reports; Bible and media through it | M | M2 |
| M4 | Remote control on a public connection; phones without thumbnails (§5.3); confirm grants (§5.5) | S | M3 |
| M5 | Rate limits and install identifier; relay concurrency caps | M | M2 |
| M6 | UI: workspace button and status, one-computer notes, three languages; volunteer guide | S | M3 |
| M7 | Deployment: public host, CloudFront, STUN (TURN later, §5.4), monitoring; privacy notice on the website | M | M2, M5 |
| M8 | Joining a church later uploads cached deck images and videos (plan §6) | M | M3 |

M1 is useful on its own and can ship first. M8 is needed only once churches move from the public server to their own.

## 8. Still to decide

1. **Videos**: accept §5.1, so P4 is local only and the plan's P4 changes to "works in local mode, no server".
2. **Thumbnails on phones**: option 1 of §5.3, or the relay option.
3. **TURN**: public STUN only at launch, or a TURN relay from the start (§5.4).
4. **One public workspace per local workspace** (as designed) or one per copy of the app. Per local workspace keeps workspaces apart, as the app already does for church connections.
5. The rate-limit numbers and the privacy notice (plan §7).
