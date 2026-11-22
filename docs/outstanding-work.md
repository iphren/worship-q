# Worship Q — Outstanding Work

**Drafted:** 15 November 2026  
**Status:** A list, not a plan. It gathers in one place everything the plans and task breakdowns describe that is not built, not verified, or not written back, as of version 2.6.0 (protocol version 8). Nothing here is scheduled. The source documents are left as they are; where one of them is out of date, §4 says so.  
**Source:** the [spec](worship-q-requirements-and-architecture.md); the [Phase 1](phase-1-task-breakdown.md), [Phase 2](phase-2-plan.md) and [Phase 3](phase-3-plan.md) plans; the [Media Uploads](media-uploads-plan.md), [OBS Control](obs-control-plan.md), [Bible Passages](bible-passages-plan.md) and [Live Audio](live-audio-plan.md) plans; the [Live Audio](live-audio-task-breakdown.md) and [Service Records](service-records-task-breakdown.md) task breakdowns; the [acceptance records](acceptance/); and the code on `main`.

## How to read this

- **§1 Not built:** features a plan names and no code delivers.
- **§2 Left out on purpose:** smaller things a plan set aside while building the feature around them. Each could be picked up; none is promised.
- **§3 Built, not yet proven:** code that is on `main` and released, whose spike, walkthrough or measurement has not been done.
- **§4 Documents behind the code:** write-backs the breakdowns ask for.
- **§5 Closed by decision:** listed so nobody mistakes them for gaps.

Identifiers (G15, D33, U5, M6.1 …) are the source document's own.

## 1. Not built

### Phones (the phase 2 plan's "Phase 4")

No phone app exists; a phone is a browser page served by the church server. The [native apps discovery](native-apps-discovery.md) (22 November 2026) covers phones and tablets (operator and remote control modes) and the link router; an Apple TV app was looked at and dropped.

| Item | What is missing | Source |
| --- | --- | --- |
| G15 Link router | `app.worship-q.com` as the QR link domain, and an installed app opening from a camera scan. QR codes point straight at the church server. `apps/router` does not exist | Spec §2, criteria 11, 24 |
| G16 Remembered rejoin | A **Connect to [workspace]** home screen. A phone's grant lives in that browser page only | Spec §4 |
| G17 Phone app | **Present on this device** with swipe navigation while mirrored to a TV; a local-only workspace on a phone; choosing between workspaces, local presentation and remote control on one phone | Spec §3, §12, §16; criteria 10, 23, 33 |
| Phones on the venue network | A phone has no LAN path and needs the internet to control slides: a phone browser will not accept the coordinator's self-signed certificate. Recorded as phase 2's one known exception; the phone app is what removes it. (Live audio does reach a phone directly on the LAN, by WebRTC.) | Phase 2 M5, [acceptance](acceptance/phase-2.md) |
| G20 Cache readiness | A view of which songs, backgrounds and fonts are on this device for offline use | Spec §14 |
| External display | A controller on the phone with clean lyrics on the TV, without mirroring | Spec §12 (later, platform-dependent) |

### Synchronization

| Item | What is missing | Source |
| --- | --- | --- |
| G14 Conflict review | Concurrent or offline edits to one song or run sheet are settled by the later edit, with nothing shown to anyone | Spec §8, §14 |
| G21 Merging on join | A local workspace joining a church gets **Keep both** or **Use the church's copy**; run sheets for the same date are not merged | Spec §3 |

### Platforms

| Item | What is missing | Source |
| --- | --- | --- |
| G18 Linux desktop | The release workflow builds macOS and Windows only | Phase 1 D1, spec §15 |

### Administration

| Item | What is missing | Source |
| --- | --- | --- |
| Several OIDC providers | One provider per instance | Phase 3 §3, §7 |
| Fine-grained operator permissions | Every paired computer of a workspace has the same rights | Spec §20 item 1 |
| Copy a workspace's song into the Church Library from the admin app | Only if a church asks for it, after D33 | Phase 3 §7 |

### Media

| Item | What is missing | Source |
| --- | --- | --- |
| U5 Pruning deck originals | The Storage page counts what pruning would free (originals of decks not presented for 180 days); nothing removes them. Optional, for when disk becomes a concern | Media plan U5 |

### Song catalogue (parked)

| Item | Source |
| --- | --- |
| Built-in public-domain hymns and Stream of Praise songs offered to every workspace; leaving a church flattens the library. Hymns checked and saved, not wired in; Stream of Praise not yet asked | [Song catalogue plan](song-catalogue-plan.md) and [song lyrics discovery](song-lyrics-discovery.md), 21–22 November 2026 |

### Ideas with no design

| Item | Source |
| --- | --- |
| Voice recognition with automatic slide switching | Spec §17; [requirements](voice-recognition-requirements.md) and [discovery](voice-recognition-discovery.md) drafted 17 November 2026 |
| Automatic translation | Spec §17 (later, optional) |
| Semantic verse and chorus structures | Spec §17 (deferred) |
| Automatic coordinator election and failover; recovery stays the operator's **Carry on here** | Phase 2 §3, D18; spec §17 (deferred) |

## 2. Left out on purpose

| Area | Left out | Source |
| --- | --- | --- |
| Pairing | QR joining links through `app.worship-q.com`; the server address is typed. One enrollment covering several workspaces; each workspace folder on a computer enrolls on its own | Phase 3 §3 |
| Church Library | Per-song confirmation when a workspace starts managing the Church Library; the administrator confirms the whole conversion | Phase 3 D36 |
| Church Library | Unhiding a church song the workspace removed. It stays hidden until the Church Library changes it | Phase 3 [acceptance](acceptance/phase-3.md), D32 |
| Church Library | A **Church** badge on the church's backgrounds in the background picker. The origin is stored, not shown | Phase 3 [acceptance](acceptance/phase-3.md), M3 |
| Admin app | Removing content from the Storage page; ending or controlling a presentation; a live slide preview | Phase 3 §3 |
| Media | HEIC photos on Windows, refused with a message. Windows' decoder needs paid Store extensions; left out unless operators ask | Media plan U25 |
| OBS | Source, audio and transition control; black-out and Fade to Black | OBS plan O3 |
| OBS | A setting for the live monitor's rate, made only if a venue connection cannot bear the current one | OBS plan O6, M5.3 |
| OBS | OBS 28 to 32 are assumed to work and are not tested; only 33.0.1 was | OBS plan O2 |
| Bible | A desktop with no church server has no Bible | Bible plan B17 |
| Bible | Editing an existing passage item from a phone | Bible plan B15 |
| Live audio | TURN over TCP or TLS, for networks that block UDP, until a church reports the need | Live audio plan A10 |
| Live audio, service records | Native audio capture in Rust. It was the fallback if the webview proved unreliable; nothing has called for it | Live audio A8, service records R4 |
| Local API | Keys. The loopback-only port is the only guard | Service records R21 |

## 3. Built, not yet proven

All three features below are on `main` and in a release. What is missing is evidence.

### OBS control

[Acceptance record](acceptance/obs-control.md): "walkthrough pending".

| Task | What remains |
| --- | --- |
| M6.1 Walkthrough | All twenty scenarios in the record are blank: setup, either start order, quit and reboot, favourites, scene changes, outputs, Studio Mode, the monitor, take-over, a version 3 desktop, the LAN with no internet, and the same on Windows |
| M5.3 Monitor on a venue connection | Upload through the relay for each watching device. The spike measured 320 pixels once a second; the code now sends 576 pixels every three seconds, which is not measured |

### Live audio

Built 13 November 2026 (M1–M5, M6.2). There is no `docs/acceptance/live-audio.md` yet.

| Task | What remains |
| --- | --- |
| M6.1 Walkthrough | At the venue during a rehearsal with a mixer feed: the manual checks of the breakdown's §3.13, delay by a clap on the venue network and from a home connection, ten listeners at once, a full service's length without drift or drop-out, macOS and Windows as broadcaster and as listener |
| M3.8 | Mouth to ear with a mixer feed and headphones on the venue network, against A6's 200 ms, which is not confirmed (the spike's cable-to-cable loop read about 220 ms); a capture already running when the screen locks; a hidden or covered main window on Windows |
| M4.5 | Android Chrome as a listener on the venue Wi-Fi; mouth to ear on a phone |
| M5.10 | A phone recorded as on mobile data, with STUN alone and through the relay; a listener on another home connection; a network that needs the relay; two hours on one relay (19 minutes were run); the venue's upload with five and ten remote listeners |
| M1.8 Opus fixtures | The test descriptions are written from each engine's published format. Real ones are to be recorded from WebKit, WebView2, Chrome, Firefox and iOS Safari |
| A17–A24 | Built as proposed in the breakdown; they wait for the project owner's agreement |
| Spike | Still unticked in the [spike](spikes/live-audio.md): the released, notarised build, where only the system's microphone prompt for the main window is new |

### Service records (recordings, presentation log, local API)

Built 14 November 2026 (M1–M6, M7.2–M7.4), released in 2.5.0. There is no `docs/acceptance/service-records.md` yet.

| Task | What remains |
| --- | --- |
| M0 Spike | Not run; it needs Windows and the venue's connection. M0.1 the recorder beside three listeners on both platforms (types, bit rate, cost, effect on listeners); M0.2 appended chunks play and seek in Safari, Chrome and VLC, also when cut off; M0.3 the recorder when the track ends, is muted and replaced, the window is hidden or the display sleeps; M0.4 500 MB of chunks in IndexedDB across a restart; M0.5 two hours beside ten listeners. Until then R4's format is chosen at run time (WebM with Opus where the webview records it, else MP4 with AAC), and R4, R5, R7 and R8 stand unconfirmed |
| M7.1 Walkthrough | A full service recorded at a rehearsal, heard afterwards in the admin app and lined up against the log by three claps; the venue's internet unplugged for ten minutes; a coordinator hand-over; a first real reader of the local API |
| M3.2 | The IndexedDB queue is tested over a memory store, not a fake IndexedDB |
| M6.6 | The examples in [local-api.md](local-api.md) are covered by `local.test.ts`, not run from the document as the task asks |

## 4. Documents behind the code

| Document | What to bring up to date | Asked for by |
| --- | --- | --- |
| Spec §17 scope matrix | **OBS control** and **Live audio broadcast** still read "Later"; **Uploaded slide decks, PowerPoint/PDF handling** reads "Later" and **Song-only run sheets** reads as a requirement, though decks, PDFs, images, videos, websites and passages are all run sheet items now | OBS M6.3, live audio M6.3 |
| Spec §9, §11 | The OBS computer as an owner role; OBS as a controlled integration, not only a consumer; the devices and the server's role in live audio | OBS M6.3, live audio M6.3 |
| [Live audio plan](live-audio-plan.md) | Its status still says "Nothing is built"; A17–A24 are to move from the breakdown into its decision table | Live audio M6.4 |
| [OBS plan](obs-control-plan.md) and [breakdown](obs-control-task-breakdown.md) | Both still say "implemented on the `obs-control` branch" and "release after the walkthrough"; it has been released. The plan's §6 open questions are not closed, though later commits gave the Present page a monitor bar (`965eb3d`) and the switch button a list of every scene (`4b330db`) | OBS M6.3, M6.5 |
| [Bible breakdown](bible-passages-task-breakdown.md) and [acceptance record](acceptance/bible-passages.md) | P8.5 reads "release follows merging"; it is merged and released | Bible P8.5 |
| Spec §20 | Still open there: the kept-too-long notification threshold, the label for ending a presentation, and the one-presentation-per-workspace limit (item 5) | — |

## 5. Closed by decision

Not gaps; recorded so they are not reopened by accident.

| Item | Decision |
| --- | --- |
| G11 Share with church | Not built: no review queue. A managing workspace writes to the Church Library directly (phase 3 D33); criterion 21 was reduced to match |
| G12 Restore central version, Central version updated | Replaced by the two-version toggle and **Delete our version** (D32) |
| G19 PostgreSQL | The server keeps one SQLite file (spec §15) |
| Server-side video processing | The server stores videos as uploaded (media U10) |
| Local-only video | Every video is uploaded (media U6) |
| Passages on the subtitle overlay | Never shown there (Bible B12) |
| A13 No recording of live audio | Reversed: the broadcast is recorded on the church server while the church records (service records R2) |
