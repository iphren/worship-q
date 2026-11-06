# Spike M0 — OBS control against a real OBS

**Status:** run on macOS, 6 November 2026, against OBS Studio 33.0.1 with obs-websocket 5.7.6
(macOS 27.2), on the same computer. Windows is still to run: the items marked **Windows**
below. Source: [OBS Control Task Breakdown](../obs-control-task-breakdown.md) M0; decisions
O1–O12 are the [plan's](../obs-control-plan.md).

The spike client was throwaway Rust code, not merged: `tokio` and `tokio-tungstenite` 0.26 with
the same features the Tauri core already uses, plus `sha2`, `serde_json` and `base64` 0.22.

## Choices for M1

| Concern | Choice | Why |
| --- | --- | --- |
| Connection | `tokio::net::TcpStream::connect` then `tokio_tungstenite::client_async("ws://…", tcp)` | The app builds `tokio-tungstenite` with `handshake` only; `connect_async` needs the `connect` feature, and nothing else is missing. Plain `ws://`, no TLS |
| New dependency | `base64` 0.22 | Only crate missing, as the plan said |
| Event subscriptions | `General (1) | Scenes (4) | Transitions (16) | Outputs (64) | Ui (1024)` | Covers `ExitStarted`, the scene events, stream, record and virtual camera states, and Studio Mode changes. Never subscribe to `InputVolumeMeters` (65536): it fires many times a second |
| Snapshot | `GetSourceScreenshot` of the current program scene, `imageFormat: "webp"`, `imageWidth: 320`, `imageCompressionQuality: 50` | Smallest of the formats tried (below); 10–15 ms per request. JPEG at 50 is the fall-back if a webview cannot draw WebP |
| Studio Mode | `SetCurrentProgramScene` only | It transitions program directly while Studio Mode is on (M0.3); `TriggerStudioModeTransition` is not needed |
| Status | See the table in M0.5 | Every case maps to one status |

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
- [ ] **Windows:** same, and against OBS 28.
- `supportedImageFormats` on macOS: `bmp, cur, heic, heif, icns, ico, jfif, jp2, jpeg, jpg,
  pbm, pgm, png, ppm, tif, tiff, wbmp, webp, xbm, xpm`. **Windows:** record whether `webp` is in the list.
- `GetVersion.availableRequests` includes every request the plan uses.

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

- The round trip includes `GetCurrentProgramScene` before the screenshot.
- `GetSourceScreenshot` accepts any scene by name, not only the program scene, and does not
  change what is on program.
- Choice for O6: **WebP, quality 50, once a second**, about 4–5 KB a second per watcher on the
  wire for a busy scene, against the plan's estimate of 15 KB/s. A camera scene is noisier and was not
  available; M5.3 measures one at a venue.

## M0.3 — Studio Mode

- [x] With Studio Mode on, `SetCurrentProgramScene("Live")` returned success and put "Live" on
      program using the current transition (Fade). The preview scene stayed on "Logo".
- Events, in order: `SceneTransitionStarted`, `SceneTransitionVideoEnded`,
  `CurrentProgramSceneChanged`, `SceneTransitionEnded`. The view updates on
  `CurrentProgramSceneChanged`, which comes when the transition's video ends, not when it starts.
- The plan's open question is answered: no `TriggerStudioModeTransition` needed. The risk in the
  task breakdown §5 is closed.

## M0.4 — obs-websocket's `config.json`

- [x] **macOS:** `~/Library/Application Support/obs-studio/plugin_config/obs-websocket/config.json`,
      readable while OBS runs. Keys: `alerts_enabled`, `auth_required`, `first_load`,
      `server_enabled`, `server_password`, `server_port`. On this computer the server was off
      (`server_enabled: false`) until the operator ticked **Enable WebSocket server**; port and
      password were already there.
- [ ] **Windows:** expected `%APPDATA%\obs-studio\plugin_config\obs-websocket\config.json`;
      confirm, and that it is readable while OBS runs.
- O12 stays: the file is the only way to tell "server disabled" from "OBS not running" (M0.5).

## M0.5 — OBS quits, is not running, refuses

| Case | What the client sees | Status |
| --- | --- | --- |
| OBS running, server enabled, right password | `Identified` | `connected` |
| Wrong password | Socket closed during `Identify`, close code **4009**, reason "Authentication failed." | `refused` |
| OBS quits | `ExitStarted` event, then close code **1001** (going away), reason "Server stopping." | `not-running` (may show closing on `ExitStarted`) |
| OBS not running | TCP connection refused (`ECONNREFUSED`, errno 61 on macOS) | `not-running` |
| OBS running, WebSocket server disabled | TCP connection refused, the same as not running | `not-running`, unless `config.json` says `server_enabled: false`: then the status line says to enable it |

- [x] After quitting and reopening OBS, the client connected on its first try with the same
      password and no change in OBS: the server's settings survive OBS restarts (O7). OBS's
      process started at 17:58:00 and the client was identified at 17:58:05.
- [ ] Whether a connection during OBS's start-up is accepted and then held before `Hello`, or
      refused until OBS has loaded: not isolated here. M1.2's retry loop covers both.
- [ ] **Windows:** connection refused maps to `WSAECONNREFUSED` (10061); the close codes are OBS's
      and should be the same.
