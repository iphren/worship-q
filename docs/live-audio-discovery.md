# Live Audio Broadcast — Discovery

**Date:** 9 November 2026
**Status:** Discovery. Nothing is built. Part of §8 was run on one Mac on 9 November 2026. The
results are in the [spike](spikes/live-audio.md), which confirms WebRTC in WebKit and measures
150–214 ms mouth-to-ear through a speaker and microphone. Other figures below are typical
published numbers or estimates, to be confirmed on a real venue connection.
**Source:** [Requirements and Architecture](worship-q-requirements-and-architecture.md), §17
"Future improvements noted": *Live audio broadcast to remote operators and controllers.*

## 1. The use case

One device at the venue captures the live service audio and sends it, with as little delay as
possible, to other operator desktops and to approved remote controllers (phones in a browser).
Someone at home can then follow the service by ear and switch slides in time.

What that implies for the design:

- **Latency is the whole point.** The listener hears a line, then presses Next, and the
  command travels back to the coordinator. The slide is late by *audio delay + command delay*.
  The command path already exists (relay or LAN WebSocket), so the audio is the part to
  minimise.
- **Audience is small.** A handful of listeners per workspace, not a public stream. Fan-out
  cost is low; no CDN is needed.
- **Speech and music.** It is a worship service, so the codec must not be tuned for speech
  only, and voice-call processing (echo cancellation, noise suppression, automatic gain)
  must be off.
- **Listeners are on two networks.** On the venue LAN (a second operator in the room or the
  booth), and across the internet through the church's own server.
- **Clients are fixed.** The desktop is Tauri (WKWebView on macOS, WebView2 on Windows) with a
  Rust core; remote controllers are browser pages served by the church instance, and phones
  cannot trust the coordinator's self-signed LAN certificate (spike M0.2), so today they
  always go through the relay.
- **The server is small and self-hosted.** One Node process (Fastify + WebSocket) in Docker,
  behind the church's reverse proxy.

### Latency target

| Target | Mouth-to-ear | Reason |
| --- | --- | --- |
| Ideal | ≤ 150 ms | Feels simultaneous; operator presses as if in the room |
| Acceptable | ≤ 300 ms | Plus ~50–150 ms for the command back, the slide still lands at the line break |
| Not usable | ≥ 1 s | Operator is consistently a line behind; this rules out HLS-family streaming |

## 2. Where the delay comes from

For any transport, the end-to-end delay is roughly:

| Stage | Typical | Notes |
| --- | --- | --- |
| Capture buffer | 5–20 ms | OS/audio-interface buffer |
| Encoder frame | 10–20 ms | Opus frame size; 20 ms default in browsers, 10 ms possible |
| Encoder look-ahead | ~5 ms | Opus |
| Network one-way | 1–5 ms LAN, 10–80 ms internet | Path length; plus the relay hop if one is used |
| Jitter buffer | 20–200 ms | The big variable: absorbs network jitter and loss |
| Playout buffer | 10–40 ms | OS/browser output |

Everything except the **network path** and the **jitter buffer** is fixed at a few tens of ms.
So the choice of transport matters mainly through two things: whether it runs over UDP (a lost
packet is skipped or concealed) or over TCP (a lost packet stalls everything behind it until it
is resent), and how well its receiver sizes the jitter buffer.

## 3. Options considered

### A. WebRTC (Opus over UDP, SRTP)

The standard real-time media stack in every browser and both webviews.

- **Latency:** typically 100–250 ms mouth-to-ear over the internet, under 100 ms on a LAN.
  Adaptive jitter buffer (NetEq) shrinks when the network is good and grows only under jitter;
  Opus packet-loss concealment and in-band FEC hide loss without waiting for resends.
- **Clients:** native in Chrome, Edge, Firefox, Safari (iOS and macOS), WebView2 and WKWebView.
  No codec to ship, no audio plumbing to write: an `RTCPeerConnection` plus an `<audio>`
  element.
- **Tuning available:** `echoCancellation`, `noiseSuppression`, `autoGainControl` off on capture;
  Opus `maxaveragebitrate` 64–96 kbps, `useinbandfec=1`, DTX off (silences between songs must
  not clip the start of the next phrase), mono, 10 ms frames (about 10 ms less delay than
  20 ms, spike L4). `RTCRtpReceiver.jitterBufferTarget` exists in Chromium, Firefox and WebKit
  on macOS 27 (the spike found it, contrary to MDN's table), but it only sets a minimum and the
  default target is already 20 ms, so there is no reason to set it.
- **Cost:** needs signalling (offer/answer/ICE) — which the existing relay and LAN channels can
  carry as new message kinds — plus STUN, and for some networks TURN.
- **LAN bonus:** WebRTC's media is secured by DTLS, with the fingerprint exchanged over the
  signalling channel. A phone whose page came from the church server can still receive media
  **directly from the venue desktop over the LAN** via ICE host candidates, side-stepping the
  self-signed-certificate problem that keeps phones on the relay for WebSockets.

### B. WebSocket + Opus (WebCodecs or a WASM decoder) + AudioWorklet

Send encoded Opus frames as binary messages over the existing relay WebSocket and play them
through a hand-written jitter buffer.

- **Latency:** fine on a clean network (~100–200 ms), but TCP head-of-line blocking means one
  lost packet stalls the stream for at least one round trip, and a mobile or busy venue Wi-Fi
  loses packets. To stay smooth the jitter buffer has to be set generously (300–500 ms+), or
  the listener hears gaps and the buffer slowly drifts.
- **Pros:** reuses the relay unchanged in shape, no STUN/TURN, works through every proxy.
- **Cons:** we would write and maintain the jitter buffer, clock-drift correction, loss
  handling and iOS audio-session quirks ourselves; the relay process carries all audio bytes.

Useful only as a **fallback** for a listener whose network blocks UDP entirely.

### C. WebTransport (HTTP/3 datagrams) + WebCodecs

UDP-like datagrams from browser to server, now unflagged in Chrome, Edge, Firefox and
Safari 26.4 (March 2026).

- **Latency:** comparable to WebRTC in principle (no head-of-line blocking with datagrams).
- **Cons:** still client–server only (no LAN peer-to-peer), the server must speak HTTP/3/QUIC,
  which the church's reverse proxy and the Node/Fastify stack do not today; we would write the
  jitter buffer, loss concealment and pacing that WebRTC already provides; Safari's
  implementation is new and part of Interop 2026 work. WKWebView/WebView2 support follows their
  engines but adds another thing to verify.

No latency advantage over WebRTC for this use case, and much more to build.

### D. Media over QUIC (MoQ)

The IETF's emerging live-media protocol on top of WebTransport/QUIC, aimed at sub-second
streaming at CDN scale.

- Spec still an Internet-Draft in 2026; early vendor deployments; most coverage calls 2026 a
  pilot year. Solves fan-out to thousands, which we do not have. Same deployment burden as C.

Not now. Worth revisiting only if it becomes a turnkey part of a server we already run.

### E. HLS / LL-HLS / DASH, RTMP, SRT, Icecast

- HLS/DASH: 6–30 s; LL-HLS/LL-DASH: 2–5 s. Icecast/HTTP streaming: several seconds of buffer.
  All fail the ≥ 1 s rule.
- RTMP and SRT are contribution protocols with no browser playback.

Rejected.

### F. WHIP/WHEP from OBS

OBS (30+) can publish over WHIP, which is WebRTC. But OBS has one streaming output, normally
used for the public stream, and it would require a WHIP/WHEP server. Not a first choice;
noted because the OBS computer usually already has the mixer feed (see §5).

### Comparison

| Option | Internet latency | LAN direct | Browser + webview support | Build effort | Infra |
| --- | --- | --- | --- | --- | --- |
| **A. WebRTC** | **~100–250 ms** | **Yes** | **All** | **Low–medium** | STUN, TURN optional/advised |
| B. WebSocket + Opus | ~200–500 ms+ under loss | No (phones) | All | Medium–high | None new |
| C. WebTransport | ~100–250 ms (in theory) | No | All since 2026, new | High | HTTP/3 server + proxy |
| D. MoQ | Sub-second | No | Via C | High | MoQ relay |
| E. HLS family | 2–30 s | — | All | Low | — |

**WebRTC is the lowest-latency option that is practical here,** and on the LAN it is the only
option that reaches phones directly.

## 4. WebRTC topology

| Topology | How it works | Fits when |
| --- | --- | --- |
| **Peer-to-peer from the venue desktop** | The capturing desktop opens one `RTCPeerConnection` per listener; signalling over the existing relay/LAN channels | Up to ~10 listeners. Opus at 64 kbps × 10 = 0.64 Mbit/s of venue upload; the lowest latency (no server hop) |
| **SFU on the church server** | Desktop sends once to an SFU; SFU forwards to each listener without decoding | Many listeners or a weak venue upload; one extra hop (~5–30 ms) |
| **TURN relay** | Media goes through a TURN server when direct UDP fails (symmetric NAT, mobile carrier, strict firewalls; roughly 10–20 % of networks) | Always needed as a fallback for reliability |

SFU candidates if ever needed: **mediasoup** (Node library with a C++ worker; fits the existing
Node server but we write signalling) or **LiveKit** (Go, standalone service with its own
signalling and SDKs; quickest to run, but another service and its own auth). A Rust SFU on
**str0m** is possible but is the most work.

For one sender and a few listeners, **peer-to-peer from the venue desktop with a TURN fallback**
is both the lowest-latency and the least infrastructure.

## 5. Capture on the venue desktop

| Approach | Notes |
| --- | --- |
| **`getUserMedia` + `RTCPeerConnection` in the Tauri webview** | Least code: the same WebRTC stack as the browser. macOS needs `NSMicrophoneUsageDescription` in the bundled Info.plist and the audio-input entitlement; WKWebView microphone prompts have known quirks (double prompt, hangs) to verify in a spike. WebView2 asks for permission through its handler. Device selection via `enumerateDevices`, so an audio interface fed from the mixer can be chosen. |
| Native Rust (`cpal` capture, `opus` encode, `str0m` or `webrtc-rs` for WebRTC) | Full control over buffers and devices, no webview permission quirks, runs while the window is hidden; much more code. Keep as the fallback if the webview route proves unreliable. |

Audio source is a setting, not a technical problem: a **feed from the mixing desk** (aux/matrix
out into an audio interface, or the interface the OBS computer already uses) sounds far better
than a laptop microphone in the room. Running the sender on the OBS computer is natural since
that machine usually has the mix.

Capture constraints: `{ echoCancellation: false, noiseSuppression: false, autoGainControl:
false, channelCount: 1 }`. WebKit supports only the first of the three and honours it (spike L2).
Avoid the built-in microphone: it shares its device with the built-in speakers, and capture
stalled for about a second when another app started audio on them.

## 6. Listener side

- **Desktop followers:** a plain `<audio>` element fed by the remote track, not Web Audio, which
  runs well below real time on a remote track in WebKit. Default jitter buffer.
- **Never touch audio devices while listening:** calling `getUserMedia` or `setSinkId` on the
  listening page while audio arrives stalls WebKit's incoming audio, and leaves about 1.2 s of
  delay for 25–30 s (spike L3). Choose the output device before connecting, or reconnect after
  changing it.
- **Phone browsers:** playback must start from a tap (autoplay policy); iOS suspends audio when
  the screen locks or the page is backgrounded, so the remote page should say so. A receive-only
  phone that never asked for the microphone may only see obfuscated mDNS host candidates;
  confirm LAN-direct still connects on iOS and Android, else it falls back to the internet path.
- **Indicator:** show the measured delay (`getStats()` gives round-trip time and jitter-buffer
  delay) so an operator knows how far behind they are hearing.

## 7. Recommendation

1. **Transport: WebRTC with Opus.** Lowest latency available in every client we have, with loss
   concealment, adaptive jitter buffering and encryption built in.
2. **Topology: peer-to-peer from the capturing desktop,** signalled as new message kinds on the
   existing `toCoordinator`/`toFollower`/phone channels (a protocol version bump, as with OBS
   control). LAN listeners connect directly; remote listeners connect across the internet.
3. **NAT traversal:** STUN always; a **TURN server (coturn) alongside the church server** in
   `compose.yaml`, with short-lived credentials issued by the server to authorised devices only.
   Without TURN, some remote listeners will not connect at all.
4. **Capture in the Tauri webview first,** with voice processing off and a selectable input
   device; native Rust capture only if the spike shows webview problems.
5. **Defer** the SFU (until listener counts or venue upload demand it), WebTransport and MoQ
   (no latency gain for this audience), and the WebSocket fallback (only if UDP-blocked
   listeners turn out to matter).

Expected result: roughly **50–100 ms on the venue LAN** and **150–250 ms over the internet**,
within the 300 ms acceptable target.

## 8. Spike to run before planning

- [ ] macOS (WKWebView) and Windows (WebView2): `getUserMedia` from a chosen audio interface,
      permission prompts in a signed release build, capture continues with the window
      minimised.
- [ ] Desktop → desktop and desktop → phone (iOS Safari, Android Chrome) on the same Wi-Fi:
      does ICE find a direct LAN path; measured mouth-to-ear delay (clap test or a click track
      recorded on both ends).
- [ ] Desktop → phone on mobile data, with and without coturn: connection rate and delay.
- [ ] Opus settings for music: 10 ms vs 20 ms frames, 64 vs 96 kbps, FEC on; listen for
      artefacts.
- [ ] `jitterBufferTarget` effect on WebView2 and Android Chrome under induced jitter.
- [ ] Venue upload with 5 and 10 listeners.

## 9. Open decisions (from the requirement, narrowed)

| Decision | Discovery's suggestion |
| --- | --- |
| Transport | WebRTC (Opus) |
| Latency target | ≤ 300 ms internet, ≤ 100 ms LAN |
| Audio source selection | Input-device setting on the sending desktop; recommend a mixer feed |
| Bandwidth over the relay | None: the relay carries only signalling; media goes peer-to-peer or through TURN |
| Permissions | Same as remote control: devices of the workspace and approved remote controllers; TURN credentials only for them |
| Which desktop sends | Any desktop of the workspace, one at a time, like the OBS link (likely the OBS computer) |

## Sources

- [WebTransport is now Baseline — webrtc.ventures](https://webrtc.ventures/2026/04/webtransport-is-now-baseline-what-it-means-for-real-time-media/)
- [WebKit: Announcing Interop 2026](https://webkit.org/blog/17818/announcing-interop-2026)
- [IETF Media over QUIC working group](https://datatracker.ietf.org/wg/moq/about/)
- [NAB 2026: MoQ gains momentum but faces adoption hurdles — CSI Magazine](https://csimagazine.com/csi/nab26-moq-update.php)
- [MDN: RTCRtpReceiver.jitterBufferTarget](https://developer.mozilla.org/en-US/docs/Web/API/RTCRtpReceiver/jitterBufferTarget)
- [Tauri issue #2338: camera/microphone permission on macOS](https://github.com/tauri-apps/tauri/issues/2338)
- [wry issue #1195: getUserMedia double prompt on macOS](https://github.com/tauri-apps/wry/issues/1195)
- [Apple forums: no prompt for WKWebView getUserMedia audio](https://developer.apple.com/forums/thread/734363)
- [str0m documentation](https://docs.rs/str0m)
- [SFU comparison: mediasoup, Janus, LiveKit, Jitsi, Pion — Fora Soft](https://www.forasoft.com/learn/video-streaming/articles-streaming/sfu-comparison-mediasoup-janus-livekit-jitsi-pion)
- [Self-hosted WebRTC SFU guide 2026: Janus vs mediasoup vs LiveKit](https://www.pistack.xyz/posts/2026-04-25-janus-gateway-vs-mediasoup-vs-livekit-self-hosted-webrtc-sfu-guide-2026/)
