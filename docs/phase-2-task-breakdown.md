# Worship Q — Phase 2 Task Breakdown: One Live State Across the Venue

**Drafted:** 30 October 2026  
**Status:** Implemented on branch `phase-2`; task-by-task status is in the [acceptance record](acceptance/phase-2.md).  
**Source:** [Phase 2 Plan](phase-2-plan.md), referred to here as "the plan", and the code at version 0.4.0. Milestone names, decisions (D14–D25) and gaps (G1–G22) are the plan's.

## 1. How to read this

The plan says what each milestone delivers and when it is done. This document breaks each milestone into tasks small enough to be one pull request, says where in the repository each lands, and names the tests that prove it. Task identifiers are `M<milestone>.<n>`; a task lists the tasks it needs first.

Every task that changes business logic carries unit tests in its package, and every task that changes the server or the relay carries an integration test in `apps/server` that runs the server with simulated devices. The desktop interface has no automated tests; it is covered by the M9 walkthrough. There are no releases between milestones (plan §5).

### Where things live today

| Concern | Location |
| --- | --- |
| Live state: pure state machine, commands, start rules, expiry | `packages/live-state` |
| Wire messages and schemas, protocol version | `packages/protocol/src/wire.ts` |
| Remote-control host: invitations, grants, requests, notices, view building | `packages/remote` (`RemoteHost`) |
| Operator session: start rules, commands, run-sheet and lyric edits against the database | `packages/session` (`Session`) |
| Database, migrations, sync state, remote grants | `packages/store` |
| Sync client to the church server | `packages/sync` |
| Church server: HTTP API, enrollment, sync, backups | `apps/server/src/app.ts`, `instance.ts`, `db.ts` |
| Relay between phones and the coordinator desktop | `apps/server/src/relay.ts` |
| Desktop church connection and relay client | `apps/desktop/src/app/cloud.ts` |
| Desktop native core: windows, overlay web server, database, files | `apps/desktop/src-tauri/src` |
| Phone remote-control page | `apps/remote` |

## 2. Tasks by milestone

### M0 — Technical spike (S)

Throwaway code on a branch that is not merged. Each task ends in a written note under `docs/spikes/`.

| # | Task | Where | Done when |
| --- | --- | --- | --- |
| M0.1 | TLS WebSocket server in the Tauri core with a self-signed certificate generated at first run; a client that checks the certificate fingerprint before speaking | `src-tauri` (axum, tokio-rustls or rustls, rcgen) | Another desktop connects from a second machine on the same Wi-Fi, and a wrong fingerprint is refused |
| M0.2 | Phone browsers against the M0.1 server: Safari on iOS and Chrome on Android, with the certificate untrusted | `apps/remote` test page | Behaviour on each is recorded: connects, blocks, or prompts |
| M0.3 | mDNS advertise and browse on macOS and Windows, including the macOS local-network permission prompt and the Windows firewall prompt | `src-tauri` (mdns-sd) | Both platforms see each other within five seconds; prompts are recorded with screenshots |
| M0.4 | Guest network with client isolation: two laptops cannot see each other; confirm discovery fails cleanly and the relay fallback is chosen | spike notes | The failure is detected within the discovery timeout and a reason is available to show |

**Exit:** `docs/spikes/lan.md` records what works, what does not, and the crate choices for M5.

### M1 — Shared live state over the relay (L)

Split as the plan allows: M1a is pure logic with no server or desktop; M1b wires it in.

#### M1a — Coordinator and follower logic

| # | Task | Where | Needs | Tests | Done when |
| --- | --- | --- | --- | --- | --- |
| M1.1 | Protocol version 2: raise `PROTOCOL_VERSION` and `MIN_PROTOCOL_VERSION`, keep `isCompatibleProtocol`; add the version to the server `info` route's tests | `packages/protocol`, `apps/server` | — | Unit: a version 1 hello is refused with `update-needed` on enroll, sync and relay | A 0.4.0 desktop against the new server shows the existing update-needed messages |
| M1.2 | Live snapshot schema: `LiveSnapshot` = `LiveState` + the live run sheet's item list (item id, title, song or content id, removed flag) + presented content (pieces of the presented item, including **Still presenting previous content**) + a `revision`. Follower and coordinator message schemas: `followerHello`, `command` (with id and origin), `snapshot`, `ack`, `handover`, `grantRegister`, `grantList` | `packages/protocol/src/wire.ts` | M1.1 | Unit: schemas parse and reject malformed input; a snapshot round-trips through JSON with `wellFormed` | Schemas are exported and documented in the file header |
| M1.3 | Coordinator side in `packages/live-state`: `Coordinator` class that takes commands (from any origin), applies them in order with `applyCommand`, assigns a snapshot revision per change, remembers applied command ids (existing `COMMAND_MEMORY`), and emits snapshots | `packages/live-state` | M1.2 | Unit: same command twice applies once; out-of-order arrivals from two origins produce one sequence; every emitted snapshot's revision increases by one | `Coordinator` is pure: no sockets, no database |
| M1.4 | Follower side: `Follower` class that sends commands with ids, applies snapshots, ignores a snapshot older than the last applied, re-requests the full snapshot when a gap is seen, and never edits the live state itself | `packages/live-state` | M1.2 | Unit: a stale snapshot is dropped; a gap triggers a resync; a follower holding a pending command keeps it until acked | `Follower` is pure like M1.3 |
| M1.5 | Simulation harness: one `Coordinator`, several `Follower`s, a scripted network that reorders, duplicates, delays and drops messages; assert convergence and single application | `packages/live-state/src/simulation.test.ts` | M1.3, M1.4 | This is the test | A thousand randomized runs pass in CI under a fixed seed, and a failing seed is printed |
| M1.6 | Snapshot building from a `Session`: the coordinator builds the item list and presented content from the local database when the live state changes, reusing `buildRemoteView` in `packages/remote` where it fits | `packages/session`, `packages/remote` | M1.2 | Unit: snapshot items match the live run sheet after add, remove and move; a presented piece from the previous run sheet appears with the flag | One function produces both the `RemoteView` for phones and the snapshot for followers |

#### M1b — Relay and desktop wiring

| # | Task | Where | Needs | Tests | Done when |
| --- | --- | --- | --- | --- | --- |
| M1.7 | Relay: let desktops join a workspace as followers. `RelayToCoordinator.ready` already says who is coordinator; add routing of `command`, `snapshot`, `ack` between the coordinator and each follower, keyed by device id | `apps/server/src/relay.ts` | M1.2 | Integration (`relay.test.ts`): two desktops, commands from the follower reach the coordinator, snapshots reach the follower; a third desktop joining gets the full snapshot | The relay still holds no presentation state |
| M1.8 | Desktop relay client: connect as follower when `ready.coordinator` is false; drive `Follower` from `cloud.ts`; feed snapshots into the session so the operator view, slideshow and overlay render from them | `apps/desktop/src/app/cloud.ts`, `packages/session` | M1.4, M1.7 | Unit on the session's snapshot application; manual: two desktops | Two desktops show the same slide within a second |
| M1.9 | Desktop as coordinator: run `Coordinator` in `cloud.ts` when `ready.coordinator` is true; publish a snapshot on every change, throttled to one per 100 ms | `apps/desktop/src/app/cloud.ts` | M1.3, M1.6, M1.7 | Integration with a simulated follower against a real server | Commands from the follower appear on the coordinator's slideshow |
| M1.10 | Reconnect: a follower that loses the relay keeps its pending commands and resends them with their ids; the coordinator ignores duplicates | `packages/live-state`, `cloud.ts` | M1.4, M1.8 | Unit: resend after reconnect applies once (covered by M1.5 too) | Unplugging one desktop's network and replugging leaves both on the authoritative slide (criterion 8) |

**Milestone done:** plan M1 done-when, with M1.5 and M1.7 green in CI.

### M2 — Operators together (M)

| # | Task | Where | Needs | Tests | Done when |
| --- | --- | --- | --- | --- | --- |
| M2.1 | Operator commands through the coordinator: Go live, Clear screen, blank and live run-sheet edits from a follower are sent as commands with the same intent shapes phones use (`addItem`, `removeItem`, `moveItem`), carrying an origin of kind `operator` | `packages/protocol`, `packages/session`, `cloud.ts` | M1.9 | Unit: a follower's Go live changes the coordinator's live run sheet; the follower's own browsed date is unchanged | D24 holds: other operators see the phone-edit notice without Undo |
| M2.2 | Edit mode stays per device: a follower preparing another date writes to its database and syncs as content; nothing reaches the live state unless the operator chooses Go live | `packages/session` | M2.1 | Unit: editing a browsed date on a follower emits no live command | Spec criterion 18 with two devices |
| M2.3 | Handover: **Use this computer** sends `claim`; the relay flips `coordinator` flags; the old coordinator sends its final snapshot, becomes a follower, and the new one starts from that snapshot | `relay.ts`, `cloud.ts`, `packages/live-state` | M1.9 | Integration: handover mid-song; the snapshot revision continues; no command is lost | Every screen is unchanged by the handover |
| M2.4 | Phone invitations on every operator device: each desktop runs its own `RemoteHost` invitation and approval as today; remove the standby state from the remote-control window; **Use this computer** moves to Settings → Church connection as the handover control only | `packages/remote`, `apps/desktop/src/components/RemoteControl.tsx`, `SettingsPage.tsx` | M1.8 | Unit on `RemoteHost` unchanged; manual | A follower shows a QR code (G22) |
| M2.5 | Relay routes a phone to the desktop whose invitation it holds: the invitation carries the device id; `hello.invite` and `hello.grant` are routed by it; a grant names the workspace, not a device | `relay.ts`, `packages/remote`, `apps/remote/src/connection.ts` | M2.4 | Integration: two desktops, one phone per desktop, each phone's commands reach its own desktop | The one-desktop-per-workspace rule is gone |
| M2.6 | Grant registration (D25): on approval a desktop sends `grantRegister` to the coordinator; the coordinator keeps the workspace grant list and includes it in a `grantList` message to followers; a phone presenting a grant is accepted by any operator device that has the list | `packages/remote`, `packages/live-state` or a new `packages/grants`, `relay.ts` | M2.5 | Unit: a grant registered on A is accepted on B; revocation on A is refused on B | A phone approved on the follower keeps working after that follower closes |
| M2.7 | Forwarded phone commands: a desktop forwards its phones' commands to the coordinator with origin `phone` and the grant id, so notices and the connected-devices list name the phone | `packages/protocol`, `cloud.ts`, `packages/remote` | M2.1, M2.6 | Unit: the Undo notice names the phone, not the forwarding desktop | Plan D25 identity rule |
| M2.8 | Phone reconnection: when its desktop disconnects, the relay tells the phone `unavailable` with a new reason `reconnect`; the phone retries with its grant and is routed to the coordinator; **Reconnecting** is shown meanwhile | `relay.ts`, `apps/remote` | M2.6 | Integration: close the approving desktop; the phone's next command reaches the coordinator | Plan M2 reconnect item |
| M2.9 | Grant migration: on first connection after the update, a desktop registers every unrevoked row of `remote_grant` with the coordinator (or, if it is the coordinator, adopts them); records the migration in `sync_state` so it runs once | `packages/store`, `cloud.ts` | M2.6 | Unit: a database with three grants registers three; a second start registers none | Phones approved before phase 2 need no new scan |
| M2.10 | Kept-too-long and expiry count only connected operator devices; the coordinator owns `lastActiveAt` and includes it in snapshots | `packages/live-state`, `packages/session` | M1.9 | Unit: with one follower connected and the coordinator closed, the live state does not expire until the follower leaves | Spec §7 rule 3 |

**Milestone done:** plan M2 done-when.

### M3 — Viewer mode (S)

| # | Task | Where | Needs | Tests | Done when |
| --- | --- | --- | --- | --- | --- |
| M3.1 | Device setting `viewerMode` saved outside the workspace database (it belongs to the computer), read at boot | `packages/store` (device settings) or `src-tauri` app config, `boot.ts` | — | Unit: the setting survives a restart | The setting is per computer, not per workspace |
| M3.2 | A viewer connects to the relay with role `viewer`; the relay never makes it coordinator; it sends no commands and starts no live state | `relay.ts`, `cloud.ts`, `packages/live-state` | M1.8 | Integration: a viewer alone in a workspace gets no `coordinator: true`; the live state expires with only it connected | Plan M3 done-when |
| M3.3 | Viewer rendering per D16: live run sheet and presented slide read-only, own outputs following; no controls; **Waiting for presentation** on the outputs' background when nothing is live | `apps/desktop/src/pages/PresentPage.tsx`, `OutputApp.tsx` | M3.2 | Manual | A projector computer set to viewer reopens as one |
| M3.4 | Viewer keeps its last snapshot when the coordinator disappears, until expiry (D6, four hours) or a new coordinator appears; never falls back to **Waiting for presentation** while a live state is unexpired | `packages/live-state` (`Follower`), `cloud.ts` | M3.3 | Unit: coordinator loss leaves the follower's state intact; expiry clears it | Plan M3 coordinator-loss item |

### M4 — Backup and recovery (M)

| # | Task | Where | Needs | Tests | Done when |
| --- | --- | --- | --- | --- | --- |
| M4.1 | Server live-state store: table `live_snapshot (workspace_id, revision, snapshot, updated_at)`; `PUT /api/v1/live` from the coordinator, `GET /api/v1/live` for devices; expired snapshots are dropped on read | `apps/server/src/db.ts`, `app.ts`, `instance.ts` | M1.2 | Integration: put, get, expiry after `DEFAULT_EXPIRY_MS` | D17 storage |
| M4.2 | Coordinator mirrors snapshots to the server on every change, throttled to one per second, and on handover | `cloud.ts` | M4.1, M1.9 | Integration with a simulated coordinator | D17 |
| M4.3 | Coordinator-loss detection on followers: relay `left` for the coordinator, or no snapshot and no pong for 15 s; show **The presenting computer is not responding** with **Carry on here** | `cloud.ts`, `PresentPage.tsx` | M1.8 | Unit on the detector with a fake clock | D18 |
| M4.4 | **Carry on here**: the follower sends `claim` with its latest revision; the relay accepts when the current coordinator is gone or silent; the new coordinator starts from the newer of its synchronized copy and the server snapshot | `relay.ts`, `cloud.ts`, `packages/live-state` | M4.1, M4.3 | Integration: close the coordinator mid-song; carry on; the slide is the same | Plan M4 done-when, first half |
| M4.5 | Old coordinator returns: becomes a follower; if it was only cut off, its slideshow and overlay jump to the new state and its phones are handed over; its operator sees **Another computer carried on; this one now follows** | `cloud.ts`, `packages/live-state` | M4.4, M2.6 | Integration: partition then rejoin; exactly one coordinator afterwards | Plan M4 done-when, second half |
| M4.6 | Start rules with the server: the first operator device to connect after a restart uses the server's unexpired snapshot, else its local saved state, per `resolveStart` | `packages/session`, `cloud.ts` | M4.1 | Unit: server snapshot newer than local wins; expired server snapshot is ignored | Spec §7 rule 1 across devices |
| M4.7 | Two coordinators meet (D14): when a coordinator receives a snapshot from another coordinator, the one with the older `startedAt` keeps it; the other becomes a follower and its slideshow jumps | `packages/live-state`, `cloud.ts` | M1.9 | Unit: both orderings converge on the older state | D14 tie rule; also exercised in M5 |

### M5 — LAN connections (L)

| # | Task | Where | Needs | Tests | Done when |
| --- | --- | --- | --- | --- | --- |
| M5.1 | Certificate per coordinator: generated once per computer, stored beside the database; fingerprint exposed to the interface | `src-tauri` (new `lan.rs`) | M0 | Rust unit: regeneration only when missing | D19 |
| M5.2 | Fingerprint distribution: the desktop sends its fingerprint and LAN addresses in `CoordinatorToRelay.hello`; the server stores them per device and returns them in `ready` and in a `GET /api/v1/workspace/peers` route; the invitation link gains `#f=<fingerprint>&a=<addresses>` | `packages/protocol`, `relay.ts`, `app.ts`, `packages/remote` | M5.1 | Integration: peers route returns the coordinator's addresses | D19, D20 server help |
| M5.3 | LAN server in the Tauri core: the M1 protocol over TLS WebSocket on a fixed port next to the overlay port, authenticating each connection by device token (checked against a list the interface supplies from the server, cached locally) or remote grant | `src-tauri/src/lan.rs` | M5.1, M2.6 | Rust integration: a connection with a wrong token is closed before any message | Criterion 32 |
| M5.4 | mDNS: advertise `_worship-q._tcp` with the workspace server identifier only; browse and resolve on followers | `src-tauri/src/lan.rs` | M0.3 | Manual on both platforms | D20 |
| M5.5 | Follower LAN client: on start, browse for a few seconds (D14); connect over TLS when the fingerprint matches one from M5.2; prove itself with the device token | `src-tauri`, `cloud.ts` | M5.2, M5.3, M5.4 | Integration on one machine with two app instances | Two desktops present together with internet unplugged |
| M5.6 | Phones on the venue Wi-Fi: the phone page tries the LAN address from the invitation first; if the browser refuses the certificate, it uses the relay and shows **Connected through the church server** | `apps/remote/src/connection.ts` | M5.2, M5.3 | Manual per M0.2 findings | Plan M5 phone item |
| M5.7 | Offline approval and grant list over the LAN: `grantRegister` and `grantList` travel over the LAN connection; the coordinator pushes the list to the server when it is reachable | `packages/remote`, `src-tauri`, `cloud.ts` | M2.6, M5.3 | Integration: approve offline, reconnect, the server has the grant | Plan M5 offline item |
| M5.8 | Offline coordinator choice: a desktop that finds no coordinator and no server after the browse window becomes coordinator; M4.7 resolves a later meeting | `cloud.ts` | M4.7, M5.5 | Unit with fake discovery results | D14 offline rule |

### M6 — Transport switching (M)

| # | Task | Where | Needs | Tests | Done when |
| --- | --- | --- | --- | --- | --- |
| M6.1 | One connection at a time: a `Transport` abstraction over relay and LAN in the desktop; exactly one active; LAN preferred | `cloud.ts` (new `transport.ts`) | M5.5 | Unit: with both available, LAN is chosen; the relay socket is closed, not left idle | D21 |
| M6.2 | Switching without loss: pending commands and the last snapshot revision carry across; the new transport receives a resync if the revision is behind | `packages/live-state` (`Follower`), `transport.ts` | M6.1, M1.10 | Unit via the M1.5 harness with a transport switch mid-run | No duplicated command, no second authority |
| M6.3 | Coordinator serves both: the coordinator accepts followers over the LAN and the relay at once; a device appearing on both is treated as one, by device id | `src-tauri/src/lan.rs`, `cloud.ts` | M5.3 | Integration: a follower on both transports is one entry | D21 |
| M6.4 | Interface: **On this network** / **Through the church server** per device in Settings and in the connected-devices list | `SettingsPage.tsx`, M8.1 | M6.1 | Manual | Plan M6 |

**Milestone done:** criterion 9 under a scripted unplug and replug of internet and Wi-Fi.

### M7 — Browser outputs (M)

| # | Task | Where | Needs | Tests | Done when |
| --- | --- | --- | --- | --- | --- |
| M7.1 | Output tokens: table `output_link (id, workspace_id, kind, token_hash, name, created_at, revoked_at)` on the server; create, list and revoke routes for devices; the token is random and shown once | `apps/server/src/db.ts`, `app.ts`, `instance.ts` | — | Integration: a revoked token is refused | D22 |
| M7.2 | Output pages served by the server at `/output/slideshow?t=…` and `/output/subtitle?t=…`: static HTML and JavaScript that open a WebSocket to the relay with the token, receive snapshots, and render with `packages/renderer`; no `localStorage`, no cookies, no sign-in | new `apps/output` built into the server image | M7.1, M1.2 | Browser test with storage disabled (Playwright) | A fresh browser shows the output on first open |
| M7.3 | Relay role `output`: a connection with a valid output token receives snapshots for its workspace and may send nothing | `relay.ts` | M7.1 | Integration: an output socket sending a command is dropped | D22, criterion 32 |
| M7.4 | Fonts on browser outputs: use the workspace font when the browser has it, else a documented fallback; report which to the connected-devices list via capabilities | `apps/output`, `packages/protocol` | M7.2 | Browser test with a missing font | Spec §11 |
| M7.5 | Backgrounds for browser outputs: served by the server from the workspace's synced backgrounds; cached with long-lived headers keyed by content hash | `app.ts`, `apps/output` | M7.2 | Integration: second request is a 304 | Plan M7 |
| M7.6 | Settings → Outputs: create a link, name it, copy it, show a QR code, revoke it | `SettingsPage.tsx`, `cloud.ts` | M7.1 | Manual | D22 |
| M7.7 | Localhost slideshow page: `/slideshow` on the existing overlay port, rendered by the desktop from its own live view, same mechanism as `/overlay/subtitle` | `src-tauri/src/overlay.rs`, `apps/desktop/src/overlay` | — | Manual: OBS Browser Source on the same computer | Works with internet unplugged |
| M7.8 | Output links survive coordinator handover: the token names the workspace, and the relay re-targets output sockets when the coordinator changes | `relay.ts` | M7.3, M2.3 | Integration: handover mid-song keeps the output socket fed | D22 stability |

**Milestone done:** plan M7 done-when, three cases.

### M8 — Connected devices and credentials (M)

| # | Task | Where | Needs | Tests | Done when |
| --- | --- | --- | --- | --- | --- |
| M8.1 | Connected-devices list in the snapshot: name, role (coordinator, operator, viewer, phone, browser output), connection type, last seen; the coordinator assembles it from relay `ready`/`left`, LAN connections, grants and output sockets | `packages/protocol`, `packages/live-state`, `relay.ts` | M1.9, M2.6, M7.3 | Unit: joining and leaving devices appear and disappear; integration for the relay part | Plan M8 |
| M8.2 | Connected devices view on operator devices, with per-device **Disconnect** for phones and outputs | `SettingsPage.tsx` or a new `DevicesPanel.tsx` | M8.1 | Manual | Plan M8 |
| M8.3 | **Disconnect all**: clears the coordinator's grant list (which also disconnects phones on other desktops) and revokes every output link, with confirmation | `packages/remote`, `cloud.ts`, `app.ts` | M2.6, M7.1 | Integration: phones on two desktops and one output are all dropped | Plan M8 |
| M8.4 | Keychain storage (D23): Tauri keychain plugin; on first launch write the token, read it back, then delete it from `sync_state`; on failure keep the database copy and set a flag that Settings shows as **not yet protected** | `src-tauri`, `packages/store`, `SettingsPage.tsx` | — | Rust unit with a fake keychain for the failure path; unit on the store for the deletion only after a read-back | No token in the database on a successful migration; enrollment never reset |
| M8.5 | Capabilities used: each device reports fonts, screens, transparency and media (already in `CapabilitiesSchema`); the coordinator warns when a follower or browser output lacks the workspace font | `packages/protocol`, `packages/live-state`, `PresentPage.tsx` | M8.1, M7.4 | Unit: a follower without the font produces a warning entry | Plan M8 |

### M9 — Acceptance pass (S)

| # | Task | Where | Needs | Done when |
| --- | --- | --- | --- | --- |
| M9.1 | Scripted walkthrough of spec criteria 3, 5, 6, 8, 9, 18, 31 and 32 with a projector computer, a streaming computer with OBS, a phone and a browser output, on macOS and Windows, with and without internet; results recorded in `docs/acceptance/phase-2.md` | docs | M2–M8 | Every criterion passes or has a recorded, accepted exception |
| M9.2 | One real service with a projector computer and a separate streaming computer | — | M9.1 | Notes recorded with M9.1 |
| M9.3 | Documentation: update the volunteer guide (viewer mode, Connected devices, Use this computer, output links, phones from any computer) and the server deployment guide (remove the internet-at-the-venue limit when M5 holds, add the output pages and the rollout steps from plan §8) | `docs/volunteer-guide.md`, `docs/server-deployment.md` | M9.1 | Guides match the shipped behaviour |
| M9.4 | Spec write-back: record D14–D25 in the spec's open decisions (§19 point 5 and 6) and G19 as a decision | `docs/worship-q-requirements-and-architecture.md` | M9.1 | The spec no longer lists them as open |
| M9.5 | Release: all package unit tests and server integration tests pass on the release build; protocol version 2 noted in the changelog; rollout per plan §8 | CI, changelog | M9.1–M9.4 | Phase 2 shipped as one version |

## 3. Order and parallel tracks

| Track | Tasks | Can start |
| --- | --- | --- |
| Logic | M1.1–M1.6 | Now |
| Spike | M0.1–M0.4 | Now, in parallel with Logic |
| Wiring | M1.7–M1.10 | After M1.2 and M1.3 |
| Operators | M2.1–M2.10 | After M1.9 |
| Viewer | M3.1–M3.4 | After M1.8 |
| Recovery | M4.1–M4.7 | After M1.9; M4.1 and M4.6 need only M1.2 |
| Outputs | M7.1, M7.7 | Now; M7.2–M7.8 after M1.2 and M2.3 |
| Devices | M8.4 | Now; M8.1–M8.3, M8.5 after M2.6 and M7.3 |
| LAN | M5.1–M5.8 | After M0 and M2.6 |
| Switching | M6.1–M6.4 | After M5.5 |
| Acceptance | M9 | After everything |

Three tasks can begin on day one without touching the live-state work: the technical spike (M0), the keychain move (M8.4) and the localhost slideshow page (M7.7). The output token table (M7.1) also stands alone.

## 4. Risks tied to tasks

| Risk | Task | Mitigation |
| --- | --- | --- |
| Phone browsers refuse the self-signed certificate | M0.2, M5.6 | The relay fallback is designed in from M5.6; native phone apps are phase 4 |
| mDNS blocked by venue routers | M0.4, M5.2 | The server supplies last known addresses; manual address entry is not planned, so M0.4 must confirm the fallback message is clear |
| Two live-state paths (snapshot and content sync) disagree on run-sheet items | M1.6, M2.2 | The snapshot carries the item list and is authoritative for what is live; content sync is authoritative for stored run sheets; M1.6's tests cover the overlap |
| Grant list split between desktops during migration | M2.9, M2.6 | Registration is idempotent by grant id; a coordinator adopting grants merges rather than replaces |
| Keychain prompts or refusals on macOS after a re-signed build | M8.4 | Read-back before deletion; the database copy stays on failure |
| Output token leaked from an OBS screenshot | M7.1, M7.6 | Revocation under Settings → Outputs; the page shows only what is already on the projector |
