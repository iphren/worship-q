# Worship Q — Service Records Task Breakdown

**Drafted:** 14 November 2026  
**Status:** Draft, reviewed with the project owner on 14 November 2026: recording is on by default with a switch (R3), it is said in Settings and nowhere else (R6), the log never expires (R19), the local API needs no key for now (R21), an entry shorter than one second is not kept (R14), and an entry copies no content but refers to the revision of the item that was shown (R15). Nothing is built. There is no separate plan: the three features are small enough that this document carries their decisions (§2, R1–R22); those not named here are still proposed (§3).  
**Source:** the three items added to the unscheduled list of the [Phase 3 Plan](phase-3-plan.md) §7 on 14 November 2026; the [Live Audio Broadcast Plan](live-audio-plan.md) (A1–A16) and its [task breakdown](live-audio-task-breakdown.md) (A17–A24), whose broadcast this records; and the code at version 2.4.1 (protocol version 7).

The three features, called *service records* here:

1. **Live audio backup.** When a workspace is broadcasting live audio, the server saves a recording of the broadcast as it goes.
2. **Presentation log.** The server keeps a record of what was presented: a snapshot of the content, with when it started and when it ended.
3. **Local API.** A read-only API of the church server on localhost, so other services running at the church can read run sheets, the presentation log and the audio recordings.

## 1. How to read this

Tasks are small enough to be one pull request each, say where in the repository they land, and name the tests that prove them. Task identifiers are `M<milestone>.<n>`; a task lists the tasks it needs first. Sizes are S, M and L as in the phase plans.

Every task that changes business logic carries unit tests in its package, and every task that adds a server route carries a test beside the others in `apps/server/src`. The desktop, phone and admin interfaces have no automated tests beyond their state-to-label mappings; the M7 walkthrough covers them.

### Where things live today

| Concern | Location |
| --- | --- |
| Capture: the one shared track, taken again when the device goes or is muted | `packages/audio/src/input.ts` (`InputWatcher`), `browser.ts` (`browserMediaPort`) |
| The broadcast on a desktop: switch, state, sessions, take-over | `apps/desktop/src/app/audioShare.ts`, `audioSettings.ts` |
| The broadcaster's report to the server, by HTTP | `apps/desktop/src/app/audioReport.ts`, `apps/server/src/audioReports.ts` |
| Audio state and signals, protocol version 7 | `packages/protocol/src/audio.ts` |
| The live snapshot: run sheet, items, what is on screen, blank | `packages/protocol/src/wire.ts` (`LiveSnapshotSchema`, `SnapshotPresentedSchema`), `records.ts` (`LiveStateSchema`) |
| The coordinator publishing snapshots and backing them up to the server one second after a change | `apps/desktop/src/app/liveLink.ts` (`scheduleBackup`), `cloud.ts` (`PUT /api/v1/live`) |
| Server routes for devices, and for administrators | `apps/server/src/app.ts`, `admin.ts` |
| Server database and its migrations | `apps/server/src/db.ts`, `instance.ts` |
| Run sheets as the server reads them for the admin app | `instance.ts` (`runSheetDays`, `runSheet`) |
| Files on the server, range requests, the storage report, the retention sweep | `apps/server/src/files.ts`, `ranges.ts`, `storage.ts`, `retention.ts` |
| Server start, environment, container | `apps/server/src/main.ts`, `cli.ts`, `compose.yaml` |
| Admin app pages | `apps/admin/src/pages/Workspace.tsx`, `RunSheets.tsx`, `Storage.tsx`, `Settings.tsx` |

### Three facts that shape the tasks

- **The server never receives the audio.** Live audio is peer-to-peer from the broadcasting desktop (A1, A2); the server carries only signalling, and the deployment guide says *nothing is recorded* (A13). So "the server saves a recording" needs a new path for the sound itself, and it reverses A13.
- **The server sees the presentation only in part.** It gets the coordinator's snapshot one second after the last change (`BACKUP_DELAY_MS`), so quick changes are merged, and it gets nothing at all while the desktops meet only on the venue network. A log built on the server from what it happens to see would have holes.
- **The server listens on one port, behind the reverse proxy.** Compose publishes it on `127.0.0.1:8080` and the proxy forwards everything. There is no route today that is reachable from the server's own machine and not from the internet.

## 2. Proposed decisions

All proposed. They continue no earlier numbering; R is for records.

### Live audio backup

| # | Topic | Decision |
| --- | --- | --- |
| R1 | Path of the sound | The broadcasting desktop records its own capture track and uploads it to the server over HTTPS in short chunks; the server appends them to a file. The server does not join the broadcast as a WebRTC listener: that would add a WebRTC stack to the Node process, need a UDP path to a server that sits behind a reverse proxy, and leave a gap in the file for every lost packet. An upload loses nothing, passes through the existing proxy, and can catch up after an outage. |
| R2 | Reverses A13 | Live audio is now recorded on the server. The deployment guide, the volunteer guide and the live audio plan are corrected, and the broadcasting computer's Settings says so (R6). |
| R3 | Automatic, with one switch | Recording needs no action in any workspace: whenever a broadcast is live and the server accepts recordings, it is recorded. The church has one switch, **Record live audio**, in the admin app's Settings, on by default; an administrator can turn it off. No per-workspace switch. **Agreed.** |
| R4 | Recorder | `MediaRecorder` on the capture track in the main window, at 64 kbps mono, started with a five-second timeslice. The container is whatever the webview gives: WebM with Opus on Windows; MP4 with AAC on macOS, unless the spike finds WebM there. The server stores the bytes as they come and never transcodes. About 29 MB an hour. Native capture in Rust stays the fallback if M0 finds the recorder disturbs the broadcast. |
| R5 | Recordings and parts | One recording is one unbroken run of one capture track: it starts when the track is live, and ends when the track ends or is replaced (device unplugged, muted and taken again, another input picked), the switch goes off, another computer takes over, or the app quits. A broadcast with an unplugged minute is therefore two recordings. Nothing is recorded while the status is **Waiting for input**. Silence is recorded as silence. |
| R6 | Said in Settings only | No label or indicator anywhere on screen: not on the Present page, the phone or the admin page. The text under the **Broadcast live audio** switch in the broadcasting computer's Settings says that the broadcast is recorded on the church's server while the church records, and the status line there adds what is unusual: how much is waiting to upload, or that the server is not recording and why. The audio state is unchanged. **Agreed.** |
| R7 | Offline and slow connections | Chunks are sent in order, one at a time. Chunks that cannot be sent wait in the webview's IndexedDB, surviving a restart, up to 500 MB (about 17 hours); beyond that the oldest recording still waiting is dropped whole and Settings says so. A service on the venue network alone is saved when the server is next reached. |
| R8 | Upload protocol | `POST /api/v1/audio/recordings` opens a recording (id made by the desktop, start time, container type, input name) and is safe to repeat. `PUT /api/v1/audio/recordings/:id/chunks/:seq` appends chunk `seq`: the server accepts only the next one, answers a repeat as already stored, and answers a gap with the number it expects. `POST …/:id/complete` closes it with its end time. Only the device that opened a recording may add to it. |
| R9 | Storage on the server | Files in `/data/recordings/<workspace>/<recording>.<webm or m4a>`; one row per recording in a new `audio_recording` table: workspace, device and its name, input name, start and end, bytes, next chunk, and whether it was completed. A recording with no chunk for ten minutes and no `complete` is shown as interrupted, and still accepts its next chunk. |
| R10 | Retention | Recordings are removed after `WORSHIP_Q_RECORDING_DAYS`, 90 by default, by the daily sweep that already runs; `0` keeps them for ever. The Storage page counts them as their own kind. |
| R11 | Who can hear a recording | Administrators, in the admin app: listed on the workspace's page, played in the page, downloaded, deleted. And the local API (R19). Not desktops and not phones. |

### Presentation log

| # | Topic | Decision |
| --- | --- | --- |
| R12 | Who writes it | The coordinator, which applies every change in order, on the venue network too. It turns each pair of consecutive snapshots into log events with one pure function and uploads them by HTTP. The server does not derive the log from the backup snapshots (second fact above). |
| R13 | What an entry is | One unbroken showing of one piece on the outputs. It starts when the piece goes on screen: by a presenting command, by **Go live** with something presented, or by unblanking. It ends when another piece replaces it, the screen is cleared or blanked, or the live state ends or expires. Blank and clear make no entry of their own; they are the gaps between entries. Changes to a run sheet that do not change what is on screen make no entry. |
| R14 | Short showings | An entry that lasted less than one second is not kept, so an operator stepping through a song to reach a verse does not fill the log. **Agreed.** |
| R15 | What an entry refers to | An entry copies no text. Every run sheet item is a song record, whether lyrics, slides, a video, a website or a Bible passage, and every edit of one leaves a revision record with all its fields, synchronized to the server and kept (`SongRevisionSchema`, kind `songRevision`). So an entry names the exact revision that was on screen, by the revision record's id, with the song's id and revision number, and for a song with two versions (D31) the revision of the version in use. It adds only what the revision does not say: the run sheet's id and date, the item's id, whether it was from the previous run sheet, and which part was shown: the lines of the lyrics, by position and count, since how lines are grouped into pieces is a setting; the slide number of a deck; the verse units of a passage's slide, by position and count. Later edits make later revisions and leave the entry's alone. **The background is the one thing recorded beside the revision,** because it is not part of one: a song's background is a workspace setting, and the slideshow's and the Bible's are too. The entry keeps the colour and the background's id as they were when the entry opened; a change of background alone opens no new entry. **Agreed.** |
| R16 | Times | `startedAt` and `endedAt` are the coordinator's clock. Each upload also carries the coordinator's time of sending, so the server stores its own clock's offset beside the entry; recordings do the same (R8), which lets a reader line a recording up with the log. |
| R17 | Upload, and offline | Events wait in a table of the workspace's local database that synchronization does not carry, and are sent in batches to `POST /api/v1/presentation-log`: on a change after one second, and every half minute while any wait. An entry is sent when it opens and again when it closes, under the same id, so a repeat changes nothing and the server can show what is on screen now. Sent rows are deleted; unsent rows older than 30 days are dropped. |
| R18 | Hand-over and failure | A coordinator that takes the role opens an entry for what is on screen at that moment. An entry still open when a later entry of the workspace starts is closed by the server at that start, and one still open when the live state expires is closed at its last activity; both are marked as closed by the server. Two adjacent entries for one piece across a hand-over are left as they are. |
| R19 | Storage, retention and reading | A new `presentation_log` table, indexed by workspace and start time. It never expires: a service is a few hundred small rows. The admin app's workspace page shows a day's log with its times, beside that day's recordings. Otherwise it is read through the local API. **Agreed.** |

### Local API

| # | Topic | Decision |
| --- | --- | --- |
| R20 | A listener of its own | A second HTTP listener in the same process, on port 8081 (`WORSHIP_Q_LOCAL_PORT`; empty turns it off), which Compose publishes on `127.0.0.1` only and which the reverse proxy is never pointed at. It serves only the local API; the public listener does not serve it at all. |
| R21 | No key, for now | Requests carry no key. The guard is that the port is published on loopback only and never proxied (R20), so anything running on the server's machine can read everything the API serves. Keys can be added later without changing the routes. **Agreed.** |
| R22 | Shape | Read-only, `GET` only, JSON, under `/local/v1`, covering every workspace of the church: workspaces; a workspace's run sheet dates and one date's run sheet with its items and their content; what is on screen now; the presentation log by time range or after a cursor, each entry with its content in full; recordings by time range, and a recording's file with range requests, readable while it is still being received; a workspace's slide and video files by name, which the log refers to. No webhooks and no event stream: a reader polls with the cursor. The API is versioned apart from the device protocol and documented in `docs/local-api.md`. **Rich text:** each log entry is returned with its content in full, joined from the revision it names (R15) at the time of reading, also when the song or its run sheet was removed since, and structured, never flattened to one string: lyrics as the lines shown, with their block; a passage as its columns, one per version, each with the reference in that version's language, the verse units shown with their labels, the lines of poetry kept, and the copyright line; a slide as its text, line by line, as the import read it from the slide (`DeckPageSchema.text`; empty for a slide that is only a picture), with its slide number and animation step, and links to its image and thumbnail; a video as a link and its duration; a website as its address; and with each, the background as its colour and a link to its image or video. **Media are links, never bytes:** the log and the run sheets return addresses under one separate route, `/local/v1/workspaces/:id/media/:name`, which serves the file itself, with range requests, to a reader that wants it. A link to a file the retention sweep has removed is still returned, marked as gone. Every content also carries a plain-text form. An entry whose revision has not reached the server yet is returned without content, and with it on a later read. |

### Across all three

No protocol version changes: nothing new passes through the relay, and the audio state is as it was. The server's `info` gains `records`, saying whether it takes recordings and log entries; a desktop uploads only what `info` offers, so against an older server it uploads nothing and says nothing.

## 3. Still proposed

Settled on 14 November 2026: R3, R6, R14, R15, R19 and R21, as marked in §2. Everything else in §2 is proposed, and nothing waits for an answer.

## 4. Tasks by milestone

### M0 — Spike: recording beside the broadcast (S)

Throwaway code on a branch that is not merged. Results added to `docs/spikes/live-audio.md`.

| # | Task | Done when |
| --- | --- | --- |
| M0.1 | `MediaRecorder` on the capture track in the real app's main window while three listeners are connected, on macOS (WKWebView) and Windows (WebView2): the types offered, the bit rate obtained, processor cost, and whether the listeners' delay or loss changes | Types and figures recorded; R4's format is fixed for each platform, or native capture is chosen |
| M0.2 | Chunks from a five-second timeslice, appended in order on disk, play from start to end and seek in Safari, Chrome and VLC, for each container; and a file cut off mid-chunk still plays up to the cut | R8's append-only file is confirmed, or parts become separate files |
| M0.3 | What the recorder does when the track ends, is muted and replaced (L7), and while the main window is hidden (L17) or the display sleeps (L9) | Each case maps to R5's rule for ending a recording |
| M0.4 | Chunks as Blobs in IndexedDB: kept across a restart of the app, 500 MB accepted, read back in order | R7 stands, or the queue moves to files through the Tauri core |
| M0.5 | Two hours of recording and uploading on a venue connection beside ten listeners: upload used, memory held, drift between the recording's length and the clock | Figures recorded |

**Exit:** R4, R5, R7 and R8 are confirmed or changed, and nothing below says "to be verified".

### M1 — Protocol and server foundations (S)

| # | Task | Where | Needs | Tests | Done when |
| --- | --- | --- | --- | --- | --- |
| M1.1 | `ServerInfo` gains `records: { audio, log }`, absent on an older server; the desktop reads it with the rest of `info` | `packages/protocol/src/wire.ts`, `apps/server/src/app.ts`, `apps/desktop/src/app/serverInfo.ts` | — | `serverInfo.test.ts`: an `info` without the field reads as offering neither | No protocol version changes |
| M1.2 | Schemas for the uploads: recording open, chunk headers, complete; log events (open, close) with the reference of R15: revision, part shown; the content the local API returns (R22) | new `packages/protocol/src/records-log.ts` (name to settle), exported from the index | — | Each kind parses; a malformed entry is refused | One definition for desktop, server and local API |
| M1.3 | Migration: `audio_recording` and `presentation_log`; `Instance` methods to write and read each | `apps/server/src/db.ts`, `instance.ts` | M1.2 | Round-trips on an in-memory database; a database from 2.4.1 migrates | R9, R19 |
| M1.4 | Church setting `recordLiveAudio`, on unless set off, and `WORSHIP_Q_RECORDING_DAYS`; `info.records.audio` follows the setting | `instance.ts`, `retention.ts`, `main.ts`, `compose.yaml` | M1.1 | Unit on the setting and the environment value, as `retentionDaysFromEnv` | R3, R10 |

### M2 — Recordings on the server (M)

| # | Task | Where | Needs | Tests | Done when |
| --- | --- | --- | --- | --- | --- |
| M2.1 | Open, append and complete (R8): the next chunk only, a repeat acknowledged, a gap answered with the expected number, the owner device only, a chunk size limit, refused when the church's switch is off | new `apps/server/src/recordings.ts`, `app.ts` | M1.3, M1.4 | §5.1 | A file on disk equals the chunks in order |
| M2.2 | Interrupted recordings: shown as interrupted after ten minutes without a chunk; still appendable; a chunk half-written when the server stopped is cut back to the last whole chunk at start | `recordings.ts`, `main.ts` | M2.1 | §5.1, last group | A restart of the server loses at most the chunk in flight, which the desktop sends again |
| M2.3 | Retention sweep and storage report: recordings older than the period removed with their rows; `recordings` as a storage kind, by workspace | `retention.ts`, `storage.ts`, `packages/protocol/src/admin.ts` | M2.1 | `retention.test.ts`, and the storage report's totals | R10 |
| M2.4 | Admin routes: list a workspace's recordings by day, fetch one with range requests while it grows, delete one | `admin.ts`, `ranges.ts` | M2.1 | `admin.test.ts`: signed out refused; a range of a growing file; delete removes file and row | R11 |

**Milestone done:** chunks posted by hand with `curl` and a device token become a playable file that an administrator's session can fetch, and a stopped and restarted server carries on with the same recording.

### M3 — Recording on the broadcasting desktop (M)

| # | Task | Where | Needs | Tests | Done when |
| --- | --- | --- | --- | --- | --- |
| M3.1 | Recorder session, pure: from the track (live, ended, replaced), the switch, take-over, and whether the server takes recordings, it decides when a recording opens and closes, numbers the chunks, and holds the queue's order and its 500 MB limit | new `packages/audio/src/recorder.ts` | M0, M1.2 | §5.2, with a fake recorder, queue and clock | R5, R7 in one place |
| M3.2 | Browser port: `MediaRecorder` on the capture track with the type chosen in M0.1; the IndexedDB queue | `packages/audio/src/browser.ts`, new `recordQueue.ts` | M3.1, M0.4 | Unit on the queue with a fake IndexedDB | Chunks survive a restart |
| M3.3 | Uploader: one request at a time, in order, with a growing wait after a failure (1 s to 1 min); follows the server's expected chunk number; drops a recording the server refuses for good (switch off, unknown device) | new `apps/desktop/src/app/audioRecord.ts`, `cloud.ts` | M3.2, M2.1 | §5.2: order kept across failures; resumes after a restart; a refusal for good empties the queue | Nothing is sent twice into the file |
| M3.4 | Wiring: `AudioShare` starts and stops the recorder with the track and stops it on take-over, and exposes the recorder's status to Settings; nothing against a server whose `info` offers no recording | `audioShare.ts`, `cloud.ts` | M3.1, M1.1 | `audioShare.test.ts`: each of R5's endings; the audio state it publishes is unchanged | R5 |
| M3.5 | Settings text: under the **Broadcast live audio** switch, that the broadcast is recorded on the church's server, shown only while the server records; the status line gains waiting to upload with the amount, and not recording with the reason. Nothing on the Present page or the phone | `AudioSettings.tsx`, `en.ts` | M3.4 | Unit on the status-to-text mapping | R6 |

**Milestone done:** a broadcast started with the mixer's interface plugged in appears on the server within ten seconds and grows; unplugging the network cable for five minutes and plugging it back leaves one complete file; unplugging the audio interface and plugging it back leaves two.

### M4 — Presentation log (M)

| # | Task | Where | Needs | Tests | Done when |
| --- | --- | --- | --- | --- | --- |
| M4.1 | Log events from snapshots, pure: `logEvents(previous, next, now)` returns the entries to close and to open by R13, each naming the item, the song and the part shown (lines, slide or verse units, from the presented piece) | new `packages/live-state/src/presentationLog.ts` | M1.2 | §5.3 | Every command that changes the screen is covered |
| M4.2 | Local outbox: a table of the workspace database that synchronization does not carry; append, read in order, delete when sent, drop after 30 days; R14's one-second floor applied when an entry closes before it was ever sent | `packages/store` | M4.1 | Store tests: order, deletion, the floor; the table is absent from the synchronized set | R14, R17 |
| M4.3 | Coordinator wiring: `LiveLink` runs M4.1 on each snapshot it publishes while it is the coordinator, adds to each opening entry the background in use (the song's, or else the slideshow's or the Bible's) and the revision of the song then in the store (the version in use, for a song with two), opens an entry on taking the role and closes its open one on losing it, ending or quitting; the uploader sends batches after one second and every half minute | `liveLink.ts`, new `apps/desktop/src/app/presentationLog.ts`, `cloud.ts` | M4.1, M4.2, M4.4 | `liveLink.test.ts`: a service with no server reaches the server later, whole and in order; a follower writes nothing | R12, R17, R18 |
| M4.4 | Server: `POST /api/v1/presentation-log` takes a batch, upserts by entry id, never reopens a closed entry, stores the clock offset, and closes an earlier open entry of the workspace when a later one starts | `app.ts`, `instance.ts` | M1.3 | §5.4 | R16, R18 |
| M4.5 | Entries left open: closed at the live state's last activity when the stored live state expires, marked as closed by the server | `instance.ts`, the daily sweep in `main.ts` | M4.4 | §5.4, last group | No entry stays open for ever |

**Milestone done:** after a rehearsal run from two desktops, with a hand-over in the middle and ten minutes on the venue network alone, the server's log lists every piece shown for a second or more, in order, with no entry overlapping the next.

### M5 — Admin app (S)

| # | Task | Where | Needs | Tests | Done when |
| --- | --- | --- | --- | --- | --- |
| M5.1 | **Record live audio** in Settings, with the retention period shown beside it | `apps/admin/src/pages/Settings.tsx`, `admin.ts` | M1.4 | `admin.test.ts` on the setting | R3 |
| M5.2 | Workspace page, **Records**: pick a day; that day's recordings, each with a player, its length and size, download and delete; that day's log as a list with start time, duration, title and the content | `Workspace.tsx`, `api.ts`, `format.ts`, `admin.ts` (a log route by day) | M2.4, M4.4 | `format.test.ts` for durations; `admin.test.ts` for the log route | R11, R19 |
| M5.3 | Storage shows recordings as their own kind, by workspace | `Storage.tsx` | M2.3 | Manual | R10 |

### M6 — Local API (M)

| # | Task | Where | Needs | Tests | Done when |
| --- | --- | --- | --- | --- | --- |
| M6.1 | The second listener: its own Fastify instance on `WORSHIP_Q_LOCAL_PORT`, started and closed with the first; nothing of it on the public listener, and nothing public on it | new `apps/server/src/local.ts`, `main.ts`, `compose.yaml` (`127.0.0.1:8081:8081`), `Dockerfile` | — | §5.5, first group | R20 |
| M6.2 | Workspaces, run sheet dates, one date's run sheet with items and content, and what is on screen now | `local.ts`, reusing `runSheetDays`, `runSheet`, `getLive` | M6.1 | §5.5 | A reader gets Sunday's run sheet with one request |
| M6.3 | Presentation log: by `from` and `to`, or `after` a cursor with a `limit`; the cursor is the server's own order of arrival, so an entry that arrives late or closes later is seen again; each entry's content in full, joined from the revision it names, removed or not, with media and the background as links (R22) | `local.ts`, `instance.ts` | M6.1, M4.4 | §5.5 | A poller misses nothing and needs no clock of its own |
| M6.4 | Recordings: list by time range; the file, with range requests, while it grows | `local.ts`, `recordings.ts`, `ranges.ts` | M6.1, M2.1 | §5.5 | A reader can follow a recording as it is made |
| M6.5 | Media route: `/local/v1/workspaces/:id/media/:name` serves a workspace's slide images, thumbnails, videos and backgrounds, its own or the Church Library's, with range requests; every link in the log and the run sheets points here | `local.ts`, `files.ts`, `ranges.ts` | M6.1 | Path traversal refused; a file of another workspace not served; a removed file is `404` | The log stays small and a reader fetches only what it wants |
| M6.6 | `docs/local-api.md`: every route with a `curl` example and its JSON, the cursor, and what is promised to stay the same within `v1` | docs | M6.2–M6.5 | The examples run in a test against a seeded server | A stranger can write a reader from the page alone |

**Milestone done:** a twenty-line script on the server's machine prints today's run sheet, follows the log as a rehearsal is presented, and saves the recording; the same requests from another machine get no answer.

### M7 — Acceptance and write-back (S)

| # | Task | Where | Needs | Done when |
| --- | --- | --- | --- | --- |
| M7.1 | Walkthrough at a rehearsal with a mixer feed: a full service recorded, listened to afterwards from the admin app, and lined up against the log by three claps at known slide changes; the venue's internet unplugged for ten minutes in the middle; a coordinator hand-over; the first real reader of the local API, if there is one by then | new `docs/acceptance/service-records.md` | M1–M6 | Every scenario passes or has a recorded, accepted exception |
| M7.2 | Deployment guide: recording, its storage and how to turn it off, the retention setting, the local port, that it has no key and must not be proxied; *Nothing is recorded* corrected | `docs/server-deployment.md` | M6 | An administrator can turn recording off and reach the local API from the guide alone |
| M7.3 | Volunteer guide: one sentence where live audio is described, saying the broadcast is recorded on the church's server | `docs/volunteer-guide.md` | M3.5 | Reviewed by a volunteer |
| M7.4 | Spec and plans: the spec's live audio and later-ideas sections; A13 marked as replaced by R2 in the live audio plan; the three items in the phase 3 plan's list marked done | `docs/worship-q-requirements-and-architecture.md`, `docs/live-audio-plan.md`, `docs/phase-3-plan.md` | M7.1 | Documents match the release |
| M7.5 | Release by release-please; server first | — | M7.1 | Released |

## 5. Rules the tests must cover

### 5.1 Recordings on the server (M2.1, M2.2)

- Chunks 0, 1, 2 in order make a file equal to their bytes joined.
- Chunk 1 sent twice is stored once, and the second answer says it is already stored.
- Chunk 3 after chunk 1 is refused, and the answer names 2.
- A chunk for a recording another device opened is refused; so is one for another workspace's recording.
- Opening the same recording twice with the same id changes nothing; with the same id from another device it is refused.
- With the church's switch off: opening is refused, and so is a chunk for a recording opened before it was turned off.
- A chunk over the size limit is refused and nothing is written.
- `complete` sets the end time; a chunk after `complete` is refused.
- After a server restart with a file longer than its row says, the file is cut back to the row's length, and the next chunk is accepted.
- A recording with no chunk for ten minutes reads as interrupted, and reads as receiving again once its next chunk comes.

### 5.2 Recording on the desktop (M3.1, M3.3)

- A live track with the switch on and a server that takes recordings opens a recording; a server that does not, or whose `info` names no records, opens none.
- Each of these closes the recording, and only the first three open another when a track is live again: the device unplugged; the track muted and taken again; another input picked; the switch off; take-over by another computer; quitting.
- Waiting for input records nothing and sends nothing.
- Chunks leave in order whatever fails: a failure of chunk 4 holds 5 and 6 until 4 is stored.
- The server's expected number is followed: told 3 when sending 5, the uploader sends 3 if it still has it, and otherwise closes that recording as cut short.
- After a restart, the queue's recordings are finished before, or beside, a new one, each in its own order.
- At the queue's limit the oldest waiting recording is dropped whole, never a chunk from the middle of one.
- Offline for the whole service: recording carries on, Settings shows the amount waiting, and everything arrives afterwards.

### 5.3 Log events from snapshots (M4.1)

- Nothing presented to a piece presented: one entry opens. Piece to another piece: one closes, one opens, at the same instant.
- Clear, blank, end and expiry each close the open entry and open none. Unblank opens one for the piece that is there.
- **Go live** on another run sheet with a slide carried from the previous one: the entry's `previous` is true and its run sheet is the one that was live.
- A change of revision alone, of the connected devices, of a video's playback position, or of the run sheet's items with the same piece on screen: no event.
- The same piece of the same song in two items of the run sheet: two entries.
- The presented song edited while it is on screen: the entry closes and another opens, naming the new revision.
- The part shown, by kind: lyrics, the position and count of the piece's lines in the song; a slide, its number; a passage, the position and count of the slide's verse units; a video and a website, nothing more. No text in any entry. The background in use is recorded when the entry opens, and a change of background while the piece stays on screen makes no event.

### 5.4 The log on the server (M4.4, M4.5)

- An entry sent open and then closed is one row; sent twice it is still one row; a close for an unknown id makes the row whole from the close alone.
- A closed entry is not reopened by a late repeat of its opening.
- A device of another workspace cannot write to this one's log; a viewer device's entries are accepted only if it held the coordinator's role, which the server cannot know, so they are accepted from any enrolled device of the workspace and attributed to it.
- A later entry's start closes an earlier one still open, marked as closed by the server; an earlier one that arrives afterwards, still open, is closed at once the same way.
- An open entry is closed at the live state's last activity when the live state expires.
- The clock offset is stored from the batch's sending time, and an entry uploaded a day late keeps its own times.
- Entries shorter than one second that reach the server anyway are kept: the floor is the desktop's.

### 5.5 Local API (M6)

- The public listener answers `404` for every `/local/` path; the local listener answers `404` for `/api/` and `/admin/`.
- An entry is returned with the content of the revision it names, not the song's latest: lyrics edited after the service come back as shown, and so does a passage whose reference was changed. It still is after the song and its run sheet were removed. A slide comes back with its text and with links, not bytes, that the media route serves; the background comes back as a colour and a link; a link to a removed file is marked as gone. An entry whose revision the server does not hold comes back without content.
- Every route refuses methods other than `GET` and `HEAD`.
- An unknown workspace, date or recording is `404`, never an empty success.
- The log's cursor: reading to the end and then reading after the cursor returns nothing; an entry that closes afterwards is returned again; a late entry with an old start time is returned.
- A recording's file honours a range, and a range past the end of a growing file is answered with what there is.
- A file name with a path in it is refused.

## 6. Order and dependencies

| Work | Tasks | When |
| --- | --- | --- |
| Spike | M0 | First; needs a Windows computer and the venue's connection |
| Foundations | M1 | Day one |
| Recording | M2, then M3 | M2 needs only M1; M3 needs M0 and M2.1 |
| Log | M4 | Needs only M1; independent of M2 and M3 |
| Admin app | M5 | After M2.4 and M4.4 |
| Local API | M6 | M6.1–M6.2 need nothing but M1.3 and can be built first; M6.3 needs M4.4, M6.4 needs M2.1 |
| Acceptance | M7 | After everything |

The recording and the log do not depend on each other, and either can be released alone with the local API serving what exists. The log (M4) is the lower risk of the two: it has no spike and touches no audio.

## 7. Rollout

- **Any order.** No protocol version changes. Recordings and log entries start arriving once both the server and a desktop are updated; until then nothing differs.
- **Tell the church before the update.** Once the server and the broadcasting desktop are both updated, services are recorded unless an administrator has turned **Record live audio** off (R3). The release notes and the deployment guide say so at the top.
- **Disk.** About 29 MB for each hour broadcast, kept 90 days: a church with three hours a week holds a little over 1 GB. The Storage page shows it.
- **The local port.** Compose publishes 8081 on `127.0.0.1` only. A church that runs the server without Compose must do the same, and must not add the port to its reverse proxy.

## 8. Risks tied to tasks

| Risk | Task | Mitigation |
| --- | --- | --- |
| The recorder disturbs the broadcast's delay, or WKWebView's recorder is unreliable on a long capture | M0.1, M0.5 | Measured before anything is built; native capture in Rust as the fallback (R4) |
| Appended chunks do not make a file every player accepts | M0.2 | Checked in three players per container; otherwise each recording is kept as separate parts with a list |
| People are recorded without knowing | M3.5, M7.2, M7.3 | The owner chose no indicator (R6): the Settings text, the two guides, the release notes and the church's one switch carry it |
| A queue of unsent audio fills the broadcasting computer's disk | M3.1 | A fixed limit, the oldest recording dropped whole, and Settings saying so (R7) |
| Two coordinators after a partition both write the log | M4.3, M4.4 | Entries have their own ids and are attributed to their device; the server closes overlaps by start time (R18); the acceptance walkthrough includes a hand-over |
| A log entry names a revision the server never receives, or a slide whose image the retention sweep removed | M4.3, M6.3 | Revisions synchronize with the content the desktop already had to have; the entry is returned without content until then. A deleted deck's images go after the retention period (D34): the entry then says the file is gone |
| The local port is published by mistake, with no key to stop a reader | M6.1 | Compose binds loopback; the guide says not to proxy it; keys can be added without changing the routes (R21) |
| The local API freezes a shape nobody needed | M6.2–M6.5 | Versioned under `/local/v1`; built last, so a real reader may exist by then |
