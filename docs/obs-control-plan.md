# Worship Q — OBS Control Plan

**Drafted:** 5 November 2026  
**Status:** Feature request recorded; design reviewed with the project owner; feasibility checked against the obs-websocket protocol and source; tasks in the [task breakdown](obs-control-task-breakdown.md). Implemented on the `obs-control` branch, 6 November 2026; walkthrough pending ([acceptance record](acceptance/obs-control.md)).  
**Source:** operator request of 5 November 2026; [Requirements and Architecture](worship-q-requirements-and-architecture.md) §§9–11 and §13 (OBS as an overlay consumer, client roles, stable output endpoints); [Phase 2 Plan](phase-2-plan.md) D14–D25 (coordinator, followers, LAN, relay, phones); the code at version 1.4.1; the obs-websocket 5 protocol document and source (see §7).

## 1. Where the implementation stands

- OBS is a one-way consumer today. The desktop app serves the subtitle overlay and the slideshow on localhost (port 47310) for an OBS Browser Source on the same computer, and the server serves the same pages through revocable output links (phase 2 D22). Worship Q never talks to OBS; an operator switches scenes, streams and records in OBS itself, on the streaming computer.
- Every desktop of a workspace connects to the church server's relay, and to the coordinator over the LAN when reachable (D19–D21). Followers exchange typed messages with the coordinator (`toCoordinator`, `toFollower`), and each desktop sends its phones a `RemoteView`. Phone commands enter through the desktop the phone is connected to and are forwarded to the coordinator (D25).
- A desktop is coordinator, follower or viewer. A viewer shows the presentation and never holds it, which is exactly the role of a streaming computer that only runs OBS.
- Device secrets (device tokens) live in the system keychain (phase 2 D23).
- The Tauri backend already has what an OBS WebSocket client needs: `tokio-tungstenite` (used for the LAN, plain `ws://` works without TLS features), `sha2` for the authentication hash, `serde_json`, and `keyring`. Only a base64 encoder is missing.

## 2. The request

Operators want to control OBS from Worship Q: from the remote control on a phone, or from another computer running the app, instead of walking over to the streaming computer. As everywhere in the app, it is set up once and then simply used.

**Agreed requirements**

- **One OBS per workspace.** The computer OBS runs on also runs the desktop app, in any role: viewer only, follower or coordinator. For one workspace, assume only one OBS is running.
- **Local connection.** That desktop connects to OBS over the OBS WebSocket server on the same computer. The desktop holds the connection and relays everything for the rest of the workspace.
- **Controls.** Switch between scenes; start and stop streaming; start and stop recording; start and stop the virtual camera. Blacking out the stream is left out: churches switch to their own blank scene, and OBS's Fade to Black is not offered.
- **One switch button.** The most common action is switching between two specific scenes the operator picks in advance. One button does just that, and sits with the main controls on the desktop app and on the remote control.
- **Control panel.** Everything else lives in a separate OBS control panel, somewhere on the desktop app and on the remote control UI.
- **Live monitor.** A snapshot of the OBS program output, about once a second if the venue Wi-Fi allows it, less often or on demand if not.
- **Shown only when configured.** The switch button, the control panel, the live monitor and the status indicator appear on every desktop and remote control of the workspace only when one of the workspace's desktops is configured to connect to OBS. Workspaces without OBS see nothing new.
- **Status indicator.** The connection status to OBS is visible wherever the controls are.
- **Either order.** It works whether OBS or Worship Q is opened first, and after either restarts or the computer reboots.
- **A separate OBS state.** Like the live state: at most one per workspace, owned by the computer whose OBS link is active. Another computer takes it over simply by configuring and activating its own OBS link; no notification is shown to anyone.

## 3. Features

- **OBS link, under Settings on the streaming computer.** Address (default `localhost:4455`, the OBS default), password, and an **Activate** switch. While active, the desktop keeps trying to connect for as long as it runs, so OBS can be opened before or after Worship Q, and the link survives both restarting. Turning the link off removes every OBS control from the workspace.
- **Guided one-time setup in OBS.** OBS ships its WebSocket server turned off, with authentication on and a generated password. The settings page tells the operator the two steps in OBS (**Tools → WebSocket Server Settings**, tick **Enable WebSocket server**, copy the password) and, where it can read OBS's own settings file on the same computer, fills in the port and password itself (§4, to be verified).
- **Two favourite scenes.** Picked from the scene list OBS reports, on the same settings page. These are the two sides of the switch button. Suggested use: the lyrics scene and the camera scene.
- **Switch button.** On the Present page next to the output controls, and on the phone's main controls. It shows which of the two scenes is live and switches to the other. If OBS is on a third scene, it switches to the first favourite.
- **OBS panel.** Scene list with the current scene highlighted; Stream, Record and Virtual camera toggles each showing its state; the status indicator; and the live monitor. On the desktop it opens from the Present page; on the phone it is a separate screen reached from the main controls.
- **Live monitor.** A small image of the program output, refreshed about once a second while a panel showing it is open, taken on the OBS computer and scaled down before it leaves the computer.
- **Status indicator.** Not configured (nothing shown anywhere), OBS not running or Connecting, Connected, Refused (wrong password or WebSocket server disabled). Shown on the switch button and in the panel; the panel explains what to do about Refused.

## 4. Proposed design

- **OBS state.** The OBS computer publishes an OBS state to the workspace: active, connection status, scene names, current scene, the two favourites, and the stream, record and virtual camera states with their timers. It is its own state beside the live state and never touches the coordinator's authority over the presentation (spec §10): the OBS computer owns it, whatever its role, and a viewer can own it.
- **Transport.** The OBS state and the commands for it are new message kinds beside the live snapshot and the live commands, on the channels that already exist: a follower's `toCoordinator` and the coordinator's `toFollower` over the relay or the LAN, and the desktop-to-phone `view`. The coordinator fans the OBS state out as it does the live snapshot and forwards commands to the OBS computer; it is transport only and keeps no OBS state of its own. When the OBS computer is the coordinator, nothing needs forwarding. A phone's command enters through its desktop and is forwarded, as today (D25). The relay validates every `toCoordinator` and `toFollower` message against the protocol schemas, so the new kinds are protocol version 4 and the church's server must be updated; the minimum protocol stays 2, and the coordinator sends OBS messages only to devices that declare an `obs` capability, so older desktops see nothing new. Until the server is updated, the OBS computer's own controls work and nothing is shared.
- **Take-over.** The OBS state carries the owning device and the time its link was activated. A later activation wins: when a desktop sees an OBS state from another device that was activated more recently than its own, it deactivates its own link silently and follows. Each computer remembers its own link settings, so turning it back on later is one switch.
- **Connection to OBS.** The desktop connects to `ws://<address>` and performs the obs-websocket handshake: read `Hello`, answer `Identify` with the authentication string when OBS demands one, then subscribe to events. It loads the scene list and the output states once on connect, and keeps them current from the `CurrentProgramSceneChanged`, `SceneListChanged`, `SceneNameChanged`, `StreamStateChanged`, `RecordStateChanged` and `VirtualcamStateChanged` events, so other operators changing things in OBS itself are reflected everywhere within the event's latency. `ExitStarted` marks OBS as closing before the socket drops.
- **Commands.** `SetCurrentProgramScene`, `StartStream`/`StopStream`, `StartRecord`/`StopRecord`, `StartVirtualCam`/`StopVirtualCam`, each acknowledged back to the device that asked. Toggles are not used from remote devices, so two operators pressing at once cannot cancel each other out.
- **Snapshots.** obs-websocket has no request for the program output itself, only for a named source. The OBS computer requests `GetSourceScreenshot` of the current program scene (`GetCurrentProgramScene`), which is the program output outside a transition. JPEG about 320 pixels wide at a modest `imageCompressionQuality`, around 10–20 KB each, requested once a second only while at least one device has a monitor open, and sent to those devices only. Over the LAN this is negligible; through the relay it costs the venue roughly 15 KB/s of upload per watching device. If that proves too much, the fall-back is a slower rate or a refresh button. To be measured on a real venue connection before the rate is fixed.
- **Password and settings.** Password in the system keychain with the device token (D23). Address, favourite scenes and the active flag in the workspace folder's settings on the OBS computer, since the scene names belong to that computer's OBS profile. Nothing on the server.
- **Reading OBS's settings.** obs-websocket keeps its settings in a plugin-owned `config.json` (`server_enabled`, `server_port`, `auth_required`, `server_password`) under OBS's plugin configuration folder. If that file is readable on the same computer, the settings page can fill in the port and password and tell the operator when the server is still disabled in OBS. The exact folder per platform is to be verified before this is promised; without it the operator pastes the password once.
- **Reconnection and restarts.** A WebSocket does not survive either process restarting; what survives is the configuration on both sides. OBS stores its server settings in its own file, so once enabled the server starts with OBS after every launch and reboot. Worship Q stores the link and retries every few seconds while it is active, so it connects whichever of the two starts first. While OBS is not running, the status shows OBS not running and the controls on every device are disabled but stay visible. When the OBS computer itself leaves the workspace, the OBS state goes with it and the controls disappear until it is back. Launching either application at login is the operating system's job and is not part of this feature.
- **OBS state on the admin page.** The relay forwards OBS messages between desktops and keeps none, and they never reach the server when the OBS computer presents alone or the desktops meet on the LAN. So the OBS computer also reports its own state to the church server with `PUT /api/v1/obs`: soon after it changes, every 30 seconds while its link is on (`OBS_REPORT_EVERY_MS`), and once when its link is turned off (`ObsReporter`). The server keeps the latest report per workspace in memory, the later activation winning as between desktops (`newerObsState`), and the admin app's workspace page shows it read-only under the presentation: the OBS computer, OBS's status, the scene on program, the scenes, and the outputs with their timers. A report older than two and a half heartbeats is shown as stale. The live monitor is not shown there, since the admin page has no live connection. An older server lacks the route; the desktop ignores the refusal.

## 5. Decisions

| # | Topic | Decision |
| --- | --- | --- |
| O1 | Which computer talks to OBS | The desktop on the same computer as OBS, in any role including viewer only. It holds the connection and relays for the workspace. **Agreed.** |
| O2 | Protocol | obs-websocket 5 as included with the current OBS Studio (default port 4455, authentication optional on the OBS side); tested with OBS 33.0.1. OBS 28 to 32 are assumed to work, as the requests used are all from obs-websocket 5.0, but are not tested; earlier OBS versions are not supported. **Agreed.** |
| O3 | Controls in scope | Scene switching, streaming, recording, virtual camera. Black-out and Fade to Black are left out; no source, audio or transition control. **Agreed.** |
| O4 | Switch button | Toggles between two scenes chosen on the OBS computer's settings page. On the main controls of the desktop and the phone. **Agreed.** |
| O5 | Visibility | OBS controls, monitor and status appear on every desktop and phone of the workspace only while a desktop of the workspace has an active link. **Agreed.** |
| O6 | Live monitor rate | About one snapshot a second to devices showing the monitor, downscaled on the OBS computer; reduce or make on demand if the venue Wi-Fi or relay suffers. **Agreed direction; rate open until measured.** |
| O7 | Startup order | OBS and Worship Q may start in either order; the desktop keeps retrying. **Agreed.** |
| O8 | One OBS state per workspace | A separate state like the live state, at most one per workspace, owned by the computer with the active link. **Agreed.** |
| O9 | Take-over | Activating a link on another computer takes the state over silently; the previous computer's link deactivates itself. No notification. **Agreed.** |
| O10 | Settings location | Address, favourites and active flag on the OBS computer, per workspace, in the app's own storage beside viewer mode (the workspace's `setting` table is synchronized, so not there); password in the keychain. Nothing on the server. **Agreed.** |
| O11 | Transport | New message kinds on the existing coordinator, follower and phone channels, as protocol version 4 with the relay updated; the coordinator forwards without owning, and only to devices declaring the `obs` capability. **Proposed.** |
| O12 | Setup help | Read port and password from obs-websocket's own settings file when possible; otherwise the operator pastes the password once. **Proposed; path verified on macOS and Windows.** |

## 6. Open questions

- Should the live monitor also appear outside the panel, for example beside the slide preview on the Present page, for operators who want to watch the stream while driving slides?
- Should the switch button's two scenes be the only quick action, or should a small number of favourite scenes be allowed, with the two-scene toggle as the default?
- Does the phone's main screen have room for the switch button without crowding slide navigation, or does it belong in a second row that appears only with OBS?
- ~~Studio Mode: whether `SetCurrentProgramScene` transitions directly while Studio Mode is on.~~ Answered by the [spike](spikes/obs.md): it does, with the current transition, and leaves the preview alone.

## 7. Feasibility check (5 November 2026)

Checked against the obs-websocket protocol document (`docs/generated/protocol.md`), its README, and its source (`src/Config.h`, `src/Config.cpp`, `data/locale/en-US.ini`) on the project's main branch.

| Need | Finding |
| --- | --- |
| Connect from the same computer | Plain WebSocket on port 4455 by default; the port is changeable in OBS. `Hello` carries `rpcVersion` and, when authentication is on, a `challenge` and `salt`. |
| Authenticate | `Identify` with `authentication` = base64(SHA-256(base64(SHA-256(password + salt)) + challenge)). Optional when OBS has authentication off. |
| Scenes | `GetSceneList` (returns the current program scene too), `GetCurrentProgramScene`, `SetCurrentProgramScene` by `sceneName` or `sceneUuid`. Events `CurrentProgramSceneChanged`, `SceneListChanged`, `SceneNameChanged`. |
| Streaming, recording, virtual camera | `StartStream`/`StopStream`/`GetStreamStatus` (with `outputTimecode`, `outputReconnecting`), `StartRecord`/`StopRecord`/`GetRecordStatus` (with `outputPaused`), `StartVirtualCam`/`StopVirtualCam`/`GetVirtualCamStatus`. Events `StreamStateChanged`, `RecordStateChanged`, `VirtualcamStateChanged` with `outputActive` and an `outputState` such as `OBS_WEBSOCKET_OUTPUT_STARTED`. |
| Live monitor | `GetSourceScreenshot` with `sourceName`, `imageFormat` (formats listed by `GetVersion.supportedImageFormats`), `imageWidth`, `imageHeight`, `imageCompressionQuality`; returns base64 `imageData`. No request for the program output itself, hence screenshotting the current program scene. |
| OBS closing | `ExitStarted` event, then the socket drops. |
| Black-out, Fade to Black | Left out (O3). For the record: the protocol has no request for either. OBS's Fade to Black is a Studio Mode quick transition reachable only by firing a per-profile hotkey through `TriggerHotkeyByName`, with no event reporting the result. A blank scene switched like any other does the job. |
| Rate limits | None documented. One screenshot a second is well within what the protocol expects; polling is only to be paused during a scene collection change (`CurrentSceneCollectionChanging`). |
| Survives OBS restarts and reboots | obs-websocket persists `server_enabled`, `server_port`, `auth_required` and `server_password` in its own `config.json`; the server starts with OBS whenever it is enabled. Defaults on a fresh OBS: server **disabled**, authentication **on**, password generated on first load. So the operator must enable the server in OBS once (`Tools → WebSocket Server Settings`, **Enable WebSocket server**); after that nothing is needed again. |
| Survives Worship Q restarts | Our side: link settings in the workspace folder and the password in the keychain, with automatic retry. Same pattern as the device token and the LAN connection today. |
| Our client library | `tokio-tungstenite` with the `handshake` feature connects to `ws://` without TLS features; `sha2` is present; a `base64` crate is needed. |

Checked in the code: the relay parses `toCoordinator` and `toFollower` with the protocol schemas and refuses unknown kinds, so the new messages need a relay change and a server update (O11). Confirmed on macOS and Windows by the [spike](spikes/obs.md) (6 November 2026): the plugin configuration folder for O12 and `SetCurrentProgramScene` under Studio Mode. Tasks are in the [task breakdown](obs-control-task-breakdown.md).
