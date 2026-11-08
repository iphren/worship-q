# Spike M0 — Media uploads

**Status:** done on the `media-spikes` branch; the last check (the entitlement) was confirmed on the signed 2.1.0 build (M6.7, 8 November 2026). M0.1 and M0.5 were run on 7 November 2026 and are done. M0.2 is done on macOS and on Windows. M0.3 is done on macOS, including the entitlement, confirmed on the signed 2.1.0 build. On Windows it is done, with and without a microphone. M0.4 is done on macOS and on Windows. The machine was a MacBook with an Apple M1 on macOS 27.2, with Docker Desktop 29.9 for the Linux images; the Windows runs (8 November 2026) were on Windows 11 with WebView2 157, at 125 % scaling. Source: [Media Uploads Task Breakdown](../media-uploads-task-breakdown.md) M0; the decisions (U1–U23) are the [plan's](../media-uploads-plan.md).

The spike code is throwaway and lives on the branch only, under `spikes/media/`. `make-test-files.sh` recreates the test images and videos. The branch also adds `sharp` to the server, which M1.3 keeps, and a temporary drop probe to the desktop app (`apps/desktop/src/spikeDrop.ts`, with a native geometry command in `src-tauri/src/spike_drop.rs`), which is not merged.

## Choices so far

| Concern | Choice | Why |
| --- | --- | --- |
| Image library | `sharp` 0.35 (libvips 8.18) as a server dependency | Installs through the image's own `pnpm fetch`/`deploy` steps on arm64 and amd64 with no system package; esbuild already leaves packages external (M0.1) |
| Image pipeline | `rotate()` → `resize({ width: 1920, height: 1080, fit: 'inside', withoutEnlargement: true })` → `flatten({ background: '#000000' })` → `jpeg({ quality: 85, mozjpeg: true })`; small copy `fit: 'inside'` 320 × 240 at quality 75 | Every size in §3.2 comes out as planned; orientation and transparency handled (M0.1) |
| Pixel limit | `limitInputPixels: 100_000_000` | A 50-megapixel photo takes 0.3 s (arm64) to 0.5 s (amd64) and about 35 MB of memory; 100 megapixels leaves room for panoramas while refusing decompression bombs |
| HEIC | Refused: "Export the photo as JPEG and try again." | The prebuilt libvips reads HEIF only as AVIF; a `.heic` fails with `bad seek` (M0.1). The desktop could convert HEIC on macOS before sending (`sips`), but that is left out unless operators ask |
| Video formats | `.mp4`, `.m4v`, `.mov`, `.webm` accepted; guidance says "MP4 (H.264) plays everywhere" | H.264 in any of the three containers, HEVC, ProRes and VP9 all load, seek and play in WKWebView (M0.2). AV1 does not, on an M1 |
| Playability check | The uploading computer loads the video in a hidden `<video>` before sending, reads `duration`, `videoWidth` and `videoHeight` from `loadedmetadata`, and refuses the file if that fails within 10 s or `videoWidth` is 0 (ProRes on Windows loads as audio only) | The same step gives U14's fields and catches AV1 and other formats this computer cannot play (M0.2) |
| Upload progress | A counting `Read` around the file inside `Body::sized`, emitting at most ten events a second plus the last one | Accurate and smooth at venue speeds; behind a buffering proxy it reaches 100 % when the proxy has the file, and the hand-over to the server falls inside the processing stage (M0.5) |
| Cancelling an upload | The counting reader returns an error once a cancel flag is set | The request stops at once with a body error; the server sees an aborted stream and must delete its `.partial` (already done by `receive`) (M0.5) |
| Drop position | macOS: `x` as given; `y` minus `innerSize().height / scaleFactor() − window.innerHeight`, measured on each `enter` (32 points on macOS 27), because wry measures from the webview's top edge under the title bar. Windows: `x` and `y` divided by `devicePixelRatio`, no title bar correction (the same formula gives 0 there). `over` repeats are ignored unless the position changed. The drop target is the nearest row, not `elementFromPoint`, because the gaps between rows and the space under the last row hit the list itself | wry 0.57 reports CSS pixels on macOS, offset by the strip under the title bar that the page does not cover, and physical pixels from the page's top on Windows (M0.4) |
| Audio output on macOS | Settings saves the chosen output's id and name. When the slideshow window opens, it asks for audio (`getUserMedia`, track stopped at once) to unlock device ids; the native core then runs one `eval` on that window that calls `setSinkId`, which unlocks later changes without a gesture. The output picker stays on both platforms. On Windows the `eval` is not needed but harmless, so one code path serves both; the picker hides `default` and `communications`, and says so when no devices are listed (no audio input) | `setSinkId` exists but needs a user gesture on macOS; a script run through `evaluateJavaScript` counts as one, and unlocks the document afterwards. Ids are usable only after permission in the same document on macOS; WebView2 needs no gesture, remembers the grant per origin, and keeps ids stable across runs (M0.3) |
| Proxy refusals | A 413 with an HTML body is the proxy's; a 413 with `{ error: 'too-large' }` is ours. A body error ("receiver is gone") after a long upload is reported as "The connection closed while sending. If this happens with every large file, the church server's proxy may limit upload size; see the deployment guide." | nginx answers 413 only if the whole body is sent within its 30 s `lingering_time`; after that it closes the connection and the desktop never sees the status (M0.5) |

## M0.1 — Images on the server

- [x] **Install:** `pnpm --filter @worship-q/server add sharp` puts `@img/sharp-linux-*` and `linuxmusl` builds in the lockfile. A Docker image built with the server Dockerfile's `pnpm fetch`, offline install, build and `deploy --prod` steps (`spikes/media/sharp/Dockerfile`, without the LibreOffice layer) runs `sharp` on both `linux/arm64` and `linux/amd64`. The server bundle still builds, because `packages: 'external'` leaves `sharp` to `node_modules`.
- [x] **Formats (same on macOS, Linux arm64 and Linux amd64):**

  | Input | Result |
  | --- | --- |
  | JPEG 4000 × 3000 | 1440 × 1080, 79–207 ms |
  | JPEG 8165 × 6124 (50 MP, 14.8 MB) | 1440 × 1080, 269–492 ms, about 35 MB more memory |
  | JPEG 4000 × 3000 tagged orientation 6 | 810 × 1080, upright |
  | PNG 1200 × 800 with transparency | 1200 × 800; transparent corner black `(0,0,0)`, half-transparent red blended onto black `(153,1,0)` |
  | GIF 640 × 480, three frames | first frame, 640 × 480 |
  | WebP 2000 × 1500 | 1440 × 1080 |
  | AVIF 1000 × 700 | 1000 × 700 |
  | HEIC (from `sips`) | refused: `bad seek` |
  | Text file named `.jpg` | refused: `Input file contains unsupported image format` |

- [x] **Sizes:** 4000 × 3000 → 1440 × 1080; 3840 × 1080 → 1920 × 540; 1080 × 1920 → 608 × 1080; 1920 × 1080 unchanged; **1921 × 1081 → 1919 × 1080** (not 1920 × 1080: the height decides, and the width rounds down); 800 × 600 unchanged; 1 × 1 unchanged; 1 × 5000 → 1 × 1080; 5000 × 1 → 1920 × 1. §3.2 of the breakdown should name 1919 × 1080 as the expected result.
- [x] **Pixel limit:** with `limitInputPixels: 40_000_000`, the 50-megapixel photo is refused with `Input image exceeds pixel limit` before decoding.

## M0.2 — Video playback in the webviews

The harness (`spikes/media/webview/harness.swift`) opens a real WKWebView in an off-screen window. It loads a probe page in two ways: as a `file://` URL, and through a custom URL scheme handler that answers `Range` requests with 206, as Tauri's asset protocol does. Each video gets its own page load, so one that hangs cannot block the rest. For each video the page waits for `loadedmetadata`, seeks to 15 s, waits for `seeked`, plays muted for 1.2 s, and checks that the position moved.

- [x] **macOS (WKWebView, Apple M1, macOS 27.2):**

  | File | `file://` | Custom scheme with ranges |
  | --- | --- | --- |
  | H.264 MP4 (faststart) | plays, seeks; metadata in 22–83 ms | plays, seeks; 182 ms; 131 range requests |
  | H.264 MP4 (no faststart) | plays, seeks | plays, seeks; 135 range requests |
  | HEVC MP4 (`hvc1`) | plays, seeks | plays, seeks |
  | H.264 M4V | plays, seeks | plays, seeks |
  | H.264 MOV | plays, seeks | plays, seeks |
  | ProRes 422 Proxy MOV | plays, seeks | plays, seeks |
  | VP9 WebM | plays, seeks | plays, seeks; **2 requests, no ranges**: the whole file is read at once |
  | AV1 WebM | never reaches `loadedmetadata` (`canPlayType` empty) | same |

  `duration`, `videoWidth` and `videoHeight` are right for every playable file.
- [x] **Finding: WebM is read whole.** Through a scheme handler, WebKit reads a WebM file in one request, with no ranges, while MP4 and MOV are read in ranges. A 200 MB WebM is held in memory by the slideshow window. That is acceptable at the U1 limit, but the guidance should recommend MP4.
- [x] **Asset protocol itself** (from the source, Tauri 2.12.3 `src/protocol/asset.rs`): a `Range` request is answered with 206, `Accept-Ranges: bytes` and `Content-Range`, each part capped at 1000 KB, and 416 when unsatisfiable. That is what the harness's scheme handler does, so its results stand for the app.
- [x] **Windows (WebView2 157, Windows 11, HEVC Video Extension 2.5 installed), 8 November 2026:** the harness `spikes/media/webview-win` (wry 0.57 and tao 0.37, as in the app) loads the same page through a custom scheme served at `http://spike.localhost`, as Tauri does on Windows, answering `Range` with 206 and capping open ranges at 1 MB.

  | File | Custom scheme with ranges |
  | --- | --- |
  | H.264 MP4 (faststart) | plays, seeks; metadata in 17 ms; 12 range requests |
  | H.264 MP4 (no faststart) | plays, seeks; 13 range requests |
  | HEVC MP4 (`hvc1`) | plays, seeks (with the HEVC extension) |
  | H.264 M4V | plays, seeks |
  | H.264 MOV | plays, seeks (although `canPlayType('video/quicktime')` is empty) |
  | ProRes 422 Proxy MOV | **audio only**: `loadedmetadata` fires and the clock runs, but `videoWidth × videoHeight` is 0 × 0 |
  | VP9 WebM | plays, seeks; **3 range requests**, read in ranges |
  | AV1 WebM | plays, seeks |

  The page is a secure context. `file://` pages get no IPC from wry, so that column was not measured; the app never uses `file://`.
- [x] **Findings for Windows:** ProRes must be refused by the playability check through `videoWidth === 0`, not by a failed `loadedmetadata`, since its audio track loads. WebView2 reads WebM in ranges, so the whole-file read is WebKit's alone. HEVC depends on the HEVC extension, which the playability check already catches on a computer without it.

## M0.3 — Audio devices

- [x] **macOS, without microphone permission:** `HTMLMediaElement.prototype.setSinkId` **exists** in WKWebView. `navigator.mediaDevices` is **missing** unless the app's Info.plist has `NSMicrophoneUsageDescription`. With it, `enumerateDevices()` lists a single unnamed `audioinput` with no id and **no `audiooutput` at all**.
- [x] **macOS, after microphone permission** (answered at the screen, 8 November 2026): once the page has called `getUserMedia({ audio: true })`, `enumerateDevices()` lists every input and output **with names and ids** (seven to nine inputs and six to eight outputs on the test Mac, as devices came and went).
- [x] **A user gesture is required.** `setSinkId(id)` called from the page, and even `setSinkId('')`, fails with `NotAllowedError: A user gesture is required`. The slideshow window never receives a click, and a change made from a phone gives no gesture anywhere.
- [x] **Native script counts as a gesture.** When the app runs the call through WKWebView's `evaluateJavaScript`, which Tauri's `WebviewWindow::eval` uses, `setSinkId(id)` succeeds and `sinkId` matches. After that one call the document is unlocked: 1.5 s later, from a timer with no gesture, the element still has its sink, can be changed to another device, and a **new** `<video>` element can be given a sink too.
- [x] **The id needs permission in the same document.** A fresh page that never called `getUserMedia` lists no outputs. Given the id saved by the earlier page, `setSinkId` fails with `NotFoundError`, even through `evaluateJavaScript`. So the slideshow window must ask for audio itself, then stop the track at once, before it can use the id saved by Settings. Whether the ids stay the same between runs was not measured: Settings should save the device's **name** with its id, and the slideshow should match by id first and by name second.
- [x] **In the app** (8 November 2026, with the probe `apps/desktop/src/spikeAudio.ts`, yellow, top right): **1. Ask for audio** lists 8 outputs with names. **No orange microphone indicator was seen**, because the track is stopped at once. **2. Play on selected in 3 s** waits three seconds, outside any click, then calls `setSinkId` from the page and then through the native eval (`spike_eval`). Both calls succeeded, for the built-in speakers and for AirPods, and `sinkId` matched. The tone came from the chosen device each time. Unlike in the harness, the page call needed no gesture. The likely reason is that the app page had already had real clicks, which unlock media in WebKit, while the harness page never had one. In the real app the operator always clicks before a video plays, so the page call should be enough. The `eval` step stays as a cheap fallback, because the slideshow window never gets a click.
- [x] **Tauri's permission answer on macOS** (from the source, wry 0.57 `wry_web_view_ui_delegate.rs`): with no permission handler, wry answers WebKit's media capture request with `Grant`, so WebKit shows no prompt of its own; only the system's microphone prompt appears, once. With a handler, `Allow` grants and `Default` prompts. One handler that allows `Microphone` (needed on Windows) is therefore right on both platforms.
- [x] **Info.plist** (from the source, tauri-codegen 2.7.2 `context.rs`, and checked on the dev binary): an `Info.plist` beside `tauri.conf.json` is embedded into `tauri dev` builds (`__TEXT,__info_plist`) and merged into the bundle's. The branch adds `apps/desktop/src-tauri/Info.plist` with `NSMicrophoneUsageDescription`; M6.7 keeps it.
- [x] **Entitlement:** releases are signed and notarized (`release.yml`), which needs the hardened runtime, under which microphone access also needs `com.apple.security.device.audio-input` in an entitlements file (`bundle.macOS.entitlements`). This can only be confirmed with a signed build, so it moved to M6.7's first signed build. **Confirmed on 2.1.0** (8 November 2026): `codesign` shows the entitlement, macOS asks for the microphone with the app's description, and the pickers list every device by name.
- [x] **Windows (WebView2 157), on a computer with no microphone** (8 November 2026): `setSinkId` exists and `navigator.mediaDevices` is present. `enumerateDevices()` lists a single unnamed `audiooutput` with no id. `getUserMedia({ audio: true })` fails with `NotFoundError: Requested device not found`, so there is **no way to get output ids or names**. `selectAudioOutput` is missing and the `speaker-selection` permission is "not enabled". From the page with no gesture, `setSinkId('')` and `setSinkId('default')` succeed, and an unknown id fails with `SecurityError: No permission to use requested device`. **So on Windows, the output picker works only on computers with an audio input** (a microphone or a line in); a PC without one can only use the default output.
- [x] **Tauri's permission answer on Windows:** wry 0.57 answers WebView2's `PermissionRequested` only through a permission handler (`with_permission_handler`); Tauri 2.12 passes one through when the app sets it. Without one, WebView2 shows its own prompt. The app should allow `Microphone` for the slideshow window and leave the rest to the default.
- [x] **Windows with a microphone** (a USB microphone plugged in, same day): before permission, `enumerateDevices()` lists the input and output unnamed with no ids. The permission handler is called with `Microphone` and allows it, with no prompt. After `getUserMedia`, every input and output is listed **with names and ids**: `default` and `communications` entries (their labels are prefixed in the system's language, e.g. "默认值 - ", "通信 - ") plus one hashed id per real device.
- [x] **No gesture needed on Windows.** `setSinkId(id)` called from the page, with no gesture, succeeds; so do later changes and a new element. Running it through `evaluate_script` behaves the same. The `eval` step is needed for macOS only.
- [x] **Windows remembers the permission.** Later page loads, and new runs of the harness, list names and ids **without** calling `getUserMedia`: WebView2 keeps the grant per origin in the app's data folder (here `media-webview-spike.exe.WebView2`). The hashed ids are the **same across runs**. An unknown id then fails with `NotFoundError` instead of `SecurityError`.
- [x] **Findings for Windows:** the output picker should list only the hashed devices, not `default` and `communications` (`default` is the empty choice, and their labels are localised). Matching by id then by name works as on macOS. Asking for audio once when the slideshow opens is harmless on Windows, and keeps one code path for both platforms. **A PC with no audio input at all can only use the default output** (see above), so the picker should say so when it lists no devices.

## M0.4 — Dropping files

- [x] **macOS position units** (8 November 2026, photos of the probe): on an external display at scale 1, the dot drawn at `position / devicePixelRatio` sat under the pointer. On the built-in Retina display at scale 2, it landed at half the pointer's position: raw `(546, 558)` was already the pointer in CSS pixels. **On macOS, Tauri's drag-drop position is in CSS (logical) pixels**, despite being typed as a physical position. The app must not divide by the scale factor there. Windows is still to check; until then, assume it reports physical pixels and divide by the scale factor there only.
- [x] **macOS title bar:** with run sheet rows to aim at, on the external display at scale 1 the dot sat about 30 CSS pixels **below** the pointer, and the earlier photos show the same gap. That is the title bar's height. The position is measured from the window's top edge, title bar included, not from the top of the page. Uncorrected, a pointer at the top of row 2 was read as the bottom half of row 2.
- [x] **The title bar cannot be measured from the interface:** on macOS, Tauri reports the same inner and outer position **and** the same inner and outer size (760 and 760), and `window.outerHeight − window.innerHeight` gives a meaningless −728.
- [x] **Cause, in wry 0.57** (`src/wkwebview/drag_drop.rs`, the same on wry's `dev` branch): every drag event computes `y = webview.frame().size.height − draggingLocation().y`. `draggingLocation` is in window coordinates, and the formula assumes the webview's top edge is at `frame.height` in them, which is about 28 points off in Tauri's window.
- [x] **Where the 32 points go:** a spike command, `spike_drop_geometry`, reported the webview's geometry from AppKit. With the window enlarged: webview frame height **1077**, its top edge at 1077 in window coordinates (frame y 0, flipped), window content and frame heights 1077, but the page's `window.innerHeight` **1045**. So the webview fills the whole window, title bar included, and macOS keeps the 32-point strip under the title bar out of the page's visible area. wry measures from the webview's top edge, so its y is 32 too large. The earlier "−728" fits: the page was 728 high in a 760 webview. The title bar is 32 points on macOS 27, not the 28 assumed before.
- [x] **Correction without native code:** `innerSize().height / scaleFactor() − window.innerHeight`, taken on each `enter` (the probe's v5). Confirmed on the external display with the window enlarged: correction 32 (webview 1077 − page 1045), the red dot at the pointer tip and the blue, uncorrected one 32 px below; a pointer at the top of row 4 was read as `row#3 (half: top)`. The native command is not needed. The formula divides by the scale factor, so it holds on the Retina display too. That was confirmed on the built-in display (correction 32 = webview 760 − page 728), with the red dot at the pointer tip. The fix could also be offered to wry, which should take the page's inset into account.
- [x] **Several files:** three files dropped together give one `drop` with all three full paths, in the order they were selected.
- [x] **Leaving:** dragging out of the window gives `leave`.
- [x] **One file:** a single file gives one `drop` with its full path.
- [x] **Reordering still works:** after a file was dropped, rows were reordered by their grip as before.
- [x] **`over` repeats:** `over` fires again and again with the same position while the pointer is still. The drop line should update only when the position changes.

- [x] **Windows position units** (8 November 2026, photos of the probe, Windows 11 at 125 % scaling, WebView2 157): raw `(208, 193)` with `devicePixelRatio` 1.25 gives CSS `(166, 154)`, and the red dot sat at the pointer tip. **On Windows the position is in physical pixels**, measured from the page's top edge: the probe's correction was `webview 760 − page 760 = 0`, so the macOS formula also gives the right answer there.
- [x] **Windows rows:** a pointer on the upper part of row 3 was read as `row#2 (half: top)`, and just under row 4 as `row#3 (half: bottom)`. A few pixels lower, in the gap above the search box, `elementFromPoint` gave the list's `div`, not a row. The real drop target should use the nearest row (or the end of the list) instead.
- [x] **Windows drops:** one file gave one `drop` with its full path (`C:\Users\…\Wallpapers\…_p0.jpg`); three files gave one `drop` with all three full paths. Paths under OneDrive arrive as ordinary local paths.
- [x] **Windows `over` repeats:** successive `over` events moved one pixel at a time; repeats with the same position were filtered as on macOS.
- [x] **Windows leaving and reordering:** dragging out of the window gives `leave`, and rows still reorder by their grip after a drop.
- [x] **macOS and Windows:** run `pnpm dev` on this branch. A green panel in the bottom-right corner logs Tauri's drag-drop events, and a red dot marks where the converted position lands. Open the run sheet editor and drag one file, then three files, from Finder or Explorer over the rows. Check:
  - the dot follows the pointer on Windows at 150 % scaling, which confirms whether Windows reports physical pixels (`position / devicePixelRatio`);
  - the panel names the right row, and whether the pointer is on the row's top or bottom half;
  - `leave` arrives when the drag leaves the window;
  - the dropped paths are complete;
  - after dropping, rows can still be reordered by their grip.

## M0.5 — Upload progress through a proxy

The client (`spikes/media/upload`) is reqwest 0.13.5 blocking, with the same features as the app. It sends a 50 MB file through a counting reader, throttled to 20 MB/s or 1 MB/s. nginx 1.27.5 runs in Docker in front of a Node server that reports when the body's first and last bytes arrived and answers 1.5 s later, as if processing.

- [x] **Direct to the server:** progress events every 100 ms, 100 % at 3.6 s; the server got the last byte at the same moment; answer at 5.2 s.
- [x] **nginx, request buffering on (the default):** 100 % at 3.6 s, when nginx has the file. The server received the whole body in **101 ms** after that, from nginx's buffer, then answered. On a real server the hand-over is local, so it stays inside the processing stage.
- [x] **nginx, `proxy_request_buffering off`:** same as direct.
- [x] **nginx, `client_max_body_size 10m`, 50 MB at 20 MB/s:** nginx did not stop the upload. The client sent all of it, then read **413** with nginx's HTML page.
- [x] **The same at 1 MB/s (50 s):** after 29 s nginx closed the connection (`lingering_time`, 30 s). The client got a body error, "send failed because receiver is gone", and **no status**. reqwest does not send `Expect: 100-continue`, so the 413 cannot be learnt before sending.
- [x] **Cancelling at 40 %:** the reader's error ends the request at once (`is_body`); the server never sees the end of the body.
