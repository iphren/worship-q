# Worship Q — Live Audio Broadcast Task Breakdown

**Drafted:** 13 November 2026  
**Status:** M1–M5 and M6.2 built on 13 November 2026, with their unit and integration tests, and waiting for the manual checks (§3.13) and the walkthrough (M6.1). The Opus fixtures (M1.8) are written from each engine's format, not yet recorded from the engines. The decisions added here (§1, A17–A24) are built as proposed and wait for the project owner.  
**Source:** [Live Audio Broadcast Plan](live-audio-plan.md), referred to here as "the plan"; the [spike](spikes/live-audio.md) (L1–L18) and its Windows runs (W0–W7, `spikes/live-audio/results/windows/NOTES.md` on the `live-audio-spikes` branch); and the code at version 2.2.0 (protocol version 6). Decisions A1–A16 are the plan's.

## 1. How to read this

The plan says what the feature delivers and why it is feasible. This document breaks it into tasks small enough to be one pull request, says where in the repository each lands, and names the tests that prove it. Task identifiers are `M<milestone>.<n>`; a task lists the tasks it needs first. Sizes are S, M and L as in the phase plans.

Every task that changes business logic carries unit tests in its package. §3 lists the business rules and edge cases those tests must cover, area by area; a task's Tests column names the main cases, and §3 is the full list a pull request is checked against. Every task that changes the relay carries an integration test in `apps/server/src/relay.test.ts`, every server route a test in `apps/server/src`, and every protocol change a case in `apps/server/src/versions.test.ts`.

No automated test opens a microphone or a real peer connection. The logic that decides what to do (which state wins, when to take the input again, when to reconnect, who may listen) is written as pure state machines that take events and return actions, and is tested with fakes. The thin layer that calls `getUserMedia`, `RTCPeerConnection` and `setSinkId` has no automated tests; the M6 walkthrough and the manual checks in §3.13 cover it.

### Where things live today

| Concern | Location |
| --- | --- |
| Wire messages and schemas, protocol version (6, minimum 2), capabilities | `packages/protocol/src/wire.ts` |
| The OBS state's schemas, the pattern for a state owned by one computer | `packages/protocol/src/obs.ts` |
| Which OBS state wins; the coordinator's addressed forwarding (`ObsHub`) | `packages/live-state/src/obs.ts` |
| Coordinator and follower logic, pure | `packages/live-state/src/coordination.ts` |
| Desktop live link: role, transports, coordinator and follower wiring | `apps/desktop/src/app/liveLink.ts` |
| Desktop sharing of the OBS state, and its report to the server | `apps/desktop/src/app/obsShare.ts`, `obsReport.ts` |
| Per-computer settings: `audioOutput`, `audioInput` (saved by id and name, U24) | `apps/desktop/src/app/deviceSettings.ts` |
| Per-workspace settings kept on this computer only (the OBS link) | `apps/desktop/src/app/obs.ts` |
| Audio pickers in Settings | `apps/desktop/src/components/AudioSettings.tsx` |
| Microphone permission for the app's own windows (`main` and the slideshow) | `apps/desktop/src-tauri/src/lib.rs` (`on_permission_request`) |
| `setSinkId` from a native script call | `apps/desktop/src-tauri/src/output.rs` |
| Relay: validates and routes `toCoordinator`, `toFollower` and phone messages | `packages/relay/src/index.ts`, hosted by `apps/server` |
| Remote-control host: the phone's view, phone commands under a grant | `packages/remote/src/index.ts` (`RemoteHost`) |
| Phone page | `apps/remote/src/RemoteApp.tsx`, `connection.ts` |
| Server routes; the OBS reports kept in memory for the admin app | `apps/server/src/app.ts`, `obsReports.ts` |
| Admin app's workspace page (it polls; it has no event stream) | `apps/admin/src/pages/Workspace.tsx`, `useLoad.ts` |
| Present page, live banners, settings page | `apps/desktop/src/pages/PresentPage.tsx`, `components/LiveBanners.tsx`, `pages/SettingsPage.tsx` |
| Compose file and deployment guide | `apps/server/compose.yaml`, `docs/server-deployment.md` |

### Six facts that shape the tasks

- **Every follower talks to the coordinator, and the relay reads every message.** A signal from a listener to the broadcaster goes listener → coordinator → broadcaster, and each hop is parsed with the protocol schemas. So the new kinds are protocol version 7, the relay must be updated first, and the coordinator needs a forwarding part of its own (`AudioHub`, as `ObsHub`). The coordinator keeps the last audio state and nothing else.
- **`getUserMedia` waits while the main window is not in view on macOS** (L17, L9): hidden, minimised, fully covered, display asleep or screen locked. It neither resolves nor fails, and resolves the moment the window is seen. A capture that is already running goes on. So "the broadcast cannot start" is a state of its own that the operator must be told about, and every place that asks for the input must expect to wait.
- **A listener that falls behind stays behind** (L10, L16). A capture that stops and starts leaves a WebKit listener up to a second late for many seconds. A fresh connection clears it in about a tenth of a second, and the buffer statistic does not always show the delay. So the broadcaster tells listeners when it has taken its input again, and they connect afresh, new connection first, old one closed after.
- **One listener logic, three places.** The desktop, the phone page and the admin page all listen. The logic lives once, in a new `packages/audio`, and each app supplies the element, the signalling and the gesture.
- **macOS and Windows differ, and the code must not depend on either** (W0–W7). On Windows another window's `getUserMedia` does not mute the broadcast, `setSinkId` needs no gesture, capture starts with the display off, and there is no start stumble. The macOS handling runs on both; where Windows never triggers it, it costs nothing.
- **Timers slow down in a hidden window** (L5): a one-second timer fires every two seconds on macOS. Nothing that matters may depend on a timer's rate: the level meter and the statistics read elapsed values, never count ticks.

### Decisions added here

All proposed. They settle what the plan left to the breakdown, or follow a spike result that came after the plan.

| # | Topic | Decision |
| --- | --- | --- |
| A17 | Listeners connect afresh | After the broadcaster puts a new track in place it sends `retaken` to every listener, and each makes a new connection, moves its element when sound arrives on it, then closes the old one. If the new one brings no sound in 3 s the listener stays on the old one (L16). |
| A18 | A listener's own check | A buffer above 300 ms for 3 s also asks for a fresh connection, at most once every 10 s. It is the slower safety net, not the main path (L16). |
| A19 | Window not in view | A fifth status, **Bring this window into view**, when the input has been asked for and not given within 5 s while the page is hidden. The broadcast starts by itself when the window is seen. It is shown on the sending computer only; other devices see **Waiting for input** (L17). |
| A20 | Counting to ten | Listeners are counted by who they are (a desktop, a phone's grant, an administrator's session), not by connection, so a listener that connects afresh is never refused by its own old connection. |
| A21 | How the server learns the audio state | The broadcasting desktop reports it over HTTP, as it reports the OBS state (`obsReport.ts`), not by the relay reading messages. This also works when the desktops meet only on the LAN but the broadcaster reaches the server. It replaces the sentence in the plan's §4. |
| A22 | The admin page's signalling | The administrator's browser posts its signals and polls for the answers (every 500 ms while connecting, every 5 s once playing). The admin app has no event stream to reuse. The server passes signals to and from the broadcaster on its relay socket as a new pair of kinds. |
| A23 | Settings while listening | Opening Settings does not stop **Listen**: `getUserMedia` in the listening window changes nothing (L6, W3). The plan's "stopping before Settings lists audio devices" is dropped. |
| A24 | The phone's lock-screen note | "The sound may stop when the screen locks or the browser goes to the background." A minute's lock did not stop it on an iPhone (L15, L18), so the plan's firmer wording would be wrong; when the page returns to view the phone connects afresh. |

Already true, so no task: the permission handler covers the main window on Windows as well as macOS (`lib.rs` allows the microphone for `main` and the slideshow window), and W1 ran without a prompt.

## 2. Tasks by milestone

### M0 — Spike (done)

Concluded on 13 November 2026 ([results](spikes/live-audio.md)). What it left open is carried by M3.8, M4.5, M5.10 and M6.1.

### M1 — Protocol and state (M)

| # | Task | Where | Needs | Tests | Done when |
| --- | --- | --- | --- | --- | --- |
| M1.1 | Protocol version 7: raise `PROTOCOL_VERSION`, add `AUDIO_PROTOCOL_VERSION = 7`, keep the minimum at 2; `Capabilities` gains `audio: boolean`, optional; the server's `info` reports 7; negotiation keeps working against 6 | `packages/protocol/src/wire.ts`, `apps/server`, `apps/desktop/src/app/cloud.ts` | — | `versions.test.ts` gains 6-against-7 and 7-against-6; a hello without `audio` still parses | The pattern of D26 and OBS M2.1 |
| M1.2 | Schemas in a new `audio.ts`: `AudioStateSchema` (owner id and name, `activatedAt`, `active`, status `live` \| `waiting` \| `refused`, input name, listener count, revision); `AudioListenerSchema` (`desktop` with device id, `phone` with grant id, `admin` with a session id; each with a name); `AudioSignalSchema` (session id and one of `listen`, `offer`, `answer`, `candidate`, `close` with a reason, `full`, `retaken`); an offer may carry ICE servers; a description is at most 16 KB, a candidate 1 KB, a session id 100 characters | `packages/protocol/src/audio.ts`, `index.ts` | M1.1 | §3.3: each signal parses; oversized, unknown and malformed ones are refused; a version 6 message set still parses | Documented in the file header |
| M1.3 | Wire kinds: `FollowerToCoordinator` gains `audioState` and `audioSignal` (addressed with `to`); `CoordinatorToFollower` gains `audioState` (nullable) and `audioSignal` (with `from` and the listener it is about) | `packages/protocol/src/wire.ts` | M1.2 | Schema unit tests | — |
| M1.4 | Which audio state wins: `newerAudioState(incoming, current)` by `activatedAt`, ties on device id, the same owner's later revision always | `packages/live-state/src/audio.ts` | M1.2 | §3.1 | A3's rule in one place |
| M1.5 | `AudioHub`, the coordinator's part: keeps the latest state; sends it to every device in the audience (connected, declaring `audio`), and to one that joins; forwards an `audioSignal` only to its addressee; answers a signal for a device that is gone with `close`; drops the state when its owner leaves | `packages/live-state/src/audio.ts`, `coordination.ts` | M1.3, M1.4 | §3.2 | The coordinator holds no session and no audio |
| M1.6 | Follower side: `Follower.receive` turns the new kinds into events; unknown kinds stay ignored | `packages/live-state/src/coordination.ts` | M1.3 | Unit via the existing harness; a version 7 follower against a version 6 coordinator sees nothing new | — |
| M1.7 | Relay: the new kinds pass `toCoordinator` and `toFollower`; an oversized description or candidate is refused and the socket stays open | `packages/relay/src/index.ts`, `apps/server/src/relay.test.ts` | M1.3 | Integration: a signal between two followers through the coordinator reaches only its addressee; a 17 KB description is refused; `audioState` reaches the coordinator | The server update is the only deployment step for M1–M4 |
| M1.8 | Opus settings: `tuneOpusDescription(sdp)` sets `minptime=10; useinbandfec=1; usedtx=0; maxaveragebitrate=64000; stereo=0; sprop-stereo=0` on the Opus format and `a=ptime:10` on the audio section, and changes nothing else. Record real descriptions as fixtures first: WebKit (macOS app), WebView2, Chrome, Firefox, iOS Safari | `packages/protocol/src/audio.ts`, `audioFixtures/` | — | §3.4 | A7 |
| M1.9 | Phone channel schemas: `RemoteView` gains `audio` (null, or the owner's name, status and whether it is full); `RemoteToHost` and `HostToRemote` gain `audioSignal` | `packages/protocol/src/wire.ts` | M1.2 | Schema unit tests; a phone page without the field still parses its view | Wiring is M4.1 |

**Milestone done:** unit tests cover take-over, forwarding only to devices with the capability, and addressed signals reaching only their device; the relay integration tests pass.

### M2 — Broadcasting (L)

| # | Task | Where | Needs | Tests | Done when |
| --- | --- | --- | --- | --- | --- |
| M2.1 | The switch's storage: per workspace on this computer, beside the OBS link, `{ broadcast, activatedAt }`. The input stays in `deviceSettings.audioInput`. Turning on stamps `activatedAt` with this computer's clock, or one millisecond after the newest activation it has seen when its clock is behind that, so a press always wins; being taken over writes `broadcast: false` | new `apps/desktop/src/app/audioSettings.ts` | — | Round-trip; a damaged or missing entry reads as off; one workspace's switch does not turn on another's; the stamp with a clock that is behind (§3.1) | A12, A15 |
| M2.2 | Input watcher, pure: from the saved device, the listed devices, and the events `devicechange`, track `ended`, track `mute`, a pick in Settings, `visibilitychange`, and the results of asking, it decides the next action (ask for a device, wait, report) and the status: `live`, `waiting`, `refused`, or `hidden` (A19) | new `packages/audio/src/input.ts` | — | §3.5 | Every branch of the plan's *Watching the input device* is a tested transition |
| M2.3 | Capture in the main window: runs M2.2's actions. `getUserMedia` with the saved input by id, then by name, with the plan's constraints; listens for `ended` and `mute`; lists devices on `devicechange` and every 3 s while waiting; starts when the workspace opens with the switch on, not when a listener arrives | new `apps/desktop/src/app/audioCapture.ts` | M2.2 | Unit with fake `mediaDevices`: the calls made for a scripted sequence of events | Manual: §3.13 |
| M2.4 | Level meter: an `AnalyserNode` on the local track, read on animation frames while Settings is open, peak held for a second by elapsed time. Nothing is read while Settings is closed | `audioCapture.ts`, `AudioSettings.tsx` | M2.3 | Unit on the peak-hold arithmetic with a 2 s gap between readings | Silence, a normal level and clipping look different |
| M2.5 | Display kept awake while the switch is on: a native command holding the system's display-sleep assertion (macOS `PreventUserIdleDisplaySleep`; Windows `SetThreadExecutionState`), released when the switch goes off, the workspace closes or the app quits | `src-tauri/src/lib.rs` or a new `power.rs`, `platform/native.ts` | — | Rust unit: on, on, off releases once; off without on is harmless | Manual: the display does not sleep at the system's idle time with the switch on, and does with it off |
| M2.6 | Broadcaster sessions, pure: one entry per session; on `listen`, refuse with `full` when ten other listeners are connected (A20), otherwise make a connection and offer; apply the answer; hold candidates until their description is set; on `close`, or when told the listener is gone, close; when switched off or taken over, close all | new `packages/audio/src/broadcaster.ts` | M1.2 | §3.6, with a fake peer connection | A2 |
| M2.7 | Connections in the main window: runs M2.6's actions on real `RTCPeerConnection`s, send-only, all sharing the one capture track; `replaceTrack` on every connection when M2.3 has a new track, then `retaken` to every listener (A17); ICE servers passed in from M5.2 (none until then) | new `apps/desktop/src/app/audioBroadcast.ts` | M2.3, M2.6 | Unit with fake connections: a new track is put on every open connection and each listener is told once | Manual: §3.13 |
| M2.8 | Sharing: `AudioShare` publishes the audio state when it changes (the listener count at most once a second), again when the coordinator changes, and `active: false` when switched off; takes `audioSignal`s for this device to M2.6; switches itself off silently when a newer state from another owner arrives; when this desktop is the coordinator the same paths run without the relay; over the LAN as over the relay | new `apps/desktop/src/app/audioShare.ts`, `liveLink.ts`, `lan.ts` | M1.5, M1.6, M2.1, M2.6 | §3.1, with a fake transport: owner as coordinator, as follower, as viewer; LAN transport passes the kinds unchanged | A3 in any role |
| M2.9 | Settings: the **Broadcast live audio** switch beside the input picker, the level meter, the status line with what to do for Refused and for **Bring this window into view**, the name of the computer that took over with the switch to take it back, and the note that sharing needs a server update when the negotiated protocol is below 7 | `AudioSettings.tsx`, `SettingsPage.tsx`, `i18n/en.ts` | M2.4, M2.8 | Unit on the status-to-text mapping, every status and both notes | Plan §3, first four items |
| M2.10 | Built-in microphone warning under the picker: a pure `isBuiltInInput(label, platform)`, also applied to what **System default** resolves to | `deviceSettings.ts`, `AudioSettings.tsx` | — | §3.5, last group | A16 |
| M2.11 | The sending computer's indicator on the Present page: live with the listener count, waiting with the device's name, and a banner for **Bring this window into view** that is visible without opening Settings | `LiveBanners.tsx`, `PresentPage.tsx` | M2.8 | Manual | An operator sees a silent broadcast without looking for it |

**Milestone done** (checked with M3.1–M3.3 on a second desktop): the app opened with the interface unplugged starts broadcasting within a few seconds of it being plugged in, with no press; unplugging it during the broadcast shows Waiting for input, and plugging it back restores the sound to the same listener; switching on a second broadcaster silences the first, which stays off after a restart; and the display does not sleep while the switch is on.

### M3 — Listening on the desktop (M)

| # | Task | Where | Needs | Tests | Done when |
| --- | --- | --- | --- | --- | --- |
| M3.1 | Listener session, pure: from **Listen** pressed or released, the audio state, signals, connection states, statistics and a clock, it decides what to send and what to do with the element. It covers asking, answering with the tuned description, candidates held until their description, ICE restart on `disconnected`, close and ask again on `failed` after 1, 2, 4, 8 then 15 s, a fresh connection on `retaken` (A17) and on a high buffer (A18), a broadcaster that restarts or is taken over, `full`, and stopping | new `packages/audio/src/listener.ts` | M1.2, M1.8 | §3.7, with a fake connection and a fake clock | One logic for desktop, phone and admin |
| M3.2 | Desktop player: a plain `<audio>` element in the main window. The press unlocks the device ids (`getUserMedia`, stopped at once), finds the Monitor device by id then by name, sets it from the native script call, then starts M3.1. Signals go through `AudioShare` | new `apps/desktop/src/app/audioListen.ts`, `output.rs` (the script call for the main window) | M3.1, M2.8 | Unit with fakes: the order unlock, device, ask; a missing device plays on the default | Sound on a second desktop on the LAN |
| M3.3 | **Listen** button on the Present page, only while the audio state is active and this computer is not the broadcaster; its states: off, connecting, playing, waiting for the broadcaster's input, reconnecting, full, could not connect. Off again after a restart | `PresentPage.tsx`, new `components/AudioListen.tsx`, `en.ts` | M3.2 | Unit on the state-to-label mapping | A5 |
| M3.4 | **Monitor** picker in Settings, the third audio picker: `deviceSettings.audioMonitor`, by id and name, default **System default** | `deviceSettings.ts`, `AudioSettings.tsx` | — | `deviceSettings.test.ts`: round-trip, an old settings file without the field, a device found by name when its id changed | A11 |
| M3.5 | Changing the Monitor device while listening: Settings tells the player by an event, and the element is moved inside the native script call; **Listen** stays on; a device that is unplugged while listening falls back to the system default | `audioListen.ts`, `AudioSettings.tsx` | M3.2, M3.4 | §3.8 | Moves within two seconds on macOS and Windows |
| M3.6 | Delay and path: from the connection's statistics every 2 s, the buffer over the last interval plus half the round trip, rounded to 10 ms, labelled as the network and buffer part; **Direct** or **Relayed** from the selected pair's candidate types | new `packages/audio/src/stats.ts`, `AudioListen.tsx` | M3.1 | §3.12 | Plan §3, *Delay shown while listening* |
| M3.7 | Broadcasting indicator on every desktop of the workspace, naming the sending computer; nothing at all when no audio state is active | `LiveBanners.tsx` | M2.8 | Manual | Plan §3 |
| M3.8 | Left from the spike: mouth-to-ear with a mixer feed and headphones on the venue network, the app on both sides, against A6's 200 ms; a capture already running when the screen locks (L9); a hidden or covered main window on Windows (L17) | `docs/acceptance/live-audio.md` | M3.3 | Recorded | A6 confirmed for the LAN, or changed with the owner |

**Milestone done:** two desktops on one network, with no internet, broadcast and listen; the coordinator can be handed over without a gap in the audio; quitting and reopening the broadcaster brings the audio back by itself; changing the Monitor device while listening, on macOS and on Windows, moves the sound within two seconds, leaves **Listen** on, and leaves the delay figure where it was; and opening Settings while listening does not interrupt the sound. M1–M3 can be released on their own.

### M4 — Listening on the phone (M)

| # | Task | Where | Needs | Tests | Done when |
| --- | --- | --- | --- | --- | --- |
| M4.1 | `RemoteHost` carries audio: the view's `audio` field, re-sent when the audio state changes; a phone's `audioSignal` forwarded to the broadcaster as from a `phone` listener with the phone's grant id and name (D25), and the broadcaster's signals back to that phone only | `packages/remote/src/index.ts`, `liveLink.ts`, `audioShare.ts` | M1.9, M2.8 | §3.9 | A phone on a desktop that is not the broadcaster is served |
| M4.2 | A phone that goes: when its grant is revoked, it disconnects from its desktop, or its desktop leaves, the host sends `close` for its sessions | `packages/remote/src/index.ts` | M4.1 | §3.9 | Revoking a phone stops its audio |
| M4.3 | ICE servers for the phone: the broadcaster's offer carries the list, so the phone needs no credential of its own | `audioBroadcast.ts` | M4.1 | Unit: the offer to a phone carries the list; to a desktop it need not | Used from M5.2 on |
| M4.4 | Phone page: the **Listen** button and the indicator on the main screen, only while a broadcast is active; the tap starts playback; the note of A24; when the page returns to view while listening, a fresh connection | `apps/remote/src/RemoteApp.tsx`, `connection.ts` | M3.1, M4.1 | Unit on the state-to-label mapping; manual on iOS Safari and Android Chrome | One tap, sound |
| M4.5 | Left from the spike: Android Chrome on the venue Wi-Fi (the names it offers, playback after a tap, screen lock); mouth-to-ear on a phone with a USB microphone against its speaker | `docs/acceptance/live-audio.md` | M4.4 | Recorded | Android confirmed, or a recorded exception |

**Milestone done:** an iPhone and an Android phone on the venue Wi-Fi listen with a direct path, and revoking a phone's approval stops its audio.

### M5 — Across the internet (L)

| # | Task | Where | Needs | Tests | Done when |
| --- | --- | --- | --- | --- | --- |
| M5.1 | `GET /api/v1/ice`, for enrolled devices only: the STUN list from `WORSHIP_Q_STUN` (comma-separated; default `stun:stun.l.google.com:19302`; empty means none), and, when `WORSHIP_Q_TURN_URL` and `WORSHIP_Q_TURN_SECRET` are set, the relay with a credential valid ten minutes (user name the expiry time, password its HMAC-SHA1 with the secret, base64). `info` says whether a relay is offered | `apps/server/src/app.ts`, new `ice.ts` | — | §3.10 | A10 |
| M5.2 | Desktop: fetch the list before every new connection and ICE restart, as listener and as broadcaster, reusing one answer for at most five minutes; with no server reachable, an empty list; pass it to phones in the offer (M4.3) | new `apps/desktop/src/app/iceServers.ts`, `audioBroadcast.ts`, `audioListen.ts` | M5.1 | §3.10: fresh for each connection, the five-minute reuse, offline gives none and still connects on the LAN | A home desktop listens with STUN alone |
| M5.3 | coturn as a compose profile, off by default: UDP only, 3478 and relay ports 49160–49180, `use-auth-secret`, the listening, relay and external addresses named from the environment, private and loopback peers refused, no `--no-dtls` (L18) | `apps/server/compose.yaml` | — | Manual: `docker compose --profile turn up`; a listener allowed only the relay connects | A10 |
| M5.4 | A listener that cannot connect: after 15 s without a connection, the message says the connection could not be made, and either that the church's server offers no relay or that the relay was tried | `packages/audio/src/listener.ts`, `AudioListen.tsx`, `RemoteApp.tsx` | M3.1, M5.1 | §3.7, last group | Plan §4, *TURN* |
| M5.5 | Audio report to the server: the broadcasting desktop sends its audio state by HTTP when it changes and every half minute while active (A21); the server keeps the latest per workspace in memory and forgets one that is 90 s old | new `apps/desktop/src/app/audioReport.ts`, `apps/server/src/audioReports.ts`, `app.ts` | M2.8 | §3.11, first group | The admin app knows a broadcast is live |
| M5.6 | Relay kinds for the administrator: the server sends `adminAudioSignal` to the broadcaster's own relay socket, and the broadcaster answers with the same kind; neither passes through the coordinator. The broadcaster treats the listener as `admin` and counts it in the ten | `packages/protocol/src/wire.ts`, `packages/relay/src/index.ts`, `audioShare.ts` | M1.2, M2.8 | Integration: the signal reaches only the broadcaster; a broadcaster that is not connected gives the server an error at once | A14 |
| M5.7 | Admin routes: `POST /admin/api/workspaces/:id/audio/signal` and `GET …/audio/signals?session=…&after=…` for a signed-in administrator; answers are queued per session and dropped after 60 s; a session that has not polled for 30 s is closed towards the broadcaster; the ICE list comes with the first answer | `apps/server/src/admin.ts`, `audioReports.ts` | M5.5, M5.6 | §3.11 | A22 |
| M5.8 | Admin page: the **Listen** button under the presentation on the workspace page, only while the report says live and the broadcaster is connected to the server; uses M3.1 with the polling of A22; the delay and path as on the desktop | `apps/admin/src/pages/Workspace.tsx`, `api.ts` | M3.1, M3.6, M5.7 | Unit on when the button shows; manual in Chrome, Safari and Firefox | Plan §3 |
| M5.9 | Deployment guide: the server update carries protocol 7; the STUN setting; the coturn profile, its two environment values and the UDP ports to open in the host's firewall and the provider's, outside the reverse proxy; how to check it from outside | `docs/server-deployment.md` | M5.3 | — | An administrator can turn the relay on from the guide alone |
| M5.10 | Left from the spike: a phone recorded as on mobile data, with STUN alone and through the relay; a listener on another home connection; a network that needs the relay; two hours on one relay; the venue's upload with five and ten remote listeners | `docs/acceptance/live-audio.md` | M5.2, M5.3 | Recorded | A6's 300 ms and A10 confirmed, or changed with the owner |

**Milestone done:** a desktop on a home connection listens with STUN alone; a phone on mobile data listens through the relay when coturn runs, and gets the explanation when it does not; a device that is not enrolled is refused the list; and an administrator hears the broadcast from the admin page, is counted among the listeners, and is refused when signed out.

### M6 — Acceptance (S)

| # | Task | Where | Needs | Done when |
| --- | --- | --- | --- | --- |
| M6.1 | Walkthrough at the venue during a rehearsal, with a mixer feed: the manual checks of §3.13; delay by a clap on the venue network and from a home connection; ten listeners at once; a full service's length without drift or drop-out; macOS and Windows as broadcaster and as listener | `docs/acceptance/live-audio.md` | M1–M5 | Every scenario passes or has a recorded, accepted exception |
| M6.2 | Volunteer guide: feeding the computer from the desk, the switch and the level meter, **Listen**, the Monitor device, what the statuses mean | `docs/volunteer-guide.md` | M3 | Reviewed by someone who runs the sound |
| M6.3 | Spec write-back: §17's scope row from Later to Agreed and done, and the sections on devices and the server's role | `docs/worship-q-requirements-and-architecture.md` | M6.1 | Spec matches the release |
| M6.4 | Plan write-back: A17–A24 moved into the plan's decision table, statuses updated | `docs/live-audio-plan.md` | M6.1 | Plan and breakdown agree |
| M6.5 | Release by release-please; server first, then desktops through the updater | — | M6.1 | Released |

## 3. Business rules and edge cases to test

Each subsection names the rules the feature must keep, then the cases that prove them, and the test file they live in. Cases are unit or integration tests unless marked **manual**, in which case they belong to the M6.1 walkthrough.

### 3.1 Audio state and take-over (A3, A15; M1.4, M2.1, M2.8)

`packages/live-state/src/audio.test.ts`, `apps/desktop/src/app/audioShare.test.ts`

Rules: one broadcaster per workspace; the later activation wins on every device by the same rule; the loser switches itself off silently and stays off; the state belongs to the broadcaster whatever its role.

- A state with a later `activatedAt` replaces the current one; an earlier one is dropped; equal times break on device id, the same way on every device.
- The same owner's next revision always replaces its last, including a lower revision after its app restarted with a newer `activatedAt`.
- A state from the same owner with `active: false` clears the state; one with `active: false` from a device that is not the owner changes nothing.
- The owner leaves the workspace or disconnects: the state goes with it, and every device in the audience is sent a null state.
- Computer A is live and B switches on: A receives B's state, switches off without a message, closes every connection, and writes `broadcast: false`. After A restarts it is still off.
- A takes it back by pressing its switch: a new `activatedAt`, and B goes off the same way.
- Two computers switch on while apart (a partition), then meet: both end on the later activation, and only one keeps broadcasting.
- Clocks differ: B's clock is five minutes behind A's and B switches on after A. B stamps one millisecond after A's `activatedAt`, which it has seen, so the press still wins. The OBS link stamps with its own clock only; this is new here.
- The broadcaster is the coordinator, a follower, and a viewer-only desktop: in each, the state reaches every other device and signals reach the broadcaster.
- The coordinator changes during a broadcast: the broadcaster publishes its state to the new coordinator; open connections are untouched; the listener count does not reset.
- The switch is on and the workspace is closed, or another workspace is opened: the broadcast stops and the state goes inactive; the first workspace's switch is still on when it is opened again.
- The app starts with the switch on and no coordinator reachable: capture starts anyway, and the state is published when a coordinator appears.
- The negotiated protocol is below 7: nothing is published, capture and the level meter still work, and Settings carries the server-update note.
- Status changes publish at once; the listener count publishes at most once a second, and the last value is never lost.

### 3.2 Coordinator forwarding and older devices (A9; M1.5, M1.6)

`packages/live-state/src/audio.test.ts`, `coordination.test.ts`

Rules: audio messages go only to devices that declare `audio`; a signal goes to one device; the coordinator keeps the last state and nothing else.

- A follower without the capability receives no `audioState` and no `audioSignal`, and nothing it sends is affected.
- A device that connects with the capability is sent the current state, or null.
- A signal addressed to device X reaches X only, with the sender's id and listener details added by the coordinator, never taken from the message's own claim.
- A signal addressed to a device that is not connected, or does not take audio: the sender gets `close` with the reason that the device is gone.
- A signal addressed to the coordinator itself (it is the broadcaster, or the listener) is handled locally and not sent on.
- A signal from a device that sends before its capabilities are known is still forwarded: it speaks audio.
- A listener leaves: the broadcaster is told, so its connection is closed without waiting for ICE to time out.
- A version 7 follower against a version 6 coordinator: its `audioState` is not understood, nothing breaks, and it shows the note of §3.1.
- An unknown future signal body is refused by the schema, not forwarded.

### 3.3 Signals and their limits (M1.2, M1.7)

`packages/protocol/src/index.test.ts`, `apps/server/src/relay.test.ts`

Rules: every signal names its session; sizes are capped; the relay refuses what does not parse and keeps the connection.

- Each of `listen`, `offer`, `answer`, `candidate`, `close`, `full`, `retaken` parses with its fields and is refused with one missing.
- A description of exactly 16 KB passes; one byte more is refused. A candidate of 1 KB passes; one byte more is refused.
- An empty candidate (the end-of-candidates marker) passes.
- A session id of 100 characters passes; 101, or an empty one, is refused.
- An offer with ICE servers passes; with more than eight, or a URL that is not `stun:` or `turn:`, it is refused.
- Through the relay: the refused message is not delivered, the sender's socket stays open, and the next valid message goes through.
- A phone's `audioSignal` on the remote channel is parsed with the same schema and the same limits.

### 3.4 The Opus settings (A7; M1.8)

`packages/protocol/src/audio.test.ts`, fixtures recorded from each engine

Rules: the function changes the Opus format line and the packet time of the audio section, and nothing else; running it twice gives the same text.

- For each fixture (WebKit, WebView2, Chrome, Firefox, iOS Safari; offer and answer): the Opus `fmtp` line carries all six settings once, `a=ptime:10` appears once in the audio section, and every other line is byte-for-byte the same.
- An Opus payload type other than 111 is found from its `rtpmap` line.
- A description with no `fmtp` line for Opus gets one, placed after the `rtpmap` line.
- Settings already present with other values (`minptime=20`, `stereo=1`, `usedtx=1`) are replaced, not repeated; settings it does not know are kept.
- A second codec in the section (telephone-event, red) is untouched.
- Line endings are kept as they came, `\r\n` or `\n`.
- A description with no audio section, or no Opus, is returned unchanged.
- Applied twice, the result equals the result of once.

### 3.5 Watching the input (A8, A15, A16, A19; M2.2, M2.3, M2.10)

`packages/audio/src/input.test.ts`, `apps/desktop/src/app/audioCapture.test.ts`, `deviceSettings.test.ts`

Rules: with the switch on, the broadcaster always ends up capturing the chosen input when it exists, waits without failing when it does not, and never shows the operator an error for a device that came or went.

Starting:
- The switch is on and the device is there: asked for once, status `live`.
- The device is not there: status `waiting`, naming the device; nothing is asked for; the list is read on `devicechange` and every 3 s.
- The device appears: taken within one listing, status `live`, with no press.
- The first `devicechange` after plugging in lists the inputs without the device and the next one has it (W5): the first is ignored, the second starts capture.
- The saved device's id has changed but its name is the same: taken by name, and the saved id is updated.
- Two devices carry the saved name: the one with the saved id; if neither has it, the first, and it stays the same one on every listing.
- **System default** is chosen: capture follows the system's default input, and starts again when the default changes.
- The system refuses the microphone: status `refused`; it is asked again only when the operator presses the switch or picks an input, not on a loop.
- Asked for, and not answered within 5 s while the page is hidden: status `hidden` (A19); nothing more is asked. On `visibilitychange` to visible the pending request resolves, or is asked again, and the status goes to `live`.
- Asked for, and not answered within 5 s while the page is visible: asked again after 5 s, then every 15 s, status `waiting`.
- The device vanishes between listing and opening (the request fails with not-found or not-readable): one more wait, no error shown.

While live:
- The track ends (unplugged): status `waiting` at once; connections stay open; nothing is sent; no listener is closed.
- The device returns: a new track, `replaceTrack` on every connection, status `live`, and each listener is told `retaken` once.
- The track is muted (another window took the microphone, L7): the input is asked for again and the new track put in place; a `mute` followed by `unmute` within 500 ms does nothing.
- Muted and unplugged at once: one request, not two; the later result is used.
- The operator picks another input during a broadcast: the old track is stopped only after the new one is in place when both exist, so listeners lose nothing; if the new one cannot be opened, the old one stays and Settings says the pick failed.
- The operator picks an input that is not connected: status `waiting` for that device; the old track is stopped.
- A request made before the switch was turned off resolves after it: its track is stopped at once and nothing is sent.
- The switch is turned off: the track is stopped, the assertion released (M2.5), status off.
- The page becomes hidden while live: capture goes on; nothing is asked.
- Ten returns in a minute (a loose cable): each is handled; no more than one request is open at a time; `retaken` is sent after each.

Built-in microphone:
- macOS labels "MacBook Pro Microphone", "MacBook Air Microphone", "iMac Microphone", "Built-in Microphone" are built-in; "AT2020USB+", "Scarlett 2i2 USB", "VB-Cable" are not.
- Windows labels "Microphone Array (Realtek(R) Audio)" and "Internal Microphone" are built-in; "Microphone (USB Audio Device)" is not.
- **System default** resolving to a built-in microphone shows the warning; resolving to an interface does not.
- The warning never blocks the switch.

### 3.6 Broadcaster sessions and the limit of ten (A2, A20; M2.6)

`packages/audio/src/broadcaster.test.ts`

Rules: one connection per session, all on the one track; at most ten listeners, counted by who they are; a listener that is gone is closed at once.

- `listen` with nine listeners connected: accepted, an offer is sent, the count becomes ten.
- `listen` from an eleventh: answered `full`, no connection made, the count stays ten.
- One of the ten asks again with a new session (a fresh connection): accepted; for a moment it holds two connections and still counts as one; its old session closes on `close` or after 10 s.
- The same listener asks with the same session id twice: the second is ignored.
- A listener leaves and the eleventh asks again: accepted.
- A desktop, a phone and an administrator each count as one; two phones on the same desktop count as two.
- `listen` while the status is `waiting`: accepted and connected, sending nothing; the listener shows that the broadcast is waiting.
- `listen` while the switch is off, or from a session meant for a previous owner: answered `close`.
- An `answer` for an unknown session, or a second answer for one already answered, is ignored.
- A candidate that arrives before its description is held and applied after; candidates for a closed session are dropped.
- The listener's device leaves the workspace, its phone's grant is revoked, or its administrator signs out: its connection is closed and the count falls.
- A connection that stays `failed` or `disconnected` for 30 s with no word from the listener is closed and no longer counted.
- Switched off, or taken over: every listener is sent `close`, every connection closed, the count is zero.
- The count published is the number of listeners, not connections, and never negative or above ten.

### 3.7 The listener (A5, A17, A18; M3.1, M5.4)

`packages/audio/src/listener.test.ts`, with a fake connection and clock

Rules: nothing plays until **Listen** is pressed; once pressed, the listener keeps itself connected to whoever broadcasts until it is released, the broadcast ends, or it is refused as full.

Connecting:
- Pressed with an active state: `listen` is sent to the owner with a new session id; the offer is answered with the tuned description; candidates go both ways; the element plays when the track arrives.
- Pressed twice quickly, or pressed and released before the offer arrives: one session at most; a late offer for a released session is answered with `close`.
- No offer within 5 s: asked again with a new session, then after 1, 2, 4, 8 and 15 s.
- Answered `full`: the button shows that the broadcast is full and nothing is retried until it is pressed again.
- Released: `close` is sent, the connection closed, the element emptied.
- After an app restart, **Listen** is off whatever it was.

Staying connected:
- The connection goes `disconnected`: an ICE restart, with a fresh ICE list. Back to `connected`: nothing else changes.
- It goes `failed`: closed, and asked again after 1 s, growing to 15 s; a success resets the wait.
- The status goes to `waiting`: the listener stays connected in silence and shows it; no reconnect.
- The broadcaster's app restarts: the state goes null and comes back with a new `activatedAt`; the listener asks again by itself.
- Another computer takes over: the listener closes its session with the old owner and asks the new one.
- The state goes inactive and stays so: after it has been null for 60 s, **Listen** turns off; within that time a returning broadcast is picked up without a press.
- The coordinator changes: the connection is untouched; a signal that could not be sent is sent again when the new coordinator is known.

Connecting afresh:
- `retaken` arrives: a new session is asked for; when sound arrives on it the element is moved and the old session closed; the order is new first, old after.
- The new connection brings no sound in 3 s: it is closed and the old one kept.
- `retaken` twice within a second: one fresh connection, not two.
- The buffer reads above 300 ms for 3 s: a fresh connection; at 299 ms, or for 2.9 s, none.
- After a fresh connection, no other is asked for by the buffer check for 10 s; a `retaken` is still obeyed.
- A fresh connection while the first is still being made: the first is dropped, the latest wins.
- A fresh connection answered `full` cannot happen (A20); if it does, the old connection is kept.

Could not connect (M5.4):
- No connection after 15 s, and the ICE list had no relay: the message says the church's server offers no relay.
- The list had a relay: the message says the relay was tried.
- No list could be fetched (offline from the server) and both devices are on the LAN: it connects, and no message is shown.

### 3.8 The Monitor device (A11; M3.2, M3.4, M3.5)

`apps/desktop/src/app/audioListen.test.ts`, `deviceSettings.test.ts`

Rules: **Listen** plays on the Monitor device, never on the hall's output device; a missing device means the system default, never silence.

- The saved Monitor device is found by id; with a changed id, by name; found neither way, the system default is used and the saved choice is kept for next time.
- The order on the press is unlock, set the device, ask. The device is set even when the unlock takes longer than a gesture lasts, because it is set from the native script call.
- The picker is changed while listening: the element is moved, **Listen** stays on, and no signal is sent.
- The picker is changed while not listening: only saved.
- The Monitor device is unplugged while listening: the sound moves to the system default; plugging it back does not move it again until the picker is touched or **Listen** is pressed again.
- The Monitor device and the output device may be the same device; choosing one never changes the other.
- A settings file from before the feature has no Monitor entry and reads as **System default**.
- **Manual:** moving the device from Settings takes under two seconds on macOS and Windows and leaves the delay figure where it was; the slideshow window opening or closing does not disturb listening.

### 3.9 Phones (A4; M4.1, M4.2, M4.4)

`packages/remote/src/index.test.ts`

Rules: every approved phone may listen; a phone speaks only through its desktop and under its grant; a phone that is no longer approved hears nothing.

- The phone's view has `audio: null` with no broadcast, and the owner's name and status with one; it is sent again on every change of status, not on every change of the listener count.
- A phone's `listen` reaches the broadcaster as from a `phone` listener with that phone's grant id and name, whichever desktop it is connected to, including the broadcaster itself and the coordinator.
- The broadcaster's offer, candidates and `retaken` reach that phone only, not another phone on the same desktop.
- A phone that has not been approved, or whose approval is pending, cannot send an audio signal.
- The grant is revoked while listening: the host sends `close` for its sessions and the phone's connection to the host is closed, as today.
- Every grant of the workspace is revoked at once: every phone's sessions are closed.
- The phone's page closes or loses its desktop: `close` is sent after 10 s without it, so a brief reconnection does not interrupt the sound.
- The phone reconnects to another desktop with its grant: it counts as the same listener (A20), and asks again.
- A desktop without the `audio` capability hosts the phone: the view has no audio and the button is absent.
- The offer to a phone carries the ICE list; a phone never calls the ICE route.
- **Manual:** one tap starts the sound on iOS Safari and Android Chrome; locking the screen for a minute and unlocking it leaves the sound playing or brings it back without a tap; the note of A24 is shown.

### 3.10 The ICE route and relay credentials (A10; M5.1, M5.2)

`apps/server/src/ice.test.ts`, `apps/desktop/src/app/iceServers.test.ts`

Rules: only an enrolled device gets the list; a credential lasts ten minutes and is made fresh for every connection; no setting is needed for the default.

- No settings: the answer is the default STUN server and no relay.
- `WORSHIP_Q_STUN` with two URLs: both, in order. Set to an empty string: no STUN. With spaces around the commas: trimmed. A value that is not a `stun:` URL: the server refuses to start, with a message naming the setting.
- The relay's URL without its secret, or the secret without the URL: no relay, and a warning in the server's log at start.
- With both: the user name is the time ten minutes from now in seconds; the password is the base64 HMAC-SHA1 of the user name with the secret; a known secret and time give a known password.
- Two requests a second apart give different user names once the second changes, and each verifies.
- A device that is not enrolled, a revoked device, an output link and a phone are refused with 401.
- The secret never appears in the answer, in `info`, or in a log line.
- `info` says whether a relay is offered, so a listener's message can say so without a credential.
- The desktop asks before each new connection and each ICE restart; a second connection within five minutes reuses the answer; after five minutes it asks again.
- The request fails or the server is unreachable: an empty list, no error shown, and LAN listening works.
- The administrator changes `WORSHIP_Q_STUN` and restarts the server: the next connection uses the new list.

### 3.11 Administrators (A14, A21, A22; M5.5–M5.8)

`apps/server/src/audioReports.test.ts`, `admin.test.ts`, `relay.test.ts`

Rules: an administrator listens only while signed in, only when the broadcaster is connected to the server, and counts as one of the ten; the server carries signals and never audio.

Reports:
- The broadcaster's report replaces its last one; another computer's report with an earlier `activatedAt` is refused, with a later one it replaces.
- A report from a device that is not the state's owner is refused.
- No report for 90 s: the workspace shows no broadcast; an `active: false` report clears it at once.
- The server restarts: no broadcast is shown until the next report, within half a minute.
- A device of another workspace cannot report for this one.

Signals:
- A signed-in administrator's `listen` reaches the broadcaster's socket as from an `admin` listener, with a session id made by the server, not by the browser.
- The broadcaster is not connected to the relay: the post is answered at once with a reason, and the page shows no **Listen** button on its next load.
- The broadcaster's answers are queued for that session only; the poll returns those after the given position, in order, and each once.
- Another administrator, or the same one in another tab, has a session of their own and counts as another listener.
- A poll for a session that is not the asker's is refused.
- No poll for 30 s: the server sends `close` to the broadcaster and forgets the session; a later poll is told the session is gone, and the page asks again if **Listen** is still on.
- The administrator signs out, or the sign-in expires, while listening: the next poll is refused, `close` is sent to the broadcaster, and the count falls.
- A person who is signed in but is not an administrator of the instance is refused.
- An eleventh listener who is an administrator is told the broadcast is full.
- A signal over the size limits is refused by the route with 413, before the relay.
- The first answer carries the ICE list, with a relay credential when one is configured.

### 3.12 Delay and path (M3.6)

`packages/audio/src/stats.test.ts`

Rules: the figure is the buffer over the last interval plus half the round trip; it is labelled as the network and buffer part, not the whole delay.

- Over the interval the buffer-delay total rose by 11,520 s and 96,000 samples were played (two seconds at 48 kHz), so the buffer is 120 ms; the round trip is 26 ms: the figure is 130 ms (120 + 13, rounded to 10).
- No samples emitted in the interval (silence while waiting): the last figure is kept and marked as old after 5 s.
- Readings 2 s apart and 4 s apart give the same figure for the same stream: nothing depends on the timer's rate.
- Statistics missing a field (an engine without the buffer target, or without the round trip): the figure uses what there is, and shows a dash rather than zero when the buffer is unknown.
- The selected pair has a relay candidate on either side: **Relayed**; otherwise **Direct**, including a path through a reflexive candidate.
- After a fresh connection the figure is taken from the new connection only, not averaged with the old.

### 3.13 Checks for the walkthrough (manual)

- **Set up once:** switch on, quit, reopen: broadcasting within a few seconds with no press. Reboot the computer and open the app: the same.
- **Input later:** open the app with the interface unplugged, then plug it in: Waiting for input, then Live, with no press.
- **Unplug during a broadcast,** with a desktop and a phone listening: both show waiting, stay connected, and hear the sound again within two seconds of plugging back, in time with the room.
- **Window out of view on macOS:** start the app with the main window minimised or under the slideshow on a single display: the banner asks for the window, and the broadcast starts when it is brought forward. Then cover it: the broadcast goes on.
- **Slideshow with an output device saved, on macOS:** open the slideshow during a broadcast: listeners lose at most about half a second and are back in time.
- **Display and lock:** with the switch on the display does not sleep. Lock the broadcasting computer's screen for five minutes: record whether the sound goes on (M3.8).
- **Take-over:** switch on at a second computer: the first goes quiet without a message, listeners move to the second without a press, and the first stays off after a restart.
- **Coordinator hand-over** while two desktops listen: no gap.
- **Listening is a choice:** a second operator's laptop in the room makes no sound until **Listen** is pressed, and none after a restart.
- **Monitor device:** headphones as Monitor, the hall's interface as output: **Listen** is in the headphones only, and a video's sound goes to the hall only.
- **Ten listeners,** then an eleventh: told it is full; one leaves and the eleventh gets in.
- **Built-in microphone:** the warning shows, and the broadcast still works.
- **Older devices:** a desktop still on protocol 6 in the workspace presents as before and shows nothing new; a server on protocol 6 gives the note in Settings.
- **Delay:** a clap in the room against the headphones, on the venue network (A6: 200 ms) and from a home connection (300 ms).
- **A full service's length:** ninety minutes with no drift in the delay figure and no drop-out, on macOS and on Windows as broadcaster.
- **Across the internet:** the cases of M5.10, each with the listener's network written down.

## 4. Order and dependencies

| Work | Tasks | When |
| --- | --- | --- |
| Protocol | M1.1–M1.3, M1.9 | First |
| State and forwarding | M1.4–M1.7 | After M1.3 |
| Opus settings | M1.8 | Day one; its fixtures need each engine once |
| Pure logic | M2.2, M2.6, M3.1, M3.6 | After M1.2; in parallel with each other |
| Broadcasting | M2.1, M2.3–M2.5, M2.7–M2.11 | After M1.5, M2.2 and M2.6 |
| Desktop listening | M3.2–M3.5, M3.7, M3.8 | After M2.8 and M3.1; M3.4 can start on day one |
| Phones | M4 | After M2.8 and M3.1 |
| Server and internet | M5.1–M5.4, M5.9 | M5.1 and M5.3 on day one; M5.2 after M2.7 and M3.2 |
| Administrators | M5.5–M5.8 | After M2.8 and M3.1 |
| Acceptance | M6 | After everything |

M1–M3 make a release on their own: a second operator in the building can listen. M4 and M5 are independent of each other and can follow in either order.

Five tasks can begin on day one: the protocol bump (M1.1), the Opus function (M1.8), the Monitor picker (M3.4), the ICE route (M5.1) and the coturn profile (M5.3).

## 5. Rollout

The server update comes first: the relay must know protocol version 7 before any desktop can share a broadcast. It changes nothing for a workspace that does not broadcast. Desktops update themselves as usual. A desktop on this release against a server still on protocol 6 presents and synchronizes as before; its switch and level meter work, and Settings says that sharing the broadcast needs a server update. A desktop still on protocol 6 in a workspace that broadcasts presents as before and shows nothing new, because the coordinator sends audio messages only to devices declaring the capability (M1.5).

Most churches set nothing up. The relay is the administrator's choice (M5.3, M5.9); the first church's server already has its UDP ports open.

## 6. Risks tied to tasks

| Risk | Task | Mitigation |
| --- | --- | --- |
| The main window is out of view when the app starts, and the broadcast is silent with nobody noticing | M2.2, M2.9, M2.11 | The `hidden` status (A19), a banner on the Present page, and other devices showing Waiting for input rather than Live |
| The broadcasting computer's screen locks during a service | M2.5, M3.8 | The display is kept awake; a lock set by policy is not prevented, so M3.8 measures whether a running capture survives it, and the volunteer guide says to turn the lock off on that computer |
| Listeners end up late after a stumble and nothing shows it | M2.7, M3.1 | `retaken` after every new track (A17); the buffer check as a second net (A18); the delay figure in view |
| Take-over decided differently on two devices | M1.4, M2.8 | One rule in `packages/live-state`, used by desktops, the coordinator and the server's reports; clock skew handled at the press (§3.1) |
| A version 6 device is sent a version 7 message | M1.5, M1.6 | Capability gate on the sender; unknown kinds ignored on the receiver |
| Ten connections on a slow venue uplink | M5.10 | 1.2 Mbit/s measured for ten (L12, W7); listeners on the venue network cost no upload; the limit is fixed at ten |
| The admin page's polling loads the server | M5.7 | 500 ms only while connecting, 5 s once playing; sessions dropped after 30 s without a poll |
| A mobile network that allows no direct path, and no relay configured | M5.4, M5.10 | The listener is told why; the relay is one compose profile and two settings away (M5.9) |
| The relay's secret leaks through a log or the ICE answer | M5.1 | Only the derived, ten-minute credential leaves the server; tests assert the secret appears nowhere |
| SDP from a new engine version breaks the Opus rewriting | M1.8 | The function leaves a description it does not recognise unchanged, and the connection still works at the engine's defaults |
| WebKit's capture proves unreliable in the field | M2.3 | Native capture in Rust stays the plan's fallback (A8); the input watcher (M2.2) is independent of where the track comes from |
