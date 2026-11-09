# Spike — Live audio over WebRTC

**Status:** run on 9 November 2026 on one Mac (Apple silicon, macOS 27.2), comparing WebKit
with Chrome 156. Everything that needs a second computer, a phone, Windows or the internet is
still open (below). Source: [Live Audio Discovery](../live-audio-discovery.md) §8.

The spike code is throwaway and lives on the `live-audio-spikes` branch only, under
`spikes/live-audio/`:

- `server.mjs`: a dependency-free Node server that serves the test page, relays signalling
  between two pages over server-sent events, and logs results.
- `harness.html`, `harness.js`, `onset.js`: one page that runs as the sender, the receiver,
  or both. It sends a 10 ms, 2 kHz click every second and times each click's arrival with an
  AudioWorklet. It also logs the WebRTC stats each second.
- `wkhost.swift`: a stand-in for the desktop app's webview on macOS. It is a `WKWebView` with
  the app's `Info.plist`. It grants media capture as wry does without a handler, and allows
  playback without a gesture. It starts the page through `evaluateJavaScript`, which counts as
  a gesture (media spike M0.3), and can hide its window after a delay.

How delay was measured:

- **One page, one audio clock:** the click goes out to the speakers and is captured by a USB
  microphone (AT2020USB+) a few centimetres above them, or comes back as the received track.
  The difference is read in that page's own audio clock, so it is exact to the sample.
- **Speaker-to-microphone calibration:** played and captured in Chrome with no WebRTC in
  between, this path took 122 ms. Subtracting it gives the part due to WebRTC and the engine.

## Choices for the plan

| Concern | Choice | Why |
| --- | --- | --- |
| Engine on the sending desktop | The webview's own WebRTC (`getUserMedia` + `RTCPeerConnection`) | WebKit sends steadily from a USB microphone: exactly 50 (or 100) packets and 1000 ms of audio a second (L2) |
| Capture constraints | `{ echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 }` | WebKit only supports `echoCancellation` among the three (its supported constraints list neither of the others) and honours `false`. Chrome honours all three. Send all three; harmless where unsupported (L2) |
| Opus | 10 ms frames (`minptime=10`, `a=ptime:10`), 64 kbps, `useinbandfec=1`, `usedtx=0`, mono | 10 ms frames save about 10 ms against 20 ms frames, at the same bitrate. 96 kbps adds nothing to delay (L4). Both engines honour these parameters when they are in the description the sender receives |
| Audio input on the sending computer | A separate audio interface or USB input, never the built-in microphone | When another app starts audio on the built-in device, which the built-in speakers share, capture stalls for about 1.2 s (L2) |
| Listening page | Never call `getUserMedia` or `setSinkId` while receiving; play through a plain `<audio>` element | Both stall incoming audio in WebKit. The jitter buffer then stays at about 1.2 s for 25–30 s before it recovers (L3) |
| `jitterBufferTarget` | Leave unset | It exists in WebKit and in Chrome. But it is only a minimum, does not undo a stall (L3), and `0` changes nothing because the default target is already 20 ms (L4) |

## L1 — Features

- [x] **WebKit (WKWebView, macOS 27.2):** has `RTCPeerConnection`, Opus
      (`minptime=10;useinbandfec=1`), `setCodecPreferences`, `RTCRtpReceiver.jitterBufferTarget`,
      `setSinkId`, `AudioContext.getOutputTimestamp` and `AudioWorklet`.
      `playoutDelayHint` is missing.
- [x] **Chrome 156:** all of the above, plus `playoutDelayHint`.
- [x] The discovery's claim, from the MDN table, that Safari lacks `jitterBufferTarget` is
      out of date for WebKit on macOS 27. It is unchecked on iOS.

## L2 — Sending from WebKit

- [x] **The WebRTC sender is clean.** A synthetic click from WebKit arrived at Chrome with a
      median of 91 ms (cross-process wall clock, a few ms of error). The interval between
      clicks was exactly 1000 ms, and Chrome's jitter-buffer target was 21 ms.
- [x] **Capture from the AT2020 is steady.** Each second carried 50 packets and 1000 ms of
      source audio (`media-source.totalSamplesDuration`), and WebKit reports a 48 kHz capture.
- [x] **Built-in microphone:** in one run, capture delivered 650 ms and then 140 ms of
      audio in two consecutive seconds, while Chrome on the same Mac started its own audio
      output. Chrome's receiver had to fill 0.4 s of missing audio. VB-Cable, a virtual cable,
      showed similar bursts in WebKit, but not in Chrome.
- [x] **Mouth-to-ear, WebKit sending:** the click went from the speakers to the AT2020, through
      WebKit, to Chrome. With 10 ms frames it settled at a flat **214 ms**, with Chrome's jitter
      buffer at 35 ms. That is 92 ms above the speaker-to-microphone calibration, against 53 ms
      for Chrome to Chrome. So WebKit's capture appears to add roughly 40 ms over Chrome's.
      The first 35 s were disturbed by the measuring Chrome page's own device set-up (see L3),
      so read only the settled figure.
- [x] **Hidden window:** with the sending window hidden (`orderOut`, as Tauri's `hide()`),
      WebKit kept sending 50 packets a second. The receiver saw one 43 ms gap, and its
      buffer target rose from 20 ms to 60 ms.

## L3 — Receiving in WebKit

- [x] **The steady state is as good as Chrome's.** Played through a plain `<audio>` element,
      the buffer held at 30 ms with a 20 ms target (24 ms with 10 ms frames), with no
      concealment.
- [x] **Mouth-to-ear, WebKit receiving:** Chrome sent the click, WebKit played it on the
      speakers, and the AT2020 picked it up. Delay was **150 ms flat** with 10 ms frames and
      164–199 ms with 20 ms frames. That is 28–48 ms above the speaker-to-microphone
      calibration.
- [x] **The device-change trap.** When the listening page calls `getUserMedia` (even only to
      unlock device names) or `setSinkId` just after audio starts arriving, WebKit's packet
      delivery stalls for about two seconds (17–29 packets a second instead of 50). The jitter
      buffer target then jumps to 1.2 s and **stays there for 25–30 s** before decaying to
      20 ms. It happened the same way with Chrome or WebKit sending, to the speakers or to
      VB-Cable. Chrome as the receiver drains the same kind of backlog faster. Setting
      `jitterBufferTarget = 20` 12 s in, and clearing it 3 s later, did not shorten it.
- [x] **Web Audio is not a usable receive path in WebKit:** a remote track fed to
      `createMediaStreamSource`, with or without an `<audio>` element also playing it, produced only a third
      to a half of real time. The listening page must play through an element.
- [x] **Hidden window:** a receiving window hidden after 10 s kept playing with a 30 ms buffer.

## L4 — Opus frame size and bitrate

Chrome, sender and receiver in one page, synthetic click, no devices (pure encode, network,
jitter buffer, decode):

| Frames | Bitrate | Median | Packets/s |
| --- | --- | --- | --- |
| 20 ms | 64 kbps | 63–70 ms | 52 |
| 10 ms | 64 kbps | 53 ms | 100 |
| 10 ms | 96 kbps | 62 ms | 102 |

- [x] `jitterBufferTarget = 0` gave the same 22 ms target as the default.
- [x] Chrome, sending 20 ms frames to WebKit, twice switched itself to 10 ms packets partway
      through a run (100 packets a second). Harmless; noted in case the rate is ever charted.

## Expected budget

From these figures, for a mixer feed into a USB interface on the sending desktop, sent across
a LAN to a listener on headphones:

- **WebKit capture and send:** about 90 ms.
- **Network, jitter buffer and playout:** 30–50 ms.
- **Listener's output device:** 10–40 ms.

That is roughly **130–180 ms** end to end, before any internet path. The MacBook's built-in
speakers alone account for much of the 122 ms calibration.

## Still to run

- [ ] Two computers on the same Wi-Fi: does ICE find the direct path; delay and jitter over real
      Wi-Fi.
- [ ] iPhone Safari and Android Chrome as listeners, including a receive-only page that never
      asked for the microphone (mDNS host candidates), playback after a tap, and the screen lock.
- [ ] Windows (WebView2) as sender and receiver, including its permission handler.
- [ ] The real Tauri app rather than the WKWebView stand-in, signed, and whether the slideshow
      window's `getUserMedia` unlock (media plan) disturbs a listening window in the same app.
- [ ] Internet path with coturn; listeners on mobile data.
- [ ] Network impairment (loss and jitter), which needs `sudo` for `dnctl`/`pfctl` or the
      Network Link Conditioner.
