# Worship Q — Native Apps Task Breakdown

**Drafted:** 26 November 2026
**Status:** M0 done for Apple devices and Windows discovery, Android waiting for a device ([spike](spikes/native-apps.md)). M1 done: the router page is live and the desktop's router links are switched off until release. **M2 broken down below and being implemented;** later milestones are broken down when M2 is done.
**Source:** the [native apps plan](native-apps-plan.md), the [spike results](spikes/native-apps.md), and the code at version 2.15.0 (protocol version 11).

## 1. How to read this

Task identifiers are `M<milestone>.<n>`; a task lists the tasks it needs first. Sizes are S, M and L as in the plan. Logic gets unit tests, as in earlier phases; the device walkthrough is M7, and each milestone's "done when" is checked on devices at its end.

Android is built and run in the emulator throughout. The checks that need real hardware (Wi-Fi, locked-screen audio, the camera) wait for the test phone, and M2 is not called done on Android until they pass.

### Where things live today

| Concern | Location |
| --- | --- |
| The phone page: connection, approval, grant in browser storage, LAN hints read but unused | `apps/remote/src/connection.ts` (`RemoteConnection`) |
| The phone page's screens: run sheet, slide, video bar, search, Bible, OBS, listening | `apps/remote/src/RemoteApp.tsx`, `Bible.tsx`, `Language.tsx`, `audio.ts` |
| The phone page's words | `packages/i18n` (`@worship-q/i18n/remote`) |
| What a phone sees and sends (`RemoteView`, `RemoteCommand`, `thumbnailVia`) | `packages/protocol/src/wire.ts` |
| The desktop's side of remote control: invitations, approvals, grants, views, thumbnails from the desktop | `packages/remote/src/index.ts` (`RemoteHost`) |
| The coordinator's LAN room, which already accepts phones (`kind: 'remote'`) and runs the relay logic over them | `apps/desktop/src/app/lan.ts` (`LanHost`), `apps/desktop/src-tauri/src/lan.rs` |
| A pinned outgoing LAN connection, which always sends a device token | `lan.rs` (`lan_connect`) |
| Choosing between the LAN and the relay | `apps/desktop/src/app/transport.ts` (`TransportSwitch`) |
| Invitation links and the router | `packages/protocol/src/invitation.ts`, `apps/desktop/src/app/inviteLink.ts` |
| The desktop's start-up, one window per workspace folder | `apps/desktop/src/main.tsx`, `App.tsx`, `app/boot.ts` |
| Spike code (throwaway, on the local `native-apps-spike` branch) | `bonjour.rs`, `Info.ios.plist`, `tauri.mobile.conf.json`, `capabilities/mobile.json` |

### Four facts that shape the tasks

1. **The coordinator already serves phones on the LAN.** `LanHost` hands a connection without a device token to the same relay logic the church server runs, which checks the invitation or grant. What is missing is on the phone's side: a browser cannot accept the coordinator's self-signed certificate. The app can, through `lan_connect`, once it can connect *without* a device token.
2. **The phone page's logic is one class.** `RemoteConnection` holds the approval flow, the grant, reconnection, commands, search, thumbnails and audio signalling over one browser WebSocket. Giving it a pluggable connection lets the page and the app share it, instead of porting it.
3. **Thumbnails from a church server come by HTTP.** With no internet that fails, so a phone on the LAN must get them from the coordinator, as phones of the public server already do (`thumbnailVia: 'host'`). Today that choice is per desktop; it needs to be per phone.
4. **Trust comes only from the invitation and the coordinator.** A phone stores the fingerprints it may connect to. It starts with the invitation's, and the coordinator replaces the list over a trusted connection with its workspace's operator devices (N30). mDNS and remembered addresses only say where to look.

## 2. Decisions for M2

These follow from the plan and the spike. Those marked **P** were proposed here and agreed by the owner on 26 November 2026.

| # | Decision |
| --- | --- |
| A1 | **P.** The shared phone screens move into a new package, `packages/phone`, used by `apps/remote` and the app. The phone page looks and behaves exactly as before. |
| A2 | **P.** `RemoteConnection` moves into `packages/phone` with a connection interface. The phone page gives it the browser WebSocket; the app gives it a switch between a pinned LAN connection and the relay, the LAN preferred, as the desktop's `TransportSwitch` does. |
| A3 | **P.** The coordinator's list of trusted fingerprints (N30) is sent in the phone's view over **both** the LAN and the relay. The relay is the church server, which the phone reaches over normal HTTPS, so its word is as good as the pinned connection's. The plan said the pinned channel only; this lets a phone that has only ever used the relay connect offline next time. |
| A4 | **P.** A remote-control workspace is kept in one small file in the app's data folder, one entry per workspace; its grant is in the keychain under that entry. No database: there is nothing to query. |
| A5 | The phone's name is asked once per device and used for every workspace, as the phone page asks once per browser. |
| A6 | Each entry is matched by the server's host and the workspace's server identifier, or by the permanent identifier `l` (N13, N22). A direct link (N31) is matched by its full server address. |
| A7 | **P.** No custom `worship-q://` scheme in M2. The plan gave the router page an **Open in Worship Q** button using one, but iOS already shows its own banner for this on the router page (seen in M1), and Android opens App Links directly. Revisit if testers ask for it. |
| A8 | The app's mDNS on iOS uses the system's Bonjour (`bonjour.rs` from the spike, made production code); Android keeps `mdns-sd`, to be checked on the test phone. |
| A9 | The app uses Tauri's official barcode scanner plugin for the in-app scanner. |

## 3. M2 — The app with remote control (L)

**Done when (from the plan):** a phone on the venue Wi-Fi with no internet moves the slides, sees thumbnails, adds a song and listens; after a restart, the workspace opens from the list without a scan; scanning it again opens it; after the coordinator moves to another desktop with no internet, the phone reconnects with no scan. G15 and G16 closed; criteria 5 and 24 for phones.

### The mobile build

| Task | What | Size | Needs |
| --- | --- | --- | --- |
| M2.1 | **Mobile builds of `apps/desktop`.** A mobile Tauri configuration over the desktop's (identifiers, the deep-link plugin for `app.worship-q.com/j`, development team), `Info.ios.plist` (local network, Bonjour service, camera, microphone, audio background mode), the Associated Domains entitlement, and the Android manifest (`ACCESS_LOCAL_NETWORK`, camera, microphone). Desktop-only crates and commands gated off (`cfg(desktop)`): window state, updater, `output.rs`, `overlay.rs`, `obs.rs`. Capabilities split by platform. A check that fails the build if the entitlement is missing. | M | — |
| M2.2 | **Mobile CI.** The check job compiles the Rust core for `aarch64-apple-ios` and `aarch64-linux-android`, so a desktop change cannot break the mobile build unseen. The OpenSSL question from the spike is settled here: `rustls` on Android if it builds cleanly, else the vendored OpenSSL with the NDK tool links. | S | M2.1 |
| M2.3 | **Platform pieces in the Rust core.** `bonjour.rs` for `lan_browse` and `lan_advertise` on iOS (A8); `lan_connect` without a device token, for a phone; the keychain on Android (Keystore) and a mobile keychain service name; restarting the LAN listener and reconnecting when the app returns to the screen. Rust unit tests where the logic is not a platform call. | M | M2.1 |
| M2.4 | **The mobile start-up.** On iOS and Android the app opens the mobile shell (the workspace list) instead of the desktop window; the updater is never called; the page draws under the status bar and home indicator and pads by the safe-area insets. The desktop's start-up is unchanged. | S | M2.1 |

### Shared phone screens and connection

| Task | What | Size | Needs |
| --- | --- | --- | --- |
| M2.5 | **`packages/phone` (A1, A2).** Move `RemoteConnection` and the phone screens out of `apps/remote`, behind a `PhoneConnection` interface (open, send, close, events) and a `files(name)` function for server files. `apps/remote` supplies the browser WebSocket and relative file addresses; its tests move with it. No change to the phone page, checked by its tests and a before-and-after look. | M | — |
| M2.6 | **The workspace source.** The interface the screens read and act through: the live run sheet and slide, commands, search, Bible, OBS, listening, thumbnails, and the state of the connection and approval. `RemoteConnection` is its remote implementation. The operator implementation is M4; the screens hide what a remote control cannot do. | M | M2.5 |
| M2.7 | **The app's connection (A2).** A `PhoneConnection` that tries the coordinator on the LAN first (pinned, with no device token), then the relay at the server's `/api/v1/remote`, and switches as `TransportSwitch` does, losing no command. Where it looks on the LAN: the invitation's or remembered addresses, then mDNS for the workspace; it connects only to a fingerprint on the entry's list. Tests for the choice and the switch with fake transports. | L | M2.3, M2.5 |
| M2.8 | **Thumbnails over the LAN.** `RemoteHost` decides `thumbnailVia` per phone: from the coordinator for a phone on the LAN, from the server otherwise, as now. The app reads server files at the server's full address. Tests in `packages/remote`. | S | M2.5 |
| M2.9 | **Trusted fingerprints (N30, A3).** An optional field in `RemoteView` with the fingerprints of the workspace's operator devices the coordinator knows, and their last addresses. The desktop fills it; older phones ignore it; the app replaces the entry's list each time. Protocol and `RemoteHost` tests; no protocol version change. | M | M2.6 |

### The app

| Task | What | Size | Needs |
| --- | --- | --- | --- |
| M2.10 | **The workspace list (A4, A6).** The home screen: each workspace with its church or server, the **Remote control** label, and whether it was presenting when last seen; **Scan a QR code**; removing an entry (forgets it, deletes its grant). Entries in the app's data folder, grants in the keychain. Reopens the workspace last used. Tests for the store and matching. | M | M2.3, M2.4 |
| M2.11 | **Opening an invitation (N13).** From a universal link or App Link (`readInvitation`), and from the in-app scanner (A9), which also reads a direct link to a church server's phone page (N31). An entry already on the list opens with no request; one whose access ended asks again; a new one asks for the phone's name the first time (A5) and joins the list on approval. `readDirectLink` beside `readInvitation`, with tests. | M | M2.10 |
| M2.12 | **Remote control in the app.** The shared screens over the app's connection, with the approval steps (name, **Waiting for approval** with the four-digit code, denied, revoked) and the grant kept in the keychain (G16). Leaving a workspace closes its connection, so gestures never reach another (criterion 23). | M | M2.6, M2.7, M2.11 |
| M2.13 | **Listening with the screen locked.** The phone page's listening over the app's connection, with the audio background mode on iOS; on Android, whatever keeps the web view playing with the screen off, decided on the test phone. Says when the system interrupts it. | M | M2.12 |
| M2.14 | **Phone and tablet layouts.** Touch targets of at least 44 points, no hover-only controls, the tablet showing run sheet and slide side by side. In English, Simplified and Traditional Chinese. | M | M2.12 |

### Checks

| Task | What | Size | Needs |
| --- | --- | --- | --- |
| M2.15 | **The "done when" on devices**, recorded in the spike results: on an iPhone and an iPad, and on the Android phone when it arrives. The venue Wi-Fi with no internet: slides, thumbnails, adding a song, listening locked; restart; a second scan; the coordinator moving to another desktop. | S | all |

### Order

M2.1 → M2.2, M2.3, M2.4 in parallel. M2.5 and M2.6 can start at once, beside the build work, because they change only TypeScript. M2.7 needs both lines. M2.8 and M2.9 are independent of the app and can land on their own. Then M2.10 → M2.11 → M2.12 → M2.13, M2.14, and M2.15 last.

Each task, or a few small ones together, is a pull request. The desktop and the phone page keep working after every one.
