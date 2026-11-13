# Spike — Live audio over WebRTC

**Status:** run on 9 November 2026 (L1–L4) and 10 November 2026 (L5–L13) on one Mac (Apple
silicon, macOS 27.2), comparing WebKit with Chrome 156 and 157. The second day ran in the real
desktop app and covers everything in the plan's M0 that one Mac can answer. What needs a second
computer, a phone, Windows or a path across the internet was run on 10–13 November (L14–L18),
and the spike was concluded on 13 November 2026 with a short list left open (below). The second day
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
- [x] **A locked screen does the same, with the display on** (13 November). The screen
      locked itself after five idle minutes during a run. From then on `getUserMedia` in the
      app neither resolved nor failed, twice, 20 s and 15 s waited; it had resolved in under a
      second in the four runs before the lock, and did again after it was unlocked. Holding
      the display awake does not stop a lock that the operator or a policy sets. Whether a
      capture already running goes on behind the lock is not measured. The cause is very
      likely the one in L17: the page is not in view.

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

## L14 — Two computers on the same Wi-Fi

Run on 10 November 2026. A MacBook on 5 GHz 802.11ax (80 MHz channel, about -48 dBm, wired
connections turned off) and a Windows desktop on Ethernet, one access point and one subnet, so
one wireless hop. Chrome on both, host candidates only (`ice=none`), 10 ms frames, 64 kbps.
Windows' firewall asked nothing.

- [x] **A direct host-to-host path was found at once**, in both directions, with no server on
      the media path. Round trip time on the connection: 4-8 ms (one sender reported 29-74 ms
      while its own page was busy; it is a statistic of the sender's clock).
- [x] **Mac to Windows and Windows to Mac, 90 s each:** 0 packets lost, 91-109 packets a
      second, jitter 6 ms, concealment 0 ms in one run and 94 ms in two spots in the other.
- [x] **Chrome's listening buffer settles at about 110 ms** (target 118-120 ms, 90-187 ms
      seen) on this Wi-Fi, against 20-45 ms between two pages on one Mac. The average jitter
      is only 2-6 ms, so it is the arrival pattern (bursts) that Chrome is protecting against.
      `jitterBufferTarget = 20` was set and read back, and changed nothing: it is a minimum.
- [x] **Mouth to ear, read in one clock:** a click from the Mac's page crossed Wi-Fi to the
      Windows page, was played into a virtual cable, captured from the cable, sent back, and
      played into a virtual cable on the Mac, where the same page heard it. 99 clicks:
      **444 ms median (433-454 ms)**; with `jbt=20` 433-464 ms. Each way is about **220 ms**,
      including a cable and Chrome's capture and playout on each computer, which the Windows run
      put at roughly 170 ms alone (W3), so the one-way figure to a headphone is lower than
      this and cannot be read from this loop. The listener's buffer is about half of it.
- [x] **A sender's window that is not in front can be starved.** The first Mac to Windows run
      sent 15 packets a second with the page's source clock running normally, and the listener
      buffered up to 3.6 s. The same page with Chrome in front and background throttling off
      sent 100. The app's own windows are not in this case when they are hidden (W2), but a
      browser tab used as a broadcaster would be.

## L15 — An iPhone listening on the venue Wi-Fi

Run on 12 November 2026. An iPhone (Safari 27.0.1) on Wi-Fi and the MacBook on the same
subnet, with both its Ethernet and its Wi-Fi connected, so media took one wireless hop. The
phone loaded the test page over https on port 47391 with a self-signed certificate, accepted
once in Safari. Host candidates only (`ice=none`), 10 ms frames, 64 kbps, a plain `<audio>`
element. No Android phone was at hand.

- [x] **One tap is enough for sound.** The tap on the page's button starts an `AudioContext`;
      the element's `play()` is called later, when the track arrives, outside the tap, and it
      played every time (four runs).
- [x] **The iPhone offers an mDNS name only,** and connects at once to a sender that offers
      its address: Chrome on the Mac, and the app capturing the built-in microphone (which
      offered one address, the Ethernet one). Round trip 3–5 ms. This is the plan's case.
- [x] **Names on both sides also connect across this Wi-Fi.** The app sending a generated
      click, with no capture, offered a name only, as the iPhone did, and the connection was
      made at once. One network; a venue that blocks multicast would differ, and the plan
      does not depend on it.
- [x] **The app capturing and sending to the iPhone, 60 s:** 100 packets a second, 0 lost,
      0 ms concealed, listening buffer 116–119 ms (target 120 ms), jitter 3 ms. Speech from
      the built-in microphone sounded steady on the phone. The app's window was behind others
      and its timers ran every 2 s; capture still delivered 2000 ms of sound every 2 s (L5).
- [x] **Chrome sending to the iPhone, 40 s and 150 s:** 100 packets a second, 0 lost, 0 and
      15 ms concealed, buffer 100–109 ms (target 120 ms).
- [x] **The screen lock does not stop the sound.** Locked for 64 s in the 150 s run: the
      clicks were heard throughout, packets kept arriving at 100 a second with nothing
      concealed, and the page's timers slowed to one every 2 s. After unlocking there was no
      reconnect, and the buffer sat at about 122 ms against 107 ms before. Longer than a
      minute, and Safari in the background behind another app, were not tried.
- [x] **A sender that is not capturing and not in front is unsteady.** The app sending the
      generated click from a window behind others delivered 1750–2030 ms of sound every 2 s.
      The iPhone's buffer rose from 85 ms to 200–340 ms, with 287 ms concealed in the first
      ten seconds and nothing lost. With capture running the same window was steady (above),
      so this is the test's source, not the product's; it matches L14's starved sender.
- [ ] **Mouth to ear is not measured.** The Mac's built-in microphone listened for the
      phone's speaker (threshold 0.05) and caught 16 clicks, most of them scattered
      (169–852 ms) by room noise. The four that agree are 169, 183, 190 and 217 ms, for a
      generated click with no capture delay, through the phone's speaker. To repeat with a
      USB microphone against the speaker.

## L16 — A listener connecting afresh

Run on 13 November 2026, on the one Mac. Chrome sent the click from a context tied to no
device and heard it back on VB-Cable, as in L6; the real app listened through a plain
`<audio>` element set to the cable. The sender's source was made to fall short on purpose:
the clicks pass through a second audio context that is suspended for 500 ms, so the track
delivers about 500 ms of sound in that second, as a capture does when it starts (L5). The
real app as the broadcaster, taking a real input again, follows further down.

A reconnect here is: the listener asks, the sender makes a second connection with the same
track and offers it, and when sound arrives on it (the new track's `unmute`) the listener
moves its element to the new track and closes the old connection.

| Run | Listener's buffer after the shortfall | Click delay | Back to normal |
| --- | --- | --- | --- |
| No reconnect | 510 ms (target 520 ms) | 181 ms, then 710 ms | after 19 s |
| Reconnect, new `srcObject` and `play()` | 518 ms, then 37 ms | 739 ms, then 235 ms | 8.4 s and 8.5 s after the shortfall |
| Reconnect, tracks changed in the element's stream | 517–528 ms, then 47 ms | 751 ms, then 283 ms | 8.8 s and 10.8 s after |

- [x] **The shortfall reproduces L10.** One second with 500–520 ms of sound from the sender
      put the app's buffer at 510 ms for 19 s, with 485 ms concealed, and every click was
      heard 530 ms later than before.
- [x] **A fresh connection starts with an empty buffer.** Its first reading was 37–48 ms
      while the old connection stood at 518–528 ms, and the next click was heard at the
      normal delay.
- [x] **It takes about a tenth of a second.** From asking to sound arriving on the new
      connection: 76–102 ms. To the element playing it: 111 and 134 ms with a new
      `srcObject`, 77 and 86 ms with the tracks changed under the same stream. Four
      reconnects, host candidates on one Mac.
- [x] **No gesture is needed.** The reconnect ran from a timer. `play()` on the element
      that was already playing resolved, and the element kept its output device: the clicks
      went on arriving on the cable. `setSinkId` was not called again.
- [x] **The check is slow, not the reconnect.** With "above 300 ms for 3 s" the buffer took
      4–5 s to climb past 300 ms, so the listener asked 8–11 s after the shortfall, against
      19 s without. The app's window was behind others for part of the runs and its timer
      fired every 2 s (L5), which made the later ones slower. A word from the
      broadcaster is quicker (below).
- [x] **What is lost is what is skipped.** The listener jumps forward by the half second it
      was behind. The clicks either side of each reconnect were heard. Whether one fell in
      the skipped half second was not counted: the pairing drops a click heard more than
      900 ms late, as three were just before one reconnect.
- [x] **A connection can carry delay that the statistics do not show.** In both reconnect
      runs the click delay was 443–462 ms from the third click on, with the buffer reading
      37 ms; in the run without a reconnect it was 181 ms. After each reconnect it was
      230–283 ms. So about 200 ms sat somewhere on that connection outside the jitter buffer,
      at one end or the other, and a fresh connection cleared it. Not explained, and a check
      on the buffer alone would never see it.
- [x] **A reconnect on a healthy connection costs nothing that was measured.** Three, 15 s
      apart: 55, 73 and 126 ms, no click missing or heard twice, and the click delay moved
      by 6–24 ms.

**The real app at both ends.** One copy of the app broadcast from the AT2020USB+, another
listened, muted, so the figures are the listener's own statistics. Thirty seconds in, the
broadcaster took its input again.

| Run | Listener: concealed | Listener's buffer | Back to normal |
| --- | --- | --- | --- |
| Input taken again while the old track is still open | 32 ms | 52 ms at most | never left it |
| Old track stopped, input asked for 1 s later; no reconnect | 1066 ms | 1118 ms (target 1120 ms) for 17 s | 26 s after the sound stopped |
| The same; the broadcaster tells the listener at once | 717 ms | 33 ms | 31 ms after `replaceTrack` |
| The same; the listener checks its buffer (above 300 ms for 3 s) | 1088 ms | 922 ms, then 60 ms | 7.7 s after `replaceTrack` |

- [x] **What makes a listener late is the device closing and opening**, not `replaceTrack`.
      A second capture of a device that is still open cost 32 ms. With the old track stopped
      first, as it is after `ended` or `mute`, no sound left for 1.1 s and the listener
      took all of it as late audio.
- [x] **Telling the listeners at once is right.** The reconnect was done 31 ms after the
      new track was in place, and the new connection's buffer stayed at 33 ms to the end of
      the run. No stumble followed 3–4 s later, so there was nothing to wait for.
- [x] **The start stumble of L5 did not happen on the AT2020 today:** in six broadcasts
      every second after the start carried 950–1050 ms. L5 saw it on the built-in
      microphone, VB-Cable and an aggregate device.
- [x] **Candidates must wait for their description.** In one run a candidate overtook the
      offer of the new connection on each side, both were refused (*The remote description
      was null*), and with host candidates only the new connection never carried sound. The
      test page now holds them back. It also stays on the old connection if the new one
      brings no sound in 3 s, which the first version did not.
- [x] **A listener whose window is behind others has a larger buffer.** With its timers
      at 2 s the listening copy's buffer read 90–240 ms against a target of 80 ms, where it
      had read 35–40 ms in front. Under the 300 ms check, but not by much.
- [ ] Not run: a Chrome or phone listener, a reconnect across a network, and the device
      really unplugged with a listener that reconnects.

## L17 — `getUserMedia` waits while the window is out of view

Found on 13 November 2026 when a broadcaster behind another window never took its input
again, then run on purpose. The real app broadcast from the AT2020USB+ and, 14 s in, asked
for the same input again.

| The main window, from 6 s in | `document.visibilityState` | The second `getUserMedia` |
| --- | --- | --- |
| In front | visible | 36 ms |
| In view, another app in front | visible, no focus | 40 ms |
| Hidden (`hide()`) | hidden | did not return in 12 s, when the run ended |
| Covered by another app's window | hidden | did not return in 11 s; returned at once when the cover was closed |

- [x] **While the page is hidden, `getUserMedia` neither resolves nor fails.** It is held,
      and it resolves the moment the window is in view again (11.4 s after the call, in the
      same instant as `visibilitychange`). `enumerateDevices` answers as usual, and a capture
      that is already running goes on (L5).
- [x] **Not being in front does not matter;** not being seen does. A window fully covered
      by another app's window counts as hidden.
- [x] **This is very likely what L9 saw.** With the display asleep or the screen locked no
      page is in view. `visibilityState` was not read in those runs.
- [x] **It reaches every case where the broadcaster asks for its input.** Starting capture
      when the app opens the workspace, taking a muted track again (L7), and taking a
      returned device (L8) all wait until the main window is seen. A main window that is
      minimised, hidden, or under the slideshow window or another app on a single display
      would broadcast silence until someone brings it forward.
- [ ] Not looked for: a WebKit setting that lifts this. Not run: Windows, where a capture
      started with the display off (W6) but a hidden or covered window was not tried.

## L18 — Across the internet, and coturn on Linux

Run on 13 November 2026, when the spike was concluded. The broadcaster was the real app on
the Mac, on a home connection behind one router, capturing the AT2020USB+. coturn and the
spike's server ran on a small Linux cloud server (Ubuntu 18.04, x86-64) that already runs the
Worship Q server in Docker behind nginx. The server has a private address which its provider
maps one-to-one to a public one. The listener was an iPhone (Safari 27.0.1), which loaded
the test page from that server over https. 10 ms frames, 64 kbps, a plain `<audio>` element.

**coturn on Linux.** The `coturn/coturn` image (4.18.0) with host networking:
`-n --listening-port=3478 --listening-ip=<private> --relay-ip=<private>
--external-ip=<public>/<private> --no-tcp --no-tls --fingerprint --use-auth-secret
--static-auth-secret=<secret> --realm=<realm> --min-port=49160 --max-port=49180`, and a
`--denied-peer-ip` for each private range and loopback.

- [x] **It relays, beside the running server.** A Chrome listener on the Mac allowed only
      the relay heard a Chrome sender on the same Mac: 100 packets a second, 0 lost, round
      trip 4–5 ms, buffer about 40 ms. coturn used 1.2 % of a core and 6 MB for the stream.
- [x] **What had to be opened:** UDP 3478 and the relay range, in the host's firewall and in
      the provider's. Nothing passes through the reverse proxy. Both were left open on that
      server after the spike, for M5; the test page's port was closed.
- [x] **The addresses must be named.** Left to itself coturn found four relay addresses, the
      Docker bridges among them. `--listening-ip` and `--relay-ip` pin it to the one that is
      mapped, and `--external-ip` gives the public address that goes into candidates.
- [x] **Options that changed in 4.18:** `--no-dtls` is not recognised and stops the server;
      `--no-cli` is deprecated and only logged.
- [x] **Private peers can be refused at no cost.** With the private ranges denied, coturn
      refused the peers' host candidates (logged each time) and the connection was made
      through the reflexive one. A relay beside the church's server should not reach the
      server's own network.
- [x] **One allocation, 19 minutes, past its credential.** A credential valid for ten
      minutes; the run was stopped at 19 min 26 s, with 100 packets a second to the end and
      107 ms concealed in eight spots of 6–26 ms. The listener's buffer had a median of
      55 ms. It rose to 400–1100 ms five times for a few seconds, each time as the app was
      started or its windows changed on the same Mac, which held both ends. This agrees with
      L13. **Two hours was not run.**

**The iPhone, away from the venue's network.** Wi-Fi was turned off on the phone. The phone's
address was not recorded in these two runs, and a third run later turned out to be on the
home Wi-Fi again, so **mobile data is likely here but not confirmed**: the round trip was
24–26 ms, against 5 ms on that Wi-Fi.

| 90 s, the app to the iPhone | Public STUN server only | coturn only |
| --- | --- | --- |
| Path | direct | relayed |
| Round trip | 26 ms | 24 ms |
| Packets | 82–110 a second, 0 lost | 92–109 a second, 0 lost |
| Jitter | 10 ms | 4 ms |
| Listening buffer | 102–114 ms, median 105 ms | 105–127 ms, median 122 ms |
| Concealed | 0 ms; 333 ms as the sender stopped | 0 ms |

- [x] **A direct path was made with the STUN server alone.** The iPhone offered an mDNS
      name and no reflexive candidate. The pair was formed from the phone's checks arriving
      at the broadcaster's reflexive address, so it rests on the broadcaster's router
      letting them in. This router did, and it gives one socket the same outside port to
      every destination (L13). One router, not a survey.
- [x] **The relay cost nothing that was measured** on this path: the same round trip, and a
      buffer at its 120 ms target either way.
- [x] **Mouth to ear, from the parts:** about 90 ms of capture (L5), 13 ms of network, a
      buffer of 105–122 ms and the phone's output give roughly **220–265 ms**, inside the
      plan's 300 ms. Not measured in one clock.
- [x] **With both offered, the direct path is used.** The third run gave both sides the STUN
      server and the relay. The phone was on the home Wi-Fi (its reflexive address was the
      Mac's), and the pair chosen was host to host, round trip 5 ms.
- [x] **A screen lock of 64 s, in that run:** packets kept arriving at 100 a second with
      nothing concealed, and the page's timers ran every 2 s, as in L15. On unlocking,
      140 ms was concealed and the buffer then stayed at about 205 ms, against 131 ms before,
      for the 50 s the run had left. A fresh connection would clear it (L16).
- [ ] Not run: the same with the phone's network recorded, a listener on another home
      connection, a network that needs the relay, and Android.

## Expected budget

From these figures, for a mixer feed into a USB interface on the sending desktop, sent across
a LAN to a listener on headphones:

- **WebKit capture and send:** about 90 ms.
- **Network, jitter buffer and playout:** 30–50 ms.
- **Listener's output device:** 10–40 ms.

That is roughly **130–180 ms** end to end, before any internet path. The MacBook's built-in
speakers alone account for much of the 122 ms calibration.

Across the internet, L11's mobile-like path added about 110 ms and the relay about 5 ms, so
roughly **240–290 ms**: inside the plan's 300 ms, with little to spare. L18's path, very
likely an iPhone on mobile data, came to roughly 220–265 ms from its parts, direct and
relayed; not measured in one clock.

## Still to run

All of it needs hardware or a network this Mac does not have.

The spike was concluded on 13 November 2026. The project owner judged that nothing left here
blocks the build; each open item is checked in the milestone it belongs to.

- [x] Two computers on the same Wi-Fi: the direct path, delay and jitter over real Wi-Fi, and
      the mouth-to-ear figure against the plan's 200 ms (L14; Chrome only, the app not run).
- [x] iPhone Safari as a listener: mDNS names across the Wi-Fi, playback after a tap, and
      the screen lock (L15).
- [ ] Android Chrome as a listener: the same three. The server already serves the test page
      over https on port 47391 for this.
- [ ] Mouth to ear on a phone, with a USB microphone against its speaker (L15).
- [ ] Windows (WebView2) as sender and receiver, with its permission handler on the main
      window: capture, `devicechange`, `setSinkId`, whether another window's `getUserMedia`
      mutes the capture there, and display sleep.
- [ ] The display asleep for several minutes with a microphone capture running (L9).
- [ ] The released, notarised build: only the system's microphone prompt for the main window
      is new there.
- [x] coturn beside the server on Linux, and an iPhone away from the venue's network with
      the public STUN server alone and through the relay (L18).
- [ ] Internet path, the rest: the phone's network recorded as mobile data, a listener on
      another home connection, a network that needs the relay, and two hours on one relay
      (19 minutes were run).
- [ ] Venue upload on a real connection with five and ten remote listeners.
- [x] A reconnect by the listener when its buffer stays high, or when the broadcaster takes
      its input again and says so (L16).
- [ ] A capture already running when the screen locks (L9).
- [ ] A hidden or covered main window on Windows, and a way round it on macOS (L17).
