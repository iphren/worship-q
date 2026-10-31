# Phase 2 — Acceptance record

**Date:** 31 October 2026 (branch `phase-2`)
**Source:** [Phase 2 plan](../phase-2-plan.md) §5 and the [task breakdown](../phase-2-task-breakdown.md).

Three kinds of evidence are kept apart here: automated tests that run in CI (`pnpm test`,
`cargo test`), the hardware spike (M0) that has not been run, and the walkthrough with real
equipment (M9.1, M9.2) that has not been done. Nothing in the last two columns is claimed.

## Tasks

| Task | Status | Evidence |
| --- | --- | --- |
| M0.1–M0.4 spike | **Not run** | `docs/spikes/lan.md` lists what to confirm |
| M1.1 protocol v2 | Done | `relay.test.ts` “tells a version 1 desktop to update” |
| M1.2 snapshot and message schemas | Done | `packages/protocol/src/wire.ts`; parsed on every relay message |
| M1.3 Coordinator | Done | `coordination.test.ts` “Coordinator” |
| M1.4 Follower | Done | `coordination.test.ts` “Follower” |
| M1.5 simulation harness | Done | `simulation.test.ts`: 1,000 seeded runs plus 50 harsher ones, failing seed printed |
| M1.6 snapshot from a session | Done | `shared.test.ts` “building snapshots”; `buildRemoteView` uses the same items |
| M1.7 relay routes followers | Done | `relay.test.ts` “one live state across desktops” |
| M1.8 follower desktop | Done (logic) | `liveLink.test.ts` “makes the first desktop coordinator…”; interface by walkthrough |
| M1.9 coordinator desktop | Done (logic) | same |
| M1.10 reconnect | Done | `liveLink.test.ts` “keeps a follower’s command across a dropped connection” |
| M2.1 operator commands via coordinator | Done | `shared.test.ts` “commands from other devices”; `liveLink.test.ts` “a follower’s Go live…” |
| M2.2 edit mode per device | Done | same |
| M2.3 handover | Done | `relay.test.ts` “handover”; `liveLink.test.ts` “hands over with Use this computer…” |
| M2.4 phones on every operator device | Done (logic) | `RemoteControlDialog` shows a QR on every operator device; `remote/index.test.ts` “puts this device’s identifier in its invitations” |
| M2.5 relay routes phones by invitation | Done | `relay.test.ts` “routes a phone to the desktop whose invitation it holds” |
| M2.6 grant registration | Done | `liveLink.test.ts` “a grant approved on the follower…” |
| M2.7 forwarded phone commands | Done | `remote/index.test.ts` “forwards an approved phone’s commands…”; `liveLink.test.ts` as above |
| M2.8 phone reconnection | Done | `relay.test.ts` “sends a phone back with its grant…”; `apps/remote/src/connection.ts` |
| M2.9 grant migration | Done | `LiveLink.registerEarlierGrants`, recorded in `sync_state.grantsRegisteredAt` |
| M2.10 expiry counts operator devices | Done | `shared.test.ts` “viewer mode” (viewer never touches); followers touch their copy |
| M3.1 viewer setting on the device | Done | `deviceSettings.test.ts` |
| M3.2 viewer never coordinates | Done | `relay.test.ts` “a viewer never becomes coordinator”; `liveLink.test.ts` “viewer mode” |
| M3.3 viewer rendering | Done (interface) | `PresentPage` viewer view; **Waiting for presentation** on the slideshow; walkthrough |
| M3.4 viewer keeps last snapshot until expiry | Done | `shared.test.ts` “keeps the last snapshot when the coordinator disappears” |
| M4.1 server live-state store | Done | `live.test.ts` “live-state backup” |
| M4.2 coordinator mirrors snapshots | Done | `liveLink.test.ts` “mirrors the coordinator’s snapshot to the server” |
| M4.3 coordinator-loss detection | Done | `coordination.test.ts` “CoordinatorWatch”; banner in `LiveBanners` |
| M4.4 Carry on here | Done | `liveLink.test.ts` “lets a follower carry on from the same slide…” |
| M4.5 old coordinator returns | Done | same (demoted, follows, same slide) |
| M4.6 start rules with the server | Done | `liveLink.test.ts` “the first operator device after a restart…” |
| M4.7 two coordinators meet | Done (logic) | `coordination.test.ts` “two coordinators meeting”; `LiveLink.anotherCoordinator` |
| M5.1 certificate per coordinator | Done | `cargo test lan::tests::makes_the_certificate_once_and_keeps_it` |
| M5.2 fingerprint distribution | Done | `relay` stores `hello.lan`; `GET /api/v1/workspace/peers` (`live.test.ts` “peers”); invitation `#f=&a=&p=` |
| M5.3 LAN server | Written, **not exercised** | `src-tauri/src/lan.rs`; credentials from `GET /api/v1/workspace/lan-credentials` (`live.test.ts`) |
| M5.4 mDNS | Written, **not exercised** | `lan_advertise`, `lan_browse` |
| M5.5 follower LAN client | Written, **not exercised** | `LanTransport`; `lan.test.ts` “choosing the coordinator on the LAN” |
| M5.6 phones on the venue Wi-Fi | Partial | The phone reads the LAN hints and reports its way in; it stays on the relay until M0.2 says a browser accepts the certificate |
| M5.7 offline approval over the LAN | Done (logic) | Grants travel as `grantRegister`/`grantList` over whichever transport; mirrored to the server with the snapshot |
| M5.8 offline coordinator choice | Written, **not exercised** | `CloudController.considerOffline` |
| M6.1 one connection at a time | Done | `TransportSwitch` (LAN preferred) |
| M6.2 switching without loss | Done | pending commands live in `Follower`, resent on `connect()`; `simulation.test.ts` covers cuts |
| M6.3 coordinator serves both | Done (logic) | `LiveLink.setLanPeers` merges by device id; `cloud.ts` fans `toFollower` out |
| M6.4 interface shows the way in | Done | Settings → Church connection and Connected devices |
| M7.1 output tokens | Done | `live.test.ts` “browser output links” |
| M7.2 output pages | Done | `apps/output`; `frame.test.ts` |
| M7.3 relay role output | Done | `relay.test.ts` “browser outputs” |
| M7.4 fonts on browser outputs | Done | `frame.test.ts` “falls back to the default font…”; `missingFonts` in the hello |
| M7.5 backgrounds for browser outputs | Done | `live.test.ts` “serves background files… cached by the browser” (304) |
| M7.6 Settings → Outputs | Done (interface) | `OutputLinks.tsx`; walkthrough |
| M7.7 localhost slideshow page | Done | `/slideshow`, `/ws/slideshow`, `/files/:name` in `overlay.rs`; `slideshow.html` |
| M7.8 links survive handover | Done | `relay.test.ts` “keeps an output fed across a handover…” |
| M8.1 connected devices in the snapshot | Done | `LiveLink.refreshDevices`; `liveLink.test.ts` checks phones and viewers appear |
| M8.2 connected devices view | Done (interface) | `ConnectedDevices.tsx` |
| M8.3 Disconnect all | Done | `liveLink.test.ts` “Disconnect all on one computer drops phones approved on another” |
| M8.4 keychain | Done (logic) | `credentials.test.ts`; `keychain.rs`; the macOS prompt by walkthrough |
| M8.5 capabilities used | Done | `missingFonts` reported by desktops and output pages; `LiveBanners` warns |
| M9.1 walkthrough | **Not done** | Table below |
| M9.2 real service | **Not done** | |
| M9.3 guides | Done | `volunteer-guide.md`, `server-deployment.md` |
| M9.4 spec write-back | Done | §7, §15, §20 of the spec |
| M9.5 release | Pending | CI green on the branch; version by release-please |

## Spec criteria (M9.1)

To be walked through with a projector computer, a streaming computer with OBS, a phone and a
browser output, on macOS and Windows, with and without internet. Fill in the result column.

| Criterion | Automated evidence | Walkthrough result |
| --- | --- | --- |
| 3 Reusable setup | Output links and the localhost pages keep their addresses | |
| 5 Local continuity | `liveLink.test.ts` dropped connection; LAN not exercised | |
| 6 Browser support | `frame.test.ts`, `relay.test.ts` outputs | |
| 8 Multiple controllers | `simulation.test.ts`, `liveLink.test.ts` | |
| 9 Relay switching | `TransportSwitch`, `Follower.connect()`; LAN not exercised | |
| 18 Calendar safety | `shared.test.ts`, `liveLink.test.ts` “a follower’s Go live…” | |
| 31 Live-state continuity | `shared.test.ts`, `liveLink.test.ts` recovery and viewer | |
| 32 LAN security | `relay.test.ts` outputs may send nothing; `lan.rs` auth; `lan.test.ts` fingerprint check; hardware not exercised | |

## Known exceptions

- Phones use the relay at the venue; the LAN path for phones waits on M0.2.
- The LAN server, mDNS, and the offline coordinator rule have not run on hardware.
