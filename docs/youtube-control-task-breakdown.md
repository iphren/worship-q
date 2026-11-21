# Worship Q — YouTube Playback Control Task Breakdown

**Drafted:** 21 November 2026  
**Status:** Not started. M0 comes first; its spike notes may change D3 and D4.  
**Source:** the code at version 2.13.0, and the project owner's question of 21 November 2026: can a YouTube link that is being presented be controlled from the desktop app and the remote? There is no separate plan; the decisions are in §2. It belongs with the [media uploads plan](media-uploads-plan.md), because it reuses that plan's video controls (M6).

## 1. How to read this

Today a YouTube link in a website item shows only its video, filling the slideshow, and plays at once (`youtubeEmbedUrl`). After that nobody can control it: it cannot be paused or moved to another point, and the desktop and the phone cannot tell where it is. Uploaded video items already have all of this. The live state holds one clock for the presented video (`LiveVideo`), every screen follows that clock, and the operator moves it with `videoPlay`, `videoPause` and `videoSeek`, from the Present page's bar, the shortcuts or the phone's `VideoBar`.

This feature makes a YouTube video a second kind of player that follows the same clock. The controls, shortcuts, position memory and blanking stay as they are. What is new is a player that the local YouTube page and the browser slideshow can drive, and a way for an output to report the video's length.

Task identifiers are `M<milestone>.<n>`; a task lists the tasks it needs first. Sizes are S, M and L as in the phase plans. The reducer and the follower logic get unit tests. The webviews and YouTube itself are covered by the M5 walkthrough.

### Where things live today

| Concern | Location |
| --- | --- |
| A YouTube link turned into its embed address (`autoplay=1`, `start=`) | `packages/protocol/src/records.ts` (`youtubeEmbedUrl`, `youtubeStart`) |
| The local page that frames the embed, served at `127.0.0.1:47310/youtube/{id}` as inline HTML | `apps/desktop/src-tauri/src/overlay.rs` (`youtube_page`, `youtube_frame`, `YOUTUBE_ROUTE`) |
| The webview over the slideshow window that shows a website or that page; closed, not hidden, so the sound stops | `apps/desktop/src-tauri/src/output.rs` (`output_website`) |
| The slideshow window asking for that webview | `apps/desktop/src/output/OutputApp.tsx` (the `websiteUrl` effect) |
| The browser slideshow's frame for a website or embed | `apps/output/src/OutputPage.tsx`; `apps/desktop/src/slideshow/main.tsx` for the local `/slideshow` page |
| The live video clock, position memory, Autoplay and blanking | `packages/live-state/src/video.ts`, `packages/live-state/src/index.ts` (`presentedVideo`, `withVideo`) |
| `LiveVideo` and `OutputVideo` schemas | `packages/protocol/src/records.ts` |
| How a player follows the clock (drift, `videoCorrection`) | `packages/renderer/src/Slide.tsx` |
| The output frames sent to local pages | `overlay.rs` (`/ws/slideshow`, `slideshow_frames`) |
| Desktop control bar and shortcuts | `apps/desktop/src/components/VideoStatus.tsx`, `apps/desktop/src/lib/shortcuts.ts` |
| Phone control bar | `apps/remote/src/RemoteApp.tsx` (`VideoBar`) |

### Three facts that shape the tasks

1. **The clock is in charge, not the player.** Outputs never receive commands. They read `video` from the frame and seek to match it. A YouTube player that follows the same rules works with every control we already have, including the old remotes.
2. **The reducer needs the video's length when the item goes live.** `followPresentation` and `applyVideoCommand` limit positions to `durationSeconds`, and `videoAt` stops the clock at the end. For an uploaded file the length is known from the upload. For a YouTube link we don't know it today.
3. **YouTube plays only inside a page with a web address.** That is why the desktop uses the local `/youtube/{id}` page. YouTube's IFrame Player API (`enablejsapi=1`) works in the same place, so the local page can hold a controllable player.

## 2. Decisions

| # | Decision |
| --- | --- |
| D1 | **Only single YouTube videos.** These are the links `youtubeEmbedUrl` already recognises: `watch`, `youtu.be`, `embed`, `live` and `shorts`. Channels, playlists and other sites stay ordinary web pages with no controls. |
| D2 | **A YouTube item is a video item to the live state.** Its piece carries `VideoInfo`, so presenting it sets `state.video`. The bar, shortcuts, phone controls, position memory and pause on blank (U22) then work without changes to them. **Autoplay is on**, as it is today. A per-item Autoplay setting is out of scope. |
| D3 | **The length is recorded when the link is saved, and an output can correct it.** When a website item is saved with a YouTube video, the desktop reads the length and stores `website.durationSeconds` (how it reads it is decided in M0.2). A new `videoDuration` command, sent by the desktop slideshow window once its player knows the length, sets it in `state.video` for the presented item. This covers links saved before this feature and lengths we could not read. |
| D4 | **`durationSeconds: 0` means "length not known yet".** We don't make the field nullable, because older desktops and remotes would fail to parse `null`. With 0, `videoAt` does not stop the clock, seeks are not limited at the top, and the controls hide the scrubber and the 10-second jumps but keep play and pause. Live streams stay at 0 (YouTube reports no length for them), so they get play and pause only. An old remote shows a 0:00 scrubber, which does nothing harmful. |
| D5 | **The link's start time becomes the first position.** `VideoInfo` gains `startSeconds`. Going live for the first time starts there, and after that the remembered position wins (U22). The embed address no longer carries `start=` or `autoplay=1`, because the clock decides both. |
| D6 | **The local YouTube page becomes a built page.** The inline HTML in `overlay.rs` turns into `youtube.html` in the desktop's Vite build, served like `slideshow.html`. It connects to `/ws/slideshow`, follows `frame.video` with the renderer's `videoCorrection`, and sends the length, the end and any errors back over the same socket. Rust only passes those messages on to the main window. The id check (`youtube_frame`'s rules) stays in the route. |
| D7 | **Only the desktop slideshow window reports.** The browser slideshow and the local `/slideshow` page follow the clock but never send anything. This way two outputs never disagree about the length, and the browser slideshow needs no right to send commands. |
| D8 | **The webview stays open while the video is paused.** It closes, as today, when the item stops being presented or the screen is blanked. When the item is shown again, the player seeks to the clock's position. |

## 3. Tasks by milestone

### M0 — Spike (S)

Throwaway code on a branch that is not merged. Ends in `docs/spikes/youtube-control.md`.

| # | Task | Where | Done when |
| --- | --- | --- | --- |
| M0.1 | Use the IFrame Player API on a page at `127.0.0.1:47310`, with the `youtube-nocookie.com` embed, `enablejsapi=1` and `origin`, inside the Tauri child webview on macOS (WKWebView) and Windows (WebView2): load, play, pause, `seekTo`, `getDuration`, `getCurrentTime`, `onStateChange`, `onError` | spike branch | All of them work on both systems, or the notes say which ones don't and why |
| M0.2 | Reading a video's length at save time: the watch page's `lengthSeconds` through the existing page fetch (`native` "start of a web page"), compared with loading the player in a hidden webview. No API key | spike notes | D3's method is chosen, or D3 is narrowed to relying on `videoDuration` alone |
| M0.3 | How the player behaves with an ad before or during the video, a video whose owner blocks embedding, an age-restricted video, a live stream and a Short | spike notes | The notes record what each reports, and whether `seekTo` during an ad causes repeated seeks |
| M0.4 | The browser slideshow's frame (`OutputPage.tsx`) controlled by `postMessage` from the server's origin, and from the local `/slideshow` page | spike branch | Play, pause and seek work in Chrome and Safari |

**Exit:** the spike notes confirm or change D3, D4 and D6.

### M1 — Protocol and live state (M)

| # | Task | Where | Needs | Tests | Done when |
| --- | --- | --- | --- | --- | --- |
| M1.1 | `website.durationSeconds` (optional, at least 0) on the website field; records saved without it read as unknown | `packages/protocol/src/records.ts` | M0.2 | Unit: old records parse; a saved length round-trips | — |
| M1.2 | A website piece with a YouTube video carries `VideoInfo` (`durationSeconds` from M1.1 or 0, `autoplay: true`, `startSeconds` from the link) | where pieces are built from songs (`PlayablePiece`), `youtubeStart` exported | M1.1 | Unit: a YouTube website piece has video info; a channel, a playlist or another site has none | D1, D2, D5 |
| M1.3 | Clock rules for an unknown length: `videoAt` does not stop at 0, `applyVideoCommand` does not limit a seek at the top, and `followPresentation` starts at `startSeconds` when there is no remembered position | `packages/live-state/src/video.ts` | M1.2 | Unit: a playing clock with length 0 keeps moving; a seek to 120 s with length 0 holds; the first presentation starts at the link's time and the second at the remembered position | D4, D5 |
| M1.4 | The `videoDuration { itemId, seconds }` command: it sets `durationSeconds` on `state.video` for the presented item and does nothing for any other item. If the position is already past the new length, the clock ends there, paused | `packages/protocol` (command schema), `packages/live-state/src/index.ts` | M1.3 | Unit: it applies to the presented item; it is ignored for another item or with nothing presented; a position past the end is clamped and paused | D3 |
| M1.5 | Older clients: a remote or desktop from before this feature receives a state with a YouTube `video`, and a server from before it receives `videoDuration` | protocol tests | M1.4 | Unit: old schemas parse the new state; the server's validation passes an unknown command on, or the notes say how it is gated | Nothing older breaks |

### M2 — Desktop slideshow player (L)

| # | Task | Where | Needs | Tests | Done when |
| --- | --- | --- | --- | --- | --- |
| M2.1 | `youtube.html`: a built page that loads the IFrame API, opens `/ws/slideshow`, and follows `frame.video` with `videoTarget` and `videoCorrection` from the renderer. The follower is pulled into a function that takes a small player interface, so `Slide`'s `<video>` element and YouTube share it | `apps/desktop/youtube.html`, `apps/desktop/src/youtube/`, `packages/renderer` | M0.1 | Unit: the follower against a fake player plays, pauses, seeks on a jump, and leaves small drift alone | D6 |
| M2.2 | `overlay.rs` serves the built page at `/youtube/{id}` (or a redirect to the dev server, like `serve_page`), keeps the id and query checks, and drops the inline HTML | `overlay.rs` | M2.1 | Rust: a bad id or query is still refused | The existing `youtube_page` tests pass after being updated |
| M2.3 | Reports: the page sends `duration`, `ended` and `error { code }` over `/ws/slideshow`; Rust emits them to the main window, which sends `videoDuration`. An embedding or age error shows on the Present page's tile, worded like the website errors | `overlay.rs`, `apps/desktop/src/app/`, `en.ts` | M1.4, M2.1 | Unit: a report for an item that is no longer presented is dropped | D3, D7 |
| M2.4 | `output_website` keeps the webview open while the video is paused and closes it on blank or when the item stops being presented (D8). The embed address loses `autoplay` and `start` (D5) | `output.rs`, `OutputApp.tsx`, `records.ts` | M2.1 | Unit: `youtubeEmbedUrl` addresses updated | Pausing keeps the frame; blanking and moving on stop the sound |

### M3 — Browser slideshow (M)

| # | Task | Where | Needs | Tests | Done when |
| --- | --- | --- | --- | --- | --- |
| M3.1 | The website frame in `OutputPage.tsx` and the local `slideshow/main.tsx` adds `enablejsapi=1&origin=…` for a YouTube video and drives it with `postMessage` through M2.1's follower. It never reports anything (D7) | `apps/output/src/OutputPage.tsx`, `apps/desktop/src/slideshow/main.tsx`, a shared `postMessage` player in `packages/renderer` | M0.4, M2.1 | Unit: the `postMessage` player sends the right messages | It follows play, pause and seek from the desktop and the phone |

### M4 — Controls (S)

| # | Task | Where | Needs | Tests | Done when |
| --- | --- | --- | --- | --- | --- |
| M4.1 | The desktop bar and the phone's `VideoBar` hide the scrubber and the 10-second jumps while `durationSeconds` is 0, and show them once the length arrives | `VideoStatus.tsx`, `RemoteApp.tsx` | M1.3 | — | D4 |
| M4.2 | The shortcuts for play/pause and jumps work while a YouTube item is live. Jumps do nothing while the length is unknown. The keyboard stays with the main window, not the webview | `shortcuts.ts`, `output.rs` | M1.3 | Unit: `presentAction` with a YouTube video | The keys work with the YouTube webview open |
| M4.3 | The Present page's tile and the phone's live line show a YouTube item as a video (title and badge), not as a website | `PresentPage.tsx`, `RemoteApp.tsx`, `badges.ts` | M1.2 | Unit: the badge for a YouTube website item | — |

### M5 — Acceptance (S)

| # | Task | Done when |
| --- | --- | --- |
| M5.1 | A walkthrough on macOS and Windows with a real run sheet: a music video, a link with `?t=`, a live stream, a Short, a video with an ad, a video that blocks embedding; control from the desktop, the keys and the phone, with the desktop slideshow and a browser slideshow open together | Recorded in `docs/acceptance/youtube-control.md` |
| M5.2 | The volunteer guide's website section says YouTube links can be paused and moved like videos, and lists what cannot (ads, live streams, other sites) | `docs/volunteer-guide.md` and its translations updated |

## 4. Edge cases to test

- Presenting a YouTube item, moving to another item, then coming back resumes where it was left (U22). Ending the service forgets the position.
- Blanking pauses it and unblanking plays it again (U22). The webview is closed while the screen is blank and seeks to the right point when it reopens.
- A seek from the phone that arrives after the operator has moved on is ignored, as for uploaded videos.
- The length arrives after the operator has already seeked past it: the clock ends at the end, paused (M1.4).
- During an ad the player cannot seek. The follower must not seek over and over: it waits until the ad ends, then catches up (M0.3).
- A video that blocks embedding shows YouTube's error in the frame. The tile says why, and the controls stay harmless.
- Two outputs drift apart by less than `VIDEO_SEEK_SECONDS`; each corrects itself on the next jump.
- Without the local server (the port is taken), `youtube_page` returns nothing and the YouTube page is shown as a website, as today, with no controls. The controls must not appear in that case.
- A link edited while it is live changes the video. The new piece's `VideoInfo` starts a new clock.

## 5. Out of scope

- Playlists, channels and sites other than YouTube (Vimeo and others).
- Volume, captions and quality control, and sending YouTube's sound to the slideshow's chosen speaker (`sinkId`). The webview plays through the system's default output.
- A per-item Autoplay setting for YouTube items.
- Reading lengths through the YouTube Data API, which needs a key.
