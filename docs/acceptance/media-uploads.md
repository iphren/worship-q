# Media Uploads — Acceptance record

**Date:** 8 November 2026 (branch `media-uploads`); walkthrough pending  
**Source:** [Media Uploads Plan](../media-uploads-plan.md), [task breakdown](../media-uploads-task-breakdown.md) M7.

Three kinds of evidence are kept apart here: automated tests that run in CI (`pnpm test`, and
`cargo test` in `apps/desktop/src-tauri`), the spikes (M0, `docs/spikes/media.md`), and the
walkthrough with real equipment (M7.1), which is still to do. The desktop and phone
interfaces have no automated tests; they are covered by the walkthrough.

## Milestones

| Milestone | Status | Evidence |
| --- | --- | --- |
| M0 spikes | Done | `docs/spikes/media.md` |
| M1.1–M1.2 limits and `info.media` | Done | `apps/server/src/media.test.ts` “limits”: environment and defaults, the limits reported, exactly at the limit and one byte over (413 with `limitBytes`, nothing left behind), a chunked body cut off over a real connection, an empty file, decks held to the deck limit |
| M1.3 images | Done | `media.test.ts` “images”: every size of §3.2 (1921 × 1081 → 1919 × 1080, as the spike found), one-page deck with `kind: 'image'`, the original kept byte for byte, the 320 × 240 small copy, orientation 6 upright, transparency on black, GIF and WebP, HEIC and unknown formats refused, a renamed text file refused leaving nothing, over 100 megapixels refused, the Church Library's folder, two at once |
| M1.4 videos | Done | `media.test.ts` “videos”: a new `video-<uuid>.<ext>` name whatever was uploaded, ranges (206, 416), unknown extensions and a bare `.mp4` refused, the Church Library's folder, browser outputs of its own workspace only |
| M1.5–M1.6 originals and reconvert | Done | `media.test.ts` “originals and reconvert”: bytes, length and an encoded download name; a converted HEIC named `.jpg`; 404 (never 500) without an original, for another workspace's deck and a malformed id; a Church Library deck's original; originals never served by the files routes; reconvert under a new id keeping the old images and an original for the new one |
| M1.7 records | Done | `packages/protocol/src/index.test.ts` “media records”; `packages/store/src/store.test.ts` “media items” |
| M1.8 protocol 5 | Done | `apps/server/src/versions.test.ts` “older desktops and video songs (U20)”, and versions 3 and 4 still served |
| M1.9 files of video songs | Done | `apps/server/src/retention.test.ts` “video songs’ files”: swept after the retention days, kept while another song uses the file, moved to and from the Church Library, Images and Videos on the Storage page; `admin.test.ts` for image and video items in the admin library |
| M2.1–M2.2, M2.6 native transfers | Done | `src-tauri/src/media.rs` tests against an HTTP server in the test: progress in order up to the total, the end reported for a tiny file, cancelling, refusals mapped to codes (413 ours and the proxy's), a download taking its name only when complete, nothing left after a failure or cancel; HEIC to JPEG with `sips` on macOS (orientation is kept by `sips`, not asserted) |
| M2.3–M2.5 kinds, checks and queue | Done | `apps/desktop/src/app/media.test.ts` (§3.1), `uploads.test.ts` (§3.5, §3.6 placement, §3.9 new versions, §3.15) |
| M3 library | Done; by walkthrough | `DeckBadge.test.ts` (each kind's colour and label); `mediaFiles.test.ts` (Download original's source); `SongsPage.tsx`, `SongForm.tsx`, `MediaActions.tsx`, `UploadProgress.tsx` |
| M4.1 adding at a place | Done | `packages/session/src/index.test.ts` “adding at a place” |
| M4.2–M4.6 run sheet | Done; by walkthrough | `RunSheetEditor.test.ts` (upload rows placed and unnumbered; the item menu's actions by kind and state); `lib/fileDrop.test.ts` (§3.7 positions and rows) |
| M5.1 store | Done | `store.test.ts` “media items”: round trip, revisions, an applied video asking for no file |
| M5.2 video cache | Done | `apps/desktop/src/app/videoCache.test.ts` (§3.13) |
| M5.3 download state | Done; by walkthrough | `VideoStatus.tsx` |
| M5.4–M5.5 presenting | Done | `session` “video items”; `packages/renderer/src/frame.test.ts` “video items”; `relay.test.ts` “video items through the relay” (older desktops sent an empty deck); `remote` “videos on phones” |
| M6.1–M6.2 live state | Done | `packages/live-state/src/video.test.ts` (§3.10), and the follower clock in `session` “puts a follower whose clock is 5 s ahead/behind…” |
| M6.3 slideshow | Done; by walkthrough | `frame.test.ts` “following the live clock” (the half-second rule) |
| M6.4 control bar | By walkthrough | `VideoStatus.tsx` (`VideoControls`) |
| M6.5 shortcuts | Done | `lib/shortcuts.test.ts` “keys while a video item is live” |
| M6.6 phones | Done; by walkthrough | `remote` “videos on phones”; `RemoteApp.tsx` (`VideoBar`) |
| M6.7 audio | Done; by walkthrough | `deviceSettings.test.ts` “audio devices”; the entitlement needs the first signed build |
| M7.1 walkthrough | Pending | Table below |
| M7.2 deployment guide | Done | `server-deployment.md` “Media”, the limits, the proxy's body limit, “Updating for media” |
| M7.3 volunteer guide | Done | `volunteer-guide.md` “Slides, PDFs, photos and videos” |
| M7.4 spec write-back | Done | `worship-q-requirements-and-architecture.md` §11 “Media items” |
| M7.5 release | After the walkthrough | release-please |

## Changes from the plan

- **HEIC on macOS** uses `sips`, macOS's ImageIO command, instead of calling `CGImageSource`
  through Objective-C bindings: the same library, quality 0.9 and metadata kept, with no new
  native dependency.
- **Download original** asks the server for the original with the item's own file name
  (`?name=`), and the server keeps the original's extension, so a photo converted from HEIC
  downloads as `.jpg`.
- **Older desktops in snapshots.** Desktops declare a `videos` capability; the relay (on the
  server and the LAN host alike) sends those without it each video item as a slide deck with
  no pages, instead of tracking protocol versions per message.
- **Clocks.** Followers learn the coordinator's clock from the `updatedAt` of the changes it
  sends (the smallest gap seen lately) and move the video clock onto their own.
- **The localhost slideshow page** (Settings → Browser outputs) plays a video item from this
  computer's copy, served by the app in byte ranges (`overlay.rs` `/videos/`), muted: the
  slideshow window is where its sound plays.
- **Entering an Autoplay video while blank** cannot happen through today's commands, since
  presenting unblanks; the rule is implemented and tested on its own.

## Walkthrough (M7.1)

Equipment: a coordinator desktop, a follower desktop and a phone, on macOS and Windows,
against a server behind nginx with the default `client_max_body_size`, then with it raised.

| Scenario | Result |
| --- | --- |
| A slide deck, a PDF, a photo and a video from **Library → Media → Add media…**: bars under the search box, each opens ready; Download original saves each unchanged | |
| The same from the calendar's editor and from Live, by **Media…** and by dropping between items 2 and 3; the bar on the row at that place; on every desktop and phone once ready | |
| Several files dropped at once; a folder and a `.txt` among them | |
| Cancel while sending; a failure and Try again; moving between pages during an upload | |
| A file over each limit: the U7 message before sending | |
| A 200 MB deck behind nginx's default 1 MB limit: the proxy message, not a raw error; fixed by the guide's setting | |
| An iPhone HEIC photo from a Mac; the same on Windows refused with the U25 message | |
| Upload new version from the editor and from the item menu, also of the live item (a deck updates on the same slide; a video keeps playing until presented again, then from 0:00) | |
| Reconvert of a deck | |
| The item menu: Edit (lyrics, title, video title and Autoplay), Download original, Upload new version, Remove; keyboard; opening upwards near the bottom | |
| A video added to next Sunday on one desktop: downloaded on the other with a bar on the item; deleted on Monday | |
| A Sunday run: a video with Autoplay entered from a song; one without Autoplay played from a phone; leaving mid-way and returning to the same moment; blank and unblank during a video; End and Go live, then videos from the start | |
| Two slideshows within half a second of each other | |
| The control bar, the shortcuts, and the phone's bar | |
| Sound only from the slideshow window, on the output chosen in Settings; a device unplugged falls back to the default and Settings says so; no microphone indicator | |
| A signed macOS build: device names listed (the `audio-input` entitlement) | |
| A Windows PC with no audio input: no devices listed, the note shown, sound on the default | |
| A desktop still on protocol 4: the image presents, the video shows nothing, renaming it there keeps the video | |
| The localhost slideshow page and an OBS Browser Source: a video plays, muted, in step with the slideshow; black until this computer has its copy | |
| The admin app: Media tab, image and video items previewed, Storage counts Images and Videos | |
