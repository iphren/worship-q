# Spike — Live audio over WebRTC

**Status:** run on 9 November 2026 (L1–L4) and 10 November 2026 (L5–L13) on one Mac (Apple
silicon, macOS 27.2), comparing WebKit with Chrome 156 and 157. The second day ran in the real
desktop app and covers everything in the plan's M0 that one Mac can answer. What needs a second
computer, a phone, Windows or a path across the internet is still open (below). The second day
also **corrects L3**: the "device-change trap" was caused by the test rig, not by WebKit.
Source: [Live Audio Discovery](../live-audio-discovery.md) §8;
[Live Audio Plan](../live-audio-plan.md) M0.

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

Added on 10 November:

- **A spike build of the real app.** The desktop app with its own identifier
  (`tauri.spike.conf.json`), so it shares no data with an installed copy. Its main window opens
  the test page; a small hook in `lib.rs` starts the page through a script call and, on a
  timetable, opens the real slideshow window, hides the main window, or runs a script in
  either. It is a debug build with an ad hoc signature, started from a terminal.
- `server.mjs` gained a UDP proxy that stands between two pages' host candidates. It counts
  every byte, and can drop packets, delay them, or black out the path.
- `multi.html`, `multi.js`: one sender with one capture track on n connections.
- `tools/`: the runner scripts; `agg.swift`, which makes an audio device appear and vanish;
  and STUN probes. coturn ran from the `coturn/coturn` image (4.18.0) in Docker.

How delay was measured:

- **One page, one audio clock:** the click goes out to the speakers and is captured by a USB
  microphone (AT2020USB+) a few centimetres above them, or comes back as the received track.
  The difference is read in that page's own audio clock, so it is exact to the sample.
- **Speaker-to-microphone calibration:** played and captured in Chrome with no WebRTC in
  between, this path took 122 ms. Subtracting it gives the part due to WebRTC and the engine.
- **10 November, no microphone at hand:** a Chrome page sends the click and hears it come back
  on VB-Cable, where the listening app plays it, all in that page's one audio clock. The figures
  (160–220 ms) include the cable and Chrome's capture of it, so only their changes mean
  anything. The Chrome page's audio context is tied to no device (`sinkId: { type: 'none' }`).
  That matters: see the correction under L3.

## Choices for the plan

| Concern | Choice | Why |
| --- | --- | --- |
| Engine on the sending desktop | The webview's own WebRTC (`getUserMedia` + `RTCPeerConnection`) | WebKit sends steadily from a USB microphone: exactly 50 (or 100) packets and 1000 ms of audio a second (L2) |
| Capture constraints | `{ echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 }` | WebKit only supports `echoCancellation` among the three (its supported constraints list neither of the others) and honours `false`. Chrome honours all three. Send all three; harmless where unsupported (L2) |
| Opus | 10 ms frames (`minptime=10`, `a=ptime:10`), 64 kbps, `useinbandfec=1`, `usedtx=0`, mono | 10 ms frames save about 10 ms against 20 ms frames, at the same bitrate. 96 kbps adds nothing to delay (L4). Both engines honour these parameters when they are in the description the sender receives |
| Audio input on the sending computer | A separate audio interface or USB input, never the built-in microphone | When another app starts audio on the built-in device, which the built-in speakers share, capture stalls for about 1.2 s (L2) |
| Listening page | Play through a plain `<audio>` element. `getUserMedia` and `setSinkId` may be called while receiving | Neither disturbs incoming audio in the real app (L6). The stall reported on 9 November came from the rig (L3, corrected) |
| `jitterBufferTarget` | Leave unset | It exists in WebKit and in Chrome. But it is only a minimum, and `0` changes nothing because the default target is already 20 ms (L4) |
| Monitor device | `setSinkId` inside the native script call, before connecting and again on every change | It needs a gesture, and a gesture lapses if the unlock before it is slow. From the native call it takes 0–3 ms and the delay stays flat, also on an element that has played for a minute (L6) |
| A muted capture track | On `mute`, ask for the input again and `replaceTrack` | Another window of the app that asks for the microphone, as the slideshow does when an output device is saved, mutes the broadcast's track for good. Asking again brings it back in a third of a second (L7) |
| The display on the broadcasting computer | Keep it awake while the switch is on | With the display asleep WebKit starts no capture, and after some minutes its audio runs short (L9) |
| Watching the input device | The track's `ended` for a device going; `devicechange` and the periodic listing for one returning | With a real USB microphone `ended` came at once every time, but `devicechange` came 8 s late once on unplugging. On plugging it came within a second every time (L8). Windows is untested |
| STUN | `stun:stun.l.google.com:19302` by default; `stun:stun.cloudflare.com:3478` is as good | Both answered in 9 ms (L13) |
| TURN credential | Valid for a few minutes; a fresh one for every new connection | coturn checks the expiry only when an allocation is made. A session outlived its credential by ten minutes, through its refreshes (L13) |

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
- [x] **The device-change trap. Corrected on 10 November: it was the rig.** As first
      reported: when the listening page calls `getUserMedia` or `setSinkId` just after audio
      starts arriving, packet delivery stalls for about two seconds, and the jitter buffer
      target jumps to 1.2 s and stays there for 25–30 s. What happened: the page that
      *sent* the click ran on the same Mac, with its audio clocked by the built-in output. When
      the listening page opened a device, that output hiccuped, and the sender produced only
      about half a second of audio in that second. The sender's own figures show it (440–560 ms
      of audio in a second). With a sender tied to no device, the same calls do nothing (L6).
      What stays true is the listener's reaction to audio that arrives late from the sender
      (L10). Setting `jitterBufferTarget = 20` 12 s in, and clearing it 3 s later, did not
      shorten it.
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

## L5 — The real app as the broadcaster (macOS)

- [x] **The main window captures and sends.** Through the app's own permission handler, from
      VB-Cable, the built-in microphone and an aggregate device: 100 packets and 1000 ms of
      audio a second at 63–64 kbps. The system's own prompt was not exercised, because the app
      was started from a terminal that already had microphone access; the released app's
      prompt and entitlement are covered by U24 since 2.1.0.
- [x] **One capture track on ten connections.** Ten listeners were fed from one track (L12).
- [x] **Hidden main window:** capture went on at 1000 ms of audio a second after `hide()`.
      A one-second timer in the page fired only every two seconds while hidden, although
      background throttling is disabled; audio does not depend on it, but a statistics or
      level reading on a timer would.
- [x] **Every capture start stumbles once.** In every run, about 3–4 s after capture began,
      one or two seconds carried only 470–820 ms of audio. It happened with one `getUserMedia`
      or with the unlock call before it, on the built-in microphone, VB-Cable and an aggregate
      device that nothing else was using. After that it is steady. Listeners connected at
      that moment hear a dropout and then carry extra delay for a while (L10), so capture
      should start well before anyone listens, as the plan has it.

## L6 — Listening in the real app, and the Monitor device

Chrome sent the click, from a context tied to no device; the app listened on VB-Cable.

- [x] **Monitor device before connecting:** unlock, `setSinkId`, then connect worked, with the
      delay flat from the start (196 ms in L7's run).
- [x] **`setSinkId` needs a gesture.** From a timer it fails with *NotAllowedError: A user
      gesture is required*. It also failed once at the start, when the unlock before it
      took long and the gesture of the script call had lapsed. So the device is always set from
      inside the native script call, as U24 does, never after an `await` of unknown length.
- [x] **Moving a playing element.** From the native script call `setSinkId` resolved in
      0–3 ms. On an element that had played for 40 s and for 60 s the delay stayed flat
      (186 ms before, 172 ms after; no concealment), and moving it back 15 s later was the
      same. Moved 5 s after the start it cost 34 ms of concealment and 35 ms of extra delay for
      11 s.
- [x] **`getUserMedia` in the listening page,** 3 s and 40 s after the start: no stall, no
      concealment worth the name, and the delay moved by 10–20 ms.
- [x] So the Monitor device can simply be moved while listening, Settings may list devices
      while listening, and no quick reconnect is needed.

## L7 — The slideshow window

The real slideshow window was opened while the main window was listening or broadcasting.

- [x] **With no output device saved,** the slideshow window never asks for the microphone, and
      nothing happens to the main window.
- [x] **With an output device saved,** it does its unlock (U24): `getUserMedia`, stop, then
      `setSinkId`.
  - **Main window listening:** undisturbed. The delay was 196 ms before, during and after.
  - **Main window broadcasting: the capture track is muted, and stays muted.** At the moment
    of the slideshow's `getUserMedia` the main window's track fired `mute`. It sent nothing
    for the remaining 45 s, also after the slideshow window was closed. WebKit lets one page
    at a time capture, and each window is a page.
- [x] **Recovery works.** On `mute`, the main window asked for the same input again 300 ms
      later and put the new track in place with `replaceTrack`: 33 ms, no renegotiation. The
      broadcast was short by about half a second, and by a little more a few seconds later
      (the start stumble, L5). A Chrome listener concealed 0.47 s, and its buffer was back
      under 100 ms in about 12 s.
- [x] **The slideshow cannot do without its unlock.** With `getUserMedia` refused in that
      window, `setSinkId` with a device id valid in an earlier run failed with *NotFoundError*,
      and `enumerateDevices` listed no outputs. The broadcast was untouched in that run.
- [x] So listening does not need its own window. The broadcaster must treat `mute` like a
      lost device and take the input again.

## L8 — Input devices coming and going

First an aggregate device around VB-Cable stood in for a USB interface: made and removed in
CoreAudio, which to the system and the webview is a device appearing and going. Then the real
thing, below.

- [x] **Going:** `devicechange` fired within half a second. The capture track fired `ended`
      0.2 s later (`readyState` `ended`), and the periodic listing saw it at its next turn.
      The connection stayed open and sent nothing.
- [x] **Coming back:** `devicechange` fired within a second, and the listing agreed.
- [x] **`replaceTrack` on a live connection:** six times, to the returned device, to the
      built-in microphone and back: 33–66 ms each, `signalingState` stayed `stable`, and the
      listener heard the sound return without reconnecting. Each new capture has the start
      stumble of L5.

**A real USB microphone (AT2020USB+), unplugged and plugged back three times** during one
four-minute broadcast from the real app, at the hub it shares with two other audio devices.
The page did what the plan describes: when the track had ended and the device was listed
again, it took it and called `replaceTrack`.

| | Unplugged: track `ended` | Unplugged: `devicechange` | Plugged: `devicechange` with the device | Taken again |
| --- | --- | --- | --- | --- |
| 1 | at once | **8 s later** | 0.6 s after the hub's other devices | 84 ms |
| 2 | at once | 0.4 s before | 0.7 s after | 109 ms |
| 3 | at once | 0.4 s after | 0.9 s after | 90 ms |

- [x] **`ended` is the signal for a device going.** It came every time, with the listing
      agreeing in the same second. `devicechange` came 8 s late once, so it cannot be the
      only watch.
- [x] **`devicechange` is enough for a device returning.** It fired each time within a second
      of the device being listed, and the three-second listing never had to step in.
- [x] **The broadcast came back by itself each time,** on the same connection, with no
      renegotiation. The listener concealed about half a second as the device went, heard
      silence while it was out, and sound again within two seconds of the plug.
- [x] **The return is late for a while.** After each return the Chrome listener's buffer
      climbed to 0.7–1.4 s and took 12–20 s to come back under 150 ms: the start stumble of L5,
      larger on this device, and L10's late audio. A WebKit listener would hold it longer.
      This makes the reconnect of L10 worth building: on a return, listeners could simply
      connect afresh.

## L9 — The display asleep on the broadcasting computer

Found by accident, when the Mac's display slept during a run, then repeated on purpose with
`pmset displaysleepnow`.

- [x] **No capture starts while the display is asleep.** `getUserMedia` neither resolved nor
      failed, in the app and in the WebKit stand-in, and the permission handler was not even
      asked. The same call took 145 ms once the display was on. Chrome was not affected.
- [x] **A capture that is already running goes on,** through a 30 s sleep: 100 packets and
      1000 ms of audio every second, with 30 ms of concealment at the listener on waking.
- [x] **After some minutes asleep, audio made in the page runs short.** Four minutes into a
      sleep, a Web Audio source in the real app delivered 630–860 ms of audio a second. Whether
      a microphone capture also runs short after minutes is not measured.
- [x] So the broadcasting computer's display must stay on. The app can hold the system's
      display-sleep assertion while the switch is on.

## L10 — Late audio and a gap are different things to a listener

- [x] **A gap on the network is harmless to the delay.** The proxy dropped everything for
      500 ms. Chrome and WebKit each concealed about 0.5 s, and the buffer did not move
      (24 ms and 30 ms, target 20 ms).
- [x] **Audio that the sender delivers late is not.** When the sender's source fell short by
      about half a second (the rig's hiccup, a capture start, a track taken again), the
      listener's buffer target rose to 0.5–0.6 s. WebKit held it for 20–45 s before coming
      back to 20–40 ms; Chrome came back in about 10 s. The click was heard 730–790 ms late
      instead of about 200 ms all that time.
- [x] So every stumble of the broadcaster's capture costs WebKit listeners up to 45 s of
      half a second's extra delay. Worth a check on the listening side: a buffer above, say,
      300 ms for a few seconds could trigger a reconnect, which starts with an empty buffer.
      Not tried.

## L11 — Loss and jitter

WebKit sent a synthetic click at 10 ms and 64 kbps through the proxy; 45 s each. Jitter is a
random extra delay up to the figure, with the order kept. The click delay is read in Chrome
only; WebKit's buffer tells the same story.

| Path impairment | Chrome: click median / p95 | Chrome: buffer | Chrome: concealed | WebKit: buffer | WebKit: concealed |
| --- | --- | --- | --- | --- | --- |
| None | 86 / 94 ms | 30 ms | 0 | 30 ms | 0 |
| 2 % loss | 76 / 86 ms | 30 ms | 22 ms/s | 30 ms | 22 ms/s |
| 5 % loss | 83 / 100 ms | 34 ms | 51 ms/s | 35 ms | 53 ms/s |
| 10 % loss | 78 / 94 ms | 30 ms | 104 ms/s | 44 ms | 105 ms/s |
| 20 % loss | 89 / 101 ms | 30 ms | 188 ms/s | 50 ms | 194 ms/s |
| 5 % loss in bursts of 5 packets | 82 / 88 ms | 30 ms | 45 ms/s | 30 ms | 47 ms/s |
| 20 ms jitter | 123 / 130 ms | 62 ms | 0 | 61 ms | 0 |
| 50 ms jitter | 137 / 144 ms | 53 ms | 0 | 79 ms | 0 |
| 100 ms jitter | 176 / 247 ms | 50 ms | 1 ms/s | 64 ms | 0 |
| 50 ms delay, 30 ms jitter, 2 % loss | 195 / 211 ms | 77 ms | 21 ms/s | 60 ms | 21 ms/s |

- [x] **Loss costs sound, not delay.** The delay stayed where it was up to 20 % loss. What
      was concealed matched what was lost, almost one for one, so in-band FEC and resending
      recovered little in a 20–50 ms buffer. At 2 % it is hardly heard; at 10 % a tenth of
      every second is made up.
- [x] **Jitter costs delay, not sound:** about 40 ms more for 20 ms of jitter, 50 ms for
      50 ms, 90 ms for 100 ms, with nothing concealed.
- [x] **A mobile-like path** (50 ms, 30 ms of jitter, 2 % loss) added about 110 ms.
- [x] **Loss raises the upload.** The sender resends: 110–140 packets a second and
      115–160 kbit/s for one listener at 2–10 % loss, and in one run at 10 % 249 packets a
      second and 444 kbit/s.

## L12 — Upload and CPU with one, five and ten listeners

WebKit sending loud noise, the hardest input for the encoder, to n connections; counted on the
wire by the proxy, with IP and UDP headers; 30 s each.

| Listeners | Packets/s | Opus | With RTP | On the wire | Back from listeners | WebKit CPU (one core = 100 %) |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 101 | 62.6 kbps | 85.3 kbps | **117 kbps** | 10 kbps | about 9 % |
| 5 | 503 | 317 kbps | 431 kbps | **586 kbps** | 50 kbps | about 20 % |
| 10 | 1006 | 623 kbps | 851 kbps | **1167 kbps** | 102 kbps | about 31 % |

- [x] 117 kbit/s a listener, a little over the plan's estimate of 105. Ten remote listeners
      need 1.2 Mbit/s of upload, more when the path loses packets (L11).
- [x] The real app capturing the built-in microphone for ten listeners: 1097 kbps and about
      30 % of one core. Each connection encodes for itself. No listener lost a packet.

## L13 — STUN, TURN and mDNS

- [x] **STUN servers,** five requests each from this network: `stun.l.google.com:19302`
      9 ms, `stun1.l.google.com:19302` 8 ms, `stun.cloudflare.com:3478` 9 ms,
      `global.stun.twilio.com:3478` 19 ms, `stun.nextcloud.com:3478` 30 ms. All answered every
      time with the same address. Google's stays the default; Cloudflare's is the alternative.
- [x] **This network's NAT** gave one socket the same outside port towards three servers, the
      kind a direct connection gets through. One home network, not a survey.
- [x] **coturn in Docker, UDP only, `use-auth-secret`.** A listener allowed only the relay
      connected in both engines: Chrome heard the click at 58 ms against 53 ms direct, with
      nothing lost; WebKit's buffer sat at 35 ms. This was Docker Desktop on the same Mac,
      with 21 relay ports published and `--external-ip`; a server on Linux is still to try.
- [x] **How long a credential must live.** A credential valid for 60 s carried a session for
      11 minutes: the permission refreshes at 4 and 8 minutes and the allocation refresh at 9
      minutes all succeeded after it had expired, with 100 packets a second throughout. A new
      allocation with an expired credential is refused (401, *credentials have expired*), in
      Chrome and in WebKit. So a credential only has to last until the connection is made;
      every new connection, an ICE restart included, needs a fresh one. Two hours on one
      allocation was not run, but it is the same refresh every nine minutes.
- [x] **mDNS candidates.** A WebKit or Chrome page without microphone access offers its host
      candidates as mDNS names only; the app with capture running offers its address. A
      listener with names only connected to the capturing app, and two pages with names only
      on both sides connected too (WebKit to WebKit, WebKit to Chrome). All on one Mac, where a
      name always resolves; across a venue's Wi-Fi it depends on multicast. Since the
      broadcaster offers its address, a listener can reach it without resolving anything.

## Expected budget

From these figures, for a mixer feed into a USB interface on the sending desktop, sent across
a LAN to a listener on headphones:

- **WebKit capture and send:** about 90 ms.
- **Network, jitter buffer and playout:** 30–50 ms.
- **Listener's output device:** 10–40 ms.

That is roughly **130–180 ms** end to end, before any internet path. The MacBook's built-in
speakers alone account for much of the 122 ms calibration.

Across the internet, L11's mobile-like path added about 110 ms and the relay about 5 ms, so
roughly **240–290 ms**: inside the plan's 300 ms, with little to spare. Not yet measured on a
real path.

## Still to run

All of it needs hardware or a network this Mac does not have.

- [ ] Two computers on the same Wi-Fi: the direct path, delay and jitter over real Wi-Fi, and
      the mouth-to-ear figure against the plan's 200 ms.
- [ ] iPhone Safari and Android Chrome as listeners: mDNS names across the Wi-Fi, playback
      after a tap, and the screen lock. The server already serves the test page over https
      on port 47391 for this.
- [ ] Windows (WebView2) as sender and receiver, with its permission handler on the main
      window: capture, `devicechange`, `setSinkId`, whether another window's `getUserMedia`
      mutes the capture there, and display sleep.
- [ ] The display asleep for several minutes with a microphone capture running (L9).
- [ ] The released, notarised build: only the system's microphone prompt for the main window
      is new there.
- [ ] Internet path: a listener on a home connection and on mobile data, with the public STUN
      server alone and then with coturn beside the server on Linux; two hours on one relay.
- [ ] Venue upload on a real connection with five and ten remote listeners.
- [ ] A reconnect by the listener when its buffer stays high, or whenever the broadcaster
      takes its input again (L8, L10).
