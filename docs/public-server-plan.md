# Worship Q — Public Server Plan

**Drafted:** 17 November 2026; owner's answers added the same day; the spec updated to match  
**Status:** Built on the `public-server` branch on 18 November 2026, not released or deployed; see the [task breakdown](public-server-task-breakdown.md) §7 for what remains. The [technical discovery](public-server-discovery.md) says how it is built.  
**Source:** the project owner's requests of 17 November 2026; the [spec](worship-q-requirements-and-architecture.md) (§ Public website and self-hosted instances, §3); the [Bible passages discovery](bible-passages-discovery.md); the [Media uploads plan](media-uploads-plan.md); the [Live audio plan](live-audio-plan.md); the [OBS control plan](obs-control-plan.md); the code at version 2.9.0.

## 1. Why

Today a computer in local mode (no church server) has songs, run sheets, the slideshow and OBS on that computer, but not:

- **Remote control** from a phone
- **Bible passages**
- **Slide decks** (PowerPoint, Keynote, PDF) and photos
- **Video items**
- **Live audio** to other devices, and **OBS controls shared** with phones

Each of these needs a church server, and running one is the biggest step for a small church. A public server, run by the project, gives them to every computer in local mode.

## 2. Who uses it

- **Every copy of the app in local mode**, with no sign-in and no switch: these features simply work, through the public server, when the workspace is not connected to a church server.
- **Rate limited** per copy of the app (file sizes, uploads and lookups per day, phones and listeners at once), so cost and abuse stay bounded.
- **A workspace connected to a church server never uses the public server.** Its features come from its own server, as today.
- Everything else in local mode stays as it is: no network is needed until one of these features is used.

**Connection status,** as for a church server today: the sidebar's workspace button is shown for a computer in local mode using the public server (today it appears only with several workspaces or a church connection). When the public server cannot be reached, because it is down or there is no internet, the button gets the amber ring and dot that a church server's connection problem shows, and its label says why.

## 3. The rule: nothing is kept on the public server

**Remote resources are deleted as soon as the app confirms it has them, or after 24 hours, whichever is sooner. What the app cached stays on the user's computer.**

- The public server holds a file or a result only until the app that asked confirms it has received it, then deletes it. Anything not confirmed is deleted 24 hours after it was made.
- It keeps no songs, run sheets, workspaces, backups, accounts, recordings or snapshots.
- What the app received is cached on the computer as today: a deck's slide images, a video's copy, a passage's text in its run sheet item. These stay, present offline, and are removed only by the user, like any local content.
- So the public server is a **service**, not a **home** for a church's content. A church that wants its content shared between computers and kept safe runs its own server.

## 4. Features

| ID | Feature | Through the public server |
| --- | --- | --- |
| P1 | Remote control | A phone scans the QR code and controls this computer through the public server's relay, as through a church server's relay today, so it needs the internet at the venue, like a church server reached over the internet. The connection, its grant and its messages last only while both are connected. |
| P2 | Bible passages | Looked up through the public server and stored in the run sheet item, as today. Only **open versions** that need no key (the Free Use Bible API: for example BSB, KJV, the Chinese Union Version), since a key cannot be shared by every user (Bible passages discovery §4). For NIV, ESV and the like, a church runs its own server with its own key. |
| P3 | Slide decks and photos | Uploaded and converted; the app downloads the slide images, confirms, and the public server deletes the original and the images. |
| P4 | Videos | **Not through the public server** (decided 18 November 2026): a video is added and played on this computer with no network at all (discovery §5.1). |
| P5 | Live audio | The public server relays the broadcast between this computer and its phones and listeners, with a TURN relay for networks that need one, and **at most two listeners** at a time (decided 18 November 2026). **No recording**, unlike a church server, which can record (live audio plan). |
| P6 | OBS controls on phones | Relayed between this computer and its phones: scenes, Stream, Record, Camera, and the small picture of the stream. **No snapshot** of the picture is saved on the server. |

For P1, P5 and P6 the public server is **only a relay** between the local app and the remote controls the app has approved; nothing passing through is stored.

## 5. What follows from the rule

The app should say these where they matter (for example in the media and Bible windows), not only in this plan:

- **One computer only.** Another computer cannot fetch a deck or video later, because the public server no longer has it. Sharing between computers, Church Library, backups and **Several computers** stay church-server features.
- **Download original** and **Upload new version** work from the local copy only. The original of a deck is not kept anywhere unless the user keeps their own file; **Reconvert** means uploading it again.
- **Losing the computer loses the media**, as with any local content. **Backup** should include the cached slide images and videos, or say clearly that it does not.
- **API.Bible usage reporting** (FUMS) does not apply, since only keyless versions are offered.

## 6. Moving to a church server later

Joining a church server already moves a local workspace's content (spec §3, G21):

- **Existing.** **Upload** (into an empty church workspace) and **Keep both** send this computer's songs, run sheets and backgrounds to the church server, background files first (`packages/sync`, `JoinMode`). Bible passages move with them already: a passage is a song record holding its text.
- **New: upload cached media.** Slide decks and videos are records whose files the church server has never had: the sync uploads background files only. Joining (and connecting later) must also upload the cached deck slide images and video files, so the church server can serve them to its other computers. A deck arrives as images without an original or phone thumbnails; the church server should make the thumbnails, and its **Download original** should say there is none.
- Once connected, the workspace no longer uses the public server (§2).

## 7. To decide when the work is planned

1. **Rate limits:** the numbers for each limit. Decided on 18 November 2026: 100 slide decks and images a day per copy of the app, 2 phones and 2 listeners at once per workspace; the rest are proposed in the [task breakdown](public-server-task-breakdown.md) (S3). Limiting per copy of the app without accounts needs an identity for the copy: a random identifier made on first use, kept by the server only as long as the limit's window.
2. **Privacy notice** for worship-q.com: what passes through (files, phone connections, audio, OBS pictures), the deletion rule in §3, what logs keep, and where the server runs.
