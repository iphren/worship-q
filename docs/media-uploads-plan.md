# Worship Q — Media Uploads Plan

**Drafted:** 1 November 2026  
**Status:** Draft for review. Not scheduled; this work comes after phase 2.  
**Source:** [Requirements and Architecture](worship-q-requirements-and-architecture.md) (spec §§ on backgrounds and media), the "Unscheduled" items in the [Phase 2 Plan](phase-2-plan.md) (live audio broadcast), and the code at version 0.5.1.

## 1. Where the implementation stands

- The server accepts any single file up to 2 GB (`MAX_FILE_BYTES` in `apps/server/src/app.ts`), whatever its type.
- Slide decks are converted on the server into slide images, small copies and text. The uploaded original is deleted once conversion ends, so a deck cannot be converted again without uploading it again.
- A run sheet item can only refer to a song. Images reach the screen only through imported slide decks or backgrounds.
- Videos reach the screen only as song backgrounds, and background videos are always muted.

## 2. Features

- **Image and video run sheet items:** upload an image or video and add it to a run sheet as an item of its own, not only as a song background. A video item's sound plays only from the slideshow (see audio device settings).
- **Audio device settings:** choose the audio input device (the source for live audio broadcast) and the audio output device. When the slideshow is open and a video item is playing, its sound plays through the chosen output device. Previews never play sound, and background videos stay muted.
- **Video playback controls:** while a video item is live, the main window and the phone remote show a video control bar. A video item starts paused. While it is live, the keyboard shortcuts change: Space plays or pauses (instead of unblank-or-next), Left and Right jump backwards and forwards through the video (instead of previous and next item), and Up and Down move to the previous and next run sheet item (instead of previous and next slide).
- **Drag and drop files:** drag a compatible file (a slide deck, PDF, image or video) onto the run sheet column, in the editor or in Live, and drop it at a chosen position. The app uploads it, waits for processing (such as slide conversion on the server), and adds the item at that position. On the library tab, a dropped file is added to the library only, not to the current run sheet.

## 3. Decisions

| # | Topic | Decision |
| --- | --- | --- |
| U1 | Size limits per type | Images **25 MB**, slide decks and PDFs **200 MB**, videos **200 MB**. Each limit can be changed by the server administrator (for example `WORSHIP_Q_MAX_VIDEO_MB`). |
| U2 | Where limits are checked | The server reports its limits in `/api/v1/info`. The desktop app checks a file's size before sending it, so a file that is too big fails at once with a clear message. The server still enforces the limit while receiving. |
| U3 | Reverse proxy | The deployment guide states that the proxy's request body limit (nginx `client_max_body_size`, default 1 MB) must be at least the largest upload limit; otherwise uploads fail with a 413 error. |
| U4 | Slide deck originals | The original file is kept on the server next to its converted images. Presenting uses only the images. The original allows **Reconvert** (after installing a missing font, or when the output size or the converter changes) and **Download original**. |
| U5 | Pruning originals | Optional, if disk becomes a concern: originals of decks not used in a run sheet for 6 months are removed, and their images are kept. Reconvert and Download original are then unavailable for that deck. |
| U6 | Videos over the limit | The video is still added to the library, but the file stays on the computer that added it and is not uploaded. The item is marked **Plays from this computer only**. |
| U7 | What syncs for a local-only video | The item's name, size, duration, a fingerprint and a poster frame sync like any other item. Where the file is on disk is kept per computer and never synced, because paths mean nothing on another machine. |
| U8 | Fingerprint | File size plus a hash of the first and last 2 MB, fast even for large files. Used to check that a located file is the same video and to find a renamed or moved file again. |
| U9 | Missing file | On a computer where the file is not found (deleted, moved, or another desktop), the item is greyed out with **Locate this video**. If the chosen file's fingerprint differs, the app warns and offers **Use this file anyway**. |
| U10 | Readiness before the service | Opening a run sheet shows a notice when items cannot play on this computer ("2 items aren't on this computer"), so the problem is found before the service, not when the item goes live. |
| U11 | Missing items in Live | Moving through the run sheet stops on a greyed-out item and shows Locate this video. It is not skipped without notice. |
| U12 | Outputs that are not the desktop app | Browser outputs served by the church server and the phone remote cannot get a local-only video, because the file exists only on one computer's disk and was never sent to the server. They show "Plays on the presenting computer only" instead of a black screen. The localhost slideshow page served by the desktop app can play it when that computer has the file. |
| U13 | Message when too big | "This video is 640 MB; this server accepts up to 200 MB. It will play from this computer only. To share it with other computers, export a smaller version." |

## 4. Notes

- At 1080p H.264 around 8 Mbps, 200 MB is about 3–4 minutes of video. Short clips, countdowns and announcements upload; longer videos commonly take the local-only path, so U7–U12 matter for everyday use, not only for edge cases.
- A storage limit per workspace may matter more than per-file limits later; it is not part of this plan.

## 5. Open questions

- Whether an administrator can choose **Upload anyway** for a single file over the limit.
- Whether the server should ever shrink videos itself; this needs ffmpeg and a lot of processing time, so it is left out for now.
