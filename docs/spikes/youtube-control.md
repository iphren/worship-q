# Spike M0 — YouTube playback control

**Status:** done on the `youtube-control-spike` branch (local, commit `0aebb36`), 21 November 2026, on a Mac (macOS 27.2) in the app under `tauri dev` and in Chrome. Windows, Safari, ads and age-restricted videos were not covered. Source: [YouTube Playback Control Task Breakdown](../youtube-control-task-breakdown.md) M0; the decisions (D1–D8) are the breakdown's.

The spike code is throwaway and lives on the branch only:

- `apps/desktop/src-tauri/src/spike_youtube.html` is a page that loads YouTube's IFrame Player API and runs a scripted sequence on one or more videos (`?ids=a,b,c`): play, pause, seek while paused, play, seek while playing, then a 10-second check of the player's clock. Each step logs the state, time, length, mute and loaded fraction.
- `overlay.rs` serves that page at `/spike/youtube/{id}` and `/spike/youtube`, and prints each log line POSTed to `/spike/log` as `[yt-spike] …` on the app's stderr.
- `lib.rs`: started with `WQ_YT_SPIKE=/spike/youtube?ids=…`, the app opens a window over the page, made with the slideshow's `BROWSER_ARGS` and with throttling off.

## M0.2 — Reading a video's length at save time

Tried 21 November 2026 from a Mac in the UK with `curl`, using the app's own user agent (`Mozilla/5.0 (compatible; WorshipQ)`).

- **oEmbed** (`/oembed?url=…`) gives the title and author, but not the length.
- **The embed page** (`youtube-nocookie.com/embed/{id}`, about 138 KB) has no length in it.
- **The watch page** (`youtube.com/watch?v={id}`, about 1.5 MB) does, with no key and no cookies:
  - `<meta itemprop="duration" content="PT3M34S">`, about 850–860 KB into the page, in the body and past `</head>`;
  - `"lengthSeconds":"213"` in the player data, about 900 KB in. It is a second shorter than the meta tag (213 against 214): the meta tag is rounded up.
  - For a live stream the meta tag gives a meaningless length (`PT2026691M52S`) and `lengthSeconds` is `121601512`. Next to it, about 3 KB later, the page has `itemprop="isLiveBroadcast" content="True"` (and `"isLiveContent":true` in the player data). A live stream must therefore be detected from that marker and stored with no length (D4), not from the length.
  - `"playableInEmbed":true|false` is in the player data too, so the save could also warn that a video won't play when embedded. I didn't find a video that blocks embedding to confirm the `false` case.
- **`fetch_page_start` can't be reused as it is.** It stops at `</head>` or after 128 KB (`web.rs`), long before the length. Reading the length needs a separate fetch that reads up to about 1.5 MB, stops once it has passed the `duration` meta tag and the live marker, and parses the ISO 8601 length (`PT#H#M#S`).

**Choice for D3:** read the length from the watch page's `duration` meta tag, with a live stream (`isLiveBroadcast` True) stored as 0. Keep the `videoDuration` report from the slideshow window for links saved before, and for when the page can't be read.

**Risks not covered:** in the EU, a request with no cookies may be sent to YouTube's consent page (`consent.youtube.com`) instead of the watch page. It wasn't seen from the UK. If it happens, the read fails, and the length comes from the `videoDuration` report instead. YouTube can change the page at any time; a failed read must never stop the item from being saved.

## Finding: `127.0.0.1` blocks most music videos, `localhost` doesn't

**This affects the released app, not only this feature.** The desktop shows a YouTube video through `http://127.0.0.1:47310/youtube/{id}` (`youtube_page` in `overlay.rs`). Loaded from a page on `127.0.0.1`, YouTube refuses most label music videos with error 150 ("video unavailable", the same as when the owner blocks embedding), even though their watch page says `"playableInEmbed":true`. Loaded from `localhost`, the same embeds play. This was seen in Chrome and in the app's WKWebView, with the plain embed the app ships (no API), and with the API too.

| Video | From `127.0.0.1:47399` (Chrome) | From `localhost:47399` (Chrome) |
| --- | --- | --- |
| Rick Astley, *Never Gonna Give You Up* (`dQw4w9WgXcQ`) | Error 150 | Plays |
| Luis Fonsi, *Despacito* (`kJQP7kiw5Fk`) | Error 150 | Plays |
| Ed Sheeran, *Shape of You* (`JGwWNGJdvx8`) | Error 150 | Plays |
| Wiz Khalifa, *See You Again* (`RgKAFK5djSk`) | Error 150 | Plays |
| Alan Walker, *Faded* (`60ItHLz5WEA`) | Plays | Plays |
| Lofi Girl live stream (`jfKfPfyJRdk`) | Error | Error: this stream doesn't play embedded anywhere |

In the app, the first run, from `127.0.0.1:47310`, got error 150 for Rick Astley; the second, from `localhost:47310`, played it and Despacito with sound. The server only listens on `127.0.0.1`, and WKWebView reached it through `localhost` without trouble.

Also tried: `youtube.com/embed` instead of `youtube-nocookie.com` changes nothing, and `enablejsapi` and `origin` change nothing. With `referrerpolicy="no-referrer"` the embed fails outright with error 153 ("player configuration error"): YouTube needs the referrer.

**Consequence:** `youtube_page` should hand out `http://localhost:47310/…`. Fixed on its own, ahead of this feature, in `644624e`. The local `/slideshow` page and the OBS overlay addresses were given as `127.0.0.1` too, so a browser slideshow opened there had the same problem with YouTube items. Since `99a832f`, a page asked for at `127.0.0.1` (from a browser, which sends a `User-Agent`) is redirected to `localhost`, so OBS sources saved with the old address keep working, and the app and the website give the `localhost` addresses.

## M0.1 — The IFrame Player API in the Tauri webview

Run on 21 November 2026 in the app under `tauri dev` on a Mac (macOS 27.2), in a window made with the slideshow's `BROWSER_ARGS` and throttling off, loading `http://localhost:47310/spike/youtube`. **Everything the follower needs works.** Windows (WebView2) was not tried.

- **Loading:** `iframe_api` loads and `onReady` fires within about 0.5 s.
- **Length:** `getDuration()` was already 214 at `onReady` for Rick Astley. For the Short and the live stream (in Chrome) it was 0 until playing began. So the length must be read on `onStateChange` as well, not only at `onReady`. The player's length can differ from the watch page's by up to a second (281.521 against `PT4M42S`).
- **Autoplay with sound:** `onAutoplayBlocked` fires, yet `playVideo()` starts the video with sound about 2.4 s after the page loads. For the second video, loaded with `loadVideoById`, it played at once. In Chrome, without a click on the page, playing with sound is blocked and the video stays `unstarted`; muted, it plays at once.
- **Pause** holds the position exactly.
- **`seekTo(s, true)` while paused** moves there and stays paused.
- **`seekTo` while playing** carries on from the new point within about 0.3 s, with a short `buffering`.
- **The clock:** with no seeks, `getCurrentTime()` moved 10.0 s in 10 s in the app, and 8.2–8.7 s in Chrome after a seek (buffering). The follower's drift correction is needed, as for uploaded videos.
- **Errors:** an unknown video id gives error 150, the same code as a blocked one, so the tile can't tell the two apart. Word it as "YouTube won't play this video here".

## M0.3 — Ads, blocked videos, live streams and Shorts

Run in Chrome from `localhost`, muted.

- **Live stream** (Al Jazeera English, `gCNeDWCI0vo`): plays.
  - `getDuration()` is the live edge, a huge number (about 9.9 million seconds) that keeps growing, and `getCurrentTime()` sits next to it.
  - `seekTo(60)` goes back to the start of the replay window (about 12 hours back), not to 60 s.
  - `getVideoData().isLive` is `true`; this field isn't documented but is present.
  - **Consequence:** a live stream must never follow the clock's position. The follower only plays and pauses it (D4). It is recognised from the save-time marker (M0.2) or from `isLive`, never from its length.
  - One open question for M2: after a pause, should playing jump back to the live edge, or carry on where it paused? Carrying on is what `playVideo()` does.
- **Short** (`k5Z7sFwFF7Q`): plays like any video, with a length of 63.5 s and seeks that work. It shows YouTube's Shorts look (portrait, with the Shorts logo and like button) inside the frame.
- **Blocked videos:** error 150, both for the music videos refused on `127.0.0.1` and for an unknown id. I didn't have a video that blocks embedding everywhere to try.
- **Ads:** none appeared in any run, from `youtube-nocookie.com`, in Chrome or in the app. **Not covered.** M5's walkthrough must look for one, and the follower must not seek over and over while one plays.
- **Age-restricted videos:** not tried.

## M0.4 — The browser slideshow's frame

Run in Chrome from `localhost`. Safari was not tried.

- The supported way to control the frame is YouTube's own `iframe_api` script. Its `postMessage` protocol isn't documented, so we use the script rather than sending messages ourselves. The browser slideshow can load it like any page, and everything in M0.1 worked in Chrome.
- **Sound:** Chrome won't play with sound until the page has been clicked. The browser slideshow already asks for a click for sound for uploaded videos (`video.clickForSound`); YouTube needs the same, or starts muted until the click.
- The browser slideshow served from the church server's own address should be fine. The local `/slideshow` page on `127.0.0.1` has the problem in the finding above.

## Changes to the task breakdown

- **Done ahead of the feature** (`644624e`, `99a832f`): `youtube_page` hands out `http://localhost:47310/…` instead of `127.0.0.1`, so music videos play, and pages asked for at `127.0.0.1` are redirected to `localhost`.
- **D3:** confirmed, with the watch page's `duration` meta tag (M0.2).
- **D4:** confirmed. A live stream is recognised by `isLiveBroadcast` at save time or `getVideoData().isLive` in the player, and only plays and pauses.
- **D6:** confirmed, with the page loaded from `localhost`. The follower reads the length on `onStateChange` as well as `onReady`.
- **M2.3:** error 150 covers both blocked and missing videos, so there is one message for both.
- **M3.1:** the browser slideshow needs a click for sound, like uploaded videos.
- **M5.1:** must include a video with an ad, an age-restricted video and Windows, none of which the spike covered.
