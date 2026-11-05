# Worship Q — OBS Control Task Breakdown

**Drafted:** 5 November 2026  
**Status:** Draft for review. Not scheduled.  
**Source:** [OBS Control Plan](obs-control-plan.md), referred to here as "the plan", and the code at version 1.4.1. Decisions (O1–O12) are the plan's.

## 1. How to read this

The plan says what the feature delivers and why it is feasible. This document breaks it into tasks small enough to be one pull request, says where in the repository each lands, and names the tests that prove it. Task identifiers are `M<milestone>.<n>`; a task lists the tasks it needs first. Sizes are S, M and L as in the phase plans.

Every task that changes business logic carries unit tests in its package, and every task that changes the relay carries an integration test in `apps/server/src/relay.test.ts`. The Tauri core's OBS client is tested against a fake obs-websocket server in Rust. The desktop and phone interfaces have no automated tests; the M6 walkthrough covers them.

### Where things live today

| Concern | Location |
| --- | --- |
| Wire messages and schemas, protocol version (3, minimum 2) | `packages/protocol/src/wire.ts` |
| Coordinator and follower logic, pure | `packages/live-state/src/coordination.ts` |
| Desktop live link: role, transports, coordinator and follower wiring, `peer` handling | `apps/desktop/src/app/liveLink.ts` |
| Desktop relay client and church connection | `apps/desktop/src/app/cloud.ts`, `transport.ts` |
| Desktop LAN client and server wiring | `apps/desktop/src/app/lan.ts`, `src-tauri/src/lan.rs` |
| Per-computer settings outside the workspace databases (viewer mode) | `apps/desktop/src/app/deviceSettings.ts` |
| Per-workspace settings on this computer | `setting` table, `packages/store` |
| Keychain | `src-tauri/src/keychain.rs`, `apps/desktop/src/platform/native.ts` |
| Relay: validates and routes `toCoordinator` and `toFollower` | `packages/relay/src/index.ts`, hosted by `apps/server` |
| Remote-control host: builds the phone's `RemoteView`, forwards phone commands | `packages/remote/src/index.ts` (`RemoteHost`) |
| Phone page | `apps/remote/src/RemoteApp.tsx`, `connection.ts` |
| Present page, output toolbar, settings page | `apps/desktop/src/pages/PresentPage.tsx`, `components/OutputPanel.tsx`, `pages/SettingsPage.tsx` |
| Interface strings | `apps/desktop/src/i18n/en.ts` |

### Two facts that shape the tasks

- **The relay reads every message.** `toCoordinator` and `toFollower` data is parsed with the protocol schemas and refused when malformed, so the OBS messages are a protocol change: version 4, with the relay updated. A desktop against an older server keeps its own OBS controls (it talks to OBS directly) but cannot share them; the settings page says so. The minimum protocol stays 2, and version 3 desktops are untouched, because the coordinator sends OBS messages only to devices that declare the `obs` capability (M2.3).
- **The coordinator is transport only.** The OBS state is owned by the OBS computer (O8). Over the relay and the LAN every follower talks to the coordinator, so the coordinator forwards OBS messages between the owner and the others without keeping any OBS state of its own beyond the last one it relayed, which it hands to a device that connects.

## 2. Tasks by milestone

### M0 — Spike against a real OBS (S)

Throwaway code on a branch that is not merged. Ends in `docs/spikes/obs.md`.

| # | Task | Where | Done when |
| --- | --- | --- | --- |
| M0.1 | Connect from the Tauri core to OBS on the same computer with `tokio-tungstenite` over `ws://`, complete `Hello`/`Identify` with and without a password, and call `GetVersion` | `src-tauri` | Both macOS and Windows connect to OBS 28 and to the current OBS; the `supportedImageFormats` list is recorded |
| M0.2 | Screenshot cost: `GetSourceScreenshot` of the current program scene as JPEG at 320 pixels wide and three compression qualities, measured for byte size and round-trip time at one per second for a minute | spike notes | Sizes and timings recorded; a format and quality are chosen for O6 |
| M0.3 | Studio Mode: what `SetCurrentProgramScene` does while Studio Mode is on, and which event follows | spike notes | Recorded; the plan's open question is answered |
| M0.4 | obs-websocket's `config.json`: its folder on macOS and Windows, and whether the file is readable while OBS runs | spike notes | Paths recorded, or O12 is dropped |
| M0.5 | Behaviour when OBS quits (`ExitStarted`, then the socket), when OBS is not running (connection refused), and when the password is wrong (`Identify` refused, close code) | spike notes | Each case maps to one status of the plan's indicator |

**Exit:** `docs/spikes/obs.md` records the findings and the choices for M1.

### M1 — OBS client in the Tauri core (M)

| # | Task | Where | Needs | Tests | Done when |
| --- | --- | --- | --- | --- | --- |
| M1.1 | obs-websocket client: `obs.rs` connects to a configured address, does the handshake and authentication (`sha2` plus a `base64` crate), sends requests with ids and matches responses, and emits events to the interface as `obs-event`; Tauri commands `obs_connect`, `obs_disconnect`, `obs_request`, `obs_status` | `src-tauri/src/obs.rs`, `lib.rs`, `Cargo.toml` | M0.1 | Rust integration: a fake obs-websocket server in the test (tokio-tungstenite `accept_async`) checks the authentication string for a known salt and challenge, answers requests, and sends an event | Requests and events flow both ways against the fake |
| M1.2 | Retry loop: while connected is wanted, reconnect every three seconds after a refusal or a drop; status `not-running`, `connecting`, `connected`, `refused` (authentication failed or closed during `Identify`) emitted as `obs-status` | `obs.rs` | M1.1, M0.5 | Rust: the fake server refuses twice then accepts; the client connects on the third try; a wrong password yields `refused` and keeps retrying slowly | O7 |
| M1.3 | Program screenshot: `obs_screenshot(width, quality)` asks `GetCurrentProgramScene` then `GetSourceScreenshot`, returns the base64 image | `obs.rs` | M1.1, M0.2 | Rust: against the fake, returns the fake's image | O6 input |
| M1.4 | Native bindings and the interface controller: `native.obs*` in `platform/native.ts`; `ObsLink` in `apps/desktop/src/app/obs.ts` holds the link settings and the OBS view (status, scenes, current scene, stream, record and virtual camera states with timers), loads them on connect (`GetSceneList`, `GetStreamStatus`, `GetRecordStatus`, `GetVirtualCamStatus`), keeps them current from the events of plan §4, and exposes the commands of plan §4 | `apps/desktop/src/app/obs.ts`, `platform/native.ts` | M1.1 | Unit with a fake native: events update the view; a command resolves on the response and rejects on a request error | One object the pages read, like `LiveLink` |
| M1.5 | Link settings: address, favourite scenes and active flag in the workspace's `setting` table on this computer (O10); the password in the keychain under an OBS account name, as the device token is | `packages/store`, `apps/desktop/src/app/obs.ts`, `keychain.rs` | M1.4 | Unit: settings round-trip; a missing keychain entry leaves the link inactive with a clear status | Survives restarts and reboots |
| M1.6 | OBS state record: a pure `ObsState` (owner device id, `activatedAt`, status, scenes, current scene, favourites, outputs) built from the `ObsLink` view, with a `newer(a, b)` rule for take-over by `activatedAt` (O9) | `packages/live-state/src/obs.ts` | — | Unit: a later activation wins; equal timestamps break on device id; a state from a device that left is dropped | O8, O9 logic in one place |

**Milestone done:** on the OBS computer alone, Settings turns the link on, the status goes to Connected whether OBS was opened before or after, and `ObsLink` reports a scene change made in OBS within a second.

### M2 — Protocol and workspace distribution (M)

| # | Task | Where | Needs | Tests | Done when |
| --- | --- | --- | --- | --- | --- |
| M2.1 | Protocol version 4: raise `PROTOCOL_VERSION`, keep `MIN_PROTOCOL_VERSION` at 2; the server `info` route reports 4; the desktop's negotiation (`CloudController.negotiate`) keeps working against 3 | `packages/protocol`, `apps/server`, `cloud.ts` | — | Unit: a version 3 hello is still accepted; `versions.test.ts` gains the 3-against-4 case | D26 pattern |
| M2.2 | Schemas: `ObsStateSchema`; `ObsCommandSchema` (`setScene`, `startStream`, `stopStream`, `startRecord`, `stopRecord`, `startVirtualCam`, `stopVirtualCam`); `FollowerToCoordinator` gains `obsState` (from the owner), `obsCommand` (id, origin, command), `obsWatch` (watching: boolean), `obsSnapshot` (from the owner: image, takenAt); `CoordinatorToFollower` gains `obsState`, `obsCommand` (forwarded to the owner, with origin and the asker's device id), `obsAck`, `obsSnapshot`; `Capabilities` gains `obs: boolean` default false | `packages/protocol/src/wire.ts` | M2.1 | Unit: schemas parse and reject malformed input; a version 3 message set still parses | Documented in the file header |
| M2.3 | Coordinator forwarding: `Coordinator.receive` relays `obsState` to every follower with the `obs` capability and keeps the latest to send to a device on connect; relays `obsCommand` to the owner and `obsAck` back to the asker; relays `obsWatch` to the owner and `obsSnapshot` to the watchers only; drops an `obsState` older than the one it holds by M1.6's rule | `packages/live-state/src/coordination.ts` | M2.2, M1.6 | Unit: a follower without the capability receives no OBS message; a command from a phone's desktop gets its ack back to that desktop; two owners resolve to the later activation | Coordinator keeps no OBS state of its own |
| M2.4 | Follower side: `Follower.receive` turns the new kinds into events (`obsState`, `obsCommand` for the owner, `obsAck`, `obsSnapshot`); unknown kinds are ignored rather than falling through | `coordination.ts` | M2.2 | Unit via the existing harness | A version 4 follower against a version 3 coordinator sees nothing new and nothing breaks |
| M2.5 | Relay accepts version 4 messages: the schemas of M2.2 make `toCoordinator` and `toFollower` pass; nothing else changes in routing | `packages/relay`, `apps/server/src/relay.test.ts` | M2.2 | Integration: an `obsState` reaches the coordinator; an `obsSnapshot` to one device reaches only it | Server update is the only deployment step |
| M2.6 | Desktop wiring: `LiveLink` publishes the local `ObsState` when it owns the link, forwards `obsCommand` events to `ObsLink` and answers with `obsAck`, applies incoming `obsState` to a shared `obsStatus` the pages read, and deactivates its own link silently when a newer state from another owner arrives (O9); when this desktop is the coordinator, the same paths run without the relay | `liveLink.ts`, `obs.ts` | M2.3, M2.4, M1.4 | Unit with a fake transport: owner, coordinator and follower in each combination, including the owner being the coordinator | Any role can own the link (O1) |
| M2.7 | LAN: the same messages over the LAN connection, which already carries `toCoordinator` and `toFollower` | `apps/desktop/src/app/lan.ts` | M2.6 | Unit: the LAN transport passes the new kinds unchanged | Works with the internet unplugged |
| M2.8 | Phones: `RemoteView` gains `obs` (null when no device has an active link); `RemoteToHost` gains `obsCommand` with an id; `RemoteHost` forwards it as a follower command with a phone origin and answers the phone with `ack`; the desktop re-sends the view when the OBS state changes | `packages/protocol`, `packages/remote`, `liveLink.ts` | M2.6 | Unit: a phone command reaches the owner and the phone gets its ack; a phone connected to a desktop without the link still sees the OBS view | O5 on phones |
| M2.9 | Older server: when the negotiated protocol is 3, the OBS computer keeps local controls and shows **Sharing OBS controls with other devices needs a server update** under Settings → OBS | `obs.ts`, `SettingsPage.tsx` | M2.1, M2.6 | Unit on the status | Nothing breaks before the church updates its server |

**Milestone done:** with the OBS computer a viewer and another desktop the coordinator, a scene change made on the coordinator desktop happens in OBS and is reflected on both within a second, over the relay and over the LAN; a phone connected to either desktop sees the same.

### M3 — Desktop interface (M)

| # | Task | Where | Needs | Tests | Done when |
| --- | --- | --- | --- | --- | --- |
| M3.1 | Settings → OBS on this computer: address with the default, password, **Activate** switch, status line with what to do about Refused, the two-step OBS guidance (Tools → WebSocket Server Settings, Enable WebSocket server, copy the password), two favourite-scene pickers filled from the scene list once connected | new `components/ObsSettings.tsx`, `SettingsPage.tsx`, `en.ts` | M1.5 | Manual | Plan §3 first three items |
| M3.2 | Read OBS's own settings: when `config.json` is readable at the path from M0.4, fill the port and password and say when the server is still disabled in OBS | `src-tauri/src/obs.rs` (`obs_read_config`), `ObsSettings.tsx` | M0.4, M3.1 | Rust unit: parses a sample file; missing file is not an error | O12, or dropped by M0.4 |
| M3.3 | Switch button: in the Present page's output toolbar next to Blank and Clear screen, shown only when `obsStatus` has an active link (O5); shows which favourite is live, switches to the other, and to the first when neither is live; carries the status indicator as a dot and a tooltip; disabled while OBS is not connected | `PresentPage.tsx`, new `components/ObsSwitch.tsx`, `en.ts` | M2.6 | Manual | O4 |
| M3.4 | OBS panel: opened from the Present page; scene list with the live scene marked, Stream, Record and Virtual camera toggles with their timers and states, the status indicator, and the live monitor from M5; an acknowledgement failure shows the OBS error text | new `components/ObsPanel.tsx`, `PresentPage.tsx`, `en.ts` | M3.3 | Manual | Plan §3 panel |
| M3.5 | Take-over feedback: none for the previous owner (O9); the new owner's settings page simply shows Active. Settings shows **Another computer, <name>, controls OBS for this workspace** when this computer has a link that was taken over, with its own Activate switch to take it back | `ObsSettings.tsx` | M2.6 | Manual | O9 |
| M3.6 | Keyboard shortcut for the switch button, listed with the others in `lib/shortcuts.ts` and the Help overlay | `lib/shortcuts.ts`, `PresentPage.tsx` | M3.3 | Unit in `shortcuts.test.ts` | Operators keep their hands on the keyboard |

**Milestone done:** a volunteer who has never seen the feature turns the link on from the guidance alone and switches scenes from another desktop in the same sitting.

### M4 — Phone remote (S)

| # | Task | Where | Needs | Tests | Done when |
| --- | --- | --- | --- | --- | --- |
| M4.1 | Switch button on the Live screen, in a row that exists only when `view.obs` is present, with the status dot; disabled while OBS is not connected | `RemoteApp.tsx` | M2.8 | Manual on iOS Safari and Android Chrome | O4 on phones |
| M4.2 | OBS screen reached from that row: scenes, Stream, Record and Virtual camera toggles with timers, status, and the live monitor from M5; commands sent with ids and shown as pending until acked | `RemoteApp.tsx`, `connection.ts` | M4.1 | Manual | Plan §3 panel on phones |

**Milestone done:** a phone connected to a desktop without the link switches scenes in OBS on another computer.

### M5 — Live monitor (S)

| # | Task | Where | Needs | Tests | Done when |
| --- | --- | --- | --- | --- | --- |
| M5.1 | Watching: a panel sends `obsWatch(true)` when it opens and `false` when it closes or the device disconnects; the owner keeps the set of watchers and runs the screenshot loop only while it is not empty, at the rate and quality chosen in M0.2 | `obs.ts`, `coordination.ts`, `liveLink.ts` | M1.3, M2.3 | Unit: no watchers, no requests; a watcher leaving stops the loop; a disconnect removes the watcher | O6 |
| M5.2 | Delivery: `obsSnapshot` to watchers only; the desktop panel and the phone screen draw the latest and show its age when it is more than three seconds old | `ObsPanel.tsx`, `RemoteApp.tsx`, `RemoteHost` | M5.1, M3.4, M4.2 | Manual | Stale images are visible as stale |
| M5.3 | Measured on a venue connection: upload cost through the relay per watching device at the chosen rate; if it exceeds what the venue bears, a per-workspace rate setting on the OBS computer (every second, every five seconds, on demand with a refresh button) | `ObsSettings.tsx`, `obs.ts` | M5.2 | Recorded in the acceptance record | O6 rate fixed |

**Milestone done:** two phones and one desktop watching cost the venue no more than the figure recorded in M5.3, and closing every panel stops the screenshot requests in OBS's log.

### M6 — Acceptance (S)

| # | Task | Where | Needs | Done when |
| --- | --- | --- | --- | --- |
| M6.1 | Walkthrough with a streaming laptop in viewer mode running OBS, a coordinator desktop, a follower desktop, and a phone, over the LAN and over the relay, on macOS and Windows: both start orders; OBS quit and reopened; the laptop rebooted; the link taken over by the follower and back; a workspace without OBS showing nothing new | `docs/acceptance/obs-control.md` | M1–M5 | Every scenario passes or has a recorded, accepted exception |
| M6.2 | Volunteer guide: an OBS section next to the output links, written for the person who runs the stream | `docs/volunteer-guide.md` | M3 | Reviewed by someone who runs a stream |
| M6.3 | Spec write-back: §9 (the OBS computer as an owner role), §11 (OBS as a controlled integration, not only a consumer), §17 scope row from Later to Agreed and done | `docs/worship-q-requirements-and-architecture.md` | M6.1 | Spec matches the release |
| M6.4 | Deployment guide: the server update carries protocol 4; nothing to configure | `docs/server-deployment.md` | M2.5 | One paragraph |
| M6.5 | Release by release-please; desktops update within six hours as usual | — | M6.1 | Released |

## 3. Order and dependencies

| Work | Tasks | When |
| --- | --- | --- |
| Spike | M0 | First; a week on real equipment |
| Core client | M1.1–M1.5 | After M0; M1.6 can start on day one |
| Protocol and logic | M2.1–M2.5 | In parallel with M1, needing only M1.6 |
| Wiring | M2.6–M2.9 | After M1.4 and M2.3 |
| Interfaces | M3, M4 | After M2.6 and M2.8; M3.1 can start after M1.5 |
| Monitor | M5 | After M3.4 and M4.2 |
| Acceptance | M6 | After everything |

Three tasks can begin on day one: the spike (M0), the OBS state record (M1.6) and the protocol bump (M2.1).

## 4. Rollout

The server update is the only deployment step, and it changes nothing for a workspace without OBS. Desktops update themselves as usual. A desktop on version 4 against a server still on protocol 3 presents and synchronizes as before; its OBS controls work on the OBS computer only until the server is updated (M2.9). A desktop still on protocol 3 in a workspace that uses OBS presents as before and shows no OBS controls, because the coordinator sends OBS messages only to devices declaring the capability (M2.3).

## 5. Risks tied to tasks

| Risk | Task | Mitigation |
| --- | --- | --- |
| Studio Mode changes what scene switching does | M0.3 | Recorded in the spike; if `SetCurrentProgramScene` only sets the preview, the owner follows with `TriggerStudioModeTransition` |
| obs-websocket's settings file is unreadable or moves between OBS versions | M0.4, M3.2 | O12 is a convenience; the guidance in M3.1 stands on its own |
| Screenshot traffic through the relay strains the venue's upload | M0.2, M5.3 | Watch-gated loop from the start; rate setting and on-demand mode if measured too high |
| Two owners after a partition | M1.6, M2.3 | Later `activatedAt` wins everywhere, same rule on every device; the coordinator drops the older state |
| A version 3 follower receives a version 4 message over the LAN | M2.3, M2.4 | Capability gate on the sender; unknown kinds ignored on the receiver |
| Password left in a log or a backup | M1.5 | Keychain only; never in the `setting` table, never in the snapshot sent to the server |
| OBS closed mid-service and the controls look live | M1.2, M3.3 | Status goes to OBS not running within the retry interval; controls disable but stay visible |
