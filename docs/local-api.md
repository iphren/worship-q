# Worship Q — Local API

A read-only API of the church server, for other services running on the server's own machine: a script that saves Sunday's recording, a lower-third generator that follows what is on screen, a report of what was sung this month. It covers every workspace of the church.

It is version 1 of the local API, versioned apart from the protocol the desktops speak. Within `v1`, routes and fields are only ever added: none is removed or changes meaning. A reader should ignore fields it does not know.

## Reaching it

The server listens for the local API on a port of its own, 8081 inside the container (`WORSHIP_Q_LOCAL_PORT`; set it empty to turn the API off). Compose publishes it on `127.0.0.1:8081` only (`WORSHIP_Q_LOCAL_API_PORT` changes the host's port).

**It has no key.** Anything that can reach the port can read every run sheet, the whole presentation log and every recording. The port is the only guard:

- never publish it on anything but `127.0.0.1`;
- never point the reverse proxy at it.

The public port does not serve the local API at all, and the local port serves nothing else: `/api/` and `/admin/` answer 404 there.

Every route answers `GET` and `HEAD`; any other method is refused with 405. An unknown workspace, date or recording is 404, never an empty success. Times are ISO 8601 in UTC.

## Routes

| Route | What it returns |
| --- | --- |
| `GET /local/v1` | The server's name, the API's version, and whether the church records live audio |
| `GET /local/v1/workspaces` | Every workspace, by id and name |
| `GET /local/v1/workspaces/:id` | One workspace, and whether it is live now |
| `GET /local/v1/workspaces/:id/run-sheets` | The dates with a run sheet that has items |
| `GET /local/v1/workspaces/:id/run-sheets/:date` | One date's run sheet: its items in order, each with all it can show |
| `GET /local/v1/workspaces/:id/live` | What is on screen now |
| `GET /local/v1/presentation-log` | The presentation log, by time range or after a cursor |
| `GET /local/v1/recordings` | Recordings of live audio, by time range |
| `GET /local/v1/recordings/:id` | One recording |
| `GET /local/v1/recordings/:id/file` | A recording's file, with range requests, readable while it is still being received |
| `GET /local/v1/workspaces/:id/media/:name` | A workspace's file: a slide image or its thumbnail, a video, a background; with range requests |

Media are always links, never bytes: run sheets and the log return addresses under the media route, and a reader fetches only what it wants. A link to a file the retention sweep has removed is still returned, with `"gone": true`, and answers 404.

### Workspaces

```sh
curl -s localhost:8081/local/v1/workspaces
```

```json
{ "workspaces": [{ "id": "6f0c…", "name": "Main hall" }] }
```

### Run sheets

```sh
curl -s localhost:8081/local/v1/workspaces/6f0c…/run-sheets
```

```json
{ "dates": [{ "date": "2026-11-15", "items": 6 }], "liveDate": "2026-11-15" }
```

```sh
curl -s localhost:8081/local/v1/workspaces/6f0c…/run-sheets/2026-11-15
```

```json
{
  "id": "rs-…",
  "date": "2026-11-15",
  "items": [
    {
      "id": "item-…",
      "position": 0,
      "song": { "id": "song-…", "revision": 4, "removed": false },
      "content": {
        "kind": "lyrics",
        "title": "Amazing Grace",
        "author": "John Newton",
        "copyright": "Public domain",
        "ccli": null,
        "blocks": [["Amazing grace", "How sweet the sound"], ["That saved a wretch", "Like me"]],
        "text": "Amazing grace\nHow sweet the sound\n\nThat saved a wretch\nLike me"
      }
    }
  ]
}
```

Each item's `content` is the song as the workspace has it now, in one of these kinds:

| `kind` | Fields |
| --- | --- |
| `lyrics` | `author`, `copyright`, `ccli`, and `blocks`: the verses, each a list of lines |
| `deck` | `pages`: each slide after each click, with `page`, `slide`, `step`, its text as `lines` (empty for a picture), `image` and `thumbnail` as links |
| `passage` | `slides`: each with `columns`, one per Bible version, each with `version`, the `reference` in the version's language, the verse `units` with their `label` and `lines`, `credit` and `copyright` |
| `video` | `video` as a link, and `durationSeconds` |
| `website` | `url` |

Every content also has `title` and `text`, a plain-text form for a reader that wants no more.

### What is on screen now

```sh
curl -s localhost:8081/local/v1/workspaces/6f0c…/live
```

```json
{
  "live": true,
  "runSheet": { "id": "rs-…", "date": "2026-11-15" },
  "blank": false,
  "updatedAt": "2026-11-15T10:04:31.000Z",
  "presented": {
    "itemId": "item-…",
    "songId": "song-…",
    "title": "Amazing Grace",
    "kind": "lyrics",
    "previous": false,
    "pieceId": "l3",
    "lines": ["That saved a wretch", "Like me"],
    "image": null,
    "video": null,
    "websiteUrl": null,
    "passage": null,
    "background": null
  }
}
```

This is the coordinator's copy on the server, refreshed a second after each change; while the desktops meet only on the venue network the server does not see it. `{ "live": false }` when nothing is live.

### The presentation log

An entry is one unbroken showing of one piece on the outputs: it starts when the piece goes on screen and ends when another replaces it, or the screen is cleared or blanked, or the live state ends. Showings shorter than a second are not kept. Blank and clear are the gaps between entries.

By time range, on the entries' start:

```sh
curl -s 'localhost:8081/local/v1/presentation-log?workspace=6f0c…&from=2026-11-15T00:00:00Z&to=2026-11-16T00:00:00Z'
```

Or following on, after a cursor:

```sh
curl -s 'localhost:8081/local/v1/presentation-log?after=0&limit=200'
```

```json
{
  "entries": [
    {
      "id": "0b5e…",
      "workspaceId": "6f0c…",
      "device": { "id": "dev-…", "name": "Projection desk" },
      "runSheet": { "id": "rs-…", "date": "2026-11-15" },
      "itemId": "item-…",
      "previous": false,
      "song": { "id": "song-…", "revision": 4, "revisionId": "rev-…", "version": null },
      "part": { "kind": "lyrics", "line": 2, "count": 2 },
      "startedAt": "2026-11-15T10:04:31.000Z",
      "endedAt": "2026-11-15T10:04:52.000Z",
      "closedByServer": false,
      "clockOffsetMs": -120,
      "cursor": 1834,
      "content": {
        "kind": "lyrics",
        "title": "Amazing Grace",
        "author": "John Newton",
        "copyright": "Public domain",
        "ccli": null,
        "block": 1,
        "lines": ["That saved a wretch", "Like me"],
        "text": "That saved a wretch\nLike me"
      },
      "background": {
        "color": "#000000",
        "media": {
          "url": "/local/v1/workspaces/6f0c…/media/hills.jpg",
          "name": "hills.jpg",
          "gone": false,
          "kind": "image"
        }
      }
    }
  ],
  "cursor": 1834,
  "more": false
}
```

- **Content as it was shown.** `content` is joined, at the time of reading, from the revision of the song that was on screen, never the song's latest: lyrics edited after the service come back as they were sung. It is still there after the song and its run sheet were removed. An entry whose revision has not reached the server yet has `content: null`, and has it on a later read.
- **Content kinds.** As for run sheets, but only the part shown: `lyrics` with the `lines` shown and their `block`; `deck` with one slide's `slide`, `step`, `page`, `lines`, `image` and `thumbnail`; `passage` with the slide's `columns`; `video`; `website`.
- **`part`** says which part was shown by position in that revision: the first line and how many (`lyrics`), the page of a deck (`deck`), or the slide and, per column, its first verse unit and how many (`passage`).
- **`background`** is the background in use when the entry opened, as a colour and a link.
- **`endedAt`** is null while the piece is still on screen. `closedByServer` is true when the server ended the entry itself: a later entry started first, or the live state expired with it open.
- **Times** are the coordinator's clock. `clockOffsetMs` is that clock minus the server's, so a reader can line the log up with a recording, whose own offset is given the same way.

**Following the log.** The cursor is the server's order of arrival, renewed each time an entry changes. Read with `after=0`, then keep reading `after=<cursor>` with the `cursor` of the last answer; while `more` is true there is more to read at once. An entry that closes later, or arrives late from a service on the venue network alone, is returned again with its new cursor, so a poller misses nothing and needs no clock of its own. Replace an entry you hold by its `id`. A range read also returns the current `cursor`, to follow on from.

### Recordings

When a workspace broadcasts live audio, the broadcasting computer records it and uploads it to the server as it goes. One recording is one unbroken run of one input: unplugging the audio interface and plugging it back in makes two.

```sh
curl -s 'localhost:8081/local/v1/recordings?workspace=6f0c…&from=2026-11-15T00:00:00Z'
```

```json
{
  "recordings": [
    {
      "id": "3d2a…",
      "workspaceId": "6f0c…",
      "deviceId": "dev-…",
      "deviceName": "Sound desk",
      "inputName": "Scarlett 2i2 USB",
      "container": "webm",
      "mimeType": "audio/webm;codecs=opus",
      "startedAt": "2026-11-15T09:58:02.000Z",
      "endedAt": null,
      "bytes": 1048576,
      "chunks": 128,
      "lastChunkAt": "2026-11-15T10:08:42.000Z",
      "status": "receiving",
      "cutShort": false,
      "clockOffsetMs": -95,
      "url": "/local/v1/recordings/3d2a…/file"
    }
  ]
}
```

- `container` is `webm` (WebM with Opus, served as `audio/webm`) or `mp4` (MP4 with AAC, served as `audio/mp4`), as the broadcasting computer recorded it. The server never transcodes.
- `status` is `receiving` while chunks keep coming, `interrupted` after ten minutes without one (a later chunk makes it `receiving` again), and `complete` once the computer closed it. `cutShort` says some of it never reached the server.
- A range of recordings is those that overlap it.

The file can be read while it grows: ask for a range from where you stopped, and a range past the end is answered with what there is.

```sh
curl -s -o service.webm localhost:8081/local/v1/recordings/3d2a…/file
curl -s -H 'Range: bytes=1048576-' localhost:8081/local/v1/recordings/3d2a…/file >> service.webm
```

### Media

```sh
curl -s -o slide.jpg localhost:8081/local/v1/workspaces/6f0c…/media/deck-…-001.jpg
```

Serves a workspace's own file or the Church Library's. A name with a path in it, a deck's original, or another workspace's file is 404.

## A reader in twenty lines

```js
// Prints today's run sheet, then follows the log as it is presented.
const api = 'http://127.0.0.1:8081/local/v1';
const get = async (path) => (await fetch(api + path)).json();

const [workspace] = (await get('/workspaces')).workspaces;
const today = new Date().toISOString().slice(0, 10);
const sheet = await fetch(`${api}/workspaces/${workspace.id}/run-sheets/${today}`);
if (sheet.ok) for (const item of (await sheet.json()).items) console.log('-', item.content?.title);

let cursor = (await get(`/presentation-log?workspace=${workspace.id}&from=${today}`)).cursor;
for (;;) {
  const page = await get(`/presentation-log?workspace=${workspace.id}&after=${cursor}`);
  for (const entry of page.entries) {
    const text = entry.content?.text.replace(/\n/g, ' / ') ?? '…';
    console.log(entry.startedAt.slice(11, 19), entry.endedAt ? 'ended' : 'on   ', text);
  }
  cursor = page.cursor;
  if (!page.more) await new Promise((done) => setTimeout(done, 2000));
}
```
