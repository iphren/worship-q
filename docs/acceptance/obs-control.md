# OBS Control — Acceptance record

**Date:** 6 November 2026 (branch `obs-control`); walkthrough pending  
**Source:** [OBS Control Plan](../obs-control-plan.md), [task breakdown](../obs-control-task-breakdown.md) M6.

Three kinds of evidence are kept apart here: automated tests that run in CI (`pnpm test`, and
`cargo test` in `apps/desktop/src-tauri`), the spike against a real OBS (M0), and the
walkthrough with real equipment (M6.1), which is still to do.

## Milestones

| Milestone | Status | Evidence |
| --- | --- | --- |
| M0 spike | Done | `docs/spikes/obs.md`: OBS 33.0.1 / obs-websocket 5.7.6 on macOS 27.2 and Windows 11. OBS 28 not tested; the current OBS is assumed (O2) |
| M1.1–M1.2 OBS client in the Tauri core | Done | `src-tauri/src/obs.rs` tests against a fake obs-websocket server: the authentication string of the protocol document; requests and events both ways; no authentication when OBS asks for none; retrying until OBS starts with no flicker through Connecting; wrong password Refused and retried slowly; password required without sending one; OBS's refusal of a request passed on; requests outside the allowed set never sent; requests failed at once while not connected; a request never answered times out without harming the connection; `ExitStarted` then 1001 fails waiting requests and reconnects when OBS is back; another program on the port Refused; stopping ends the task; address parsing; obs-websocket's `config.json` parsing. `against_the_obs_on_this_computer` (ignored in CI) ran against the real OBS on macOS |
| M1.3 program screenshot | Done, in the interface | `GetSourceScreenshot` of the scene on program, requested by `ObsLink` (see Changes from the plan) |
| M1.4–M1.5 `ObsLink` and its settings | Done | `apps/desktop/src/app/obs.test.ts`: settings per workspace and never the password, damaged settings read as defaults, connecting on start with the keychain's password, trying without when the keychain refuses, OBS's own port and password used on turning on (O12) but never over a typed password, activation dated, turning off, reconnecting on address and password changes; Connecting until OBS's state is read, events, an event winning over an answer it overtook, answers from before a reconnection dropped, `ExitStarted`, OBS's settings read again when OBS stops answering, scene collection change, favourites following a renamed scene; outputs loaded with durations and carried forward, paused recording held, a duration arriving after the output stopped dropped, outputs forgotten when the connection drops; commands as the state wanted, Start on a running output counted as done, OBS's refusal and timeouts passed on, nothing sent while not connected |
| M1.6 OBS state record | Done | `packages/live-state/src/obs.test.ts` “which OBS state wins (O9)”: later activation, tie on device id, revisions within an activation, a new activation of the same computer, a link turned off never holding the state against an active one, unreadable times settled the same way |
| M2.1 protocol 4 | Done | `packages/protocol/src/index.test.ts` “speaks version 3 to a server not yet updated for OBS control”; `apps/server/src/versions.test.ts` “gives a version 3 device what a version 4 device gets”; `admin.test.ts` info route |
| M2.2 schemas | Done | `index.test.ts` “OBS messages (protocol version 4)”: state both ways, malformed state refused, commands that name the state and never toggle, answers with OBS's code, monitor images limited to small image data URLs, every version 3 message still read |
| M2.3 coordinator forwarding | Done | `obs.test.ts` “the coordinator forwarding OBS messages”: only to devices declaring the capability; the last state to a device connecting later; a state in another device's name refused; a late older state dropped; take-over and the earlier owner told; crossed activations settled the same either way; turning off and taking over after; commands to the owner and answers to the asker only; no-OBS answered at once; the coordinator's own commands; the coordinator as owner; owner leaving drops the state and fails its unanswered commands; take-over fails waiting commands; a departed asker forgotten |
| M2.4 follower side | Done | Unknown kinds ignored by `Follower.receive` and `Coordinator.receive`; OBS messages routed beside the live state by `LiveLink` |
| M2.5 relay | Done | `apps/server/src/relay.test.ts` “OBS control through the relay”: a viewer's state reaches the coordinator, a message addressed to one device reaches only it, output pages never see OBS messages, malformed ones refused with a warning |
| M2.6 desktop wiring | Done | `apps/desktop/src/app/liveLink.test.ts` “OBS control across the workspace”, through the real relay: a viewer's OBS shown on every desktop and its changes followed; commands from a follower and from the coordinator answered; the coordinator as the OBS computer; no OBS message to an older desktop; take-over and taking back (O9); controls gone when the link is turned off or its computer leaves, and back when it returns; a command failed when its OBS computer leaves; a coordinator handover |
| M2.7 LAN | Done | `apps/desktop/src/app/lan.test.ts` “OBS messages on the venue network” |
| M2.8 phones | Done | `packages/remote/src/index.test.ts` “OBS on phones”; `liveLink.test.ts` “gives a phone on a desktop without OBS the OBS view and its commands” |
| M2.9 older server | Done | `liveLink.test.ts` “keeps the OBS computer’s own controls, and says why nothing is shared, against an older server” |
| M3 desktop interface | Done; by walkthrough | `components/ObsSettings.tsx`, `components/Obs.tsx`, `pages/PresentPage.tsx`; shortcut in `lib/shortcuts.test.ts` |
| M4 phone remote | Done; by walkthrough | `apps/remote/src/RemoteApp.tsx` (`ObsRow`, `ObsScreen`), `connection.ts` |
| M5.1–M5.2 live monitor | Done | `obs.test.ts` (desktop) “the live monitor”: nothing while nobody watches; one image a second, one request at a time; stopping when the last stops watching and when OBS goes away, resuming when it is back; non-images never sent; JPEG fall-back; waiting during a scene collection change. `obs.test.ts` (live-state) “the live monitor”; `liveLink.test.ts` “takes monitor images only while some desktop watches…” and “stops … when the watching desktop leaves without saying so”; `remote` “counts phones watching the monitor…” |
| M5.3 measured on a venue connection | Walkthrough | Spike sizes are 3–10 KB a second per watcher; the rate setting is made only if the venue cannot bear it |
| M6.1 walkthrough | Pending | Table below |
| M6.2 volunteer guide | Done | `volunteer-guide.md` “OBS” |
| M6.3 spec write-back | After the walkthrough | §9, §11, §17 |
| M6.4 deployment guide | Done | `server-deployment.md` “Updating for OBS control (protocol version 4)” |
| M6.5 release | After the walkthrough | release-please |

## Changes from the plan

- **Settings on this computer.** The link's address, favourites and switch are kept in the web
  view's storage, per workspace folder, like viewer mode, not in the workspace's `setting`
  table: that table is synchronized with the church server, and O10 keeps them off it. No
  database migration was needed. The password is in the keychain as planned.
- **Screenshots.** Taken by `ObsLink` with `GetSourceScreenshot` of the scene it already knows
  is on program, through the allowed requests of `obs_request`, rather than by a separate
  native command: one round trip instead of two, and tested with the rest of the link.
- **Watching.** The coordinator keeps the set of devices showing the monitor and tells the
  owner only whether anyone does; the owner sends each image once to the coordinator, which
  passes it to the watchers.
- **Take-over.** A link that was turned off never holds the state against another computer's
  active link, so turning the earlier owner off and then activating an older link elsewhere
  works whatever the clocks say.
- **Phones on an older desktop.** The phone page comes with the server, so after the server
  update a phone says version 4. When a version 3 desktop answers update-needed, the phone
  says hello again at the next older version, down to the oldest accepted, so phones keep
  working with desktops that have not updated yet.
- **Stopping.** Stopping the stream or a recording asks for confirmation on the desktop and a
  second tap on the phone.
- **Shortcut.** `/` switches the scene, on the Present page and in the slideshow window.

## Walkthrough (M6.1)

Equipment: a streaming laptop in viewer mode running OBS, a coordinator desktop, a follower
desktop and a phone, over the LAN and over the relay, on macOS and Windows.

| Scenario | Result |
| --- | --- |
| Settings → OBS on the streaming laptop: the two steps in OBS, the link turned on, Connected; OBS's own port and password used without typing | |
| WebSocket server turned off in OBS: Settings says so; turned on: connects without touching Worship Q | |
| Wrong password: Refused, with what to do | |
| OBS opened after Worship Q, and Worship Q after OBS | |
| OBS quit and reopened: Not running, then Connected; controls disabled meanwhile on every device | |
| The laptop rebooted: link back on its own | |
| Favourites chosen; the switch button on the coordinator, the follower and the phone switches between them, and from a third scene to the first | |
| `/` switches the scene, also from the slideshow window | |
| The scene list is in the same order as OBS's Scenes dock | |
| Scene changed in OBS itself: every device shows it within a second | |
| Scene renamed in OBS: the favourite follows | |
| Stream, Record and Virtual camera started and stopped from a follower and from the phone; timers count; Stop asks first | |
| Studio Mode on in OBS: switching changes program, preview untouched | |
| Live monitor on the desktop panel and on the phone; stale age shown when the OBS computer drops; closing every panel stops the screenshot requests in OBS's log | |
| Upload through the relay per watching device on the venue connection (M5.3) | |
| Link taken over by the follower: the laptop's switch turns off silently, Settings names who took over; taken back with one switch | |
| Link turned off: every OBS control disappears everywhere | |
| A workspace without OBS: nothing new anywhere | |
| A version 3 desktop in the workspace: presents as before and shows nothing new | |
| Over the LAN with the internet unplugged: OBS controls still work between the desktops | |
| The same on Windows | |
