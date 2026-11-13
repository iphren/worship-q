# Worship Q — Church Server Deployment

The church server (`apps/server`) gives a church's desktops content synchronization,
off-site backups, church-wide default settings, remote control from phones, and an admin web
app for the church's administrators. Desktops work without it; connecting is optional.

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
| `WORSHIP_Q_ADMIN_DIR` | `/app/admin` | The built admin app, served at `/admin/` |
| `WORSHIP_Q_PUBLIC_URL` | — | This server's public address, `https://worship.example.org`; needed for sign-in and used in pairing links |
| `WORSHIP_Q_OIDC_ISSUER` | — | The church's OpenID Connect provider; see **Administrator sign-in** |
| `WORSHIP_Q_OIDC_CLIENT_ID` | — | The application registered with the provider |
| `WORSHIP_Q_OIDC_CLIENT_SECRET` | — | Its secret, when the provider requires one (both Microsoft and Google do) |
| `WORSHIP_Q_ADMINS` | — | E-mail addresses made administrators at start, comma-separated |
| `WORSHIP_Q_RETENTION_DAYS` | `90` | How long a deleted song's or background's files are kept before the daily sweep removes them |
| `WORSHIP_Q_MAX_IMAGE_MB` | `25` | Largest image a desktop may upload, in MB |
| `WORSHIP_Q_MAX_DECK_MB` | `200` | Largest slide deck or PDF a desktop may upload, in MB |
| `WORSHIP_Q_MAX_VIDEO_MB` | `200` | Largest video a desktop may upload, in MB; the server never shrinks videos |
| `WORSHIP_Q_YOUVERSION_KEY` | — | The church's YouVersion Platform app key; see **Bible passages** |
| `WORSHIP_Q_API_BIBLE_KEY` | — | The church's API.Bible key |
| `WORSHIP_Q_ESV_KEY` | — | The church's ESV API key |
| `WORSHIP_Q_STUN` | `stun:stun.l.google.com:19302` | STUN servers for live audio, comma-separated; empty for none. See **Live audio** |
| `WORSHIP_Q_TURN_URL` | — | The live audio relay's address, `turn:worship.example.org:3478`; with the secret below |
| `WORSHIP_Q_TURN_SECRET` | — | The secret shared with the relay; never sent to a device |
| `WORSHIP_Q_TURN_LISTEN_IP` | — | The relay's own address on the host (`--profile turn` only) |
| `WORSHIP_Q_TURN_EXTERNAL_IP` | — | The host's public address, or `public/private` behind the provider's NAT |

Back up the `worship-q-data` volume like any other server data. It holds the church's
songs (as synchronized records), the background files, and the last 30 desktop backups
per workspace.

## Reverse proxy and CloudFront

The server needs, end to end:

- WebSockets on `/api/v1/coordinator`, `/api/v1/remote` and `/api/v1/output`.
- The `Authorization`, `x-worship-q-protocol` and `x-worship-q-admin` request headers passed
  through, and cookies both ways for `/auth/*` and `/api/v1/admin/*`.
- No caching of `/api/*` or `/auth/*`.
- Uploads of large files (videos) with `PUT` and `POST`, with a request body limit at least
  as large as the largest media limit above (200 MB by default). nginx allows only 1 MB
  unless told otherwise; without the setting below, every larger upload fails with a 413
  error, which the desktop reports as the proxy refusing the file:

  ```nginx
  client_max_body_size 200m;  # at least WORSHIP_Q_MAX_VIDEO_MB and WORSHIP_Q_MAX_DECK_MB
  ```

  With nginx's default request buffering, the desktop's upload bar reaches 100 % when nginx
  has the file, and nginx then hands it to the server; that short wait shows as
  processing. `proxy_request_buffering off;` for `/api/v1/` avoids it, but is not needed.

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
# {"name":"Our Church","protocolVersion":7,"minProtocolVersion":2,"decks":true,"outputs":true,
#  ...,"media":{"images":true,"videos":true,"limits":{"image":26214400,"deck":209715200,"video":209715200}}}
```

A device token is passed through correctly if, after connecting a desktop, its Settings →
Church connection shows "Up to date". "Could not synchronize: … 401" means the
`Authorization` header is being stripped on the way.

## Administrator sign-in

Administrators use the admin app at `https://<server>/admin/` after signing in with the
church's Microsoft 365 or Google Workspace account. Signing in only proves who someone is:
they get in only if their e-mail address is on the server's list of administrators.

> These steps follow the providers' documentation and have not yet been run against a real
> tenant; see `docs/spikes/oidc.md` for what to confirm.

**Microsoft Entra ID:** in the tenant, **App registrations → New registration**; platform
**Web**; redirect URI `https://<server>/auth/callback`. Make a client secret. Under **Token
configuration**, add the optional claim `email` to the ID token. The issuer must name the
church's tenant: the server refuses `common`, `organizations` and `consumers`, which would let
any Microsoft tenant sign in. Then, in `apps/server/.env`:

```sh
WORSHIP_Q_PUBLIC_URL=https://worship.example.org
WORSHIP_Q_OIDC_ISSUER=https://login.microsoftonline.com/<tenant id>/v2.0
WORSHIP_Q_OIDC_CLIENT_ID=<application (client) id>
WORSHIP_Q_OIDC_CLIENT_SECRET=<secret value>
WORSHIP_Q_ADMINS=pat@example.org
```

**Google Workspace:** in Google Cloud, **APIs & Services → Credentials → Create OAuth client
ID**; type **Web application**; authorised redirect URI `https://<server>/auth/callback`. Set
the consent screen to **Internal** so only the Workspace's users can sign in. Then:

```sh
WORSHIP_Q_PUBLIC_URL=https://worship.example.org
WORSHIP_Q_OIDC_ISSUER=https://accounts.google.com
WORSHIP_Q_OIDC_CLIENT_ID=<client id>.apps.googleusercontent.com
WORSHIP_Q_OIDC_CLIENT_SECRET=<client secret>
WORSHIP_Q_ADMINS=pat@example.org
```

`WORSHIP_Q_ADMINS` names the first administrator; the server adds an address it has never
seen at start and never removes one. An administrator removed in the app stays removed even
while still listed here; `admin add` on the command line brings them back. Administrators add and remove each other in the app, and the last one
cannot be removed there. Without the sign-in variables the server runs as before, the admin
app says that sign-in is not configured, and administration is the command line below.

Sessions last eight hours without a request. Sign out ends one at once.

## Administration

Administrators do the following in the admin app:

- **Workspaces:** create and rename them; see which manage the Church Library and which are
  presenting right now; turn **Manage Church Library** on, after a page that lists what the
  conversion changes; turn a workspace's connection code on or off, or replace it.
- **Devices:** approve computers that ask to join (see **Connecting a desktop**), name them,
  see when each was last seen and whether it is connected, and revoke one, which disconnects
  it at once.
- **Church Library:** see the church's songs and backgrounds, which workspaces' run sheets
  use one, delete one, and bring a deleted one back.
- **Administrators**, **Church defaults** and **Storage** (how much space the server uses,
  by kind of file and by workspace, with the free space left).
- **Live:** a workspace's page shows what the server last heard of its presentation: who
  holds it, the run sheet, what is on screen and which devices follow. It is a view only;
  presenting stays with the operator computers.

The same can be done as a command inside the container, which stays as the way back in when
sign-in is unavailable or the last administrator is gone:

```sh
docker compose -f apps/server/compose.yaml exec worship-q node dist/cli.js <command>
```

| Command | Does |
| --- | --- |
| `admin add <email>` | Makes an e-mail address an administrator |
| `admin list` | Lists administrators |
| `admin remove <email>` | Removes one; the last cannot be removed |
| `workspace create <name>` | Creates a workspace and prints its connection code |
| `workspace list` | Lists workspaces |
| `workspace code <id>` | Replaces a workspace's connection code; enrolled devices keep working |
| `workspace library <id> <types>\|all\|none [--yes]` | What the workspace manages in the Church Library: `songs`, `backgrounds`, `slides`, `websites`, comma-separated; without `--yes` it only shows what would change |
| `workspace library-take <id> <types> [--yes]` | Takes the Church Library's items of those types into the workspace's own library; without `--yes` it only lists them |
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

The connection code lets any computer join the workspace. It works for every workspace until
the server has an administrator; from then on it works only for a workspace whose code an
administrator turned on, and new computers normally join by approval instead (see
**Connecting a desktop**). Give a code only to people who may prepare that workspace's
content, and replace it with `workspace code` if it leaks.

## The Church Library

Songs, backgrounds, slides and websites of the Church Library are seen by every workspace.
A workspace manages each of these types on its own (`workspace library <id> songs,backgrounds`,
or `all`); for the types it manages, it adds, edits and removes the church's items directly.
For the other types, and in every other workspace:

- new songs and backgrounds stay in that workspace;
- editing a church song makes the workspace its own version, which replaces the church's
  there only, and later church edits leave it alone;
- removing a church song or background hides it in that workspace only.

When the church removes a song, a workspace's own version of it stays as that workspace's
song.

A workspace that edited a church song has **two versions** of it, both kept up to date: the
church's latest and its own. Its computers show both and a toggle for which one the
workspace presents; the choice is per song and per workspace, and it synchronizes to the
workspace's other computers like an edit. **Delete our version** goes back to the church's
song for good. Computers show a **Church** badge on the church's songs and **2 versions** on
songs with both; a workspace shows neither on the types it manages, since those are the
church's.

Deleting a song or background from the Church Library, by a managing workspace or in the
admin app, is recoverable: the admin app lists deleted items and **Restore** brings one back
to every workspace; a workspace that made its own version of a song sees both versions again,
still using its own. After `WORSHIP_Q_RETENTION_DAYS` (90 by default) a daily sweep removes a deleted item's
files; the item stays listed as deleted with its files gone and can no longer be restored. A
workspace's own deleted backgrounds and slide decks are swept the same way; a church item a
workspace merely hid is not a deletion and keeps its files.

Turning a type on first shows what will happen, and changes nothing without `--yes`. The
list given is everything the workspace manages afterwards:

```sh
docker compose -f apps/server/compose.yaml exec worship-q node dist/cli.js workspace library <id> songs,backgrounds
docker compose -f apps/server/compose.yaml exec worship-q node dist/cli.js workspace library <id> songs,backgrounds --yes
```

The workspace's items of the types turned on become the church's. Its own versions of
church items replace them for every workspace, including workspaces without their own
version. Church items of those types it hid reappear. Their files move to the church's
folder. Turning a type off leaves the Church Library as it is.

To give the church's items of some types to one workspace instead, turn those types off for
it and take them:

```sh
docker compose -f apps/server/compose.yaml exec worship-q node dist/cli.js workspace library-take <id> slides,websites
docker compose -f apps/server/compose.yaml exec worship-q node dist/cli.js workspace library-take <id> slides,websites --yes
```

Every live church item of those types becomes the workspace's own, with its history and
files. Every other workspace sees it deleted from the Church Library; one that made its own
version keeps that as its own. The church's deleted item cannot be restored.

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

## Media: slide decks, PDFs, images and videos

**Library → Media → Add media…** on a connected desktop, or a file dropped on a run sheet,
sends a slide deck, PDF, image or video to the server. Each kind has its own size limit
(see the table above); a desktop refuses a file over the limit before sending it, and the
server refuses it again while receiving, with 413.

- **Images** (JPEG, PNG, WebP, GIF) are reduced on the server to fit 1920 × 1080, never
  enlarged, turned upright, and saved as JPEG with a small copy for phones. This uses the
  `sharp` library, which comes with the server: nothing more to install, and images work
  even without LibreOffice. HEIC photos are refused; a Mac converts them to JPEG before
  sending, and a Windows PC asks for a JPEG.
- **Videos** (MP4, M4V, MOV, WebM) are stored as uploaded; the server never converts them.
  MP4 with H.264 plays on every computer. Each desktop downloads the videos of today's and
  upcoming run sheets ahead of time, so nothing streams during a service.
- **Originals** of decks, PDFs and images are kept beside their images, for **Download
  original** and **Reconvert**; the Storage page in the admin app counts them.

### Slide decks

A PowerPoint (.pptx, .ppt, .ppsx), Keynote, OpenDocument (.odp) or PDF file is sent to the
server. The server lays the slides out with
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

## Bible passages

Desktops and phones show Bible passages through this server, which calls the Bible
providers with the church's own keys. The keys stay on the server: they are never logged,
never sent to a desktop or a phone, and the admin app shows only whether each is set.

| Provider | Variable | Where to get a key | What it serves |
| --- | --- | --- | --- |
| YouVersion Platform | `WORSHIP_Q_YOUVERSION_KEY` | Register an app at developers.youversion.com; accept each publisher's licence (Biblica for NIV and 当代译本, Lockman for NASB) in the portal, or those versions answer 403 | NIVUK, 当代译本 (CCB, CCBT), 中文标准译本 (CSBS, CSBT), BSB |
| API.Bible | `WORSHIP_Q_API_BIBLE_KEY` | api.bible; the Starter plan allows 5,000 calls a month for the whole church | NKJV, NLT, KJV, and NIVUK and the open 当代译本 as fallbacks |
| ESV API | `WORSHIP_Q_ESV_KEY` | api.esv.org | ESV |
| Free Use Bible API | — | No key | 新标点和合本 (CUNP-S, CUNP-T), KJV, BSB, 当代译本 and 中文标准译本 as fallbacks |

The keys belong to the church, registered by the church for its own use, as each provider's
terms require (see the Bible passages discovery, §4). Set them in `.env` beside the others
and restart the server; the log then says which keys are set and, once checked, which
versions are available and through which provider.

**Choose the offered versions** in the admin app: **Church defaults → Bible versions** lists
every version Worship Q knows, says whether a provider answers for it with the keys set, and
offers the ticked ones to every workspace. Until a version is ticked, desktops say the church
offers no Bible. **Default for workspaces** chooses up to two of them, shown side by side on
every desktop and phone of a workspace until it picks its own.

The server checks each version once at start and daily, falls back from one provider to the
next for the same edition when one fails, and keeps each version's table of contents in
`bible/` in the data folder (about 7 KB each). Passage text is kept in memory for ten minutes
at most and never written to disk. API.Bible's usage tokens are reported to API.Bible from
the server in the background, as its terms ask.

## Connecting a desktop

1. On the desktop: **Settings → Church connection**, enter the server address
   (`worship.example.org`) and a name for the computer, then **Next**.
2. With an administrator on the server, the computer shows an eight-character code and a QR
   code and waits. An administrator opens the admin app (or scans the QR code, which opens
   the request there after sign-in), checks the code and the computer's name, chooses the
   workspace, chooses whether the computer may merge its own songs and run sheets into it
   (there is no default), and approves. The request lasts fifteen minutes. Without an
   administrator yet, or on a server before phase 3, the computer asks for a connection code
   instead: create
   the workspace in the admin app or with `workspace create`, and enter the code it prints.
   An administrator can also turn a workspace's code on for a while, and the computer offers
   **I have a connection code instead**.
3. The first computer of a workspace uploads its songs, run sheets and settings.
   A computer joining later chooses either **Keep both**, which merges its songs into the
   workspace, or **Use the church's copy**, which replaces its own. If the administrator who
   approved its pairing did not allow merging, it is offered only **Use the church's copy**,
   and brings nothing even to a workspace with no content yet, which it then starts empty.
   The admin app warns when that would leave the computer with no songs at all. Either way
   a backup is saved first in the app's data folder, under `backups/`.

Computers connected before phase 3 stay connected; the device list shows them as joined with
a connection code.

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
start. From then on an older desktop shows **The server runs a newer version** and stops
synchronizing and receiving phones; presenting from local data keeps working. The desktop
downloads the new version within six hours and installs it when the operator restarts the
app. Tell the branches to restart once the update banner appears.

The update keeps the enrollment; the device token moves into the system keychain (Keychain
on macOS, Credential Manager on Windows), and Settings says so when the keychain refused.
Phone approvals are kept. The OBS subtitle overlay keeps its address. Viewer mode and
browser output links are new and off until an operator turns them on.

## Updating to phase 3 (protocol version 3)

Phase 3 raises the protocol version to 3 but keeps accepting version 2, and a desktop speaks
the server's version when the server is older. So the server and the desktops can update in
either order, and nothing stops working on the day of either.

Before the server update, register the application with the church's provider (see
**Administrator sign-in**), choose the first administrator's e-mail address, and add the
variables to `apps/server/.env`. Check that the reverse proxy passes cookies and the new
paths (`/admin/`, `/auth/`, `/api/v1/admin/`). Without the variables the server starts as
before and the admin app says that sign-in is not configured.

Run `scripts/update-server.sh` early in a week. The server migrates its database on start,
adds the first administrator, and starts the retention sweep, which removes nothing for 90
days. Connection codes keep working until that administrator exists; from then on new
computers ask for approval, so tell the branches who approves.

Desktops update themselves within six hours of the release, whether or not the server has
been updated. A desktop still on version 2 keeps presenting and synchronizing; it shows no
**Church** or **2 versions** badges and no toggle until it restarts into version 3. The first
pull after the desktop update is a full one, so every song learns where it came from; a
workspace of a few thousand songs takes under a minute. Every enrollment, device token, phone
approval, output link and viewer setting is kept; no computer re-pairs.

## Live audio

One computer of a workspace can broadcast the sound from the mixing desk to the workspace's
other computers, its approved phones and signed-in administrators, who press **Listen**.
The audio goes directly between the devices, never through this server: the server only
passes the messages that set each connection up. Nothing is recorded.

Most churches set nothing up. Devices on the venue network find each other by their own
addresses. A listener at home reaches the broadcaster through a public STUN server, which
`GET /api/v1/ice` hands enrolled devices (default `stun:stun.l.google.com:19302`; replace it
with `WORSHIP_Q_STUN`, or set it empty for none).

Some networks, often mobile ones, allow no direct path. For those, run the optional relay,
coturn, beside the server. It is a Compose profile, off by default:

1. Choose a long random secret, and add to `apps/server/.env`:

   ```sh
   WORSHIP_Q_TURN_SECRET=<a long random secret>
   WORSHIP_Q_TURN_URL=turn:worship.example.org:3478
   WORSHIP_Q_TURN_LISTEN_IP=<this host's own address, as `ip addr` shows it>
   WORSHIP_Q_TURN_EXTERNAL_IP=<the public address>   # or public/private behind NAT
   ```

2. Open **UDP 3478** and **UDP 49160–49180** to the internet, in the host's firewall and in
   the hosting provider's. These do not go through the reverse proxy or CloudFront; the
   relay answers on the server's own address. Each relayed listener uses one of the 21
   relay ports.
3. Start it with the server: `docker compose -f apps/server/compose.yaml --profile turn up -d`.
4. Check it: `/api/v1/info` says `"audioRelay":true`. From outside the venue, run the
   Trickle ICE page (webrtc.github.io/samples) with the relay's address and a credential
   from `GET /api/v1/ice` taken with a device token; a `relay` candidate means it works.

Each device asks the server for a credential before every new connection; a credential is
valid ten minutes and is made from the secret, which never leaves the server. A listener
that cannot connect is told whether the church offers a relay. TURN over TCP or TLS is not
offered.

## Updating for live audio (protocol version 7)

Live audio raises the protocol version to 7 and keeps accepting versions 2 to 6. Update the
server first: the relay must know the new messages before any desktop can share a broadcast.
It changes nothing for a workspace that does not broadcast. Until the server is updated, the
broadcasting computer's switch and level meter work and its Settings says a server update is
needed. A desktop still on version 6 presents as before and is sent no audio messages.

## Updating for media (protocol version 5)

Media uploads raise the protocol version to 5 and keep accepting versions 2 to 4. Update the
server first: a desktop with media against an older server still imports slide decks and
PDFs, and says that images and videos need a server update. Raise the reverse proxy's body
limit at the same time (see above). Image items work on older desktops too, as one-page
slide decks. A desktop older than version 5 shows a video item as a title with nothing to
present, and the server keeps the video when such a desktop renames it; ask every computer
to update before planning a service with videos.

## Updating for Bible passages (protocol version 6)

Bible passages raise the protocol version to 6 and keep accepting versions 2 to 5. Update
the server first, set the church's keys and choose the offered versions; desktops update
themselves as usual. A desktop older than version 6 shows a passage item as plain lyrics
(the passage's first version), and the server keeps the passage when such a desktop saves
the item, so churches can update desktops at their own pace. The Bible window appears only
on updated desktops connected to an updated server. A phone connected through an older
desktop cannot add passages; its Bible screen says the computer has no Bible.

## Updating for OBS control (protocol version 4)

OBS control raises the protocol version to 4 and keeps accepting versions 2 and 3; there is
nothing to configure. The server only passes the new OBS messages on, and refuses them before
version 4, so updating it is the one step needed for the OBS computer's controls to reach the
other computers and phones. Until then the OBS computer's own controls work and its Settings
says a server update is needed. Desktops update themselves as usual; a desktop still on
version 3 presents as before and is sent no OBS messages, and phones step down to its version
so they keep working with it. A workspace without OBS sees nothing new.



- When two computers edit the same song or the same date's run sheet before synchronizing,
  the later edit wins. Earlier song versions are kept in the song's history.
- Deleting a background on one computer hides it in that workspace. A background or song
  deleted from the Church Library keeps its files for the retention period, then loses them.
- Administrator sign-in has been tested only against a provider simulated in the tests, not
  yet against Microsoft Entra ID or Google Workspace; see `docs/spikes/oidc.md`.
- A church song a workspace hid cannot be unhidden from that workspace; the Church Library
  changing the song does not bring it back either.
- A phone browser usually refuses the coordinator's self-signed certificate, so phones use
  the server and need internet at the venue; the desktops do not.
- The venue network's part of phase 2 has not yet been tried on real hardware; see
  `docs/spikes/lan.md`.
