# Worship Q — Live Audio Broadcast Plan

**Drafted:** 10 November 2026  
**Status:** Draft, reviewed with the project owner on 10 November 2026. Nothing is built. No questions remain open (§6); the decisions in §5 are agreed where marked and otherwise proposed, pending the spike. The spike has run everything one Mac can answer, in the real app (10 November 2026); M0's remaining items need a second computer, phones, Windows and an internet path, and are finished before any feature code. The task breakdown follows M0.
**Source:** [Requirements and Architecture](worship-q-requirements-and-architecture.md) §17 (*Live audio broadcast to remote operators and controllers*); [Live Audio Discovery](live-audio-discovery.md), referred to here as "the discovery"; the [spike](spikes/live-audio.md) (L1–L13); [Media Uploads Plan](media-uploads-plan.md) U24 (audio device settings); [OBS Control Plan](obs-control-plan.md) O8–O11, whose pattern this follows; and the code at version 2.2.0 (protocol version 6).

## 1. Where the implementation stands

- **No audio leaves a computer today.** The only sound the app makes is a video item's, played by the slideshow window on the output device chosen in Settings (U24).
- **The input picker already exists.** Settings has an audio input picker, saved on this computer as `audioInput` (`apps/desktop/src/app/deviceSettings.ts`, `components/AudioSettings.tsx`). It was added for this feature and nothing reads it yet.
- **Microphone access is already granted to the app.** `NSMicrophoneUsageDescription` and the `audio-input` entitlement shipped in 2.1.0, and macOS asks once. On Windows the permission handler allows the microphone for the slideshow window; the main window is not yet covered.
- **A state owned by one computer already has a pattern.** The OBS state is owned by whichever desktop has an active link, fanned out by the coordinator to devices that declare the `obs` capability, and forwarded to phones by `RemoteHost` (`packages/protocol/src/obs.ts`, `packages/remote/src/index.ts`). The relay validates every message kind, so new kinds mean a protocol version and a server update.
- **The server has no media role.** It is one Node process behind the church's reverse proxy (`apps/server/compose.yaml`). There is no STUN or TURN server.
- **What the spike settled:** WebRTC works in WKWebView as sender and receiver; Opus with 10 ms frames at 64 kbps mono; capture constraints; play through a plain `<audio>` element; avoid the built-in microphone. Measured on one Mac: 150–214 ms mouth-to-ear through a speaker and microphone, and an expected 130–180 ms on a LAN with a mixer feed and headphones. In the real app on macOS (L5–L13): the main window captures and listens; the Monitor device can be moved while listening; a device that goes and returns is seen and taken again without reconnecting; ten listeners cost 1.2 Mbit/s; coturn works with short-lived credentials. Three things to design for: another window asking for the microphone mutes the broadcast's capture (L7), the broadcasting computer's display must stay awake (L9), and a stumble of the capture leaves WebKit listeners half a second late for up to 45 s (L10).

## 2. The request

Someone who is not in the room, or is in a booth without the room's sound, hears the service with so little delay that they can switch slides in time.

**Proposed requirements**

- **One broadcaster per workspace.** Any desktop of the workspace, in any role including viewer only, broadcasts the audio input chosen on that computer. Normally this is the computer with the mixer feed, often the OBS computer.
- **Listeners are the workspace's own devices, and the church's administrators.** Other desktops of the workspace, every approved phone, and an administrator signed in to the admin app. Nobody else: not output links, not browser slideshow pages.
- **Listening is a choice, each time.** Nothing plays until an operator presses **Listen**. A second operator in the room must never have the service come out of their laptop.
- **Low delay comes first.** Target: at most 200 ms on the venue network and at most 300 ms across the internet. The discovery's 100 ms LAN target is dropped: the spike puts WebKit's capture alone at about 90 ms.
- **Shown only when broadcasting.** Workspaces that do not use it see nothing new, except one switch in Settings.
- **Not recorded.** The audio is sent live and kept nowhere.

## 3. Features

- **Broadcast switch, under Settings on the sending computer.** Beside the existing input picker: a **Broadcast live audio** switch, a level meter so the operator can see the mixer feed arriving before anyone listens, and the status.
- **Set up once.** The switch stays on until someone turns it off in Settings, or another computer takes the broadcast over. Every time the app opens after that, the computer offers the broadcast by itself as soon as its input device is there. The operator does nothing on a Sunday.
- **The input device may come later, or go.** The app may be opened before the mixer's interface is plugged in. While the switch is on, the app keeps looking for the chosen input and starts broadcasting within a few seconds of it appearing, or at once when the operator picks another input from the list. If the device is unplugged during a broadcast, nothing fails: the status changes to **Waiting for input**, listeners are told the broadcast is waiting and stay connected in silence, and the sound returns by itself when the device is plugged back in or another is picked.
- **Built-in microphone warning.** When the chosen input is the computer's own microphone, Settings shows a note under the picker: the built-in microphone picks up the room, not the mixer, and its sound can cut out for about a second whenever another app on the computer starts playing sound. It is allowed, for a church with nothing else, but an interface fed from the mixing desk is what to use. This comes from the spike (L2): on a Mac the built-in microphone and speakers are one device, and when another app started audio on it, capture delivered 650 ms and then 140 ms of sound in two consecutive seconds.
- **Broadcast status.** Off; Live, with the number of listeners; Waiting for input (the chosen device is not connected), naming the device; Refused (the system denied the microphone, with what to do about it).
- **Broadcasting indicator.** While a broadcast is live, every desktop and phone of the workspace shows that audio is being sent, and from which computer. The sending computer shows it on the Present page too, not only in Settings.
- **Listen button on the desktop.** On the Present page, only while a broadcast is live. Pressing it connects and plays on this computer's **Monitor** device; pressing it again stops. The Monitor device can be changed while listening: the sound moves to the new device and **Listen** stays on. It is off again after the app restarts.
- **Monitor device, under Settings on every desktop.** A third audio picker beside the output and input pickers: where **Listen** plays. It starts as **System default**, and is kept on this computer only. It is separate from the output device, which is where the hall's video sound goes.
- **Listen button on the phone.** On the remote control's main screen, only while a broadcast is live. The tap that starts it is the gesture phone browsers require. The page says that the sound stops when the screen locks or the browser goes to the background.
- **Listen button on the admin app.** On the workspace page, under the presentation, only while a broadcast is live. An administrator presses it to hear the service; nothing plays before that. It needs the broadcasting computer to be connected to the church server.
- **Delay shown while listening.** A small figure, from the connection's own statistics, with the path in use: **Direct** or **Relayed**. It is the network and buffer part of the delay, not the whole mouth-to-ear figure, and the label says so.
- **Reconnects by itself.** While **Listen** is on, a dropped connection is retried, and a broadcaster that restarts is picked up again without another press.
- **Up to ten listeners,** counting desktops, phones and administrators together. The eleventh is told the broadcast is full. The limit is fixed, not a setting.

## 4. Proposed design

- **Audio state.** The broadcasting computer publishes an audio state to the workspace: the owning device and its name, the time the broadcast was switched on, the status, and the listener count. It is a separate state beside the live state and the OBS state, owned by the broadcaster whatever its role, and it never touches the coordinator's authority over the presentation.
- **Take-over.** As with OBS (O9): a later activation wins, and the earlier broadcaster switches itself off silently, and stays off after a restart until someone turns it on again. Each computer keeps its own switch and input choice, per workspace, in the app's own storage beside the OBS link, not in the synchronized `setting` table.
- **Media path.** WebRTC, peer-to-peer: the broadcaster holds one send-only `RTCPeerConnection` per listener. The audio never passes through the coordinator or the relay. So a change of coordinator during a service does not interrupt anyone's audio; only new connections wait for the new coordinator.
- **Signalling.** New message kinds on the existing channels, as protocol version 7, sent only to devices that declare an `audio` capability:
  - `audioState`, fanned out by the coordinator like `obsState`, and passed to phones in their view;
  - `audioSignal`, addressed from one device to another, carrying a session identifier and one of: listen request, offer, answer, ICE candidate, close, or full.
  The coordinator forwards and keeps nothing but the last audio state. A phone's signals enter through the desktop it is connected to, which forwards them under the phone's grant identity (D25). The relay checks sizes: a description is capped at 16 KB and a candidate at 1 KB.
- **Who offers.** The listener asks; the broadcaster answers with an offer; the listener returns its answer. The Opus settings travel in the listener's answer, because a sender follows the description it receives (spike). One pure function in `packages/protocol` rewrites a description to `minptime=10; useinbandfec=1; usedtx=0; maxaveragebitrate=64000`, `a=ptime:10`, mono, and is unit-tested against descriptions from WebKit, Chromium and Firefox.
- **Capture.** In the main window's webview: `getUserMedia` with the saved input (by id, then by name, as U24) and `{ echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 }`. One capture track is shared by every peer connection. The level meter reads the local track through Web Audio, which is safe on a local track; the spike's Web Audio problem is with remote ones. Capture runs while the window is hidden (L2, and L5 in the real app). With the switch on, capture starts when the app opens the workspace, not when the first listener arrives, so the level meter and the status are true before anyone listens, and so the stumble every capture makes a few seconds after it starts (L5) is over by then. Two things the spike found in the real app are handled here. **A muted track is taken again:** WebKit lets one window at a time capture, so when the slideshow window does its audio unlock (U24, only when an output device is saved) the main window's track is muted and stays muted; on `mute` the broadcaster asks for the input again and puts the new track in place with `replaceTrack`, which cost listeners about half a second (L7). **The display stays awake:** with the display asleep WebKit starts no capture and, after some minutes, audio runs short (L9), so the app holds the system's display-sleep assertion while the switch is on. Native capture in Rust stays the fallback if the rest of M0 finds the webview unreliable; nothing so far calls for it.
- **Watching the input device.** While the switch is on, the broadcaster listens for `devicechange` and also lists the devices every few seconds. With a real USB microphone on macOS, unplugged three times, the track's `ended` came at once every time and is what marks the device as gone; `devicechange` came 8 s late once. On plugging back, `devicechange` came within a second every time, and the device was taken again in about 0.1 s (L8). The listing stays as a second look, and Windows is still to try (M0). The saved input is matched by id, then by name. A capture track that ends (`ended`, on unplugging) puts the state to Waiting for input; the peer connections stay open, sending nothing. When the device is back, or another is picked, the new track is put in place with `replaceTrack` on each connection, with no renegotiation, so listeners hear the sound return without reconnecting (33–109 ms in the spike, L8). After a return the sound reaches listeners late for 12–20 s, more in WebKit (L8, L10), so the broadcaster tells its listeners when it has taken the input again and they connect afresh; this is still to try. Every step is tried and caught: a device that vanishes between listing and opening is one more wait, never an error shown to the operator. With **System default** chosen, the broadcast follows whatever the system's default input is.
- **Listening on the desktop.** A plain `<audio>` element in the main window, default jitter buffer. The press on **Listen** unlocks the device ids (`getUserMedia`, track stopped at once, as U24), finds the saved Monitor device by id and then by name, calls `setSinkId`, and then asks the broadcaster for a connection. `setSinkId` needs a gesture, and the gesture of the press can lapse while the unlock is waited for, so the device is set from inside the native script call, as U24 does (L6). The order is for tidiness only: the stall the first spike blamed on these calls came from its test rig (L3, corrected). A missing device falls back to the system default, also when it is unplugged while listening.
- **Changing the Monitor device while listening.** This has to work, as changing the output during a video does since 2.1.0. That fix has two parts, and both are reused: Settings tells the playing window directly (an event, not a storage event, which is not delivered reliably between windows), and the element is moved inside the native script call, which macOS counts as a gesture. The spike measured it in the real app: moved from the native script call, an element that had played for a minute changed device in 0–3 ms with the delay flat, and moving it back was the same (L6). So the element is simply moved, and no reconnect is needed. From a timer, without a gesture, the call is refused. Settings' pickers do not disturb listening: a `getUserMedia` in the listening window changed nothing (L6).
- **The slideshow window.** Its audio unlock (U24) does not disturb a listening main window, so listening needs no window of its own (L7). It does mute a broadcasting main window's capture, which is taken again as described under *Capture*. The slideshow cannot skip its unlock: without it `setSinkId` is refused there (L7).
- **Listening on the phone.** The same element in the remote page, started from the tap. The phone gets its ICE servers inside the signalling from its desktop, so it needs no credential of its own.
- **Listening on the admin app.** The admin page has no connection to the workspace's devices, so the server stands in for it. The administrator's browser sends its signals to the server over the signed-in session (`POST /admin/api/workspaces/:id/audio/signal`, answers returned over the page's existing event stream or a short poll, to be settled in the breakdown), and the server passes them to the broadcasting desktop through the relay as `audioSignal` messages from a listener marked as an administrator. The broadcaster treats it as any other listener and counts it in the ten. The server learns that a broadcast is live from the audio state the relay already forwards, and keeps only the latest one in memory, as it does the OBS report. The browser gets its ICE servers from the server directly. When the workspace's desktops meet only on the LAN, or the broadcaster is offline from the server, the admin page shows no **Listen** button.
- **Finding a path.** ICE with host candidates always, so two devices on the venue network connect directly with no server involved. A phone whose page came from the church server can reach the broadcaster directly on the LAN this way, which the self-signed certificate prevents for WebSockets today. A listener that never asked for the microphone advertises mDNS names instead of addresses. The broadcaster, which is capturing, advertises its address, so the listener reaches it without anyone resolving a name; on one Mac names also resolved both ways (L13). Across a venue's Wi-Fi this is confirmed with a phone in M0.
- **STUN.** A public STUN server by default, so a listener on an ordinary home connection reaches the broadcaster with nothing extra for the church to run. The server hands out the list through a new `GET /api/v1/ice`, which only an enrolled device may call, and the administrator can replace or empty it with `WORSHIP_Q_STUN` (default `stun:stun.l.google.com:19302`; it and `stun:stun.cloudflare.com:3478` both answered in 9 ms, L13). A device that cannot reach the server uses none and still connects on the venue network.
- **TURN.** Optional: a `coturn` service in `apps/server/compose.yaml` as a profile that is off by default, over UDP only. When it runs, the same route adds it with short-lived credentials from a shared secret (coturn's `use-auth-secret`: the user name is an expiry time, the password its HMAC). coturn checks the expiry only when an allocation is made: in the spike a session ran ten minutes past its credential, through every refresh, and a new allocation with an expired one was refused (L13). So a credential lives ten minutes, and a device asks the route again before every new connection or ICE restart. Without it, a listener whose network allows no direct connection (roughly 10–20 % of networks) cannot listen from outside the venue; the listener is told the connection could not be made and that the church's server offers no relay. TURN over TCP or TLS, for networks that block UDP altogether, is left out until a church reports the need.
- **Encryption.** WebRTC's own: DTLS-SRTP between the two ends, with fingerprints exchanged over the authenticated signalling channel. A TURN server relays ciphertext and cannot hear the audio.
- **Cost on the venue connection.** Opus at 64 kbps in 10 ms packets measured 117 kbps per listener on the wire, so five remote listeners need 0.6 Mbit/s of upload and ten need 1.2 Mbit/s, with about 30 % of one processor core on the broadcasting computer (L12). A path that loses packets raises it, as the sender resends (L11). Listeners on the venue network cost no internet upload.
- **Failure handling.** A connection that goes `disconnected` gets an ICE restart; one that goes `failed` is closed and asked for again after a short, growing wait. The broadcaster drops a listener whose device leaves the workspace or whose phone grant is revoked. A lost input device is handled as above.
- **Older devices and servers.** The minimum protocol stays 2. A desktop or phone page without the `audio` capability sees nothing. Against a server older than version 7 the relay refuses the new kinds; the broadcaster's Settings says the church's server must be updated.

## 5. Decisions

All proposed.

| # | Topic | Decision |
| --- | --- | --- |
| A1 | Transport | WebRTC with Opus, as the discovery recommends. No WebSocket fallback, SFU, WebTransport or MoQ in this plan. |
| A2 | Topology | Peer-to-peer from the broadcasting desktop, one connection per listener, at most ten in all, fixed. **Limit agreed.** |
| A3 | Who broadcasts | Any desktop of the workspace, one at a time, in any role. A later activation takes over silently. |
| A4 | Who listens | Desktops of the workspace, every approved phone with no switch to exclude phones, and administrators in the admin app. No output links or slideshow pages. **Agreed.** |
| A5 | Listening is opt-in | Never starts by itself, and is not remembered across restarts. Broadcasting is the opposite (A15). |
| A6 | Latency target | At most 200 ms on the venue network, 300 ms across the internet, mouth-to-ear with a mixer feed and headphones. |
| A7 | Codec settings | Mono, 10 ms frames, 64 kbps, in-band FEC on, DTX off; voice processing off. Fixed, with no quality setting. |
| A8 | Capture | The main window's webview; native Rust capture only if M0 shows the webview unreliable. **Confirmed on macOS** (L5), with two conditions: a muted track is taken again (L7), and the display is kept awake while the switch is on (L9). Windows is still to run. |
| A9 | Signalling | New kinds on the existing coordinator, follower and phone channels, protocol version 7, `audio` capability. The coordinator and relay forward and keep no audio. |
| A10 | NAT traversal | A public STUN server by default, replaceable or removable by the administrator. The church's own coturn as an optional TURN relay over UDP, with short-lived credentials from the server, valid ten minutes and asked for again before every new connection (L13). No TURN over TCP or TLS yet. **Agreed; confirmed on one network and with coturn in Docker, the internet path still to run.** |
| A11 | Monitor device | A **Monitor** picker in each desktop's Settings, defaulting to the system default, kept on that computer by id and name like U24's devices. Separate from the output device. Applied before connecting. It can be changed while listening, and **Listen** stays on: the element is moved from the native script call (L6). **Agreed; confirmed on macOS.** |
| A12 | Settings location | The switch on the broadcasting computer, per workspace, beside the OBS link. Nothing in the workspace's synchronized settings; the server stores nothing. |
| A13 | Recording | None. No audio is written to disk or kept on the server. |
| A14 | Administrators listening | A **Listen** button on the admin app's workspace page, pressed each time. The server carries the administrator's signalling to the broadcaster through the relay; the audio itself still goes peer-to-peer or through TURN. Available only while the broadcaster is connected to the server. **Agreed; signalling route proposed.** |
| A15 | Broadcasting persists | Once switched on, a computer offers the broadcast every time the app opens, until it is switched off in Settings or another computer takes over. It watches for its input device, starts when the device appears or another is picked, and waits, without failing, when the device is unplugged. **Agreed.** |
| A16 | Built-in microphone | Allowed, with a warning under the picker. **Proposed.** |

## 6. Open questions

None remain.

Settled on 10 November 2026: a Monitor device picker (A11); every approved phone may listen (A4); ten listeners, fixed (A2); administrators may listen from the admin app (A14); a public STUN server by default, a Sunday service being public anyway, and TURN over TCP or TLS not yet (A10).

## 7. Milestones

Sizes are S, M and L as in the phase plans.

### M0 — Finish the spike (M)

Throwaway code on the `live-audio-spikes` branch; results added to `docs/spikes/live-audio.md`.

Run on 10 November 2026, on one Mac, in the real app (L5–L13):

- The real app on macOS: capture from the main window, the slideshow window's audio unlock, `setSinkId` to a Monitor device before connecting and on an element that had played for a minute.
- Input devices on the broadcaster, with a stand-in for a USB interface: `devicechange`, the ended track, and `replaceTrack` on a live connection.
- coturn in Docker and how long a credential must live; the public STUN server against alternatives.
- Induced loss and jitter.
- Upload with five and ten listeners, through a local proxy.

Still to run, each needing hardware or a network the spike's Mac lacks (the spike's "Still to run" list):

- Two computers on the same Wi-Fi: direct path found, delay and jitter, and the 200 ms target (A6).
- iPhone Safari and Android Chrome listening: mDNS candidates across the Wi-Fi, playback after a tap, screen lock.
- Windows (WebView2) sending and receiving, with the permission handler on the main window, and the macOS findings repeated there: a muted capture, display sleep, `devicechange`, `setSinkId`.
- The display asleep for several minutes during a capture; listeners connecting afresh after the broadcaster takes its input again.
- A listener on a home connection and on mobile data with the public STUN server alone, then with coturn beside the server; the 300 ms target (A6).

**Done when:** each item has a measured result, A6, A8 and A10 are confirmed or changed, and the task breakdown can be written without a "to be verified".

### M1 — Protocol and state (M)

- Audio state and `audioSignal` schemas, the `audio` capability, protocol version 7 (`packages/protocol`).
- Which audio state wins, and the coordinator's forwarding (`packages/live-state`), as for OBS.
- The relay passes the new kinds and enforces the size limits (`packages/relay`).
- The description rewriting function for the Opus settings.

**Done when:** unit tests cover take-over, forwarding only to devices with the capability, and addressed signals reaching only their device; a relay integration test passes signals between two followers and refuses an oversized one.

### M2 — Broadcasting (M)

- Capture from the saved input from the moment the workspace opens, the shared track, one peer connection per listener, the ten-listener limit.
- Settings: the switch, level meter, status and the built-in microphone warning.
- The switch kept across restarts; watching for the input device; unplugging and plugging back; picking another input during a broadcast.
- Take-over, and the broadcasting indicator on the sending computer.

**Done when:** a test page on another computer, signalling by hand, hears the broadcast; the app opened with the interface unplugged starts broadcasting within a few seconds of it being plugged in, with no press; unplugging it during the broadcast shows Waiting for input and plugging it back restores the sound to the same listener without a reconnect; and switching on a second broadcaster silences the first, which stays off after a restart.

### M3 — Listening on the desktop (M)

- The **Listen** button, the `<audio>` element, the delay figure and path label.
- The **Monitor** picker in Settings, applied before connecting, and changed while listening.
- Reconnection and ICE restart; stopping before Settings lists audio devices.
- The broadcasting indicator on every desktop.

**Done when:** two desktops on one network, with no internet, broadcast and listen; the coordinator can be handed over without a gap in the audio; quitting and reopening the broadcaster brings the audio back by itself; and changing the Monitor device while listening, on macOS and on Windows, moves the sound within two seconds, leaves **Listen** on, and leaves the delay figure where it was. Opening Settings while listening does not interrupt the sound.

### M4 — Listening on the phone (M)

- `RemoteHost` forwards the audio state and the phone's signals; ICE servers passed to the phone.
- The **Listen** button and indicator in `apps/remote`, the lock-screen note.

**Done when:** an iPhone and an Android phone on the venue Wi-Fi listen with a direct path, and revoking a phone's approval stops its audio.

### M5 — Across the internet (M)

- `GET /api/v1/ice` with the STUN list and `WORSHIP_Q_STUN`; coturn as an optional profile in `compose.yaml`, with short-lived credentials; the desktop fetches the list and passes it on.
- A listener that cannot connect is told why, and whether the church's server offers a relay.
- `docs/server-deployment.md`: the UDP ports to open, which do not go through the reverse proxy, and how to check the service from outside.

- The admin app: the server keeps the latest audio state, carries an administrator's signals to the broadcaster, and the workspace page gets its **Listen** button (`apps/admin`, `apps/server`).

**Done when:** a desktop on a home connection listens with STUN alone; a phone on mobile data listens through TURN when coturn runs, and gets the explanation when it does not; a device that is not enrolled is refused the list; and an administrator hears the broadcast from the admin page, is counted among the listeners, and is refused when signed out.

### M6 — Acceptance pass (S)

A walkthrough at the venue during a rehearsal, with a mixer feed: delay measured by a clap on the venue network and from a home connection, ten listeners at once, a full service's length without drift or drop-out, and the volunteer guide updated. Recorded in `docs/acceptance/live-audio.md`.

## 8. Order and dependencies

M0 first; its results may change A6, A8 and A10. Then M1, then M2. M3, M4 and M5 each need M2 and are independent of each other. M3 alone already serves a second operator in the building, so it can be released before M4 and M5.

## 9. Rollout

- **Server first.** The relay must know protocol version 7 before any desktop can share a broadcast, as with OBS control. Update the church's server, then the desktops through the updater.
- **Nothing to set up for most churches.** Remote listening works through the public STUN server. coturn is the administrator's choice, for listeners whose networks need a relay: it needs UDP port 3478 and a range of relay ports open to the internet on the server's own address, outside the reverse proxy.
- **At the venue.** Feed the broadcasting computer from the mixing desk through an audio interface or USB input, not the built-in microphone, and check the level meter before the service.
