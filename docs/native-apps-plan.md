# Worship Q — Native Apps Plan

**Drafted:** 22 November 2026
**Updated:** 23 November 2026 (local workspaces, N22–N25; plan review: one release, pairing in place of promotion, phone broadcasting, offline invitations, N26–N34)
**Status:** Plan agreed with the project owner; nothing is built. Tasks are to be broken down milestone by milestone, starting with the M0 spike. N1 is confirmed or reopened by M0 (N34).
**Source:** the [native apps discovery](native-apps-discovery.md) of 22 November 2026 and the owner's answers recorded there and here. Where the two differ, this plan is the later decision. The [spec](worship-q-requirements-and-architecture.md) §2 (application distribution, QR entry points), §3 (local-only mode), §4 (devices and roles), §10 (connectivity), §12 (phone-to-TV), §16 (native mobile) and acceptance criteria 5, 9, 10, 11, 16, 23, 24, 32 and 33; the [phase 3 plan](phase-3-plan.md) §7 "Phase 4 — Phones"; the code at version 2.14.0 (protocol version 11).

## 1. Where the implementation stands

- **No phone app exists.** A phone is a web page (`apps/remote`) served by the church server, or by the public server for a computer in local mode. It controls the slides through the server's relay, so it needs the internet even at the venue: phone browsers refuse the coordinator's self-signed certificate. This is phase 2's one known exception.
- **QR codes point straight at the server** (`cloud.ts:1409`): `https://<server>/remote/?w=<workspace>#i=<invite>&f=<fingerprint>&a=<addresses>&p=<port>`. `remoteLink()` returns nothing without a server and a workspace server identifier, so a workspace with no internet cannot invite anyone today. `app.worship-q.com` is not deployed, so no installed app could open from a camera scan (G15).
- **A phone's approval already lasts until an operator disconnects it.** The grant is kept by the coordinator in its own database, and with a church server mirrored to the server with the live-state backup (D25). The phone page loses it only because it keeps its copy in browser storage, which phones clear (G16).
- **No local workspace or Presenter Mode on a phone** (G17).
- **The venue network is served only with a church server.** A computer in local mode builds no `LanHost` (`cloud.ts:1700`).
- **Pairing already does what a phone needs for operator access** (D29). A device asks the instance, shows a code and a QR code of the admin app's link, and polls. An administrator approves it into a workspace, names it, and chooses whether it may keep its own content (`allowMerge`). The server keeps the token until the device first uses it, so a lost response does no harm.
- **The desktop is Tauri 2: React and TypeScript on a Rust core.** The core already serves and connects TLS WebSockets with a pinned certificate fingerprint (`lan.rs`), advertises and browses mDNS, and holds SQLite, files, media and the keychain. The application layer (`apps/desktop/src/app`, about 22,000 lines of TypeScript with the screens) runs the live state, coordination, synchronization, the public server and remote control.
- **Apple Developer membership exists,** an organisation's, used to notarise the macOS build.

## 2. The request

Native apps for iPhone, Android phones, iPad and Android tablets, and the link router, so that:

- a phone on the venue Wi-Fi controls the slides with no internet;
- a camera scan of the invitation QR code opens the installed app, or the church's phone page when the app is not installed;
- a phone or tablet can do what the desktop does: keep a workspace, prepare songs and run sheets, present, and hold the presentation that other devices follow.

**Agreed requirements (22 and 23 November 2026)**

- **One app, one way of working.** The device holds a list of workspaces. Each workspace has an access level: **Remote control** (like today's web remote) or **Operator** (like the desktop app). A remote control is an operator with fewer permissions, not a separate mode.
- **Scanning a QR code adds the workspace,** shown by a desktop or another phone or tablet, as a remote control after an operator approves. Scanning one already in the list opens it.
- **A phone or tablet requests full access as a desktop does,** by pairing with the church server and an administrator's approval. There is no separate promotion mechanism.
- **An operator phone or tablet can coordinate for other devices**: phones, desktops in viewer mode and other operators.
- **Presenter Mode turns with the device** (N16, revised).
- **No Apple TV app.** A native tvOS app cannot show websites or YouTube items, and an app that cannot show everything is not built. An Apple TV shows the slideshow by AirPlay from a phone, tablet or Mac.
- **No list of workspaces found on the venue Wi-Fi.** A workspace is added by a scan only.
- **Published by the same organisation, under the same legal name,** as the existing Apple Developer membership, in both stores. The app is called **Worship Q**.
- **Minimum versions:** iOS and iPadOS 17; Android 10 (API 29).
- **One public release, after every feature here is built.** The work is still broken down with remote control first.

## 3. Features

### The workspace list

The home screen lists the device's workspaces, each with its church (or **On this device**), its access level as a quiet label, and whether it is presenting now. Below the list: **Scan a QR code** and **New local workspace**. The app reopens the workspace last used.

- **Adding by scan.** A camera scan through the link router, or the in-app scanner, which also reads a direct link to a church server (N31). The phone asks for a name the first time, sends the request, and shows **Waiting for approval** with the four-digit code, as today. On approval the workspace joins the list as **Remote control**.
- **Scanning a workspace already in the list** opens it and sends no request. The match is on the server's host and the workspace's server identifier, or on the permanent identifier for a local workspace (N22), never the name. If the workspace's access has ended, the scan asks for approval again.
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
| OBS buttons, when a desktop of the workspace is linked to OBS | Yes | Yes |
| Listen to live audio | Yes | Yes |
| Calendar, other dates, Go live, Edit run sheet, copy Append and Replace | | Yes |
| Songs: write and edit lyrics, backgrounds, slide decks, photos, videos | | Yes |
| Settings: typography, backgrounds, outputs, connected devices, viewer mode | | Yes |
| **Present on this device** and the external display | | Yes |
| Coordinate: hold the presentation, show an invitation QR code, approve phones, serve the venue network | | Yes |
| Broadcast live audio while the app is on screen, recorded when the church server takes recordings | | Yes |
| A copy of the workspace on the device, usable offline | | Yes |

A remote control works only while it reaches the coordinator; an operator keeps its copy and works offline (criterion 5).

### Operator features

- **Prepare** as on the desktop: calendar, run sheets, songs with the lyrics editor, backgrounds, Bible passages, slide decks and photos, videos, websites. Settings are a reduced set.
- **Present on this device.** Presenter Mode: clean slides full screen, turning with the device, swipe to move (as a clicker's Page Down and Page Up), tap to show controls for a few seconds; a presented website or video takes no touches, so a tap never pauses it (spec §12; criteria 10, 33). Websites and YouTube items show here too.
- **External display.** The slideshow on a projector or TV, with the controls on the device. iPhone and iPad: by cable or AirPlay, including to an Apple TV. Android: by cable. Everything the desktop slideshow shows, websites and YouTube included.
- **Coordinate.** Hold the live state; show a rotating invitation QR code and approve phones (D25); serve the venue network to phones, desktops and other operators; back up the live state to the church server; **Use this device** and **Carry on here** as on the desktop.
- **Broadcast live audio (N28).** From the device's microphone or a connected USB input, with the desktop's input picker, level meter and built-in microphone warning. It runs only while the app is on screen. If the system interrupts it, the broadcast status says so and listeners see it stop.
- **Record the broadcast (N28).** As on the desktop (service records R3–R9): when the church server takes recordings, the broadcasting device records its capture track and uploads it in chunks, and chunks wait on the device while it is offline. An interruption ends one recording, and the next run is a new one. The text under the broadcast switch says the broadcast is recorded (R6), so the reduced Settings keep it.
- **A local workspace** uses the public server as a desktop does: remote control through its relay, Bible, slide decks, live audio.
- **Not on phones and tablets at first:** connecting to OBS and the subtitle overlay page (OBS runs on a computer), the local API.

### Full access by pairing

- **Where it starts.** A remote-control workspace of a church has **Request full access**. A local workspace has **Connect to a church**, as on the desktop. A workspace on the public server has no administrator, so a phone controlling a local desktop stays a remote control.
- **The request.** The same flow as a computer (D29, D30): the phone shows the eight-character code and the admin link's QR code, with a share button for an administrator using this same phone, and waits. An instance that still uses connection codes takes a code instead, as the desktop's `probe` decides.
- **The approval.** In the admin app, unchanged. The administrator chooses the workspace, names the device and decides whether it may keep its own content. The phone then appears with the computers on the Devices page.
- **From a remote-control workspace (N26).** The phone makes a new empty folder and pulls the workspace by the normal synchronization. It has nothing to merge.
- **From a local workspace (N23).** As on the desktop: a backup is saved first, and that workspace joins the church, with **Keep both** offered only if the administrator allowed it. Phones that controlled it as a local workspace scan its new invitation.
- **If the administrator chooses a different workspace (N27).** When the approved workspace matches the remote-control entry, that entry becomes **Operator** and the phone ends its old grant with the existing `grantRevoke`. Otherwise the approved workspace is a new entry and the remote-control entry stays as it was.
- **Removing operator access (N20).** An administrator removes the device on the Devices page, as for a computer. The workspace stays in the phone's list with a note, and a scan asks to control it again.

### Local workspaces

A local workspace has one operator, the device that holds it. Remote controls join it as they join any workspace, and their approvals are kept on that device. Four things differ from a church workspace:

- **A permanent identifier (N22).** The device makes it when the workspace is created, with no network. The list and the venue network use it, and invitations carry it as `l` (N29). The public server's workspace identifier becomes only a relay address, which can change: the server forgets a workspace after 90 days unseen. After that, a scan updates the same list entry and sends no request, provided the invitation's fingerprint matches the one the phone remembers. If it does not, the phone asks for approval.
- **Moving to a church (N23).** By pairing from inside the workspace, as above.
- **Backup (N24).** The phone holds the only copy, and the public server stores no content. **Export backup** saves a file through the share sheet, in the desktop's backup format.
- **When the app leaves the screen (N25).** No other device can carry on. Remote controls show "Waiting for [device] to come back" and reconnect by themselves.

A phone and a computer do not share a local workspace; sharing between devices is what a church server is for.

### Tablets

The same app with wider layouts: run sheet, slide and preview side by side; the full song editor with a keyboard.

### The link router

- `https://app.worship-q.com/j#s=<server host[:port]>&w=<workspace>&l=<local identifier>&i=<invite>&f=<fingerprint>&a=<addresses>&p=<port>`. The whole invitation is in the fragment, which browsers never send, so the router never receives church data (criterion 11).
- **What an invitation carries (N29).** A church workspace: `s`, `w`, `i`, and the LAN hints `f`, `a`, `p` when known. A local workspace online: all of them with `l`. A local workspace with no internet: `l`, `i`, `f`, `a`, `p`, with no `s` or `w`.
- **With the app installed,** the camera opens it directly, with no network, so joining a coordinator on the venue Wi-Fi works offline.
- **Without the app,** the page shows "This invitation is for **church.example.org**" and offers **Continue to church.example.org** (today's phone page, unchanged) and the store links. It never forwards on its own (criterion 24).
- **Without the app and without `s`,** there is no phone page to continue to. The page says this presentation needs the Worship Q app, and offers the store links.
- **Addresses the router does not carry (N31).** `s` is a host name with an optional port. A server whose address uses `http://`, an IP address or a path keeps a direct QR code to its phone page, as today. The in-app scanner reads those too.
- In English, Simplified Chinese and Traditional Chinese, following the browser.

## 4. Proposed design

- **One Tauri project.** The mobile app is iOS and Android builds of `apps/desktop`, reusing its application layer, Rust core and every package. New code is the phone and tablet screens, the workspace list, and small platform plugins.
- **One set of phone screens over a workspace source.** The screens read and act through one interface: the live run sheet, the slide on screen, commands, search, Bible, OBS, live audio, thumbnails, and, for operators, the editing and settings the desktop has. Two implementations:
  - **Remote source:** `RemoteView` and `RemoteCommand` over the LAN or the relay, as the phone page speaks today. Ported from `apps/remote/src/connection.ts`, with the Rust LAN client and the desktop's `Transport` in place of the browser WebSocket.
  - **Operator source:** the desktop's session, live link and store for that workspace's folder.

  Remote-only screens are never written; the operator-only parts are hidden for a remote source. `apps/remote` stays as the browser page and shares components with the app where it can.
- **Desktop screens.** The desktop's pages are split from its application layer where they are not already. The desktop's own layouts do not change.
- **Rust core on mobile.** Kept: `lan.rs` (serving and connecting), `db.rs`, `workspaces.rs`, `files.rs`, `media.rs`, `cloud.rs`, `instances.rs`, `power.rs`, `web.rs` (website titles). Replaced by platform plugins where the spike shows they are needed: mDNS on iOS (`NWBrowser` and `NWListener` behind `lan_browse` and `lan_advertise`), `keychain.rs` on Android (Keystore), `fonts.rs`'s font list (a platform call instead of `fontdb`), and `output.rs`'s windows, monitors and second web view (the external display plugin). Left out: `overlay.rs`, `obs.rs`, and the desktop-only updater and window-state plugins, which are gated off in mobile builds. The app updates through the stores.
- **Websites in the slideshow.** The desktop's second web view does not exist on mobile. One platform plugin hosts a native web view for a presented website, both over Presenter Mode on the device and in the external display's scene or `Presentation`. Each device can set its own scale for websites (N35), applied to that web view.
- **Workspaces on the device.** Each operator workspace is a folder with its database, as on the desktop. A remote workspace keeps only what identifies it: server host, workspace server identifier or permanent identifier, name, the trusted fingerprints and last addresses, and the grant in the keychain.
- **Pairing.** The desktop's pairing client and server routes, with no server or admin app change. The phone's device token goes in the keychain. After approval it applies N26 or N23, and N27.
- **Trusting a new coordinator with no internet (N30).** A phone first trusts the fingerprint in its invitation. While connected over that pinned channel, the coordinator sends the fingerprints of the workspace's operator devices it knows, in an optional field of the phone's view, and the phone replaces its stored list each time. mDNS and remembered addresses say only *where* to connect. The certificate must match the stored list, and a fingerprint from mDNS alone is never trusted (criterion 32). Against an older desktop, which sends no list, the phone uses the relay or asks for a scan.
- **A phone coordinator in the background, the same on iOS and Android.** Both suspend an app's network soon after it leaves the screen. While presenting, the app keeps the screen awake, and an external display keeps it active. When it goes to the background anyway, the other devices show **The presenting device is not responding** and offer **Carry on here** (D18). On return, it follows whoever carried on (D14). No Android foreground service.
- **No new protocol version for phones and tablets.** They speak protocol 11 like a desktop. An optional `mobile` field in the capabilities makes followers say "presenting phone" or "presenting tablet". Older desktops ignore it, and an older relay strips it, so through an older church server every device says "computer" until that server is updated. The app steps down to an older server as the desktop does (`negotiateProtocol`), and keeps support at least one release behind, because store reviews delay app updates.
- **Desktop.** Serves the venue network in local mode: a `LanHost` for public-server workspaces, with grants checked on the coordinator and an mDNS advertisement carrying the permanent identifier. Invitations that work with no internet (N29). The list of fingerprints for phones (N30). Thumbnails go to phones over the LAN when they are connected there. QR codes point to the router, except for addresses it does not carry (N31). "Presenting phone" wording.
- **Router.** One static HTML page with its script, `/.well-known/apple-app-site-association` (applinks for `/j`, served as JSON with no redirect), and `/.well-known/assetlinks.json` (the Android package and signing certificates). Hosted on the public server's host. The page's **Open in Worship Q** uses the custom scheme `worship-q://j#…`, because iOS ignores a universal link to the page's own domain.
- **App identity and releases (N32, N33).** The iOS and iPadOS bundle identifier is `com.worship-q.app` and the Android package is `com.worship_q.app`, following the project's domain, `worship-q.com`, as the desktop's `com.worship-q.desktop` does. Android package names cannot contain a hyphen. Both are set in a mobile Tauri configuration over the desktop's, and registered at M0 because neither can change after the first upload. The app takes its version from the repository's release, with a build number from CI. A separate manual workflow builds, signs and uploads to TestFlight and Google Play's internal track, so a desktop release never submits to a store.
- **Permissions.** Camera (scanner); local network (iOS prompt with `NSBonjourServices` listing `_worship-q._tcp`; Android 17 `ACCESS_LOCAL_NETWORK`); microphone (broadcasting); background audio for listening with the screen locked. Each is asked when first needed, with a sentence saying why.
- **Security** is unchanged: TLS with pinned fingerprints and a device token or grant on every connection (criterion 32); approval with the four-digit code for every new remote control; operator access only by an administrator; credentials in the keychain.

## 5. Decisions

Numbers are the discovery's, with N17 onwards added here.

| # | Topic | Decision |
| --- | --- | --- |
| N1 | Framework | Tauri 2 mobile, as iOS and Android builds of `apps/desktop`. **Proposed,** confirmed by M0 (N34). |
| N2 | Venue network in local mode | The desktop serves it without a church server, so phones reach it with no internet. **Proposed.** |
| N3 | Apple TV app | Not built: tvOS cannot show websites or YouTube. AirPlay from a phone, tablet or Mac instead. **Agreed.** |
| N4 | Coordination | An operator phone or tablet coordinates for other devices. A desktop stays the recommended coordinator for a venue. **Agreed.** |
| N5 | Operator access for phones | By the same pairing as computers (D29), approved by an administrator. **Agreed 23 November 2026,** replacing promotion. |
| N6 | Google Play account | An organisation account in the same legal name as the Apple membership: the D-U-N-S number Apple's enrolment used, and no 12-tester closed test. **Agreed.** |
| N7 | Router hosting | Static files on the public server's host; GitHub Pages cannot carry a second domain or serve the association file as JSON. **Proposed.** |
| N8 | Android TV and Google TV | Not planned; cabled screens through the Android app. **Proposed.** |
| N9 | Publisher | The existing Apple developer organisation, same legal name, in both stores. **Agreed.** |
| N10 | Workspaces listed from the venue Wi-Fi | Not built. Added by scan only. **Agreed.** |
| N11 | Store name | **Worship Q.** Availability checked at M6. **Agreed.** |
| N12 | Minimum versions | iOS and iPadOS 17; Android 10 (API 29). **Agreed.** |
| N13 | Scanning a workspace already on the device | Opens it, whatever its access, and sends no request; if its access ended, asks again. **Agreed.** |
| N14 | Phone coordinator in the background | The same on iOS and Android: keep the screen awake while presenting, and fall back to **Carry on here** when the app goes to the background (for a local workspace, N25). No Android foreground service. **Agreed.** |
| N15 | Release order | One public release after M0–M5. The milestones still build remote control first. **Agreed 23 November 2026.** |
| N16 | Presenter Mode orientation | Turns with the device, like the rest of the app; no orientation is forced. Landscape only was meant to stop slides flipping when a device is moved during a service, but a service that matters shows on an external display, which does not turn. M0 also found that iPadOS 26 no longer lets an app force landscape, only lock the orientation it is in. **Agreed,** revised 24 November 2026. |
| N17 | One mode | No separate operator and remote control modes. A workspace list where each workspace has an access level, and one set of screens showing what it allows. **Agreed.** |
| N18 | Promotion | **Withdrawn 23 November 2026.** No **Make operator**, promotion route or grants kept on the server. See N5. |
| N19 | Shared phone screens | Built once in M2 over a workspace source with remote and operator implementations, porting `apps/remote`'s components. About a third more work in M2, none repeated in M4. **Agreed.** |
| N20 | Removing operator access | An administrator removes the device, as for a computer. The workspace stays listed and a scan asks to control it again. **Agreed.** |
| N21 | Who approves full access | Administrators only, in the admin app, as the spec reserves permanent access for administrators (§4). **Agreed.** |
| N22 | Local workspace identity | A permanent identifier made on the device, used by the list, the venue network and invitations. The public server's identifier is only a relay address; a new one needs a scan but no new approval, if the fingerprint matches. **Agreed.** |
| N23 | A phone's local content moving to a church | Pairing from inside the local workspace, as on the desktop: a backup first, then **Keep both** if the administrator allowed it. **Agreed 23 November 2026.** |
| N24 | Backup of a phone's local workspace | **Export backup** through the share sheet, in the desktop's format. **Agreed.** |
| N25 | Local workspace in the background | No **Carry on here**, as there is no other operator. Remote controls wait and reconnect by themselves. **Agreed.** |
| N26 | Requesting full access from a remote-control workspace | A new empty folder, filled by synchronization. Nothing to merge. **Agreed.** |
| N27 | The administrator approves a different workspace | If it matches, the entry becomes Operator and its grant ends. If not, a new entry, and the remote-control entry is unchanged. **Agreed.** |
| N28 | Broadcasting and recording from a phone or tablet | Both included, while the app is on screen. Recording follows the desktop's service records rules; M0 settles where waiting chunks are kept on a phone. **Agreed.** |
| N29 | Invitations with no server | A new `l` field for the permanent identifier; `s` and `w` optional. Without `s`, the router says the app is needed. **Agreed.** |
| N30 | Trusting a new coordinator offline | The coordinator sends its operator devices' fingerprints over the pinned connection. mDNS never establishes trust. **Agreed.** |
| N31 | Server addresses and the router | `s` carries a host and optional port. Other addresses keep a direct QR code, which the in-app scanner also reads. **Agreed.** |
| N32 | App identifiers | iOS and iPadOS `com.worship-q.app`; Android `com.worship_q.app`, as package names cannot contain a hyphen. No published app used either on 23 November 2026; registering them at M0 is the real check. **Agreed.** |
| N33 | Mobile release process | A separate manual signing and upload workflow, the repository's version, and a CI build number. **Agreed.** |
| N34 | When M0 reopens N1 | Tauri is reconsidered if the Rust core cannot run on iOS or Android, if pinned LAN connecting or serving cannot work on either, or if the slideshow cannot be drawn on an external display. Any other gap is written down with its workaround. **Agreed.** |
| N35 | Website scale per device | Each device keeps its own scale for the websites it shows, in its device settings, because the same page needs a different size on a phone, a tablet, a TV and a projector. It applies to Presenter Mode and the external display, and to the desktop's slideshow. While a website other than a YouTube video is presenting, the preview box shows a small "− 100% +" control that changes this device's scale, in Chrome's steps from 25% to 500%: 25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400 and 500. The desktop part does not depend on the apps and can ship first. **Agreed.** |

## 6. Open questions

None are waiting for the owner. N1 is settled by M0 (N34). N2, N7 and N8 stand as proposed, and the work assumes them.

## 7. Milestones

Sizes are relative (S, M, L), not time estimates. Every milestone adds unit tests for its logic in the packages, as earlier phases did; the device walkthrough is M7.

### M0 — Spike (M)

First, register the app identifiers (N32) and put the two association files on `app.worship-q.com`, because universal links and App Links cannot be tested without them. Then throwaway code on an iPhone, an iPad and an Android phone:

- The Rust core building on both platforms: `reqwest` with its TLS backend on Android, and the desktop-only plugins gated off.
- A Tauri mobile shell connecting to a desktop coordinator over the LAN through `lan.rs` with the fingerprint, with no internet; mDNS browse and advertise on both platforms.
- The same shell **serving** the LAN, reached by a desktop; how soon iOS and Android suspend it in the background, and that followers see it go.
- A universal link and an App Link carrying the fragment into the app; both opening offline after install.
- The external display: iOS scene by cable and by AirPlay to an Apple TV on the iOS 27 SDK, Android `Presentation` by cable, each with a website and a YouTube item playing.
- A website and a YouTube item in Presenter Mode on the device.
- Live audio: listening over WebRTC in the web view with the screen locked; broadcasting from the built-in microphone and a USB input, with voice processing off, while charging; what interrupts it.
- Recording that broadcast: the format each platform's web view produces uploads and plays back; an interruption leaves whole recordings; waiting chunks survive a restart and low storage, or the queue moves to files through the Rust core with a lower limit if needed.
- The keychain on Android, and the font list on iOS.

**Done when:** each item works, or the gap and its workaround are written down. A failure named in N34 reopens N1 before any other work.

### M1 — Link router (S)

- The page with the `l` field and the no-`s` message; the final association files; hosting on the public server's host.
- The desktop's link builder for the router, kept switched off until the release (N15), with direct links for addresses the router does not carry (N31).

**Done when:** a router link scanned on a phone without the app shows the church's domain and reaches its phone page; a link with no `s` shows the app message; an old QR code still works.

### M2 — The app with remote control (L)

- The mobile app shell, the workspace list, the in-app scanner, link handling, scan routing (N13).
- The workspace source interface and its remote implementation; the shared phone and tablet screens for everything a remote control does.
- On the LAN first and the relay as fallback; grants in the keychain; the trusted fingerprint list on the app and the desktop (N30).
- Thumbnails to phones over the LAN.
- Live audio listening with the screen locked.

**Done when:** a phone on the venue Wi-Fi with no internet moves the slides, sees thumbnails, adds a song and listens; after a restart, the workspace opens from the list without a scan; scanning it again opens it; after the coordinator moves to another desktop with no internet, the phone reconnects with no scan. G15 and G16 closed; criteria 5 and 24 for phones.

### M3 — Desktop: venue network in local mode (M)

- The permanent local workspace identifier (N22), given to existing local workspaces on update; approvals kept when the public server's identifier changes.
- `LanHost` for public-server workspaces, grants checked on the coordinator, mDNS with the permanent identifier, LAN addresses and the identifier in the invitation.
- Invitations from a workspace with no internet (N29).

**Done when:** M2's checks pass against a computer with no church server, a computer with no internet invites a phone with the app, and after the public server forgets the workspace, a scan reopens the same list entry with no new approval.

### M4 — Operator features, local workspace (L)

- The operator implementation of the workspace source over the desktop's session and store.
- The operator parts of the screens: calendar, run sheets, songs, settings.
- Local workspaces with their permanent identifier, Presenter Mode, the external display and website plugin, public server features.
- Broadcasting live audio while on screen (N28).
- Website scale per device (N35).
- **Export backup** (N24), and the waiting message on remote controls (N25).

**Done when:** a phone with no account creates a workspace, adds songs and presents while mirrored and on an external display; it also controls another workspace as a remote control, with separate permissions; a workspace made with no internet invites a phone on the venue Wi-Fi, which listens to its broadcast; an exported backup restores on a desktop. G17 closed; criteria 10, 23 and 33.

### M5 — Pairing and coordinating (L)

- App: **Request full access** and **Connect to a church** over the desktop's pairing; N23, N26 and N27; synchronization; approving phones with its own invitation; serving the venue network; live-state backup; recording a broadcast to the church server (N28).
- The fall-back to **Carry on here** when the app goes to the background; the `mobile` capability and "presenting phone" wording on every device.

**Done when:** a phone added by scan requests full access, is approved in the admin app and gains the operator features without a new scan; a phone approved into a different workspace keeps both entries; a local workspace joins a church with **Keep both** only when allowed; a tablet paired the same way coordinates a service with a desktop in viewer mode and two phones on the venue Wi-Fi with no internet; when the tablet goes to the background, the desktop carries on; a broadcast from a paired phone, including a stretch offline, reaches the church server as a playable recording. Criteria 9 and 32 with a mobile coordinator; criterion 16 for a paired phone.

### M6 — Store release (M)

- The signing and upload workflow (N33).
- App Store: TestFlight, privacy label, review notes with a demo of the local workspace.
- Google Play: the organisation account (N6), the listing, review.
- The website's download page gains the store links.

**Done when:** **Worship Q** is in both stores.

### M7 — Acceptance pass (S)

A walkthrough at a rehearsal recorded in `docs/acceptance/native-apps.md`, before the public release: remote control on iPhone and Android with and without internet; a camera scan with and without the app; requesting full access, approval in the admin app, and removing it; Presenter Mode mirrored and on an external display, including AirPlay to an Apple TV; broadcasting and recording from a phone; a tablet as coordinator with the background hand-over; a phone with a local workspace and a remote-control workspace; that local workspace invited on the venue Wi-Fi with no internet, left in the background, backed up, and joined to a church.

## 8. Order and dependencies

M0 first, after the identifiers and association files it needs. M1 and M3 can run beside M2. M4 builds on M2's screens; M5 on M4. M7 follows M5, and the public release follows M7.

The account work in M6 starts at M0: Google's D-U-N-S check on the Play organisation account can take weeks, and the Play signing certificate must be added to `assetlinks.json`. Internal builds through TestFlight and Google Play's internal track can start after M2. App Review the first time takes longest, so the first submission goes in as soon as M5 is stable.

## 9. Rollout

- **One release: the whole app,** with the router and the desktop's local-mode venue network.
- **Order.** The router is live first. A desktop update follows, carrying the venue network and the router QR codes. The store apps are released once they are approved, and the desktop's QR codes switch to the router with that release, so nobody gets an extra tap before there is an app to open.
- **Church servers need no update.** The app uses existing routes, including pairing. Through an older server, devices say "computer" rather than "presenting phone".
- The phone page stays: it is the router's fallback for phones without the app.
