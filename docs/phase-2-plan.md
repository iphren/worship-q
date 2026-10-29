# Worship Q — Phase 2 Plan: One Live State Across the Venue

**Drafted:** 28 October 2026  
**Status:** Draft for review. Scope and decisions below are proposals until confirmed.  
**Source:** [Requirements and Architecture](worship-q-requirements-and-architecture.md), referred to here as "the spec", and the code at version 0.3.0.

## 1. Where the implementation stands

Phase 1 is done, and much of what it set aside has already shipped: a church server, content synchronization, remote control from phones, and the subtitle overlay. Some features the spec labels **Later** have also shipped.

### Done

| Area | What exists |
| --- | --- |
| Local desktop (phase 1, M0–M10) | Songs, search with pinyin and initials, calendar and meeting days, dated run sheets, Go live / Edit run sheet, copy Append/Replace, live state with start rules and expiry, slideshow output with fitting and wrapping, backgrounds, live lyrics editing, backup file, signed installers and automatic updates for macOS and Windows |
| Subtitle overlay | Localhost page on a fixed port for OBS, with its own font family and scale slider (phase 1 decision D2) |
| Several workspaces on one computer | Each in its own folder and database; switching reopens the app |
| Church server (`apps/server`) | One Node process with SQLite, Docker image, CLI administration, church defaults with workspace overrides, off-site backups |
| Content synchronization | Songs, revisions, run sheets, settings and backgrounds, pushed and pulled as records; the later edit wins |
| Church Library | Manage Church Library on/off, with a dry run; workspace versions of church songs; hiding church items; workspace versions become their own songs when the church deletes the original |
| Protocol versions | Checked on enrollment and on the relay; an old client is told to update |
| Remote control | Rotating invitation QR, four-digit code, operator approval, grants that stay until Disconnect / Disconnect all, navigation, live run-sheet edits by intent with an Undo notice, library search |
| Ahead of the spec | Slide decks converted to images on the server (spec: Later), websites shown on the slideshow, legacy song import, public download website |

### Gaps

Each gap is listed against the spec section or acceptance criterion it fails.

| # | Gap | Spec |
| --- | --- | --- |
| G1 | **The live state is per computer.** Two operator desktops in one workspace each keep their own, so a streaming computer cannot follow the projector computer, and one operator's slide changes do not reach another | §7 rules 1–2, §8, criteria 8, 31 |
| G2 | **No live-state backup or recovery.** If the presenting computer fails, a second computer cannot carry on from where it was | §7 rule 9, criterion 31 |
| G3 | **No viewer mode** | §7, criterion 31 |
| G4 | **No coordinator role between desktops.** The relay picks one desktop for phones only; nothing orders commands from several operators | §7, §9, §10 |
| G5 | **No LAN connections.** Phones and other devices go through the server, so remote control and multi-device use need internet at the venue | §10, criteria 5, 9, 32 |
| G6 | **No browser displays or browser overlay pages** reached through the church server | §11, criterion 6 |
| G7 | **No connected-devices view.** Capabilities are reported to the relay but not used | §4, §9 |
| G8 | **Enrollment uses a shared connection code**, not administrator-approved pairing. Anyone with the code can join the workspace | §4, criterion 16 |
| G9 | **No admin web app and no OIDC sign-in.** Administration is a command run in the container | §2, §4 |
| G10 | **Device tokens are kept in the app's database**, not the system keychain | §4 |
| G11 | **No Share with church.** No promotion, review, or approval for songs or backgrounds | §5, criterion 21 |
| G12 | **No Restore central version and no Central version updated notice** | §5 |
| G13 | **Central deletion of backgrounds:** deleting one hides it everywhere and its file stays on the server; no recovery for centrally deleted songs | §5, §11 |
| G14 | **Conflicts:** concurrent edits to one song or run sheet are resolved by last write, with no review | §8, §14 |
| G15 | **No app.worship-q.com link router.** QR codes point straight at the church server, so an installed app cannot open from a camera scan | §2, criterion 24 |
| G16 | **Remembered rejoin is page-local.** A phone's grant lives in that browser; there is no **Connect to [workspace]** home screen in an app | §4 |
| G17 | **No phone app or local-only phone presentation** | §3, §12, criteria 10, 33 |
| G18 | **No Linux build** (phase 1 D1 deferred it) | §15 |
| G19 | **Server uses SQLite, not PostgreSQL** | §15 |
| G20 | **Cache readiness is not shown.** No view of which songs, backgrounds, and fonts are on this device for offline use | §14 |
| G21 | **Moving a local workspace into a church** exists as Keep both / Use the church's copy at join time, but does not merge run sheets for the same date | §3 |
| G22 | **Phones can only be invited and approved on the computer that receives them.** Another desktop shows **Use this computer** instead of the QR code; the spec lets any operator device show the invitation and approve | §4 |

G19 is a deliberate simplification: one SQLite file is easier for a small church to run and back up. The spec should record it as a decision rather than treat it as work.

## 2. Phase 2 goal

At a venue with a projector computer and a separate streaming computer, and with or without internet:

1. both computers show the same live slide, the projector computer on the slideshow and the streaming computer through OBS (without internet, the streaming computer runs the desktop app and uses its localhost pages);
2. an operator at either computer, or a phone on the venue Wi-Fi, can move the slides, and every screen follows;
3. a projector computer set up as a viewer opens as a viewer every week and never takes over;
4. if the presenting computer crashes, another computer carries on from the same slide;
5. a device on the venue network without credentials can neither read nor send anything.

This covers G1–G7, G10 and G22, which together are the spec's **Networked** scenario and the unfinished parts of criteria 5, 6, 8, 9, 31 and 32. The rest of the gaps are planned for later phases in section 7.

## 3. Scope

| In phase 2 | Not in phase 2 |
| --- | --- |
| One live state per workspace, shared by its operator devices | Admin web app, OIDC sign-in, administrator-approved pairing (G8, G9) |
| A coordinator that orders commands; explicit handover | Automatic coordinator election and failover |
| Viewer mode, saved on the device | Share with church, Restore central version (G11, G12) |
| Live-state backup on the church server and recovery from it | Conflict review for offline edits (G14) |
| LAN connections between desktops, and from phones on the same network, authenticated and encrypted | Link router and installed-app opening (G15, G16) |
| mDNS discovery, with the server's help when it is reachable | Native phone apps, local-only phone (G17) |
| Browser slideshow and overlay pages through the church server | Linux (G18) |
| Connected-devices view, Disconnect all | Live audio broadcast, voice recognition (spec §17 future improvements) |
| Device tokens in the system keychain | |

## 4. Decisions needed before or during phase 2

These continue the phase 1 numbering. Each one has a recommendation so work can start.

| # | Decision | Recommendation | Blocks |
| --- | --- | --- | --- |
| D14 | Who is coordinator | Kept from today: the first operator device of the workspace to connect to the server. Another takes over only when an operator chooses **Use this computer**. No election. Without the server (M5), a desktop browses mDNS for a few seconds before coordinating, and follows a coordinator it finds. If two coordinators ever meet, over the LAN or when the server returns, the one whose live state has the older start keeps it and the other becomes a follower; its slideshow jumps to the kept state | M1, M5 |
| D15 | Where the coordinator runs | Desktop app only in phase 2. A browser cannot accept LAN connections, and there is no phone app yet | M1 |
| D16 | What a viewer can see (spec open decision) | The live run sheet and presented slide, read-only, with its own outputs following. No controls, no editing | M3 |
| D17 | Live-state backup period | The coordinator sends a snapshot to the server on every change, throttled to one a second. The server keeps it until the live state expires | M4 |
| D18 | Recovery after the coordinator is lost | Not automatic. Other operator devices show **The presenting computer is not responding** and offer **Carry on here**, which takes the latest snapshot from the synchronized copy or the server. That device becomes coordinator | M4 |
| D19 | LAN security protocol | TLS with a self-signed certificate per coordinator. Its fingerprint goes to devices through the church server (and in invitation QR codes), so they can recognize the right coordinator. Each device still proves itself with its device token or remote grant | M5 |
| D20 | Discovery | mDNS on the LAN, advertising only the workspace's server identifier. The server also tells devices the coordinator's last known LAN addresses. If neither works, connect through the relay | M5 |
| D21 | One authority across transports | A device connects to the coordinator over exactly one transport at a time; it prefers LAN and switches without losing commands, using the existing command identifiers | M6 |
| D22 | Browser display access | A per-output link holding a revocable output token, created on an operator device under Settings → Outputs and shown there with Copy and a QR code. The link is self-contained: the token is in the link, and the page keeps nothing in browser storage, sets no cookies and asks for no sign-in, so a fresh browser or an OBS Browser Source shows the output the first time the link is opened. The link stays the same across dates, run-sheet changes, app restarts and coordinator handover, and stops working only when revoked from Settings → Outputs | M7 |
| D23 | Keychain storage | Use the platform keychain through a Tauri plugin; move the existing token on first launch and remove it from the database | M8 |
| D24 | Live run-sheet edits from other operators | Sent to the coordinator as the same intent-based commands phones use (`addItem`, `removeItem`, `moveItem`). Other operators see the same notice as for a phone edit, without Undo | M2 |
| D25 | Inviting and approving phones from any operator device | Every operator device shows its own rotating invitation QR and approves the phones that scan it, as one desktop does today. On approval the device registers the grant with the coordinator, which keeps the workspace's grant list and mirrors it to the server with the live state. A phone's commands enter through the device it is connected to and are forwarded to the coordinator carrying the phone's grant identity, with the device as transport only, so Undo notices and the connected-devices list name the phone (D24). Because the grant belongs to the workspace, not the approving computer, the phone can later connect to any operator device, including the coordinator over the LAN, without a new scan. The relay routes a phone to the device whose invitation it holds, and the one-desktop-per-workspace rule and standby state go away | M2 |

## 5. Milestones

Sizes are relative (S, M, L), not time estimates. Each milestone ends in something that can be demonstrated.

There are no releases between milestones: phase 2 ships as one version after M9. Instead, every milestone adds unit tests for its business logic in the packages (`live-state`, `protocol`, `remote`, `sync`) and integration tests that run the server with simulated devices, so each stage is proven before the next builds on it. The desktop interface is covered by M9's walkthrough.

### M0 — Technical spike (S)

Throwaway code to confirm the riskiest parts:

- A WebSocket server with TLS in the Tauri core, reached from another desktop and from Safari and Chrome on a phone on the same Wi-Fi, with a self-signed certificate whose fingerprint is checked.
- mDNS advertise and browse on macOS and Windows, including the macOS local-network permission prompt and the Windows firewall prompt.
- Behaviour on a guest network with client isolation: confirm that the relay fallback is chosen and the reason shown.

**Done when:** each item works on both platforms, or the gaps are written down. A phone browser rejecting a self-signed certificate is likely; the fallback is the relay (see D19 notes in M5).

### M1 — Shared live state over the relay (L)

- Extend the relay from phones-only to every operator device of the workspace: desktops that are not coordinator connect to the coordinator the same way phones do, with their device token instead of a grant.
- Protocol version 2. The server is updated first; an older desktop joining the workspace is told to update by the existing check, so a workspace never mixes old and new desktops in one live state.
- `packages/live-state` gains a coordinator side (applies commands in order, publishes snapshots with a revision) and a follower side (sends commands, applies snapshots, never edits the live state itself).
- A simulation harness in `packages/live-state` tests: one coordinator and several followers with messages reordered, duplicated, delayed and dropped, asserting that every follower converges on the coordinator's state and no command applies twice (criterion 8).
- Follower desktops drive their own slideshow and overlay from the snapshots.
- Reconnecting devices receive the full snapshot; command identifiers keep a retried command from applying twice.
- The snapshot carries the live run sheet's item list (item identifiers, titles, and the song or content each points to) as well as the presented content, including **Still presenting previous content**, so a follower whose content sync is behind still shows the run sheet and renders the presented song. Lyrics and backgrounds themselves arrive by content sync; a follower missing one shows the presented text on the default background until it does.

**Done when:** two desktops on the same server show the same slide on both slideshows within a second, with commands from either one, and unplugging the network of one and plugging it back leaves both on the authoritative slide (criterion 8).

M1 can be worked as two halves: M1a, the coordinator and follower logic with the simulation harness in `packages/live-state` and `packages/protocol`, which needs no server or desktop; and M1b, the relay extension and desktop wiring. M3, M4, M7 and M8 can start against M1a.

### M2 — Operators together (M)

- Go live, Clear screen, blank and live run-sheet edits from any operator device go through the coordinator (D24).
- Edit mode stays per device: preparing another date on a follower never touches the live state (spec §7).
- **Use this computer** hands over coordination without changing what is on screen.
- Every operator device shows its own invitation QR and approves its own phones per D25 (G22); grants are registered with the coordinator, and phone commands are forwarded to it. **Use this computer** moves out of the remote-control window and becomes only the coordination handover.
- When an operator device disconnects, its phones reconnect to another operator device with their existing grant, preferring the coordinator, and show **Reconnecting** meanwhile.
- The kept-too-long notification and expiry count only connected operator devices.

**Done when:** spec criterion 18 holds with two operator devices, the handover leaves every screen unchanged, and a phone that scans the QR on the follower and is approved there controls the slides on both computers, and keeps control after that follower is closed.

### M3 — Viewer mode (S)

- A device setting, saved on the device and kept across restarts.
- A viewer does not start, keep alive, or coordinate a live state.
- With nothing live, a viewer shows **Waiting for presentation** on its outputs' background.
- When the coordinator disappears mid-service, a viewer keeps showing its last snapshot until the live state expires (phase 1 D6, four hours) or a new coordinator appears; it never falls back to **Waiting for presentation** while a live state is unexpired.
- What it shows otherwise per D16.

**Done when:** the viewer part of criterion 31 passes: a projector computer set to viewer reopens as one after a restart, and with only it connected the live state expires.

### M4 — Backup and recovery (M)

- The coordinator mirrors its snapshot to the server per D17; the server holds it per workspace until expiry.
- Recovery per D18, from a follower's synchronized copy first, then from the server.
- When the old coordinator returns, it becomes a follower; it never resumes its own stale live state. If it was only cut off rather than closed, its slideshow and overlay jump to the new coordinator's state, and phones that were connected to it are handed to the new coordinator with their workspace grants (D25). Its operator sees **Another computer carried on; this one now follows**.
- The first operator device to connect after a restart uses the server's unexpired live state, as the start rules require.

**Done when:** closing the coordinator's lid mid-song, then choosing **Carry on here** on another computer, continues from the same slide; and reopening the first computer makes it follow (criterion 31, recovery part).

### M5 — LAN connections (L)

- The coordinator serves the M1 protocol over TLS on the LAN per D19, advertised by mDNS per D20.
- Desktops connect over the LAN when they find the coordinator; certificate fingerprint and device token are both checked.
- Phones on the venue Wi-Fi: the invitation QR also carries the coordinator's LAN address and fingerprint, whichever operator device showed it. A phone approved on a follower therefore connects to the coordinator over the LAN with its workspace grant (D25). If the phone browser will not accept the certificate, it uses the relay and says so. Native phone apps (later phase) are what make offline phone control dependable.
- Offline approval: the approving operator device grants as usual and registers the grant with the coordinator over the LAN; the coordinator sends the grant list to the server when it is reachable.

**Done when:** with the venue router's internet unplugged, two desktops keep presenting together, and a device without credentials on the same network cannot connect or read traffic (criteria 5, 32).

### M6 — Transport switching (M)

- One connection to the coordinator at a time per D21, choosing LAN over the relay.
- Switching when the LAN appears or disappears, without duplicating commands or creating a second authority.
- The interface says which way each device is connected, in plain words: **On this network** or **Through the church server**.

**Done when:** criterion 9 passes: unplugging and replugging the venue internet and Wi-Fi during a service never duplicates a slide change or splits the live state.

### M7 — Browser outputs (M)

- Slideshow and subtitle overlay pages served by the church server, following the workspace's live state through the relay.
- Output links per D22, created and revoked under Settings → Outputs. The pages work with browser storage and cookies disabled; a standalone OBS laptop with only the overlay link configured shows subtitles as soon as OBS opens, with internet.
- A localhost slideshow page served by the desktop app next to the existing subtitle overlay, at the same fixed port, so a browser or OBS on a computer running the app can show the full slideshow without internet (spec §10 localhost exception). The desktop app reaches the coordinator over the LAN or the relay; the localhost page only needs the app.
- Fonts: the page uses the workspace's font when the browser has it, otherwise a documented fallback, and reports which (spec §11).
- Backgrounds fetched from the server and cached by the browser.

**Done when:** a computer without the desktop app shows the slideshow in a browser with only the link; a laptop with a fresh OBS profile and no desktop app shows the overlay after pasting the link and nothing else, and keeps it across weeks; and a browser on a computer running the desktop app shows the localhost slideshow with the venue's internet unplugged (criteria 3, 6).

### M8 — Connected devices and credentials (M)

- A **Connected devices** list on operator devices: name, role (coordinator, operator, viewer, phone, browser output), connection type, last seen.
- **Disconnect all** clears the coordinator's grant list, so it covers phones connected through any operator device, and browser outputs.
- Device tokens in the keychain per D23.
- Capabilities (fonts, screens, transparency, media) reported by each device and used to warn, for example when a follower lacks the workspace font.

**Done when:** an operator can see and disconnect every device following the presentation, and no token is left in the database file.

### M9 — Acceptance pass (S)

- Walk through spec criteria 3, 5, 6, 8, 9, 18, 31 and 32 with a projector computer, a streaming computer with OBS, a phone, and a browser output, on macOS and Windows, with internet and without.
- Run one real service with a projector computer and a separate streaming computer.
- Update the volunteer guide and the server deployment guide; remove "Remote control needs internet at the venue" from known limits when M5 holds.
- Confirm the package unit tests and server integration tests from M1–M8 all pass on the release build.

**Done when:** every listed criterion passes or has a recorded, accepted exception.

## 6. Order and dependencies

| Milestone | Needs first |
| --- | --- |
| M0 | — |
| M1 | — |
| M2 | M1 |
| M3 | M1 |
| M4 | M1 |
| M5 | M0, M1 |
| M6 | M5 |
| M7 | M1 |
| M8 | M1 |
| M9 | M2–M8 |

- M1 does not wait for M0: the relay already exists, so shared live state can be built over it first and moved to the LAN in M5.
- M3, M4, M7 and M8 are independent once M1 is in, and can run in any order; their logic can start against M1a before the relay and desktop wiring of M1b are done.
- M5 is the riskiest milestone; M0 exists to find out early whether phone browsers can use the LAN at all.

## 7. Later phases

A suggested grouping for the remaining gaps:

**Phase 3 — Church administration**

- Admin web app bundled with the server, with OIDC sign-in and a way to name the first administrator (G9).
- Administrator-approved pairing replacing the connection code, with a migration for enrolled devices (G8).
- Share with church: submit, review, approve or reject songs and backgrounds (G11).
- **Workspace version**, **Restore central version** and **Central version updated** (G12).
- Recoverable central deletion for songs and backgrounds, with files removed after a retention period (G13).

**Phase 4 — Phones**

- app.worship-q.com link router and installed-app opening from a camera scan (G15).
- A phone app: Present on this device with swipe navigation, a local-only workspace, remembered **Connect to [workspace]**, and LAN control without internet (G16, G17).
- Cache readiness for offline use (G20).

**Unscheduled**

- Conflict review for concurrent and offline edits, and merging run sheets for the same date on join (G14, G21).
- Linux desktop build (G18).
- Live audio broadcast to remote operators and controllers, and voice recognition with automatic slide switching (spec §17).
- Record SQLite as the server database in the spec (G19).
