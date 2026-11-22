# Worship Q — Native Apps Discovery

**Date:** 22 November 2026
**Status:** Discovery. Nothing is built. The [plan](native-apps-plan.md) follows from it. Read from the code at version 2.14.0 (protocol version 11). **Decided 22 November 2026:** no Apple TV app (§5); two modes on phones and tablets, operator and remote control, with an operator phone or tablet able to coordinate for other devices (§4.2, §4.4), and a scan for a workspace the device already operates opening operator mode (N13); the publisher, no workspace list from the venue Wi-Fi, the store name and the minimum OS versions (§11, N9–N12).
**Source:** the project owner's request of 22 November 2026: native apps for iPhone, Android phones, iPad, Android tablets and Apple TV (slideshow only), and the link router. Also the [spec](worship-q-requirements-and-architecture.md) (§2 Application distribution, §3 Local-only mode, §4, §10, §12, §16), the [phase 3 plan](phase-3-plan.md) §7 "Phase 4 — Phones", [outstanding work](outstanding-work.md) §1 "Phones", the [public server plan](public-server-plan.md), and `apps/remote`, `apps/desktop` (`src/app/cloud.ts`, `src/app/lan.ts`, `src-tauri/src/lan.rs`), `packages/protocol`, `packages/renderer`.

The question: what it takes to put Worship Q on phones, tablets and the Apple TV as installed apps, and to send QR codes through `app.worship-q.com` so a camera scan opens the installed app, while reusing as much of today's code as possible.

## 1. Answer in short

**One Tauri 2 mobile app for phones and tablets (iOS, iPadOS, Android) and a static link router. No Apple TV app.**

- **Phones and tablets: Tauri 2 mobile, with two modes.** **Operator** mode is the desktop app on a phone or tablet: a workspace device (local, or paired to a church) that edits songs and run sheets, presents, approves phones, and can be the coordinator other devices follow. **Remote control** mode is today's phone page in the app. The desktop is already React and TypeScript on a Rust core, so the mobile app is the same Tauri project (`apps/desktop`) built for iOS and Android: operator mode reuses the desktop's application layer (`src/app`), Rust core and every `packages/*` module with phone and tablet screens; remote control mode reuses `apps/remote`. The Rust core already does what a phone browser cannot: a TLS WebSocket checked against a pinned certificate fingerprint (`lan.rs`), serving as well as connecting, plus mDNS, SQLite and the keychain. This removes phase 2's one known exception: **a phone on the venue Wi-Fi controls the slides with no internet.**
- **Apple TV: dropped.** tvOS has no WebKit, so a native TV app could not show websites or YouTube items, and WebM videos may not play. The owner decided that an Apple TV app that cannot show everything is not built (§5). An Apple TV can still show the slideshow, through AirPlay from an iPhone or iPad running the mobile app as an external display (§4.3).
- **Link router: a static page on `app.worship-q.com`,** plus the two association files that let the installed apps claim its links. The whole invitation stays in the URL fragment, so the router never receives it. The page shows the church's domain and offers **Open in Worship Q** and **Continue to [domain]**. Once the app is installed, scanning opens it directly, with no network, so joining a coordinator on the venue Wi-Fi works offline.
- **Desktop changes are small; the shared code changes more.** The venue network (LAN) is served today only when a church server is connected (`cloud.ts`: "A public workspace has one computer … no venue network"). For phones to reach a computer in local mode over the LAN, the desktop has to serve the LAN in local mode too. The desktop's screens assume a mouse and a wide window, so operator mode needs its own phone and tablet layouts over the same application layer.
- **Cost.** The project already has an Apple Developer membership (the macOS build is notarised, see `release.yml`), and the same membership covers iOS and iPadOS. Google Play is a one-off US$25, but a **personal** account must first run a 12-tester closed test for 14 days. Android also has new developer verification rules (§8).

Rough size, with tests: remote control mode about 2,000–3,000 lines on top of `apps/remote`; operator mode about 6,000–10,000 lines of phone and tablet screens and mobile plugins on top of the desktop's application layer (about 22,000 lines of TypeScript today) and Rust core; the router about 200 lines plus configuration; desktop changes about 400–700. Protocol version 12 for a `mobile` capability, so other devices know a coordinator may be suspended (§4.4).

## 2. What exists today

### The phone page (`apps/remote`)

A React page served by the church server, or by the public server for a computer in local mode, at `/remote/`. The QR code the desktop shows is built in `cloud.ts:1409`:

```text
https://<server>/remote/?w=<workspace server id>#i=<invite>&f=<fingerprint>&a=<addr,addr>&p=<port>
```

`connection.ts` reads the invite and the coordinator's LAN hints from the fragment. It keeps the grant in `localStorage`, one per workspace. It uses the LAN only if the browser has already accepted the self-signed certificate. In practice browsers do not accept it (phase 2 M0), so the phone goes through the relay and needs the internet. Everything the page does goes through `RemoteToHost` and `HostToRemote` in `packages/protocol`: navigation, edits by intent, search, Bible, OBS, live audio (WebRTC, which **does** reach a phone on the LAN) and thumbnails.

### The venue network (`lan.rs`, `lan.ts`)

- The coordinator serves the relay protocol over TLS WebSockets on port 47311, with a self-signed certificate for each workspace folder. It advertises `_worship-q._tcp` by mDNS.
- Clients check the certificate by SHA-256 fingerprint (`ServerCertVerifier` in Rust). They prove themselves with a device token, or with a phone's grant.
- The native side moves bytes and checks credentials. Relay logic runs in the interface (`LanHost`, `@worship-q/relay`).
- **Only with a church server.** A workspace using the public server builds no `LanHost` (`cloud.ts:1700`).

### Browser outputs (D22)

A per-output link holding a revocable token, made under Settings → Outputs and only with a church server. The page (`apps/output`) receives `OutputView`: a `LiveSnapshot` plus the output's `look` (font family, scale, background colour, file or built-in background, lines per piece, wrapping). It gets images and videos from the church server. The `ConnectedDevice` role `output` already exists.

### What the slideshow draws (`packages/renderer`)

- **Lyrics and passages.** `layout.ts` (432 lines) fits and wraps text with no browser dependency: the caller supplies a `Measure` function. `Slide.tsx` (756 lines) composes it with CSS.
- **Slide decks and photos:** images, `Deck { width, height, pages }`.
- **Uploaded videos**, with one shared clock (`LiveVideo`: position at a time, playing, `resumeOnUnblank`).
- **Websites and YouTube** in a second web view, with YouTube captions since protocol 11.
- **Backgrounds:** a colour, an image, a video, or the built-in **Default** aurora (`aurora.ts`, canvas radial gradients on a 30-second clock).

### What the spec already settles

- Native apps are the owner's preference (§16). App store fees "have not been checked" (now checked, §8).
- Offline LAN control is for desktop and native apps only (§10).
- `app.worship-q.com` is a link router, not a web client. The apps declare that one domain. The page must show the destination domain before forwarding (§2).
- A phone can present in Solo mode with a local workspace (§3, §12). How it gets the client is open, and this discovery answers it: the installed app.
- Whether a native mobile app can serve LAN clients is open (§10). Decided yes, in operator mode (§4.4, N4).

## 3. Platform facts checked

Checked on 22 November 2026. Items marked *to confirm* go into the M0 spike.

| Fact | Effect here |
| --- | --- |
| tvOS has no WebKit: no `WKWebView` | A TV app could not show websites or YouTube items, so the Apple TV app is dropped (§5) |
| Tauri 2 mobile targets iOS and Android, not tvOS. Official plugins include barcode scanner (camera QR) and deep link | Reuse the desktop stack on phones and tablets |
| iOS: an app can put its own window on an AirPlay or cabled display through the external-display scene role, which ends mirroring. Reports say apps built with the iOS 27 SDK must register a scene accessory (*to confirm*) | "Controls on the phone, clean lyrics on the TV" (spec §12) works on iPhone and iPad, including to an Apple TV by AirPlay. The web view draws everything the desktop's slideshow does, websites and YouTube included |
| Android: `Presentation` on a second display (HDMI or USB-C). Casting to a Chromecast mirrors the screen only | External display on Android tablets with a cable only |
| Android 17 (API 37): apps targeting it must request `ACCESS_LOCAL_NETWORK` for mDNS and local sockets. The NSD system picker is exempt | A runtime prompt on Android, like iOS's local-network prompt. Target-SDK deadlines will force it |
| iOS: local-network prompt, with `NSLocalNetworkUsageDescription` and `NSBonjourServices` listing `_worship-q._tcp` | Plan the first-run explanation |
| Universal links (iOS) and App Links (Android) come from files on the domain: `apple-app-site-association`, fetched through Apple's CDN, which does not follow redirects; and `assetlinks.json`, verified at install. After that, a link opens the app without fetching anything (*confirm offline* on both) | Camera scan works offline once installed |
| iOS does not open a universal link tapped on a page of the same domain | The router page's **Open in Worship Q** button needs a custom scheme (§6) |
| Apple Developer Program US$99 a year; one membership covers iOS, iPadOS and macOS. Fee waiver only for nonprofit, educational or government **legal entities**, not individuals, and only for free apps | Already paid for the notarised macOS build |
| Google Play: US$25 once. Organisation accounts need a D-U-N-S number, which can take up to 28 days. Personal accounts made after 13 November 2023 need a closed test with 12 testers opted in for 14 days before production | Plan the closed test or an organisation account (N6) |
| Android developer verification: installs on certified devices need a verified developer. Enforced from 30 September 2026 in Brazil, Indonesia, Singapore and Thailand; worldwide in 2027 | Also affects side-loaded APKs from GitHub Releases |

## 4. Phones and tablets

### 4.1 Options

| Option | Reuse | Against |
| --- | --- | --- |
| **Tauri 2 mobile** (recommended) | The desktop's whole application layer and Rust core (`lan.rs` server and client, mDNS, `db.rs`, `workspaces.rs`, `files.rs`, `media.rs`, `keychain.rs`, `power.rs`); every TypeScript package; React screens from `apps/remote` and parts of the desktop | Young mobile ecosystem; native features (external display, background audio, keychain on Android) need small Swift/Kotlin plugins; the system web views differ, as on desktop |
| Capacitor | All TypeScript and React | Loses the Rust core: the pinned-fingerprint TLS WebSocket, mDNS and SQLite would be rewritten as native plugins in two languages |
| React Native | Packages without DOM (`protocol`, `lyrics`, `live-state`, `session`, `relay`, `sync`, `layout.ts`) | Every screen rewritten; renderer rewritten; two UI codebases to keep matching |
| Swift and Kotlin apps | None beyond the protocol | Two more codebases beside the desktop. Not reasonable for one maintainer |

Tauri wins because operator mode is the desktop app, and the desktop app is Tauri: its application layer and Rust core move over, and only screens and a few platform plugins are new. The one thing a phone browser cannot do, a fingerprint-checked TLS connection to the coordinator, is already written in Rust. It is also the spec's own first candidate (§15, §16).

Risks for the spike. First, the `keyring` crate's `apple-native` feature covers iOS, but Android needs a Keystore plugin. Second, `tokio`, `rustls` and `mdns-sd` must work under iOS's network rules. mDNS on iOS may need `NWBrowser` (Network framework) instead of raw multicast, which also needs the multicast entitlement. That would be a small Swift plugin behind the same `lan_browse` command. Third, the desktop shows a presented website in a second web view (`unstable` multi-webview); on a phone the external display is a separate native window, so the slideshow window there needs a plugin that hosts its own web view (§4.3). Fourth, `fontdb` reads font files from disk, which iOS does not allow for system fonts, so the font list comes from a platform call instead. Not needed on mobile: `overlay.rs` (OBS on the same computer) and, at first, `obs.rs`.

### 4.2 Two modes

The home screen from spec §4 lists what this phone or tablet can do, and each entry opens in one of two modes. Starting to present as an operator leaves remote control, so gestures never affect the wrong workspace (spec §4).

**Operator** (like the desktop app):

- A **workspace device**: a local workspace with no church (spec §3), or a church device paired as the desktop is (D29), with songs, run sheets, settings and backgrounds synchronized as on a desktop. Several workspaces, each in its own folder, as on the desktop.
- **Edit** songs and run sheets, Go live, present, blank. The calendar, songs, run sheet and present pages get phone layouts; settings get a reduced set (outputs, typography, backgrounds, connected devices).
- **Present on this device**: Presenter Mode (spec §12), with swipe navigation and controls that are hidden until a tap, or the slideshow on an external display with the controls on the device (§4.3).
- **Coordinate**: hold the live state, approve phones (its own rotating invitation QR, D25), and serve the venue network to phones, desktops in viewer mode and other operators (§4.4).
- Local mode uses the public server as a desktop does (remote control through its relay, Bible, slide decks, live audio).
- Left out at first: OBS control and the subtitle overlay page (OBS runs on a computer), live audio broadcast from the phone, and recording.

**Remote control** (like the web remote control):

- **Connect to [workspace]**: a remembered grant, held in the keychain, not in `localStorage` (G16). Asking again needs fresh approval, as today.
- **Join another presentation**: the in-app scanner, or a camera scan arriving through the link router (§6). Workspaces are not listed from the venue Wi-Fi (N10). A scan for a workspace this device operates opens operator mode instead (below).
- Everything the phone page does today: navigate, add, remove and reorder run sheet items, search, Bible, OBS buttons, listen to live audio.
- **Transport:** LAN first, through the Rust client with the fingerprint from the invitation. The relay is the fallback (D21). The page's relay and LAN code paths merge into the `Transport` the desktop already has.

Live audio stays WebRTC in the web view. iOS needs the `audio` background mode, so listening carries on with the screen locked, which the spike found a browser already manages for a minute.

**One device, both modes.** A phone can be an operator of **Wednesday Small Group** and a remote control of **Sunday Worship** (spec §4). The two keep separate credentials: an operator workspace has a device token, a remote connection a grant.

**A scan for a workspace this device already operates opens operator mode (decided 22 November 2026).** Every invitation names its server (`s`, §6.1) and workspace (`w`). When a scan, from the camera through the link router or from the in-app scanner, names a server and workspace this device is already enrolled in as an operator, the app opens that operator workspace and sends no remote-control request. The invitation is not used, so no operator is asked to approve anything. The match is on the server's host and the workspace's server identifier, never the workspace's name; a local workspace using the public server matches the same way, on the public server's workspace identifier. If the operator enrollment has been revoked, the app says so and offers **Ask to control as a remote** with the same invitation.

### 4.3 Tablets and external displays

The same app with wider layouts. It is not a separate product.

- **Tablet as operator:** the closest to the desktop; a two- or three-pane layout (run sheet, slide, preview). With a keyboard, the full song editor.
- **Tablet as remote control:** a two-pane screen (run sheet beside the slide) instead of the phone's tabs.
- **External display:** clean slideshow on a projector or TV (through a cable, or AirPlay to an Apple TV), with controls on the device. This is spec §12's "true external display", and the iOS scene API makes it practical on iPhone and iPad. It is also how an Apple TV shows Worship Q, now that there is no TV app (§5). Android: `Presentation` over a cable. The slideshow window is the desktop's slideshow page in a web view owned by the external display's scene or `Presentation`, through a small plugin (§4.1).

### 4.4 A phone or tablet as coordinator for other devices (N4)

**Decided 22 November 2026: yes, in operator mode.** A phone or tablet coordinates for other devices as a desktop does: it serves the LAN port with its own certificate, advertises by mDNS, relays through the church or public server, and backs up the live state to the church server.

The limit is the platform, not the code:

- **iOS** suspends an app's sockets soon after it leaves the foreground. While presenting, the app keeps the screen awake (`isIdleTimerDisabled`, as `power.rs` does on desktop), and an external display keeps the app active. When the coordinator goes to the background anyway (a call, the home button), the other devices see **The presenting computer is not responding** and can **Carry on here** (D18), as when a desktop crashes. On return, the phone finds whether someone carried on and follows, by the existing rule (D14).
- **Android** allows a foreground service with a notification ("Presenting Sunday Worship"), which keeps the server running in the background. The service type must suit Play policy (`connectedDevice` is the likely one, to be confirmed at review).
- **Wording:** devices following a phone coordinator say "presenting phone" or "presenting tablet" rather than "computer", from the `mobile` capability in protocol 12.
- **Battery:** coordinating with the screen on drains a phone over a long service. The app suggests charging when it starts coordinating on battery.
- **Prompts:** the local-network prompt on iOS and Android 17 also covers serving.

A desktop remains the recommended coordinator for a venue (spec §10).

### 4.5 Versions

The app is released and updated through the stores, separately from desktops and church servers, so the version window matters more. The app speaks the same `hello` with `PROTOCOL_VERSION`, and steps down as the phone page already does. Store review delays mean a server update must never require a same-day app update. Keep `MIN_PROTOCOL_VERSION` support at least one release behind.

## 5. Apple TV: dropped

**Decided 22 November 2026 by the project owner:** if a native tvOS app cannot show everything the slideshow shows, it is not built.

It cannot:

- **Websites and YouTube.** tvOS has no WebKit, so it has no web view of any kind, and YouTube offers no embeddable player on tvOS. Both are ordinary run sheet items today.
- **WebM videos** probably do not play through `AVPlayer` (not confirmed). Uploaded videos are kept as uploaded (media U10), so some would not play.

The design that was looked at, kept here so it is not explored again from scratch: a SwiftUI follower of the live state, joining like a browser output (D22) by an approved display request, drawing lyrics with a Swift port of `layout.ts`, and fetching images and videos from the coordinator over the LAN. It covered lyrics, passages, decks, photos and most videos, and could not cover the items above.

**How an Apple TV shows Worship Q instead:**

- **AirPlay from an iPhone or iPad** running the mobile app, as an external display: clean slideshow on the TV, controls on the device (§4.3). The app's web view draws websites and YouTube like the desktop.
- **AirPlay from a Mac** running the desktop app, with the TV as a second screen for the slideshow, as today.

Reopen this only if tvOS gains a web view.

## 6. The link router (`app.worship-q.com`)

### 6.1 Link format

```text
https://app.worship-q.com/j#s=<server host>&w=<workspace>&i=<invite>&f=<fingerprint>&a=<addrs>&p=<port>
```

- **Everything in the fragment.** Browsers never send the fragment to the server, so the router literally never receives the church, the workspace or the invitation. That meets "handles no church data" by construction, with no log policy to trust.
- `s` is the church server's host, or the public server's. The rest is today's fragment, unchanged.
- The installed apps receive the whole URL, fragment included, through the universal link and App Link (*to confirm* on both).

### 6.2 The page

A single static HTML file, in English, Simplified Chinese and Traditional Chinese, chosen by the browser language. The website rule against mixing languages on English pages applies to the website, and this page is one screen.

1. It reads the fragment and validates `s` as a bare host name: no scheme, no path, no user info, no IP literals except the public server's.
2. It shows "This invitation is for **church.example.org**" in large type, as the spec requires against forged links.
3. **Continue to church.example.org** goes to `https://<s>/remote/?w=…#i=…&f=…&a=…&p=…`, which is exactly today's QR target, so church servers need no change.
4. **Open in Worship Q** uses the custom scheme `worship-q://j#…` (iOS ignores a universal link to its own domain) and the iOS Smart App Banner. Store links appear when the app is not installed.
5. It never forwards on its own. One tap is the price of showing the domain first.

### 6.3 Association files

- `/.well-known/apple-app-site-association`: `applinks` for `/j` and the iOS and iPadOS app IDs; `application/json`; no redirect.
- `/.well-known/assetlinks.json`: the Android package and its signing certificate's SHA-256, with `autoVerify` in the manifest.

### 6.4 Hosting (N7)

The website is on GitHub Pages, which allows one custom domain per repository. A Pages site cannot also be `app.worship-q.com`, and Pages serves the extensionless AASA file without a JSON content type. Options:

- The public server's host (a static route in its reverse proxy), or
- Any static host that sets headers.

**Recommendation:** the public server's host. It already exists, and the router is three files. A router outage only means the camera route falls back to "open the app and scan", and installed apps keep opening links they already verified.

### 6.5 Moving desktops over

Desktops switch their QR codes to the router once the router is live. Older phone pages keep working, because the router's **Continue** target is the same URL. Pairing links (D29, the admin app's approval page) stay direct to the church server: they are opened by an administrator, not scanned for the app. Outstanding work §2 lists QR joining through the router for pairing as set aside, and it stays so.

## 7. Changes to the desktop and servers

| Change | Where | Why |
| --- | --- | --- |
| Serve the LAN in local mode: `LanHost` for public-server workspaces, with grants checked on the coordinator; mDNS advertisement with a local workspace identifier | `cloud.ts`, `lan.ts`, `lan.rs` | Phones on the venue network for a computer with no church server. The spec left "whether local-only mode includes LAN outputs and controllers" open; this decides it yes for controllers (N2) |
| Phone thumbnails over the LAN when the phone is connected there, not only through the relay | `packages/remote`, `lan.rs` | Thumbnails on a venue network with no internet |
| QR codes point to the router | `cloud.ts:1409` | §6 |
| A `mobile` capability in the hello, and the follower wording "presenting phone" or "presenting tablet" | `packages/protocol`, desktop | §4.4; protocol 12 |
| The desktop's screens split from its application layer where they are not already, so mobile layouts sit beside them | `apps/desktop/src` | Operator mode (§4.2) |
| `apps/remote`'s screens usable inside the app, with the Rust transport in place of the browser WebSocket | `apps/remote`, `connection.ts` | Remote control mode (§4.2) |
| None needed for the router | church server | Same `/remote/` target |

## 8. Distribution and cost

| | iPhone, iPad | Android phone, tablet |
| --- | --- | --- |
| Account | Existing Apple Developer membership | Google Play: personal (US$25 and a 12-tester, 14-day closed test) or organisation (US$25, D-U-N-S) |
| Fee each year | Already paid | None |
| Review | App Review, each release | Play review |
| Outside the store | TestFlight for testers | APK on GitHub Releases, but developer verification applies worldwide from 2027 |
| Bundle | One universal iOS and iPadOS app (`com.worship-q.mobile`) | One app with tablet layouts |

**App Review points to prepare:** the app must be useful without a church. The local workspace and Presenter Mode cover this, which is a good reason to ship Solo mode in the first release. Also prepare a reviewer demo, a privacy label (the app collects nothing, and the relay passes through), the local-network and camera prompts, and no in-app purchases (which would also keep a future nonprofit fee waiver possible).

**Publisher (N9):** the same developer, and the same legal name, as the existing Apple Developer membership that notarises the macOS build. The Google Play account is opened in that same legal name. The app is called **Worship Q** in both stores (N11), like the desktop; whether the name is free in each store is checked when the store listings are made, at M6.

## 9. Milestones

Sizes are relative (S, M, L), not time estimates.

| # | Milestone | Size | Done when |
| --- | --- | --- | --- |
| M0 | Spike: Tauri mobile shell on an iPhone and an Android phone, joining a desktop coordinator over the LAN through `lan.rs` with the fingerprint, with no internet; mDNS on both; universal link and App Link with the fragment, offline after install; iOS external-display scene on the iOS 27 SDK, by cable and by AirPlay to an Apple TV, with a website and a YouTube item; the LAN server on a phone reached by a desktop, and what happens to it in the background on iOS and with a foreground service on Android | S | Each works, or the gap is written down |
| M1 | Link router: page, association files, hosting; desktops' QR codes switch | S | A camera scan without the app reaches the church's phone page after showing its domain |
| M2 | Remote control mode: the phone page in the app, LAN first, keychain grant, home screen with **Connect to [workspace]**, in-app scanner | L | A phone with Wi-Fi but no internet moves the slides; G15, G16 closed |
| M3 | Desktop: LAN in local mode | M | M2 works against a computer with no church server |
| M4 | Operator mode, local: local workspace, songs, run sheets, Presenter Mode, phone and tablet layouts, external display on iPhone, iPad (cable and AirPlay) and Android (cable), public server features | L | G17 closed; spec criteria 10, 23, 33 |
| M5 | Operator mode, church and coordinator: pairing, synchronization, approving phones, serving the LAN, live-state backup, the Android foreground service, protocol 12 | L | A tablet coordinates a service with a desktop in viewer mode and two phones on the venue Wi-Fi with no internet; when the tablet goes to the background, the desktop carries on; scanning that workspace's invitation on the tablet opens its operator mode |
| M6 | Store submissions: TestFlight, Play closed test (14 days), review, website download page | M | Both in their stores |

Order: M0, then M1 and M3 in parallel; M2 next; then M4 and M5; M6 runs from M2 onwards (the Play closed test needs its 14 days early). M2 can ship on its own before operator mode.

## 10. Decisions

Each has a recommendation, so work can start, except N3, N4 and N13, which are decided.

| # | Decision | Recommendation |
| --- | --- | --- |
| N1 | Framework for phones and tablets | Tauri 2 mobile, as iOS and Android targets of `apps/desktop`, reusing its application layer, Rust core and the packages (§4.1) |
| N2 | Does local mode serve the venue network? | Yes. Otherwise a computer without a church server still needs the internet for every phone |
| N3 | Apple TV app | **Decided 22 November 2026: not built**, because tvOS cannot show websites or YouTube items (§5). An Apple TV is reached by AirPlay from the mobile or desktop app |
| N4 | Phones and tablets as coordinator for other devices | **Decided 22 November 2026: yes, in operator mode** (§4.4). Two modes on phones and tablets: operator (like the desktop) and remote control (like the web remote) |
| N5 | Permanent pairing on phones | In operator mode with a church (M5), as the desktop's D29. Remote control mode needs none |
| N6 | Google Play account type | The same type as the Apple membership, in the same legal name (N9): an organisation account (D-U-N-S, no tester gate) if that membership is an organisation's, otherwise a personal account with the 12-tester closed test started at M2 |
| N7 | Router hosting | On the public server's host, as three static files (§6.4) |
| N8 | Android TV / Google TV | Not requested; not planned. The Android app's `Presentation` support covers cabled screens |
| N13 | A scan for a workspace the device already operates | **Decided 22 November 2026:** opens operator mode, with no remote-control request (§4.2) |

## 11. Answered by the project owner (22 November 2026)

| # | Question | Answer |
| --- | --- | --- |
| N9 | Who publishes in the stores, and under what legal name? | The same developer and legal name as the existing Apple Developer membership |
| N10 | Should the phone list the workspaces found on the venue Wi-Fi as well as accepting a scan? | No. It was looked at and needed too much new design: names in the mDNS advertisement, join requests with no invitation, and a certificate trusted on first use. A phone joins by a scan, then reconnects with **Connect to [workspace]** |
| N11 | The app's name in the stores | **Worship Q** |
| N12 | Minimum OS versions | iOS and iPadOS 17; Android 10 (API 29) |

No open questions remain from this discovery. The items marked *to confirm* in §3 go to the M0 spike.

## Sources

- Apple, [Membership fee waivers](https://developer.apple.com/support/fee-waiver)
- Apple, [Presenting content on a connected display](https://developer.apple.com/tutorials/data/documentation/uikit/presenting-content-on-a-connected-display.md); developer forums on the external-display scene role ([815376](https://developer.apple.com/forums/thread/815376), [773838](https://developer.apple.com/forums/thread/773838), [850825](https://developer.apple.com/forums/thread/850825))
- Apple developer forums on WebKit on tvOS ([849373](https://developer.apple.com/forums/thread/849373)); [Apple TV: a world without WebKit](https://medium.com/bpxl-craft/apple-tv-a-world-without-webkit-5c428a64a6dd)
- Apple developer forums on the AASA CDN ([651737](https://developer.apple.com/forums/thread/651737), [699401](https://developer.apple.com/forums/thread/699401))
- Google Play, [App testing requirements for new personal developer accounts](https://support.google.com/googleplay/android-developer/answer/14151465)
- Android, [Developer verification FAQ](https://developer.android.com/developer-verification/guides/faq); [rollout to all developers](https://developer.android.com/blog/posts/android-developer-verification-rolling-out-to-all-developers-on-play-console-and-android-developer-console); [timeline coverage](https://www.helpnetsecurity.com/2026/06/19/android-developer-verification-rollout-markets/)
- Android, [Local network permission](https://developer.android.com/privacy-and-security/local-network-permission)
- Tauri, [Features and plugins](https://v2.tauri.app/plugin/), [Barcode scanner](https://v2.tauri.app/plugin/barcode-scanner/)
