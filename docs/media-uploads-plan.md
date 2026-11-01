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
| U1 | Size limits per type | Images **25 MB**, slide decks and PDFs **200 MB**, videos **200 MB** by default. Each limit can be changed by the server administrator (for example `WORSHIP_Q_MAX_VIDEO_MB`). |
| U2 | Where limits are checked | The server reports its limits in `/api/v1/info`. The desktop app checks a file's size before sending it, so a file that is too big fails at once with a clear message. The server still enforces the limit while receiving. |
| U3 | Reverse proxy | The deployment guide states that the proxy's request body limit (nginx `client_max_body_size`, default 1 MB) must be at least the largest upload limit; otherwise uploads fail with a 413 error. |
| U4 | Slide deck originals | The original file is kept on the server next to its converted images. Presenting uses only the images. The original allows **Reconvert** (after installing a missing font, or when the output size or the converter changes) and **Download original**. |
| U5 | Pruning originals | Optional, if disk becomes a concern: originals of decks not used in a run sheet for 6 months are removed, and their images are kept. Reconvert and Download original are then unavailable for that deck. |
| U6 | Videos are uploaded like everything else | Every video is uploaded to the server. There is no local-only video: a file over the limit is refused and not added to the library. |
| U7 | Message when too big | "This video is 640 MB; this server accepts up to 200 MB. Export a smaller version and try again." The limit shown is the server's current setting. |
| U8 | Caching videos for the run sheet | A computer downloads and keeps a copy of every video in today's and upcoming run sheets, so playback never streams from the server during a service. The download starts as soon as the video is in such a run sheet, and items show their download progress until the copy is ready. Past run sheets do not keep copies. |
| U9 | Removing cached videos | A copy is deleted once no current or upcoming run sheet uses the video. If the video is needed again, it is downloaded again. |
| U10 | No server-side video processing | The server stores videos as uploaded and never shrinks or converts them. A video over the limit must be exported smaller before uploading (U7). |
| U11 | Storage monitor in the admin web app | The admin web app (phase 3) shows how much space the server uses, broken down by type of resource: slide deck images, slide deck originals, images, videos, backgrounds, desktop backups, and the database. Each type shows its total size and file count, overall and per workspace, next to the free space left on the data volume. Slide deck originals show how much pruning (U5) would free. The page is for viewing only; removing content still happens through the normal delete actions. |
