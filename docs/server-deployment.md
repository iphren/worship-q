# Worship Q — Church Server Deployment

The church server (`apps/server`) gives a church's desktops content synchronization,
off-site backups, church-wide default settings, and remote control from phones. Desktops
work without it; connecting is optional.

It is one Node process with one SQLite database and a folder of background files and
backups, all under the data directory (`/data` in the container).

## Run it with Docker

From the repository root on the server:

```sh
WORSHIP_Q_NAME="Our Church" docker compose -f apps/server/compose.yaml up -d --build
```

The container listens on `127.0.0.1:8080` (set `WORSHIP_Q_PORT` to change it). Point your
reverse proxy at it. TLS is expected in front of it: phones and desktops must reach it over
HTTPS.

| Variable | Default | Meaning |
| --- | --- | --- |
| `WORSHIP_Q_NAME` | `Worship Q` | Shown by `/api/v1/info` |
| `WORSHIP_Q_DATA` | `/data` | Database, background files and backups |
| `PORT` | `8080` | Port inside the container |

Back up the `worship-q-data` volume like any other server data. It holds the church's
songs (as synchronized records), the background files, and the last 30 desktop backups
per workspace.

## Reverse proxy and CloudFront

The server needs, end to end:

- WebSockets on `/api/v1/coordinator` and `/api/v1/remote`.
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
# {"name":"Our Church","protocolVersion":1,"minProtocolVersion":1}
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
| `device list [workspace-id]` | Lists enrolled computers |
| `device revoke <device-id>` | Disconnects a computer; it must enroll again |
| `settings show` | Shows the church defaults |
| `settings set <key> <json>` | Sets a church default, e.g. `settings set linesPerPiece 2` |
| `settings unset <key>` | Removes a church default |

Church defaults: `linesPerPiece` (1–8), `wrapLongLines` (true/false),
`slideshowFontFamily` and `subtitleFontFamily` (a font name in quotes, e.g.
`'"Noto Sans SC"'`). A workspace that sets its own value in Settings keeps it; "Use church
default" goes back to the church's.

The connection code lets any computer join the workspace. Give it only to people who may
prepare that workspace's content, and replace it with `workspace code` if it leaks.

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

## Remote control

The first desktop of a workspace to connect receives remote control. Another can take over
with **Use this computer** in Settings or in the remote-control window. In the app, open the
phone icon at the bottom of the sidebar. It shows a QR code and a link, both of which change
every few minutes. A phone that scans or opens it asks for control and shows a four-digit
code. The operator sees the same code in a banner and approves it. The phone then stays
approved until someone chooses **Disconnect** or **Disconnect all**.

Phones can move between slides, jump to any slide of the live run sheet, and blank the
screen. They cannot edit, go live with another date, or change settings. Remote control
needs internet at the venue: phones connect through the server, not over the local network.

## Known limits of this version

- Device tokens are stored in the app's database, not the operating system's keychain.
- When two computers edit the same song or the same date's run sheet before synchronizing,
  the later edit wins. Earlier song versions are kept in the song's history.
- Deleting a background on one computer hides it everywhere. Its file stays on the server.
- Administration is the command above, with no admin web app and no OIDC sign-in yet.
