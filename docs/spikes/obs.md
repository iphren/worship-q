# Spike M0 — OBS control against a real OBS

**Status:** run on 6 November 2026 against OBS Studio 33.0.1 with obs-websocket 5.7.6, on the
same computer as the client: on macOS 27.2, and on Windows 11 (version 26H2, OBS in Simplified
Chinese). OBS 28 was not available on either and was not tested; obs-websocket 5 has kept
the same `rpcVersion: 1` since OBS 28, and every request the plan uses is from 5.0. Source: [OBS Control Task Breakdown](../obs-control-task-breakdown.md) M0; decisions
O1–O12 are the [plan's](../obs-control-plan.md).

The spike client was throwaway Rust code, not merged: `tokio` and `tokio-tungstenite` 0.26 with
the same features the Tauri core already uses, plus `sha2`, `serde_json` and `base64` 0.22.

## Choices for M1

| Concern | Choice | Why |
| --- | --- | --- |
| Connection | `tokio::net::TcpStream::connect` then `tokio_tungstenite::client_async("ws://…", tcp)` | The app builds `tokio-tungstenite` with `handshake` only; `connect_async` needs the `connect` feature, and nothing else is missing. Plain `ws://`, no TLS |
| New dependency | `base64` 0.22 | Only crate missing, as the plan said |
| Event subscriptions | `General (1) | Scenes (4) | Transitions (16) | Outputs (64) | Ui (1024)` | Covers `ExitStarted`, the scene events, stream, record and virtual camera states, and Studio Mode changes. Never subscribe to `InputVolumeMeters` (65536): it fires many times a second |
| Snapshot | `GetSourceScreenshot` of the current program scene, `imageFormat: "webp"`, `imageWidth: 320`, `imageCompressionQuality: 50` | Smallest of the formats tried on both platforms (below); 4–17 ms per request. `webp` is in `supportedImageFormats` on both. JPEG at 50 is the fall-back if a webview cannot draw WebP |
| Studio Mode | `SetCurrentProgramScene` only | It transitions program directly while Studio Mode is on (M0.3); `TriggerStudioModeTransition` is not needed |
| Status | See the table in M0.5 | Every case maps to one status on both platforms |
| Retry timing | Count the three-second retry interval from when the attempt fails, and do not show `connecting` during a refused attempt | On Windows a refused connection to `127.0.0.1` takes about 2.3 s to fail (M0.5); on macOS it fails at once |
| Scene events | Treat `CurrentProgramSceneChanged` as idempotent | Turning Studio Mode off sends it twice more with no change of program (M0.3) |

## M0.1 — Connect, authenticate, `GetVersion`

- [x] **macOS:** connects on `127.0.0.1:4455`; `Hello` carries `rpcVersion: 1`,
      `authentication.challenge` and `.salt`; `Identify` with
      base64(SHA-256(base64(SHA-256(password + salt)) + challenge)) gets `Identified` with
      `negotiatedRpcVersion: 1`. The salt is the same between connections, but the challenge changes each time.
- [x] **macOS**, authentication off in OBS: `config.json` shows `auth_required: false` at once
      (the old `server_password` stays in the file); `Hello` has no `authentication` field, and
      `Identify` without one gets `Identified`. The client sends the authentication string only
      when `Hello` asks for it, so a stored password is harmless when the operator later turns
      authentication off. Settings should therefore not require a password, and when
      `config.json` says `auth_required: false` it should say none is needed.
- [x] **Windows:** the same `Hello` and `Identified` (`negotiatedRpcVersion: 1`, 2 ms);
      `GetVersion` reports `platform: "windows"`. Identifying with no authentication string
      when `Hello` asks for one gets close code **4009**, as a wrong password does.
- [ ] OBS 28 on either platform: not tested (see Status).
- `supportedImageFormats` on macOS: `bmp, cur, heic, heif, icns, ico, jfif, jp2, jpeg, jpg,
  pbm, pgm, png, ppm, tif, tiff, wbmp, webp, xbm, xpm`. On Windows the same without `heic`,
  `heif` and `jp2`; `webp` and `jpeg` are in both.
- `GetVersion.availableRequests` includes every request the plan uses, on both (151 on Windows).

## M0.2 — Screenshot cost

Each figure is the mean of 3 to 15 requests at one a second, at 320 × 180 (16:9 canvas). "Image" is the decoded
size; the wire carries it as a base64 data URL (`data:image/webp;base64,…`), about a third
larger.

| Scene (content) | Format | q30 | q50 | q70 | Round trip |
| --- | --- | --- | --- | --- | --- |
| Logo (image on a dark field) | JPEG | 3.4 KB | 4.1 KB | 5.1 KB | 3–9 ms |
| Logo | WebP | 1.4 KB | 1.9 KB | 2.4 KB | 7–13 ms |
| Website (browser source, busy) | JPEG | 4.2 KB | 5.5 KB | 7.2 KB | 3–6 ms |
| Website | WebP | 2.5 KB | 3.3 KB | 4.3 KB | 12–17 ms |
| Screen (screen capture) | JPEG | 1.8 KB | 1.9 KB | 2.0 KB | 3–7 ms |
| Screen | WebP | 0.6 KB | 0.7 KB | 0.7 KB | 10–14 ms |

On Windows, the mean of 5 requests at one a second for each cell, 320 × 180:

| Scene (content) | Format | q30 | q50 | q70 | Round trip |
| --- | --- | --- | --- | --- | --- |
| Text (GDI+ text source) | JPEG | 3.4 KB | 3.9 KB | 4.6 KB | 1–3 ms |
| Text | WebP | 1.8 KB | 2.1 KB | 2.3 KB | 4–6 ms |
| Image (photo) | JPEG | 5.7 KB | 7.9 KB | 10.6 KB | 1–2 ms |
| Image | WebP | 4.8 KB | 6.7 KB | 8.2 KB | 4–6 ms |
| Video (VLC source, playing) | JPEG | 5.5 KB | 8.0 KB | 10.9 KB | 1–8 ms |
| Video | WebP | 5.0 KB | 7.2 KB | 9.3 KB | 4–9 ms |

- The round trip includes `GetCurrentProgramScene` before the screenshot.
- With photographic and moving content WebP gains less over JPEG (about 10–15 % rather than
  half), but it is still the smaller. The playing video, the nearest thing here to a camera, is
  7.2 KB at q50, about 9.5 KB on the wire: under the plan's estimate of 15 KB/s per watcher.
- `GetSourceScreenshot` accepts any scene by name, not only the program scene, and does not
  change what is on program.
- Choice for O6: **WebP, quality 50, once a second**, about 4–5 KB a second per watcher on the
  wire for a busy still scene and about 10 KB a second for video, against the plan's estimate
  of 15 KB/s. A real camera was not available; M5.3 measures one at a venue.

## M0.3 — Studio Mode

- [x] With Studio Mode on, `SetCurrentProgramScene("Live")` returned success and put "Live" on
      program using the current transition (Fade). The preview scene stayed on "Logo".
- Events, in order: `SceneTransitionStarted`, `SceneTransitionVideoEnded`,
  `CurrentProgramSceneChanged`, `SceneTransitionEnded`. The view updates on
  `CurrentProgramSceneChanged`, which comes when the transition's video ends, not when it starts.
- [x] **Windows:** the same with a target that was neither on preview nor on program: program
      went from "场景 2" to "场景 3" with the current transition (Fade), the preview stayed on
      "场景 2", and the events came in the same order, `CurrentProgramSceneChanged` at about
      320 ms.
- **Windows**, target already on preview: with OBS's **Swap preview and program after
  transition** on (`SwapScenesMode=true` in `%APPDATA%\obs-studio\user.ini`), switching to the
  preview scene put it on program and moved the old program scene to preview, with a
  `CurrentPreviewSceneChanged` event before `CurrentProgramSceneChanged`. That is OBS's own
  behaviour for its own Transition button, so nothing to handle; Worship Q does not show the
  preview.
- Turning Studio Mode off (`SetStudioModeEnabled` false) sends `CurrentProgramSceneChanged`
  twice more for the scene already on program, then `StudioModeStateChanged`. The client must
  treat a repeated scene as no change.
- The plan's open question is answered: no `TriggerStudioModeTransition` needed. The risk in the
  task breakdown §5 is closed.

## M0.4 — obs-websocket's `config.json`

- [x] **macOS:** `~/Library/Application Support/obs-studio/plugin_config/obs-websocket/config.json`,
      readable while OBS runs. Keys: `alerts_enabled`, `auth_required`, `first_load`,
      `server_enabled`, `server_password`, `server_port`. On this computer the server was off
      (`server_enabled: false`) until the operator ticked **Enable WebSocket server**; port and
      password were already there.
- [x] **Windows:** `%APPDATA%\obs-studio\plugin_config\obs-websocket\config.json`
      (`C:\Users\<user>\AppData\Roaming\…`), readable while OBS runs, with the same keys. The
      server was off here too until the operator enabled it, and the file showed
      `server_enabled: true` as soon as they clicked **Apply**.
- O12 stays: the file is the only way to tell "server disabled" from "OBS not running" (M0.5).

## M0.5 — OBS quits, is not running, refuses

| Case | What the client sees | Status |
| --- | --- | --- |
| OBS running, server enabled, right password | `Identified` | `connected` |
| Wrong password | Socket closed during `Identify`, close code **4009**, reason "Authentication failed." | `refused` |
| OBS quits | `ExitStarted` event, then close code **1001** (going away), reason "Server stopping." | `not-running` (may show closing on `ExitStarted`) |
| OBS not running | TCP connection refused (`ECONNREFUSED`, errno 61 on macOS; `WSAECONNREFUSED`, os error 10061 on Windows); `io::ErrorKind::ConnectionRefused` on both | `not-running` |
| OBS running, WebSocket server disabled | TCP connection refused, the same as not running | `not-running`, unless `config.json` says `server_enabled: false`: then the status line says to enable it |

- [x] After quitting and reopening OBS, the client connected on its first try with the same
      password and no change in OBS: the server's settings survive OBS restarts (O7). OBS's
      process started at 17:58:00 and the client was identified at 17:58:05.
- [x] **Windows:** every case behaves as on macOS. Wrong password: 4009 "Authentication
      failed.". OBS quit from the menu: `ExitStarted`, then 1001 "Server stopping." 144 ms
      later. Server disabled while OBS runs: connection refused (10061).
- [x] **Windows**, OBS reopened: refused until OBS had loaded, then the first attempt that
      got through was identified 0.5 s after it started, with no change in OBS. OBS's process
      started at 18:36:35 and the client was identified about 4 s later. The salt changed
      across the restart (it stays the same between connections while OBS runs), so the
      client must read it from every `Hello`, as it does.
- **Windows:** each refused attempt took about **2.3 s** to fail, against an immediate failure
  on macOS: Windows retries a TCP connection that is reset. A three-second retry counted from
  the start of an attempt would therefore loop with almost no pause; count it from the failure.
  The status should stay `not-running` during these attempts rather than flicker to
  `connecting`.
