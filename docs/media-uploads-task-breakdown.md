# Worship Q — Media Uploads Task Breakdown

**Drafted:** 7 November 2026  
**Status:** Done. M1–M7 complete: released in version 2.1.0 and accepted by the M7.1 walkthrough (8 November 2026); one fix from the walkthrough follows in the next release. See the [acceptance record](acceptance/media-uploads.md).  
**Source:** [Media Uploads Plan](media-uploads-plan.md), referred to here as "the plan", and the code at version 2.0.0. Decisions (U1–U21) are the plan's.

## 1. How to read this

The plan says what the feature delivers and why. This document breaks it into tasks small enough to be one pull request, says where in the repository each lands, and names the tests that prove it. Task identifiers are `M<milestone>.<n>`; a task lists the tasks it needs first. Sizes are S, M and L as in the phase plans.

Every task that changes business logic carries unit tests in its package. §3 lists the business rules and edge cases those tests must cover, area by area; a task's Tests column names the main cases, and §3 is the full list a pull request is checked against. Every server route carries a test in `apps/server/src`, next to `decks/route.test.ts`, and every protocol change a case in `apps/server/src/versions.test.ts`. The native core's transfers are tested in Rust against a small HTTP server inside the test. The desktop and phone interfaces have no automated tests; the M7 walkthrough covers them.

### Where things live today

| Concern | Location |
| --- | --- |
| Record schemas: songs with `deck` and `website`, `LIBRARY_TYPES` (`slides`), `libraryTypeOf` | `packages/protocol/src/records.ts` |
| Wire messages, protocol version (4, minimum 2), `ServerInfo`, snapshot item kinds (`lyrics`, `deck`, `website`), phone commands (`addItem.afterItemId`) | `packages/protocol/src/wire.ts` |
| Live state and its commands | `packages/protocol/src/records.ts` (`LiveStateSchema`, `CommandSchema`), `packages/live-state/src/index.ts` |
| Server routes: `/api/v1/info`, files, `POST /api/v1/decks`, upload size (`receive`, `MAX_FILE_BYTES`) | `apps/server/src/app.ts` |
| Slide conversion (LibreOffice, Ghostscript), one at a time | `apps/server/src/decks/convert.ts`, `queued` in `app.ts` |
| Workspace and Church Library file folders; deck originals moved with their images | `apps/server/src/files.ts` |
| Retention sweep and the files records use (`filesInUse`) | `apps/server/src/retention.ts`, `apps/server/src/instance.ts` |
| Storage monitor (U11) | `apps/server/src/storage.ts`, `apps/admin/src/pages/Storage.tsx` |
| Native transfers: background files, `import_deck`, backups | `apps/desktop/src-tauri/src/cloud.rs`, bindings in `apps/desktop/src/platform/native.ts` |
| Deck import in the interface: `decksAvailable`, `importDeck` | `apps/desktop/src/app/cloud.ts` |
| File synchronization: which files are uploaded and fetched | `packages/sync/src/index.ts`, `AppliedChanges.backgroundFiles` in `packages/store/src/sync.ts` |
| Local database and its migrations | `packages/store/src/store.ts`, `migrations.ts` |
| Run sheet edits, including a follower's edits sent to the coordinator | `packages/session/src/index.ts` (`addSong`, `moveItem`) |
| Library page and its tabs; the Slides import | `apps/desktop/src/pages/SongsPage.tsx` (`ImportSlides`) |
| Song editor, with `DeckForm` | `apps/desktop/src/components/SongForm.tsx` |
| Run sheet editor (calendar, and Live's edit tab); Live's run sheet column | `apps/desktop/src/components/RunSheetEditor.tsx`, `apps/desktop/src/pages/PresentPage.tsx` |
| Kind badges | `apps/desktop/src/components/DeckBadge.tsx` |
| Frame building, slideshow drawing (background videos) | `packages/renderer/src/frame.ts`, `Slide.tsx` |
| Slideshow window, browser output pages | `apps/desktop/src/output/OutputApp.tsx`, `apps/output/src/OutputPage.tsx` |
| Keyboard shortcuts | `apps/desktop/src/lib/shortcuts.ts` |
| Per-computer settings outside the workspace databases | `apps/desktop/src/app/deviceSettings.ts` |
| Phone remote: host and page | `packages/remote/src/index.ts`, `apps/remote/src/RemoteApp.tsx` |
| Admin library tabs and labels (`Slides`) | `apps/admin/src/pages/Library.tsx`, `Workspace.tsx` |
| Interface strings | `apps/desktop/src/i18n/en.ts` |

### Four facts that shape the tasks

- **Only the native core sees the file's bytes.** Uploads stream from disk to the network in Rust (`cloud.rs`) so that large videos never pass through the interface. Upload progress (U15) must therefore come from the native core as events, and the size check (U2) needs the file's size from the native core.
- **A deck import is one request.** The server converts while the request is open and answers with the deck. The upload stage ends when the last byte is sent; the processing stage lasts until the answer arrives and the images are fetched. No polling or job store is needed.
- **Every deck's images are fetched by every computer.** File synchronization fetches all files a record names (`backgroundFiles`). Images as one-page decks (U13) fit that as they are, but video files must be kept out of it and fetched only for upcoming run sheets (U8).
- **The relay and older desktops read records and messages with schemas.** A new snapshot item kind (`video`) and new live commands need protocol version 5 (U21). An older desktop drops fields it does not know when it saves a song, hence U20.

## 2. Tasks by milestone

### M0 — Spikes (S)

Throwaway code on a branch that is not merged. Ends in `docs/spikes/media.md`.

| # | Task | Where | Done when |
| --- | --- | --- | --- |
| M0.1 | Images on the server: `sharp` installed by `pnpm deploy` in the Docker image on x64 and arm64, and on macOS for development; kept outside the esbuild bundle (it is already `packages: 'external'`); reads JPEG, PNG, WebP, GIF and HEIC; applies camera orientation; time and memory for a 25 MB, 50-megapixel photo; `limitInputPixels` set | spike notes | Formats recorded; HEIC accepted or refused (U13); the pixel limit chosen |
| M0.2 | Video playback in both webviews: MP4 (H.264, HEVC), M4V, MOV and WebM from the asset protocol in WKWebView (macOS) and WebView2 (Windows); seeking across the file (range requests); `duration`, `videoWidth` and `videoHeight` read on the uploading computer before sending | spike notes | Accepted formats fixed for U14; how to read duration and size chosen |
| M0.3 | Audio devices: `navigator.mediaDevices.enumerateDevices` and `HTMLMediaElement.setSinkId` in both webviews; device names before and after microphone permission (macOS `NSMicrophoneUsageDescription` and the app's entitlements; Windows permission handling in WebView2) | spike notes | Open questions 1 and 2 of the plan answered; the macOS fallback chosen |
| M0.4 | Dropping files: Tauri's `onDragDropEvent` (`over`, `drop`, `leave`) with its position, on a Retina screen and on Windows at 150 % scaling; several files at once; check that the run sheet's pointer-based reordering still works with file drops enabled | spike notes | Position-to-row mapping works on both; nothing breaks |
| M0.5 | Upload progress through a proxy: a counting reader around the file in `reqwest::blocking`; what the bar shows behind nginx with request buffering on (the default); what the desktop sees when nginx refuses a body over `client_max_body_size` part-way | spike notes | The progress source is confirmed; the 413 case maps to the U7 message |

**Exit:** `docs/spikes/media.md` records the findings and the choices for M1, M5 and M6.

**Done** on 8 November 2026, on macOS and Windows. The findings are in [the spike notes](spikes/media.md). The one check left, the macOS microphone entitlement, needs a signed build and moved to M6.7. The Windows drop was checked at 125 % scaling, not 150 %; the conversion divides by the scale factor, whatever it is.

### M1 — Server (M)

| # | Task | Where | Needs | Tests | Done when |
| --- | --- | --- | --- | --- | --- |
| M1.1 | Limits (U1, U2): `WORSHIP_Q_MAX_IMAGE_MB`, `WORSHIP_Q_MAX_DECK_MB` and `WORSHIP_Q_MAX_VIDEO_MB` with the defaults of U1; `receive` takes the limit of its route and answers 413 `{ error: 'too-large', limitBytes }`; background files keep today's limit | `app.ts`, `main.ts` | — | Route: a body one byte over the limit is refused and leaves no `.partial` behind; the limit follows the environment | U1 and U2 enforced while receiving |
| M1.2 | What the server offers (U19): `ServerInfo.media` (optional) with `images`, `videos` and `limits` in bytes | `wire.ts`, `app.ts` | M1.1 | Unit: an info without `media` still parses; route: the limits reported are the configured ones | The desktop can check sizes before sending |
| M1.3 | Image import (U13): `POST /api/v1/images?name=` resizes to fit 1920 × 1080 without enlarging, applies orientation, fills transparency with black, writes `deck-<id>-001.jpg` and its `-t` small copy, keeps `deck-<id>-original.<ext>`, and answers a `Deck` with `kind: 'image'`; at most two at once; `DeckSchema` gains the optional `kind`. The pipeline is the spike's: `rotate()`, `resize` (`fit: 'inside'`, `withoutEnlargement`), `flatten` on black, `jpeg` at quality 85 with `mozjpeg`, the small copy at 320 × 240 and quality 75, and `limitInputPixels: 100_000_000`. HEIC is refused (U13) | new `apps/server/src/images.ts`, `app.ts`, `records.ts`, `package.json` | M0.1, M1.1 | Route: 4000 × 3000 becomes 1440 × 1080; 1080 × 1920 becomes 608 × 1080; 800 × 600 stays 800 × 600; a rotated phone photo comes out upright; a PNG with transparency comes out on black; an unsupported format is refused with its message; a `.heic` is refused with the U13 message; an image over 100 megapixels is refused | Images are imported as one-page decks |
| M1.4 | Video upload (U14): `POST /api/v1/videos?name=` stores the file as `video-<uuid>.<ext>` in the workspace's or the Church Library's folder and answers its name and size; the device files route and the output files route accept video names and serve ranges (`ranges.ts`) | `app.ts` | M0.2, M1.1 | Route: stored under the Church Library when the workspace manages `slides`; a range request returns the part asked for; an unknown extension is refused | Videos reach the server |
| M1.5 | Download original (U18): `GET /api/v1/decks/:id/original` sends the kept original with its length and a `content-disposition` naming the deck's source file; 404 `{ error: 'no-original' }` when it was never kept or was pruned | `app.ts`, `files.ts` | — | Route: the original's bytes come back; a deck without one answers 404; another workspace's deck id answers 404 | Originals can be fetched |
| M1.6 | Reconvert (U4): `POST /api/v1/decks/:id/reconvert` converts the kept original again under a new id and answers the new `Deck`; the old images stay until the retention sweep finds them unused | `app.ts` | M1.5 | Route: a new deck with new image names; 404 without an original | Reconvert is available to the desktop |
| M1.7 | Video records (U14): `VideoSchema` (`file`, `source`, `width`, `height`, `durationSeconds`, `bytes`, `autoplay` defaulting to false, U23); `SongFieldsSchema.video`, nullable and null when missing; `libraryTypeOf` counts a video song as `slides`; `deckLyrics`-style text for search is the title only | `records.ts` | — | Unit: an older song without `video` parses with null; a video song is library type `slides` | One schema for all packages |
| M1.8 | Protocol 5 (U20, U21): raise `PROTOCOL_VERSION` to 5, keep the minimum at 2; on a push from a device below 5, a song record without `video` keeps the stored one | `wire.ts`, `instance.ts` | M1.7 | `versions.test.ts`: a version 4 device's title edit keeps the video; a version 5 device can remove it; version 3 and 4 hellos still accepted | Older desktops cannot lose a video |
| M1.9 | Files of video songs: `filesInUse` and the retention sweep include `video.file`; moving files between a workspace and the Church Library (D31) moves video files with their songs; the Storage page counts video items as **Videos** and image items as **Images** (from the deck's `kind`) beside the existing types (U11) | `instance.ts`, `retention.ts`, `files.ts`, `storage.ts`, `admin.ts`, `Storage.tsx` | M1.3, M1.4, M1.7 | `retention.test.ts`: a removed video song's file is swept after the retention days, a used one never; storage: the new types are counted | Videos are kept and removed like everything else |

**Milestone done:** with `curl`, an image and a video upload, an image comes back as a one-page deck at the right size, a file over its limit is refused with 413, and a deck's original downloads byte for byte.

### M2 — Desktop upload pipeline (M)

| # | Task | Where | Needs | Tests | Done when |
| --- | --- | --- | --- | --- | --- |
| M2.1 | Native upload with progress: `upload_media(server, token, uploadId, route, source)` streams the file through a counting reader and emits `media-progress` `{ id, sent, total }` at most ten times a second and once at the end; `cancel_upload(uploadId)` makes the reader fail; 413, 422 and 501 become clear errors (as `import_deck` does now); `file_size(path)` for the size check | `cloud.rs`, `lib.rs`, `native.ts` | M0.5 | Rust, against a server in the test: progress reaches the total and is in order; cancelling stops the request; 413 maps to `too-large` | Progress comes from the core |
| M2.2 | Native download with progress: `download_media(server, token, transferId, path, destination)` writes to `.partial`, renames when complete, emits the same progress events, and can be cancelled; used for Download original and for the video cache | `cloud.rs`, `native.ts` | M2.1 | Rust: a partial file never takes the final name; a cancelled download leaves nothing | One mechanism for both directions |
| M2.3 | Kinds and checks (pure): `mediaKindOf(fileName)` gives `slides`, `pdf`, `image`, `video` or null by extension; `tooBig(kind, bytes, limits)` gives the U7 message with the server's limit; the file dialog's extension lists come from the same table | new `apps/desktop/src/app/media.ts` | M1.2 | Unit: every accepted extension, upper case, unknown ones; the U7 text for each kind | One list of formats |
| M2.4 | Upload queue: `MediaUploads` holds uploads with their file, kind, target (the library, a run sheet date with the item to follow, or a new version of an existing item, U26) and stage: `waiting`, `uploading` (sent, total), `processing`, `failed` (message), `done`; sends one file at a time in the order added; a deck, PDF or image is processing from the last byte until its images are fetched (U15), then becomes a song; a HEIC file is converted first (M2.6); before a video is sent, `probeVideo` loads it in a hidden `<video>` and reads `duration`, `videoWidth` and `videoHeight` on `loadedmetadata`, and refuses it if that fails within 10 s or `videoWidth` is 0 (U14); a video is copied into this computer's storage (U14) and becomes a song straight away; a run sheet target then adds the song after its item (M4.1); **Try again**, **Dismiss** and **Cancel** (while waiting or uploading only) | new `apps/desktop/src/app/uploads.ts`, `cloud.ts` | M2.1, M2.3 | Unit with a fake native core and session: stages in order; a video never processes; a failure keeps its target for Try again; a cancelled upload leaves no song; the item lands after its neighbour, or at the end when the neighbour was removed meanwhile; a file over the limit fails before anything is sent | Uploads carry on across pages (U16) |
| M2.5 | Replace the deck import: `CloudController` exposes the queue and `mediaOffer()` (what the server takes, from `info.media` and `info.decks`, U19) in place of `decksAvailable` and `importDeck` | `cloud.ts` | M2.4 | Unit: an older server offers decks only; no server offers nothing | `ImportSlides` can go |
| M2.6 | HEIC on macOS (U25): native `convert_heic(source)` decodes with ImageIO (`CGImageSource`) and writes a full-size JPEG at quality 0.9 with `CGImageDestination`, keeping the orientation tag, into a temporary file the queue deletes once the upload ends; on Windows it answers `unsupported`, which the queue turns into the U25 message before sending | `cloud.rs` or a new `heic.rs`, `native.ts`, `uploads.ts` | M2.4 | Rust on macOS: a 12-megapixel HEIC fixture gives a JPEG of the same size, with its orientation tag, in under a second; a damaged file gives an error, not a crash. Unit: Windows refuses before any upload | iPhone photos go up from a Mac |

**Milestone done:** from the developer console, queueing an image, a PDF and a video against a local server ends with three songs, and the progress events arrive in order.

### M3 — Media tab and library (M)

| # | Task | Where | Needs | Tests | Done when |
| --- | --- | --- | --- | --- | --- |
| M3.1 | Media tab (U12): the `slides` tab becomes `media` and lists decks, images and videos; strings `library.media*`; kind badges for slides, PDF, image, video and website, each with its icon and colour (U12) | `SongsPage.tsx`, `DeckBadge.tsx`, `en.ts` | M1.7 | `DeckBadge.test.ts`: each kind's badge | The tab reads **Media** |
| M3.2 | **Add media…** with every supported format and several files at once; disabled with the reason when not connected or when the server offers nothing (U19) | `SongsPage.tsx` | M2.5, M3.1 | Manual | One button for everything |
| M3.3 | Progress bars: a shared `UploadProgress` row with the file name, a filling bar with the percentage, and the processing bar: diagonal stripes moving sideways (a repeating linear gradient animated in `styles.css`, static stripes under reduced motion), then the failure line with its buttons | new `components/UploadProgress.tsx`, `styles.css` | M2.4 | Manual | U15 as drawn |
| M3.4 | Library placement (U16): the Media tab's uploads stack under the search box; a finished upload opens its item in the editor unless another item has unsaved changes | `SongsPage.tsx` | M3.3 | Manual | Progress under the search box |
| M3.5 | Media editors: the deck editor names the kind (slides, PDF or image, with the image's size); a new video editor with the title, the **Autoplay** switch (U23, the same form in the run sheet menu's Edit window, M4.6), a muted preview with its own controls, the duration and the size | `SongForm.tsx`, `en.ts` | M1.7 | Unit: saving Autoplay makes a new revision and keeps the rest of the video | Every kind can be renamed and previewed; Autoplay can be set |
| M3.6 | **Download original** (U18): save dialog with the source name, progress while downloading, the not-kept message on 404; a video saves this computer's copy when present | `SongForm.tsx`, `cloud.ts` | M1.5, M2.2 | Unit in `cloud.ts`: local copy first for videos, server otherwise | U18 |
| M3.7 | **Reconvert** for slides and PDFs (U4): sends the kept original back through the processing bar and saves the new deck as the item's next revision | `SongForm.tsx`, `cloud.ts` | M1.6, M3.3 | Manual | U4 |
| M3.8 | Dropping on the library: a dropped file opens the Media tab and is added there only, never to a run sheet | `SongsPage.tsx` | M4.4 | Manual | As the plan's Features say |
| M3.9 | Admin app: the `slides` library type is labelled **Media** in the Library tabs, the workspace's library settings and the plan of what moves to the church; image and video items are badged and previewed | `Library.tsx`, `Workspace.tsx`, `instance.ts` (`libraryType`, `contentOf`) | M1.7 | `admin.test.ts`: a video item is listed with its type | Same name in both apps |
| M3.10 | **Upload new version…** (U26): the button next to Download original, and the same action in the run sheet item menu (M4.6), opens a file dialog with the formats the item's kind can take; the upload's bars show in the editor, or on the run sheet item when started from its menu; when it is ready the item is saved as its next revision with the new deck or video, keeping the title and Autoplay; disabled when not connected, with unsaved changes, or without the right to edit the item | `SongForm.tsx`, `uploads.ts`, `cloud.ts`, `en.ts` | M2.4, M3.3 | Unit in `uploads.ts`: a new-version upload saves a revision of the same song, not a new song; a failed one changes nothing | U26 |

**Milestone done:** a slide deck, a PDF, a photo and a video added from the Media tab each show their bars under the search box and open ready to present, and Download original saves each one unchanged.

### M4 — Run sheet (M)

| # | Task | Where | Needs | Tests | Done when |
| --- | --- | --- | --- | --- | --- |
| M4.1 | Adding at a place: `Session.addSong(date, songId, afterItemId?)` inserts after that item locally, and from a follower sends it in `addItem.afterItemId`, which the coordinator already accepts | `packages/session`, `packages/store` | — | Unit: placed after the item on the coordinator and from a follower; at the end when the item is gone; with nothing live, the run sheet still goes live as today | Items land where dropped |
| M4.2 | Upload rows (U16): the run sheet editor and Live's run sheet column show the uploads aimed at their date as rows at their place, with name, badge and bar; such a row cannot be dragged or presented and has no number; it becomes the ordinary item once ready | `RunSheetEditor.tsx`, `PresentPage.tsx` | M2.4, M3.3 | Unit for the pure merge of items and uploads by position | Progress on the item itself |
| M4.3 | **Add media…** next to the song search in both run sheet editors; adds to the end (U17) | `RunSheetEditor.tsx` | M4.2 | Manual | U17 |
| M4.4 | Dropping files: `useFileDrop` over Tauri's drag-drop events; while files are dragged over an editable run sheet a line shows where they will land; on drop, each compatible file is queued for that place, in order; an incompatible file shows "Worship Q cannot show this kind of file." Positions as found in M0.4: on macOS, `x` as given and `y` minus `innerSize().height / scaleFactor() − window.innerHeight` (the strip under the title bar, 32 points on macOS 27), measured on each `enter`; on Windows, both divided by `devicePixelRatio`. Repeated `over` events at the same position are ignored. The target is the nearest row, not the element under the pointer | new `lib/fileDrop.ts`, `RunSheetEditor.tsx`, `PresentPage.tsx` | M0.4, M4.2 | Unit: `dropIndex(rows, y)` for above, between and below the rows, and scrolled lists | The plan's drag and drop |
| M4.5 | Dropping on Live: an item added during a service never changes what is on screen; other desktops and phones see it once ready | `PresentPage.tsx` | M4.4 | Manual, with a follower and a phone | Safe during a service |
| M4.6 | Run sheet item menu (U27): the ✕ becomes a **⋯** button opening a menu with **Edit…**, **Download original**, **Upload new version…** and **Remove**, in the calendar's editor and Live's run sheet column; **Edit…** opens the item's Edit window in a dialog (lyrics, title, or title and Autoplay for a video); Remove keeps today's confirmation; which actions show and which are disabled follow the item's kind and state; a keyboard-usable menu component | `RunSheetEditor.tsx`, new `components/Menu.tsx`, `PresentPage.tsx`, `CalendarPage.tsx`, `en.ts` | M3.5, M3.6, M3.10 | Unit for the pure choice of actions by kind and state; manual for the menu | Every item's actions in one place |

**Milestone done:** dropping a PDF between items 2 and 3 of today's run sheet shows the bar on a new row there, and after processing the PDF is item 3 on every desktop and phone.

### M5 — Video items (L)

| # | Task | Where | Needs | Tests | Done when |
| --- | --- | --- | --- | --- | --- |
| M5.1 | Store: `video` column on `song` and `song_revision`; read, write and apply from remote; video files are never put in `backgroundFiles` | `migrations.ts`, `store.ts`, `sync.ts` | M1.7 | `store.test.ts`: round trip; an applied video song asks for no file | No video is fetched by plain sync |
| M5.2 | Video cache (U8, U9): `VideoCache` works out the videos in run sheets dated today or later (the workspace's time zone) and in the live run sheet, even past its date, fetches missing ones one at a time with progress (M2.2), and deletes copies nothing upcoming uses; a copy made by uploading counts as wanted on the day it was made; runs after each pull and each run sheet edit | new `apps/desktop/src/app/videoCache.ts`, `cloud.ts` | M2.2, M5.1 | Unit with a fake core and clock: fetched when scheduled; deleted the day after its last date; a video in two run sheets kept until both are past; a failed fetch retried on the next pass | U8, U9 |
| M5.3 | Download state on items (U8): rows of a video item show the download bar until its copy is ready, then nothing; a failure shows **Try again**; presenting a video without a copy says so on the operator's screen and never streams | `RunSheetEditor.tsx`, `PresentPage.tsx` | M5.2, M3.3 | Manual | Operators know a video is ready |
| M5.4 | Presenting a video: snapshot item kind `video` with one piece (protocol 5); `OutputFrame.video` with the file's address; the slideshow draws it full screen on black; the subtitle overlay shows nothing; previews show it muted and paused | `wire.ts`, `session`, `frame.ts`, `Slide.tsx` | M1.8, M5.1 | `frame.test.ts`: a video frame on the slideshow, none on the subtitle overlay, the background never shown behind it | A video can be live |
| M5.5 | Browser outputs and phones: the output pages play it from the server, with sound on the slideshow page; phones show the title and duration in place of a slide | `apps/output`, `packages/remote`, `RemoteApp.tsx` | M5.4, M1.4 | `remote` unit: a video piece in the phone's view | Every screen has something sensible |

**Milestone done:** a video added to next Sunday's run sheet on one desktop is fetched by the other desktop with a bar on the item, plays on its slideshow, and its copy is deleted on Monday.

### M6 — Playback controls and audio (L)

| # | Task | Where | Needs | Tests | Done when |
| --- | --- | --- | --- | --- | --- |
| M6.1 | Video commands (U21): `videoPlay`, `videoPause` and `videoSeek` (to a second) in `CommandSchema` and the phone commands; `LiveState.video` (item, playing, position, the time the position was taken, and `resumeOnUnblank`, set when blanking paused it or Autoplay waits for the screen, U22 and U23); `LiveState.videoPositions` keyed by run sheet item (U22), empty for states saved before it; the relay accepts them | `records.ts`, `wire.ts`, `packages/relay` | M1.8 | Unit: schemas; a live state without the new fields parses; `relay.test.ts`: a phone's `videoPlay` reaches the coordinator; a version 4 follower is sent nothing new | Commands travel |
| M6.2 | Applying them: the reducer plays, pauses and seeks within the duration and reports a video at its end as paused there; leaving a video item saves its position (U22); entering one restores it and plays or waits by Autoplay and the blank screen (U23); blank pauses and unblank resumes only what blank paused; End, Go live on another run sheet and removing the item forget positions | `packages/live-state/src/index.ts`, `packages/session` (removal) | M6.1 | Unit: every case in §3.10 | One clock for every screen, and positions survive the session |
| M6.3 | The slideshow follows the state: play, pause and seek its video when it drifts more than half a second from the live position; sound from the slideshow window (plan Features) and the browser slideshow pages, never from previews | `OutputApp.tsx`, `Slide.tsx` | M6.2, M5.4 | Manual on both platforms | Video plays with sound |
| M6.4 | Control bar on the Present page while a video item is live: play or pause, position and duration, a scrubber, back and forward 10 seconds | `PresentPage.tsx`, new `components/VideoControls.tsx` | M6.2 | Manual | The plan's control bar |
| M6.5 | Shortcuts while a video item is live: Space plays or pauses, Left and Right jump 10 seconds, Up and Down move to the previous and next item; the Help overlay lists both sets | `lib/shortcuts.ts` | M6.2 | `shortcuts.test.ts`: each key with a video live and with a song live | As the plan's Features say |
| M6.6 | The phone's control bar: the same controls on the phone's Live screen while a video is live | `RemoteApp.tsx`, `packages/remote` | M6.1 | `remote` unit: the commands are forwarded with ids and acknowledged | Phones control videos |
| M6.7 | Audio settings on this computer (U24): input and output device pickers with **System default** first, kept with the device settings (not synchronized), saving the id and the name; the pickers hide `default` and `communications`, ask for microphone permission when they open, and say when no devices are listed (a PC with no audio input); the slideshow asks for audio on opening and stops the track at once, finds the device by id then by name, and the native core applies it with one `eval` calling `setSinkId`; a chosen device that is missing falls back to the default with a note. Platform set-up: `src-tauri/Info.plist` with `NSMicrophoneUsageDescription` (from the spike branch); `com.apple.security.device.audio-input` in a `bundle.macOS.entitlements` file, **checked on the first signed build**; a WebView2 permission handler that allows the microphone for the app's own page | `deviceSettings.ts`, `SettingsPage.tsx`, `OutputApp.tsx`, `lib.rs`, `Info.plist`, `tauri.conf.json`, entitlements | M0.3, M6.3 | `deviceSettings.test.ts`: saved and read back; damaged settings read as defaults; matching by id, then by name | Sound goes where chosen, on a signed macOS build too |

**Milestone done:** with a phone, a video item is played, paused and moved through, its sound comes from the chosen output, and a second desktop's slideshow stays within half a second of the first.

### M7 — Acceptance (S)

| # | Task | Where | Needs | Done when |
| --- | --- | --- | --- | --- |
| M7.1 | Walkthrough on macOS and Windows with a coordinator, a follower and a phone, against a server behind nginx: each kind added from the Media tab, the calendar's editor and Live, by button and by dropping; cancel, failure and Try again; a file over each limit; Download original, Upload new version (also of the live item) and Reconvert, from the editor and from the run sheet item menu; an iPhone HEIC photo from a Mac; an older desktop next to video items (U20); a video service played end to end, including leaving and returning to a video, Autoplay on and off, and blanking during a video; the §3.14 checks | `docs/acceptance/media-uploads.md` | M1–M6 | Every scenario passes or has a recorded, accepted exception |
| M7.2 | Deployment guide: the three limits and their variables, the proxy's body limit (U3), nothing more to install for images | `docs/server-deployment.md` | M1.1 | Reviewed |
| M7.3 | Volunteer guide: adding media, the two bars, uploading a new version, iPhone photos, video controls and audio settings | `docs/volunteer-guide.md` | M3–M6 | Reviewed by a volunteer |
| M7.4 | Spec write-back: media items, the Media tab and the audio settings in the requirements | `docs/worship-q-requirements-and-architecture.md` | M7.1 | Spec matches the release |
| M7.5 | Release by release-please | — | M7.1 | Released |

## 3. Business rules and edge cases to test

Each subsection names the rules the feature must keep, then the cases that prove them, and the test file they live in. "Given … then …" cases are unit or route tests unless marked **manual**, in which case they belong to the M7.1 walkthrough. A case that turns out impossible to automate moves to the walkthrough with a note in the acceptance record, never silently.

### 3.1 File kinds and size limits (U1, U2, U7, U19)

`apps/desktop/src/app/media.test.ts`, `apps/server/src/app` route tests

Rules: the kind comes from the extension alone, ignoring case; each kind has its own limit; the desktop refuses before sending, and the server refuses while receiving, whatever the desktop said.

- `.PPTX`, `.Key`, `.pdf`, `.JPG`, `.jpeg`, `.webp`, `.gif`, `.mp4`, `.MOV`, `.m4v`, `.webm` each map to their kind; `.heic` and `.HEIF` are images that need converting (U25): accepted on macOS, refused on Windows with the U25 message; `.txt`, `.docx`, a name with no extension and a name ending in a dot map to null.
- A file named `slides.pdf.mp4` is a video; a file named `.mp4` (no base name) is refused.
- A file exactly at the limit is accepted; one byte over is refused, on the desktop and on the server.
- An empty file (0 bytes) is refused with "This file is empty."
- The U7 message shows the file's size and the limit in MB rounded the same way, and names the kind ("video", "image", "slide deck").
- The limits come from the server's `info`; when the server changes a limit, the next upload uses the new one (the desktop does not keep an old copy past a reconnect).
- A server without `info.media`: decks and PDFs offered, images and videos refused with the U19 message, before any upload starts.
- A server with `decks: false` but `media.images: true`: images offered, decks and PDFs refused with "Your church's server cannot convert slides yet."
- The server answers 413 with `limitBytes` and leaves no `.partial` file; a body that stops part-way also leaves none.
- An upload whose declared content length differs from what arrives is refused.

### 3.2 Image processing on the server (U13)

`apps/server/src/images.test.ts`, with images made in the test

Rules: fit within 1920 × 1080 keeping the aspect ratio, never enlarge, upright by camera orientation, transparency on black, JPEG out, original kept unchanged.

- 4000 × 3000 → 1440 × 1080; 3840 × 1080 → 1920 × 540; 1080 × 1920 → 608 × 1080 (rounded, never 1081); 1920 × 1080 stays exactly; 1921 × 1081 → 1919 × 1080 (the height decides; the width rounds down); 800 × 600 stays 800 × 600; 1 × 1 stays 1 × 1; 1 × 5000 → 1 × 1080; 5000 × 1 → 1920 × 1 (spike M0.1).
- A photo whose orientation tag says rotated 90° comes out upright, with width and height swapped before fitting.
- A PNG with transparent areas comes out black there, not white.
- An animated GIF gives its first frame.
- The deck answered has one page, `slide: 1`, `step: 0`, empty text, `kind: 'image'`, `source` the uploaded name, and `width`/`height` of the image written.
- The small copy fits within 320 × 240.
- The original on disk has the uploaded bytes exactly, under `deck-<id>-original.<ext>` with the uploaded extension in lower case.
- A file with an image extension that is not an image (a renamed text file) is refused with 422 and its message, and leaves no files.
- An image larger than the pixel limit chosen in M0.1 is refused with its message rather than exhausting memory.
- Two images at once both succeed; a third waits rather than failing.
- The image goes to the Church Library's folder when the workspace manages `slides`, to its own otherwise.

### 3.3 Videos, originals and reconvert on the server (U4, U14, U18)

`apps/server/src/app` route tests

- A video is stored under a new `video-<uuid>.<ext>` whatever its uploaded name; names with path separators or `..` cannot escape the folder.
- The files route serves a video with ranges: `bytes=0-99` gives 100 bytes and 206; a range past the end gives 416.
- The output files route (output token) serves video names and refuses other workspaces' files.
- `GET …/original` gives the bytes, the length and a download name that is the deck's source name, with quotes and non-ASCII characters encoded correctly.
- `GET …/original` for a deck from before originals, for a pruned original, for another workspace's deck, and for a malformed id: 404, never 500.
- A Church Library deck's original is found from a workspace that uses it.
- Reconvert gives new image names; the old images stay on disk until the retention sweep finds no record using them; the original is kept under the new id as well, so the item can be reconverted again.
- Reconvert while another conversion runs waits its turn.

### 3.4 Records, sync and older desktops (U14, U20, U21)

`packages/protocol/src/index.test.ts`, `packages/store/src/store.test.ts`, `apps/server/src/versions.test.ts`, `sync.test.ts`

- A song record without `video` parses with `video: null`; a video without `autoplay` parses with `autoplay: false`.
- A deck without `kind` is slides; an unknown `kind` value is slides, not a parse failure.
- A video song is library type `slides`; it never counts as `songs` or `websites` for D31 management.
- Applying a remote video song stores the video and asks for no file download (`backgroundFiles` stays empty); applying a remote image deck asks for its image as today.
- A song revision keeps the video, so history and restore bring back the video and its Autoplay setting.
- A version 4 device pushes a video song without `video` (a title edit): the server keeps the video and the new title.
- A version 5 device pushes the same song with `video: null`: the video is removed.
- A version 4 device pushes a song that never had a video: nothing is added.
- A version 3 and a version 4 hello are still accepted; a version 4 follower receives no video commands or `video` snapshot items.
- Moving a video song to the Church Library and back moves its file; a file another record still uses is copied, not moved.
- Retention: the file of a video song removed longer ago than the retention days is swept; one removed recently, or still used by another song, is kept.

### 3.5 Upload queue (U15, U16)

`apps/desktop/src/app/uploads.test.ts`, with a fake native core, server and session

Rules: one file is sent at a time, in the order added; stages only move forward, except Try again; nothing is created until the media is ready.

- An image goes `waiting → uploading → processing → done`; a video goes `waiting → uploading → done` and never shows `processing`.
- Progress never goes backwards and never passes 100 %; a final event with `sent == total` arrives even when the file is smaller than one progress step.
- A zero-progress gap (stalled network) keeps the stage `uploading`; it does not time out into `failed` before the native core gives up.
- Three files added together are sent one after another; the second shows `waiting` until the first finishes uploading (processing of the first does not block sending the second).
- Cancel while waiting removes the entry; Cancel while uploading stops the request and leaves no song and no file on the server; Cancel is not offered while processing.
- A failure during upload, during processing (422 with the server's message), and while fetching the converted images each end in `failed` with a readable message, and no song is created.
- Try again after a failure sends the file again from the start, to the same target.
- Try again when the source file was moved or deleted fails with "The file is no longer at …".
- Dismiss removes a failed entry and nothing else.
- Losing the connection mid-upload fails the entry; it does not retry by itself.
- Revoked device (401) fails every waiting entry with the sign-in message instead of trying each.
- A video that this computer cannot load within 10 s, or that loads with `videoWidth` 0 (sound only), fails before sending with the U14 message; nothing is uploaded. The duration and size read are the ones saved in the song.
- A video is copied into this computer's storage before its song is created, so it plays here without a download; a failed copy fails the entry.
- The song's title is the file name without its extension; a name of only an extension uses "Untitled".
- Two files with the same name become two items.
- Quitting the app drops the queue; on the next start nothing is half-created.

### 3.6 Placing items in a run sheet (U16, U17)

`packages/session/src/index.test.ts`, `apps/desktop/src/components` pure helpers

Rules: an item lands after the item it was dropped below, or first when dropped above everything, or last from the **Add media…** button; placeholders are never records.

- Dropped between items 2 and 3: the new item is item 3, on the coordinator and from a follower (`addItem.afterItemId`).
- Dropped above the first item: it becomes item 1 (`afterItemId: null`).
- The item it was to follow was removed while uploading: the new item goes last.
- The item it was to follow was moved: the new item still follows it, at its new place.
- Two uploads aimed after the same item land in the order they were added, not the order they finished.
- The run sheet's date passed, or its run sheet was deleted, while uploading: the media stays in the library and the entry says it could not be added to that run sheet.
- With nothing live, adding to an editable run sheet makes it live as today; adding during a service never changes what is on screen.
- A placeholder row is not numbered, cannot be dragged, presented or removed by ✕, and other rows' numbers do not shift until it is ready.
- Placeholders appear only in the run sheet of their own date: browsing another date in the calendar does not show them.
- Other desktops and phones never see a placeholder.
- Run sheet not editable (a past date, or read-only): no **Add media…**, and dropping shows nothing.

### 3.7 Dropping files (M4.4, M3.8)

`apps/desktop/src/lib/fileDrop.test.ts`

- `dropIndex` above the first row's middle → 0; below the last row's middle → the row count; between rows → the row after; on an empty run sheet → 0.
- The list scrolled: positions are taken from the visible rows, not from the top of the list.
- Positions from the native event are converted as M0.4 found: on macOS, already in CSS pixels, less the title bar strip (Retina and scale 1 give the same result); on Windows, divided by the scale factor (125 %, 150 %).
- A pointer over the gap between rows, or below the last row, still gives the nearest row's place.
- Several files dropped together keep their order and land together at the same place.
- A mix of supported and unsupported files: the supported ones are added and one message lists the rest.
- A folder dropped: refused with the unsupported message, not opened.
- Dragging files over the window outside the run sheet shows no line; leaving the window clears it.
- Dropping on the library while the Songs or Web tab is open switches to Media and adds to the library only, never to a run sheet.
- Reordering items by their grip still works after files have been dropped (**manual**).

### 3.8 Media tab (U12)

`apps/desktop/src/components/DeckBadge.test.ts`, `packages/search` tests

- The Media tab lists slide decks, PDFs, images and videos; the Songs tab lists none of them; the Web tab only websites.
- Each item's badge matches its kind, in that kind's colour, the same in the library, run sheets, Live and search; a deck from before `kind` shows the slides badge, or the PDF badge when its source ends in `.pdf`.
- Searching the Media tab finds a video or an image by title; slides also by their text.
- Pinned media lead the list as pinned songs do.
- Removing a media item used on past dates gives the same "used on …" warning as a song.
- A church item hidden rather than removed (spec §5) behaves the same for media.

### 3.9 Download original and Upload new version (U18, U26)

`apps/desktop/src/app/cloud.test.ts`, `uploads.test.ts`, Rust tests for `download_media`

- A deck, PDF and image item each save the original's bytes under the source name offered in the save dialog.
- A video saves this computer's copy when it has one, without the network; otherwise it downloads from the server.
- The save dialog cancelled: nothing is downloaded.
- 404 from the server: the button shows "The original file was not kept for this item." and stays disabled for that item.
- Not connected: the button is disabled with the connect message, except for a video this computer has.
- The download fails part-way: no file is left at the chosen place (the `.partial` is removed).
- The chosen place already has a file: the save dialog's own overwrite question decides; nothing is overwritten silently.
- A new version of a deck, PDF or image item accepts a deck, PDF or image; a video item accepts only a video, and refuses anything else with the U26 message before sending.
- A new version keeps the song's id, title, Autoplay and every run sheet item that uses it; no run sheet changes.
- Download original after a new version saves the new file under its name; restoring the previous revision from history brings back the old deck or video, and Download original then saves the old file again.
- A new version that fails, is cancelled or is over the limit leaves the item as it was, with no new revision.
- Two new versions queued for the same item: they are sent in order, and the last one to finish is the item's version.
- The item is deleted while its new version uploads: the upload finishes, and no song is recreated; the uploaded files are left to the retention sweep.
- The item has unsaved edits: the button is disabled with "Save your changes first."
- A Church Library item seen from a workspace that only uses it: the button is not offered.
- A new deck for the live item: the displays update on the same slide number, or the last slide when the new deck is shorter (**manual**).
- A new video for the live video item: the old one keeps playing; presenting the item again starts the new one at 0:00, whatever position was remembered (**manual**).
- On another desktop, a new video is downloaded for upcoming run sheets and the old copy is deleted when nothing else uses it.

### 3.10 Live video state: position memory, autoplay, blank (U22, U23)

`packages/live-state/src/index.test.ts`, with a fixed clock

Rules: one position per run sheet item for the life of the live state; on entry the remembered position is restored and the video plays only with Autoplay and an unblanked screen; blank pauses, and unblank resumes only what blank paused.

Entry and memory:

- First entry to a video item without Autoplay: paused at 0.
- First entry with Autoplay: playing from 0, its position counted from the entry time.
- Played to 42 s, then another item presented: the item's position is saved as 42 s; presenting the video item again restores 42 s, paused without Autoplay, playing with Autoplay.
- The same, but leaving by Next, Previous, Next item, Previous item, a click in the run sheet, a phone's tap, and Clear: each saves the position.
- Paused at 42 s and left: restored at 42 s.
- Left at its end (within half a second of the duration, or ended by itself): the next entry starts at 0.
- Seeked to 10 s and left without playing: restored at 10 s.
- Presenting the video item that is already live (clicked again, or its only piece played again): position and playing state unchanged.
- Two items in the run sheet with the same video: each remembers its own position.
- Presenting a slide of another deck and coming back: still the remembered position (the memory is per item, not "last item").
- End: positions forgotten; going live again starts every video at 0 (or plays from 0 with Autoplay).
- Go live on another run sheet: positions forgotten.
- The item removed from the run sheet: its position forgotten; adding the same video again starts at 0.
- A position remembered beyond the duration (the video was replaced by an edit): clamped to the duration, so the next entry starts at 0.
- A live state saved before `videoPositions` existed loads with no positions and works.

Play, pause and seek:

- Play then pause after 5 s of clock: position advanced by 5 s.
- Seek to −3 s gives 0; seek past the duration gives the end and pauses there.
- A video playing past its duration is reported paused at its end, without any command.
- Play at the end starts again from 0.
- A repeated command (same id) is applied once, as for other live commands.
- A video command while a non-video item is live is ignored and not an error.
- A video command naming an item that is no longer live (a slow phone) is ignored.

Blank:

- Blank while playing: paused at the current position, `resumeOnUnblank` set; unblank: playing again from there.
- Blank while paused: stays paused; unblank: stays paused.
- Blank while playing, then the operator pauses while blank: unblank leaves it paused.
- Blank while playing, then the operator plays while blank: it plays while blank (hidden), and unblank changes nothing.
- Entering an Autoplay video while blank: paused at its remembered position with `resumeOnUnblank` set; unblank starts it.
- Entering an Autoplay video while blank, then the operator presses pause: unblank leaves it paused.
- Entering a video without Autoplay while blank: unblank leaves it paused.
- Blank, then leaving the video item: its saved position is the paused position, and `resumeOnUnblank` does not carry over to the next item.

Autoplay changes:

- Autoplay turned on while the video is live and paused: nothing starts; the next entry plays.
- Autoplay turned off while it is playing: it keeps playing; the next entry waits.
- Autoplay saved on one desktop reaches the coordinator through sync before the next entry; until then the coordinator's copy decides (no flip-flop on the screen).

Coordinator changes:

- The coordinator hands over (or a follower takes over offline, plan M5.8) while a video plays: the new coordinator continues from the position and time in the live state, and remembered positions survive the handover.
- Clocks of two desktops a few seconds apart: both slideshows show the same moment within half a second. Nothing in the live state corrects for clock differences today, so M6.1 adds a clock offset learned from the coordinator's messages; tested with a follower clock 5 s ahead and 5 s behind.

### 3.11 Shortcuts while a video is live (M6.5)

`apps/desktop/src/lib/shortcuts.test.ts`

- With a video item live: Space plays or pauses; Left and Right jump 10 s back and forward, stopping at 0 and at the end; Up and Down go to the previous and next item.
- With a song or deck live: every key does what it does today.
- With a video live and the screen blank: Space plays or pauses (it does not unblank).
- Up on the first item and Down on the last do what Previous item and Next item do there today.
- Keys typed into a text field are never taken as shortcuts, as today.
- A video item keyed (moved to without presenting it): the slide keys act as today until it is presented.

### 3.12 Slideshow, previews and outputs (M5.4, M6.3, M6.7)

`packages/renderer/src/frame.test.ts`; the rest **manual**

- A video frame on the slideshow carries the video's address, playing state and position; the subtitle overlay's frame carries none and shows no lyrics; no song background is drawn behind a video.
- A video frame while blank shows the background and no video.
- Previews in the main window never play sound and never move unless the live video moves.
- The slideshow seeks only when it drifts more than half a second from the live position; it does not stutter on every state update (**manual**).
- A video without a copy on this computer shows a black screen on the slideshow and "This video is not downloaded yet" on the operator's screen; it never streams (**manual**).
- Browser slideshow pages play the sound; where the browser blocks it until the page is clicked, the video plays muted with **Click for sound** (**manual**).
- The chosen output device is used on a signed macOS build and on Windows, with no click in the slideshow window, and no microphone prompt or indicator after the first permission (**manual**).
- A device saved with an id that changed is found by its name (**manual**).
- A Windows PC with no audio input: the picker lists nothing, says the system default is used, and video sound plays there (**manual**).
- The chosen output device is used; unplugging it falls back to the system default and the setting says so; plugging it back in does not switch back by itself mid-video (**manual**).

### 3.13 Video cache (U8, U9)

`apps/desktop/src/app/videoCache.test.ts`, with a fake core and clock

- A video added to today's run sheet, or any later date's, is fetched; one only in past run sheets is not.
- "Today" follows the workspace's time zone: at 23:30 local time on the day of a service, that day's run sheet still counts.
- The day after its last date, its copy is deleted; a video also in a later run sheet is kept, and so is one in a run sheet still live past its date.
- A video in the library only is not fetched; the uploader's own copy is kept on the day it was made and deleted after that unless scheduled.
- A video removed from a run sheet and added back the same day is not deleted in between if a pass has not run; if it was deleted, it is fetched again.
- Several videos are fetched one at a time; the one in the earliest run sheet first.
- A failed fetch is retried on the next pass; a partial file never counts as a copy.
- Disk full while fetching: the entry fails with "Not enough space on this computer" and the partial file is removed.
- A video whose song was removed but which an upcoming run sheet still uses is still fetched (removed items still present, as songs do).
- Copies never belonging to any record (left by a crash) are deleted.

### 3.14 Checks for the walkthrough (manual)

- Progress bars: the upload bar fills smoothly for a 200 MB video on venue Wi-Fi; the processing stripes move and stop moving under reduced motion; the bar sits on the run sheet item in the calendar and in Live, and under the search box in the library.
- Moving between Library, Calendar and Live during an upload: the bars carry on and nothing is lost.
- Two desktops add media to the same run sheet at once: both items land, in their places.
- A 200 MB deck behind nginx with the default `client_max_body_size`: the U7-style message, not a raw error, and the guide's setting fixes it.
- An image item and a video item on a desktop still on protocol 4 (U20): the image presents, the video shows nothing, and renaming the video there does not remove it.
- A Sunday run: a video with Autoplay entered from a song; a video without Autoplay played from a phone; leaving a video mid-way for a reading and returning to the same moment; blank and unblank during a video; End and Go live, after which videos start from the beginning.

### 3.15 HEIC photos (U25)

Rust tests for `convert_heic` on macOS; `uploads.test.ts`

- A HEIC photo on macOS is converted, uploaded as JPEG, and comes back as a one-page deck at the right size and upright (a portrait photo with orientation 6 is portrait).
- Download original of a converted HEIC saves `<name>.jpg`, and the item's title is the file name without its extension, as for any image.
- The temporary JPEG is deleted after the upload, also after a failure or a cancel.
- A damaged `.heic` fails with "This photo could not be read." and nothing is sent.
- A `.heic` on Windows is refused before sending with the U25 message.
- A `.heic` sent straight to the server (an older desktop, `curl`) is refused with the U13 message.

### 3.16 Run sheet item menu (U27)

`apps/desktop/src/components/RunSheetEditor.test.ts` for the actions, the rest **manual**

- A lyrics song and a website show **Edit…** and **Remove** only; a slide deck, PDF, image and video show all four.
- A song removed from the library shows **Download original** (media only) and **Remove**.
- A run sheet that cannot be edited shows **Download original** only, and no menu for a lyrics song or a website.
- Not connected: **Download original** and **Upload new version…** are shown disabled with the connect message, except Download original of a video this computer has.
- **Edit…** on a video opens the title and **Autoplay**; saving Autoplay makes a new revision, and the change shows on every run sheet that uses the video.
- **Edit…** in the calendar's editor and in Live edit the same song; a lyrics edit made from the menu during a service updates the displays, as the ✎ button does.
- **Remove** asks first, removes only this item (the same song used twice keeps its other item), and never deletes the song from the library.
- **Upload new version…** started from the menu shows its bars on that item; the item can still be presented, reordered and removed meanwhile; removing it lets the upload finish and update the song.
- Opening the menu does not select or present the item; Escape and a click outside close it; arrow keys move through it, and Enter chooses.
- The menu on the last rows of a long run sheet opens upwards, inside the window.

## 4. Order and dependencies

| Work | Tasks | When |
| --- | --- | --- |
| Spikes | M0 | First; M0.1 and M0.5 decide the server and upload work |
| Server | M1.1–M1.7, M1.9 | After M0.1; M1.5 and M1.7 can start on day one |
| Protocol 5 | M1.8 | After M1.7; needed only by M5.4 and M6 |
| Upload pipeline | M2 | After M1.2 and M0.5 |
| Library and run sheet | M3, M4 | After M2.4; M4.1 can start on day one |
| Video items | M5 | After M1.8 and M2.2 |
| Playback and audio | M6 | After M5.4 and M0.3 |
| Acceptance | M7 | After everything |

M1–M4 make a release on their own: the Media tab, images, decks and PDFs with progress, Download original, and video upload. Video items stay hidden until M5 and M6 are done.

Four tasks can begin on day one: the spikes (M0), the original route (M1.5), the video schema (M1.7) and adding at a place (M4.1).

## 5. Rollout

The server update comes first, and changes nothing for desktops that have not updated. A desktop on this release against an older server imports slide decks and PDFs as before, now with progress, and says images and videos need a server update (U19). Image items work on older desktops too, since they are ordinary decks (U13). Video items appear only once the server speaks protocol 5. Desktops older than protocol 5 show a video item as a title with nothing to present (U20), so churches are asked to let every desktop update before planning a video.

## 6. Risks tied to tasks

| Risk | Task | Mitigation |
| --- | --- | --- |
| `sharp` does not install in the image, or cannot read iPhone photos | M0.1, M1.3, M2.6 | `sharp` installs (M0.1); HEIC is converted on the Mac (U25) and refused with a clear message elsewhere |
| The macOS webview cannot choose an audio output | M0.3, M6.7 | Resolved by M0.3: it can, through one native `eval`. Left: the entitlement on a signed build |
| A proxy buffers the upload, so the bar fills before the server has the file | M0.5 | The processing bar covers the rest; the deployment guide explains the proxy settings |
| A proxy refuses a large body part-way and the desktop shows a raw error | M0.5, M2.1 | 413 mapped to the U7 message; limits also checked before sending (U2) |
| A long upload over the venue's connection is interrupted | M2.1, M2.4 | **Try again** sends the file again from the start; resuming is out of scope |
| An older desktop removes a video while renaming it | M1.8 | The server keeps the video on pushes below protocol 5 (U20) |
| A video is not fetched in time for the service | M5.2, M5.3 | Fetching starts as soon as the item is in an upcoming run sheet, and the item shows it is not ready |
| Large video folders on operators' computers | M5.2 | Only today's and upcoming videos are kept (U9) |
| Desktops' clocks differ, so two slideshows play the same video at different moments | M6.1, M6.3 | A clock offset from the coordinator's messages (§3.10); the slideshow corrects only drifts over half a second |
| An operator expects a video to start where it began, not where it was left | M6.2, M6.4 | The control bar shows the position on entry, and the scrubber goes back to 0 in one move; End resets every position (U22) |
