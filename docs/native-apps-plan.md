# Worship Q — Native Apps Plan

**Drafted:** 22 November 2026
**Status:** Plan agreed in discovery with the project owner; nothing is built. Tasks are to be broken down milestone by milestone, starting with the M0 spike.
**Source:** the [native apps discovery](native-apps-discovery.md) of 22 November 2026 and the owner's answers recorded there and here; the [spec](worship-q-requirements-and-architecture.md) §2 (application distribution, QR entry points), §3 (local-only mode), §4 (devices and roles), §10 (connectivity), §12 (phone-to-TV), §16 (native mobile) and acceptance criteria 5, 9, 10, 11, 16, 23, 24, 32 and 33; the [phase 3 plan](phase-3-plan.md) §7 "Phase 4 — Phones"; the code at version 2.14.0 (protocol version 11).

## 1. Where the implementation stands

- **No phone app exists.** A phone is a web page (`apps/remote`) served by the church server, or by the public server for a computer in local mode. It controls the slides through the server's relay, so it needs the internet even at the venue: phone browsers refuse the coordinator's self-signed certificate. This is phase 2's one known exception.
- **QR codes point straight at the server** (`cloud.ts:1409`): `https://<server>/remote/?w=<workspace>#i=<invite>&f=<fingerprint>&a=<addresses>&p=<port>`. `app.worship-q.com` is not deployed, so no installed app could open from a camera scan (G15).
- **A phone's approval already lasts until an operator disconnects it.** The grant is kept by the coordinator in its own database, and with a church server mirrored to the server with the live-state backup (D25). The phone page loses it only because it keeps its copy in browser storage, which phones clear (G16).
- **No local workspace or Presenter Mode on a phone** (G17).
- **The venue network is served only with a church server.** A computer in local mode builds no `LanHost` (`cloud.ts:1700`).
- **The admin app's Devices page lists enrolled computers only,** not phones.
- **The desktop is Tauri 2: React and TypeScript on a Rust core.** The core already serves and connects TLS WebSockets with a pinned certificate fingerprint (`lan.rs`), advertises and browses mDNS, and holds SQLite, files, media and the keychain. The application layer (`apps/desktop/src/app`, about 22,000 lines of TypeScript with the screens) runs the live state, coordination, synchronization, the public server and remote control.
- **Apple Developer membership exists,** an organisation's, used to notarise the macOS build.

## 2. The request

Native apps for iPhone, Android phones, iPad and Android tablets, and the link router, so that:

- a phone on the venue Wi-Fi controls the slides with no internet;
- a camera scan of the invitation QR code opens the installed app, or the church's phone page when the app is not installed;
- a phone or tablet can do what the desktop does: keep a workspace, prepare songs and run sheets, present, and hold the presentation that other devices follow.

**Agreed requirements (22 November 2026)**

- **One app, one way of working.** The device holds a list of workspaces. Each workspace has an access level: **Remote control** (like today's web remote) or **Operator** (like the desktop app). A remote control is an operator with fewer permissions, not a separate mode.
- **Scanning a QR code adds the workspace,** shown by a desktop or another phone or tablet, as a remote control after an operator approves. Scanning one already in the list opens it.
- **An administrator can promote a phone or tablet to operator** of a workspace it already controls, from the admin app. This needs a church server.
- **An operator phone or tablet can coordinate for other devices**: phones, desktops in viewer mode and other operators.
- **Presenter Mode is landscape only.**
- **No Apple TV app.** A native tvOS app cannot show websites or YouTube items, and an app that cannot show everything is not built. An Apple TV shows the slideshow by AirPlay from a phone, tablet or Mac.
- **No list of workspaces found on the venue Wi-Fi.** A workspace is added by a scan only.
- **Published by the same organisation, under the same legal name,** as the existing Apple Developer membership, in both stores. The app is called **Worship Q**.
- **Minimum versions:** iOS and iPadOS 17; Android 10 (API 29).
- **Remote control ships first;** operator features follow in a later release of the same app.

## 3. Features

### The workspace list

The home screen lists the device's workspaces, each with its church (or **On this device**), its access level as a quiet label, and whether it is presenting now. Below the list: **Scan a QR code** and **New local workspace**. The app reopens the workspace last used.

- **Adding by scan.** A camera scan through the link router, or the in-app scanner. The phone asks for a name the first time, sends the request, and shows **Waiting for approval** with the four-digit code, as today. On approval the workspace joins the list as **Remote control**.
- **Scanning a workspace already in the list** opens it and sends no request. The match is on the server's host and the workspace's server identifier, never the name. If the workspace's access has ended, the scan asks for approval again.
- **New local workspace.** A workspace on this device alone, with no church, where the device is its operator (spec §3).
- **Removing** a workspace from the list forgets it on this device; an operator removes the device's access from the other side.
- Each workspace has its own credential: a grant for a remote control, a device token for an operator. Opening one workspace leaves the other, so gestures never reach the wrong one (criterion 23).

### One workspace screen, two access levels

The same screens for every workspace, showing what the access level allows. The phone screens are designed once for both.

| | Remote control | Operator |
| --- | --- | --- |
| The live run sheet and the slide on screen | Yes | Yes |
| Navigate, blank, video play and pause | Yes | Yes |
| Add, remove and reorder live run sheet items; search the library; Bible passages; websites | Yes | Yes |
| OBS buttons, when the workspace has OBS | Yes | Yes |
| Listen to live audio | Yes | Yes |
| Calendar, other dates, Go live, Edit run sheet, copy Append and Replace | | Yes |
| Songs: write and edit lyrics, backgrounds, slide decks, photos, videos | | Yes |
| Settings: typography, backgrounds, outputs, connected devices, viewer mode | | Yes |
| **Present on this device** and the external display | | Yes |
| Coordinate: hold the presentation, show an invitation QR code, approve phones, serve the venue network | | Yes |
| A copy of the workspace on the device, usable offline | | Yes |

A remote control works only while it reaches the coordinator; an operator keeps its copy and works offline (criterion 5).

### Operator features

- **Prepare** as on the desktop: calendar, run sheets, songs with the lyrics editor, backgrounds, Bible passages, slide decks and photos, videos, websites. Settings are a reduced set.
- **Present on this device.** Presenter Mode: clean slides full screen, always landscape, swipe to move, tap to show controls for a few seconds (spec §12; criteria 10, 33).
- **External display.** The slideshow on a projector or TV, with the controls on the device. iPhone and iPad: by cable or AirPlay, including to an Apple TV. Android: by cable. Everything the desktop slideshow shows, websites and YouTube included.
- **Coordinate.** Hold the live state; show a rotating invitation QR code and approve phones (D25); serve the venue network to phones, desktops and other operators; back up the live state to the church server; **Use this device** and **Carry on here** as on the desktop.
- **A local workspace** uses the public server as a desktop does: remote control through its relay, Bible, slide decks, live audio listening.
- **Not on phones and tablets at first:** OBS control and the subtitle overlay page (OBS runs on a computer), broadcasting live audio, recording, the local API.

### Promotion to operator

- **Where:** the admin app's workspace page lists the workspace's phones and tablets (the remote controls it has approved), with name and when approved. Each has **Make operator**. Operator phones and tablets are listed with the computers, with **Remove operator** beside **Remove**.
- **On the phone:** the next time it reaches the church server, it receives its operator credential, downloads the workspace, and the operator features appear. A note says "You are now an operator of Sunday Worship".
- **Removing operator access** ends the device token. The workspace stays in the phone's list with a note, and a scan asks to control it again.
- **Only with a church server.** A workspace in local mode lives on one computer and is never synchronized to another device, so there is no one to promote and nothing to download. A phone controlling a local desktop stays a remote control; it can have its own local workspace.
- **Phones do not use pairing codes.** Promotion replaces **Set up as a church device** on phones. Computers keep pairing (D29).

### Tablets

The same app with wider layouts: run sheet, slide and preview side by side; the full song editor with a keyboard.

### The link router

- `https://app.worship-q.com/j#s=<server host>&w=<workspace>&i=<invite>&f=<fingerprint>&a=<addresses>&p=<port>`. The whole invitation is in the fragment, which browsers never send, so the router never receives church data (criterion 11).
- **With the app installed,** the camera opens it directly, with no network, so joining a coordinator on the venue Wi-Fi works offline.
- **Without the app,** the page shows "This invitation is for **church.example.org**" and offers **Continue to church.example.org** (today's phone page, unchanged) and the store links. It never forwards on its own (criterion 24).
- In English, Simplified Chinese and Traditional Chinese, following the browser.

## 4. Proposed design

- **One Tauri project.** The mobile app is iOS and Android builds of `apps/desktop`, reusing its application layer, Rust core and every package. New code is the phone and tablet screens, the workspace list, promotion, and small platform plugins.
- **One set of phone screens over a workspace source.** The screens read and act through one interface: the live run sheet, the slide on screen, commands, search, Bible, OBS, live audio, thumbnails, and, for operators, the editing and settings the desktop has. Two implementations:
  - **Remote source:** `RemoteView` and `RemoteCommand` over the LAN or the relay, as the phone page speaks today. Ported from `apps/remote/src/connection.ts`, with the Rust LAN client and the desktop's `Transport` in place of the browser WebSocket.
  - **Operator source:** the desktop's session, live link and store for that workspace's folder.

  Remote-only screens are never written; the operator-only parts are hidden for a remote source. `apps/remote` stays as the browser page and shares components with the app where it can.
- **Desktop screens.** The desktop's pages are split from its application layer where they are not already. The desktop's own layouts do not change.
- **Rust core on mobile.** Kept: `lan.rs` (serving and connecting), `db.rs`, `workspaces.rs`, `files.rs`, `media.rs`, `cloud.rs`, `instances.rs`, `power.rs`. Replaced by platform plugins where the spike shows they are needed: mDNS on iOS (`NWBrowser` and `NWListener` behind `lan_browse` and `lan_advertise`), the keychain on Android (Keystore), the font list (a platform call instead of `fontdb`), and output and monitor handling (the external display). Left out: `overlay.rs`, `obs.rs`, `web.rs`'s second web view.
- **Workspaces on the device.** Each operator workspace is a folder with its database, as on the desktop. A remote workspace keeps only what identifies it: server host, workspace server identifier, name, the coordinator's last fingerprint and addresses, and the grant in the keychain.
- **Promotion.**
  - The server keeps each workspace's grants (identifier, secret hash, name, approval time) for as long as they are valid, not only with the live-state backup, which expires. The coordinator still owns the list and mirrors it, as D25 says.
  - **Make operator** creates a device enrolment for the workspace, marked as waiting for the grant that names it, and records the administrator, as D29 records approvals.
  - The phone asks the church server with its grant whenever it opens a church workspace with internet (`GET /api/v1/promotion`). If an enrolment waits, the server returns the device token once and keeps only its hash, as for computers. The grant is retired, and the coordinator removes it from the list.
  - The phone stores the token in the keychain, makes the workspace's folder, pulls the workspace by the normal synchronization, and connects as an operator device.
  - The enrolment is an administrator's approval, as the spec requires for permanent access (§4). Its `enrolled_by` is `promotion`.
- **A phone coordinator in the background, the same on iOS and Android.** Both suspend an app's network soon after it leaves the screen. While presenting, the app keeps the screen awake, and an external display keeps it active. When it goes to the background anyway, the other devices show **The presenting device is not responding** and offer **Carry on here** (D18). On return, it follows whoever carried on (D14). No Android foreground service.
- **No new protocol version for phones and tablets.** They speak protocol 11 like a desktop. An optional `mobile` field in the capabilities makes followers say "presenting phone" or "presenting tablet". Older servers and desktops ignore it and say "computer". The app steps down to an older server as the desktop does (`negotiateProtocol`), and keeps support at least one release behind, because store reviews delay app updates. The promotion route is a new server route, not a protocol change: an older server answers 404 and the phone shows no promotion.
- **Desktop.** Serves the venue network in local mode: a `LanHost` for public-server workspaces, with grants checked on the coordinator and an mDNS advertisement carrying a local workspace identifier. Thumbnails go to phones over the LAN when they are connected there. QR codes point to the router. "Presenting phone" wording.
- **Router.** One static HTML page with its script, `/.well-known/apple-app-site-association` (applinks for `/j`, served as JSON with no redirect), and `/.well-known/assetlinks.json` (the Android package and signing certificate). Hosted on the public server's host. The page's **Open in Worship Q** uses the custom scheme `worship-q://j#…`, because iOS ignores a universal link to the page's own domain.
- **Permissions.** Camera (scanner); local network (iOS prompt with `NSBonjourServices` listing `_worship-q._tcp`; Android 17 `ACCESS_LOCAL_NETWORK`); background audio for listening with the screen locked. Each is asked when first needed, with a sentence saying why.
- **Security** is unchanged: TLS with pinned fingerprints and a device token or grant on every connection (criterion 32); approval with the four-digit code for every new remote control; operator access only by an administrator; credentials in the keychain.

## 5. Decisions

Numbers are the discovery's, with N17 onwards added here.

| # | Topic | Decision |
| --- | --- | --- |
| N1 | Framework | Tauri 2 mobile, as iOS and Android builds of `apps/desktop`. **Proposed.** |
| N2 | Venue network in local mode | The desktop serves it without a church server, so phones reach it with no internet. **Proposed.** |
| N3 | Apple TV app | Not built: tvOS cannot show websites or YouTube. AirPlay from a phone, tablet or Mac instead. **Agreed.** |
| N4 | Coordination | An operator phone or tablet coordinates for other devices. A desktop stays the recommended coordinator for a venue. **Agreed.** |
| N5 | Operator access for phones | By promotion from the admin app (N18), not by pairing codes. Computers keep D29. **Agreed.** |
| N6 | Google Play account | An organisation account in the same legal name as the Apple membership: the D-U-N-S number Apple's enrolment used, and no 12-tester closed test. **Agreed.** |
| N7 | Router hosting | Static files on the public server's host; GitHub Pages cannot carry a second domain or serve the association file as JSON. **Proposed.** |
| N8 | Android TV and Google TV | Not planned; cabled screens through the Android app. **Proposed.** |
| N9 | Publisher | The existing Apple developer organisation, same legal name, in both stores. **Agreed.** |
| N10 | Workspaces listed from the venue Wi-Fi | Not built. Added by scan only. **Agreed.** |
| N11 | Store name | **Worship Q.** Availability checked at M6. **Agreed.** |
| N12 | Minimum versions | iOS and iPadOS 17; Android 10 (API 29). **Agreed.** |
| N13 | Scanning a workspace already on the device | Opens it, whatever its access, and sends no request; if its access ended, asks again. **Agreed.** |
| N14 | Phone coordinator in the background | The same on iOS and Android: keep the screen awake while presenting, and fall back to **Carry on here** when the app goes to the background. No Android foreground service. **Agreed.** |
| N15 | Release order | Remote control first (after M2), operator features in a later release. One app. **Agreed.** |
| N16 | Presenter Mode orientation | Landscape only, turning on its own; the rest of the app turns with the phone. **Agreed.** |
| N17 | One mode | No separate operator and remote control modes. A workspace list where each workspace has an access level, and one set of screens showing what it allows. **Agreed.** |
| N18 | Promotion | An administrator makes a remote-control phone or tablet an operator of that workspace in the admin app; the phone picks it up from the church server. Church server only. **Agreed.** |
| N19 | Shared phone screens | Built once in M2 over a workspace source with remote and operator implementations, porting `apps/remote`'s components. About a third more work in M2, none repeated in M4. **Agreed.** |
| N20 | Removing operator access | Ends the device token; the workspace stays listed and a scan asks to control it again. **Proposed.** |
| N21 | Who can promote | Administrators only, in the admin app. Workspace operators cannot, as the spec reserves permanent access for administrators (§4). **Agreed.** |

## 6. Open questions

None at present.

## 7. Milestones

Sizes are relative (S, M, L), not time estimates. Every milestone adds unit tests for its logic in the packages, as earlier phases did; the device walkthrough is M7.

### M0 — Spike (S)

Throwaway code on an iPhone, an iPad and an Android phone:

- A Tauri mobile shell connecting to a desktop coordinator over the LAN through `lan.rs` with the fingerprint, with no internet; mDNS browse and advertise on both platforms.
- The same shell **serving** the LAN, reached by a desktop; how soon iOS and Android suspend it in the background, and that followers see it go.
- A universal link and an App Link carrying the fragment into the app; both opening offline after install.
- The external display: iOS scene by cable and by AirPlay to an Apple TV on the iOS 27 SDK, Android `Presentation` by cable, each with a website and a YouTube item playing.
- The keychain on Android, and the font list on iOS.

**Done when:** each item works, or the gap and its workaround are written down.

### M1 — Link router (S)

- The page, the two association files, and hosting on the public server's host.
- The desktop's QR codes point to the router.

**Done when:** a camera scan on a phone without the app shows the church's domain and reaches its phone page; an old QR code still works.

### M2 — The app with remote control (L)

- The mobile app shell, the workspace list, the in-app scanner, link handling, scan routing (N13).
- The workspace source interface and its remote implementation; the shared phone and tablet screens for everything a remote control does.
- On the LAN first and the relay as fallback; grants in the keychain.
- Live audio listening with the screen locked.

**Done when:** a phone on the venue Wi-Fi with no internet moves the slides, adds a song and listens; after a restart, the workspace opens from the list without a scan; scanning it again opens it. G15 and G16 closed; criteria 5 and 24 for phones.

### M3 — Desktop: venue network in local mode (M)

- `LanHost` for public-server workspaces, grants checked on the coordinator, mDNS with a local workspace identifier, LAN addresses in the invitation.
- Thumbnails to phones over the LAN.

**Done when:** M2's checks pass against a computer with no church server.

### M4 — Operator features, local workspace (L)

- The operator implementation of the workspace source over the desktop's session and store.
- The operator parts of the screens: calendar, run sheets, songs, settings.
- Local workspaces, Presenter Mode, the external display plugin, public server features.

**Done when:** a phone with no account creates a workspace, adds songs and presents while mirrored and on an external display; it also controls another workspace as a remote control, with separate permissions. G17 closed; criteria 10, 23 and 33.

### M5 — Promotion and coordinating (L)

- Server: grants kept while valid; **Make operator** and the waiting enrolment; `GET /api/v1/promotion`; **Remove operator**.
- Admin app: the workspace's phones and tablets, **Make operator**, operator phones listed with the computers.
- App: picking up the promotion, pulling the workspace, switching the workspace's source; synchronization; approving phones with its own invitation; serving the venue network; live-state backup.
- The fall-back to **Carry on here** when the app goes to the background; the `mobile` capability and "presenting phone" wording on every device.

**Done when:** a phone added by scan is made an operator in the admin app and gains the operator features without a new scan; a tablet promoted the same way coordinates a service with a desktop in viewer mode and two phones on the venue Wi-Fi with no internet; when the tablet goes to the background, the desktop carries on. Criteria 9 and 32 with a mobile coordinator; criterion 16 for a promoted phone.

### M6 — Store release (M)

- App Store: TestFlight, privacy label, review notes with a demo of the local workspace.
- Google Play: the organisation account (N6), the listing, review.
- The website's download page gains the store links.

**Done when:** **Worship Q** is in both stores.

### M7 — Acceptance pass (S)

A walkthrough at a rehearsal recorded in `docs/acceptance/native-apps.md`: remote control on iPhone and Android with and without internet; a camera scan with and without the app; promotion in the admin app and removing it; Presenter Mode mirrored and on an external display, including AirPlay to an Apple TV; a tablet as coordinator with the background hand-over; a phone with a local workspace and a remote-control workspace.

## 8. Order and dependencies

M0 first. M1 and M3 can run beside M2. M2 is the first release (N15), and its store work (M6) starts with it: Google's D-U-N-S check on the Play organisation account can take weeks, and App Review the first time takes longest. M4 builds on M2's screens; M5 on M4. M7 closes each release: a short pass after M2, the full pass after M5.

## 9. Rollout

- **First release: the app with remote control,** with the router and the desktop's local-mode venue network. Desktops update first so their QR codes point to the router. Church servers need no update.
- **Second release: operator features.** Local workspaces and coordinating need no church server or desktop update: a phone speaks protocol 11. **Promotion needs the church server and admin app updated** for the new route and page; until then, a church's phones stay remote controls. Desktops updated with the first release say "presenting phone"; older ones say "computer".
- The phone page stays: it is the router's fallback for phones without the app.
