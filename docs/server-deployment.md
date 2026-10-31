# Worship Q — Church Server Deployment

The church server (`apps/server`) gives a church's desktops content synchronization,
off-site backups, church-wide default settings, and remote control from phones. Desktops
work without it; connecting is optional.

It is one Node process with one SQLite database and a folder of background files and
backups, all under the data directory (`/data` in the container).

## Run it with Docker

From the repository root on the server, save your settings once in `apps/server/.env`,
next to `compose.yaml`. Docker Compose reads them every time it starts the container:

```sh
cat > apps/server/.env <<'END'
WORSHIP_Q_NAME=Our Church
WORSHIP_Q_PORT=8080
END
```

Then start it:

```sh
docker compose -f apps/server/compose.yaml up -d --build
```

Without the file, both fall back to their defaults each time the container is created.
Check what Compose will use with
`docker compose -f apps/server/compose.yaml config | grep -E "WORSHIP_Q_NAME|published"`.
The `.env` file is ignored by Git and left out of the image, so pulling updates never
touches it.

The container listens on `127.0.0.1:8080`, or on `WORSHIP_Q_PORT`. Point your reverse
proxy at it. TLS is expected in front of it: phones and desktops must reach it over HTTPS.

| Variable | Default | Meaning |
| --- | --- | --- |
| `WORSHIP_Q_NAME` | `Worship Q` | Shown by `/api/v1/info` and `/`; only a label |
| `WORSHIP_Q_PORT` | `8080` | Port on `127.0.0.1` the reverse proxy forwards to |
| `WORSHIP_Q_DATA` | `/data` | Database, background files, backups and live-state snapshots |
| `PORT` | `8080` | Port inside the container |
| `WORSHIP_Q_REMOTE_DIR` | `/app/remote` | The built phone page, served at `/remote/` |
| `WORSHIP_Q_OUTPUT_DIR` | `/app/output` | The built browser output pages, served at `/output/` |

Back up the `worship-q-data` volume like any other server data. It holds the church's
songs (as synchronized records), the background files, and the last 30 desktop backups
per workspace.

## Reverse proxy and CloudFront

The server needs, end to end:

- WebSockets on `/api/v1/coordinator`, `/api/v1/remote` and `/api/v1/output`.
- The `Authorization` and `x-worship-q-protocol` request headers passed through.
- No caching of `/api/*`.
- Uploads of large files (videos) with `PUT`.

For CloudFront in front of the proxy, use one behavior for everything:

- **Allowed HTTP methods:** GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE.
- **Cache policy:** `CachingDisabled`.
- **Origin request policy:** `AllViewerExceptHostHeader`. Use `AllViewer` if your proxy
  routes by the public host name.
- **Viewer protocol policy:** Redirect HTTP to HTTPS.

CloudFront passes WebSockets through without extra settings. It closes idle connections,
so the server pings every 25 seconds.

Check the whole path from outside once deployed (replace the address):

```sh
curl https://worship.example.org/api/v1/info
# {"name":"Our Church","protocolVersion":2,"minProtocolVersion":2,"decks":true,"outputs":true}
```

A device token is passed through correctly if, after connecting a desktop, its Settings →
Church connection shows "Up to date". "Could not synchronize: … 401" means the
`Authorization` header is being stripped on the way.

## Administration

Until the admin web app exists, administration is a command run inside the container:

```sh
docker compose -f apps/server/compose.yaml exec worship-q node dist/cli.js <command>
```

| Command | Does |
| --- | --- |
| `workspace create <name>` | Creates a workspace and prints its connection code |
| `workspace list` | Lists workspaces |
| `workspace code <id>` | Replaces a workspace's connection code; enrolled devices keep working |
| `workspace library <id> on\|off [--yes]` | Whether the workspace manages the Church Library; without `--yes` it only shows what would change |
| `device list [workspace-id]` | Lists enrolled computers |
| `device revoke <device-id>` | Disconnects a computer; it must enroll again |
| `settings show` | Shows the church defaults |
| `settings set <key> <json>` | Sets a church default, e.g. `settings set linesPerPiece 2` |
| `settings unset <key>` | Removes a church default |

Church defaults: `linesPerPiece` (1–8), `wrapLongLines` (true/false),
`slideshowFontFamily` and `subtitleFontFamily` (a font name in quotes, e.g.
`'"Noto Sans SC"'`). A workspace that sets its own value in Settings keeps it; "Use church
default" goes back to the church's.

| `import legacy <workspace-id> <file\|-> [--dry-run]` | Imports songs from the legacy lyrics service |

The connection code lets any computer join the workspace. Give it only to people who may
prepare that workspace's content, and replace it with `workspace code` if it leaks.

## The Church Library

Songs and backgrounds of the Church Library are seen by every workspace. A workspace that
manages it (`workspace library <id> on`) adds, edits and removes them directly. In every
other workspace:

- new songs and backgrounds stay in that workspace;
- editing a church song makes the workspace its own version, which replaces the church's
  there only, and later church edits leave it alone;
- removing a church song or background hides it in that workspace only.

When the church removes a song, a workspace's own version of it stays as that workspace's
song.

Turning it on first shows what will happen, and changes nothing without `--yes`:

```sh
docker compose -f apps/server/compose.yaml exec worship-q node dist/cli.js workspace library <id> on
docker compose -f apps/server/compose.yaml exec worship-q node dist/cli.js workspace library <id> on --yes
```

The workspace's songs and backgrounds become the church's. Its own versions of church
songs replace them for every workspace, including workspaces without their own version.
Church songs and backgrounds it hid reappear. Its files move to the church's folder.
Turning it off leaves the Church Library as it is.

Import legacy songs only once, into the workspace that manages the Church Library. The
imported songs keep the same identifiers every time, so importing them again into another
workspace makes them that workspace's own versions of the church's.

## Importing songs from the legacy lyrics service

Export the live songs from the legacy service's MariaDB as tab-separated text, with the text
columns in hexadecimal so line breaks in lyrics survive any client. Run this in the legacy
service's folder, which holds its `.env`:

```sh
set -a; . ./.env; set +a
sudo mysql --default-character-set=utf8mb4 -B "$MARIADB" -e "
  SELECT songId, HEX(id) id_hex, HEX(title) title_hex, HEX(lyricist) lyricist_hex,
    HEX(composer) composer_hex, HEX(lyrics) lyrics_hex, HEX(copyright) copyright_hex, year,
    HEX(ccli) ccli_hex
  FROM songs WHERE deleted = 0 AND id NOT LIKE '%-probation' ORDER BY songId" > ~/legacy-songs.tsv
```

The import also reads a JSON array of the same columns, as a database tool exports it.

Then, from the repository folder, import it into a workspace. Check with `--dry-run` first:

```sh
docker compose -f apps/server/compose.yaml exec -T worship-q \
  node dist/cli.js import legacy <workspace-id> - --dry-run < ~/legacy-songs.tsv
```

The author is the lyricist and the composer, named once when they are the same person.
Importing again later updates the songs changed in the legacy service and removes the ones
deleted there. Songs edited in Worship Q since they were imported are left as they are. Do
the import before a workspace's first computer connects, so that computer can choose
**Use the church's copy**.

## Importing slide decks

**Songs → Import slides** on a connected desktop sends a PowerPoint (.pptx, .ppt, .ppsx),
Keynote, OpenDocument (.odp) or PDF file to the server. The server lays the slides out with
LibreOffice and draws each one as an image with Ghostscript, both included in the Docker image.
A slide with click animations becomes one image per click; hidden slides are left out. The
deck is saved as a song that presents its images, and other computers fetch the images when
they synchronize, so presenting works offline.

Converting takes about 10–20 seconds for 100 slides; one deck is converted at a time.
Without LibreOffice or Ghostscript (`WORSHIP_Q_SOFFICE`, `WORSHIP_Q_GHOSTSCRIPT` point to
them if they are elsewhere), the server starts as usual and the button explains that slides
cannot be converted. To try a file on the command line:

```sh
docker compose -f apps/server/compose.yaml exec worship-q \
  node dist/cli.js deck convert /data/some-deck.pptx /data/deck-test
```

Text keeps its place only when the server has the deck's fonts. The image includes Chinese
fonts (Noto CJK), fonts with the same widths as Calibri, Cambria, Arial and Times New Roman,
and Microsoft's free core fonts such as Trebuchet MS when they could be downloaded while
building.

## Connecting a desktop

1. `workspace create "North Branch"` prints a connection code.
2. On the desktop: **Settings → Church connection**, enter the server address
   (`worship.example.org`), the code, and a name for the computer, then **Connect**.
3. The first computer of a workspace uploads its songs, run sheets and settings.
   A computer joining later chooses either **Keep both**, which merges its songs into the
   workspace, or **Use the church's copy**, which replaces its own. Either way a backup is
   saved first in the app's data folder, under `backups/`.

After that, content synchronizes every minute, a few seconds after each edit, and
straight away when another computer changes something. Off-site backups are sent every 12
hours while the app is open, or with **Back up now**.

## One live state across the venue

Every desktop of a workspace shares one presentation (phase 2). The first operator computer
to connect holds it, as the **coordinator**; the others follow it, showing the same slide on
their own slideshow screens and subtitle overlays, and their Go live, slide changes, blank
and clear, and live run-sheet edits go through it. **Use this computer** under **Settings →
Church connection** moves the role to another computer without changing any screen.

The coordinator mirrors the live state to the server, which keeps it until the live state
expires (four hours after the last operator computer leaves). If the presenting computer
fails, the other computers show **The presenting computer is not responding** with **Carry
on here**, which continues from the same slide. When the failed computer returns it follows.

Computers on the same network also reach the coordinator directly, over TLS with a
certificate the coordinator makes for itself; its fingerprint reaches the other computers
through the server, so a device without a workspace credential can neither read nor send
anything. Found by mDNS on port 47311. With the venue's internet down, the desktops keep
presenting together over the network; a desktop that finds neither the server nor a
coordinator presents on its own and the others follow it. The first launch after the update
asks once to allow the app on the local network (macOS) or through the firewall on private
networks (Windows). Settings shows each computer's way in: **On this network** or **Through
the church server**.

A computer set to **Viewer mode** (Settings) shows the presentation on its screens and
never starts, holds or keeps one alive; it reopens as a viewer. Use it for a projector
computer that should only follow.

## Remote control

Every operator computer shows its own QR code and link under the phone icon at the bottom of
the sidebar; both change every few minutes. A phone that scans or opens it asks for control
and shows a four-digit code. The operator sees the same code in a banner and approves it.
The approval belongs to the workspace: the phone then stays approved on every computer of the
workspace, also when the computer that approved it closes, until someone chooses
**Disconnect** or **Disconnect all** (which also ends every browser output link). Phones
approved before phase 2 keep working without a new scan.

Phones can move between slides, jump to any slide of the live run sheet, and blank the
screen. With **Edit** they can also search the library and add, remove, or reorder songs on
the live run sheet; every operator sees each change in a banner, the coordinator with
**Undo**. Approve only people you trust with the service order. Phones cannot edit songs, go
live with another date, or change settings. Phones connect through the server; the
invitation also names the coordinator's address on the venue network, which a phone browser
can use only once it accepts the coordinator's certificate.

## Browser outputs

**Settings → Browser outputs** makes links that show the slideshow or the subtitle overlay in
any browser through the server, for example an OBS Browser Source on a streaming laptop
without Worship Q. Each link holds its own key: the page keeps nothing in browser storage,
sets no cookies and asks for no sign-in, so a fresh browser shows the output the first time
the link opens, and it keeps working across dates, restarts and handovers until the link is
revoked. The page uses the workspace's font when the browser has it, else the system's, and
the connected-devices list says which. Anyone with the link sees what is on the projector.

On a computer running Worship Q, OBS and browsers can also show the slideshow without
internet at `http://127.0.0.1:47310/slideshow`, next to the subtitle overlay at
`http://127.0.0.1:47310/overlay/subtitle`.

## Connected devices

**Settings → Connected devices** lists every computer, phone and browser output following the
presentation, its role and how it is connected, with **Disconnect** for phones and outputs
and **Disconnect all**.

## Updating to phase 2 (protocol version 2)

Phase 2 raises the protocol version, so the day the server is updated is the only day that
affects the branches.

Before the server update, every church computer must run a release with the automatic
updater (0.2.0 or later). Computers installed from a build of `main` before 25 October 2026
report version 0.1.0 and never update themselves: install the current release over the
existing app, on a weekday. Workspaces, songs, run sheets, phone approvals and the church
enrollment are all kept.

Run `scripts/update-server.sh` early in a week. The server migrates its own database on
start. From then on an older desktop shows **The server runs a different version** and stops
synchronizing and receiving phones; presenting from local data keeps working. The desktop
downloads the new version within six hours and installs it when the operator restarts the
app. Tell the branches to restart once the update banner appears.

The update keeps the enrollment; the device token moves into the system keychain (Keychain
on macOS, Credential Manager on Windows), and Settings says so when the keychain refused.
Phone approvals are kept. The OBS subtitle overlay keeps its address. Viewer mode and
browser output links are new and off until an operator turns them on.

## Known limits of this version

- When two computers edit the same song or the same date's run sheet before synchronizing,
  the later edit wins. Earlier song versions are kept in the song's history.
- Deleting a background on one computer hides it everywhere. Its file stays on the server.
- Administration is the command above, with no admin web app and no OIDC sign-in yet.
- A phone browser usually refuses the coordinator's self-signed certificate, so phones use
  the server and need internet at the venue; the desktops do not.
- The venue network's part of phase 2 has not yet been tried on real hardware; see
  `docs/spikes/lan.md`.
