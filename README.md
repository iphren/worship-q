# Worship Q

_Every screen. In harmony._

Church lyrics and presentation software. The desktop app works on its own, with no church
server, account or network. A church server lets several computers, phones and browsers
share one presentation.

## Documentation

| For                     | Document                                                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Volunteers              | [Volunteer guide](docs/volunteer-guide.md)                                                                                                                               |
| Whoever runs the server | [Church server deployment](docs/server-deployment.md)                                                                                                                    |
| Developers              | [Requirements and architecture](docs/worship-q-requirements-and-architecture.md)                                                                                         |
| Phase 1                 | [Task breakdown](docs/phase-1-task-breakdown.md)                                                                                                                         |
| Phase 2                 | [Plan](docs/phase-2-plan.md), [task breakdown](docs/phase-2-task-breakdown.md), [acceptance record](docs/acceptance/phase-2.md), [LAN spike](docs/spikes/lan.md)         |
| Phase 3                 | [Plan](docs/phase-3-plan.md), [acceptance record](docs/acceptance/phase-3.md), [sign-in spike](docs/spikes/oidc.md)                                                      |
| Next                    | [Media uploads plan](docs/media-uploads-plan.md)                                                                                                                         |
| OBS control             | [Plan](docs/obs-control-plan.md), [task breakdown](docs/obs-control-task-breakdown.md), [acceptance record](docs/acceptance/obs-control.md), [spike](docs/spikes/obs.md) |

## Develop

You need Node 22, pnpm 9 and a Rust toolchain. See the
[Tauri prerequisites](https://tauri.app/start/prerequisites/).

```sh
pnpm install
pnpm dev          # desktop app with live reload
pnpm build        # installer for this platform, in apps/desktop/src-tauri/target/release/bundle

pnpm test         # unit tests
pnpm typecheck
pnpm lint
pnpm format
```

### Church server

```sh
pnpm --filter @worship-q/remote-web build
pnpm --filter @worship-q/output-web build
pnpm --filter @worship-q/admin-web build
pnpm --filter @worship-q/server dev                       # http://localhost:8080, data in apps/server/data
pnpm --filter @worship-q/server cli workspace create "Test"
```

For Docker, the reverse proxy and CloudFront, see
[Church server deployment](docs/server-deployment.md).

### Website

`apps/website` is the download page at [worship-q.com](https://worship-q.com). Its build
reads the latest published release and fills in the installer links (`*_universal.dmg`,
`*_x64-setup.exe`), the version and the date. `.github/workflows/website.yml` deploys it to
GitHub Pages when a release is published or when the site changes. Run that workflow by hand
after you point "latest" at another release.

```sh
pnpm --filter @worship-q/website dev
```

## Layout

```text
apps/desktop/          Desktop app: React interface and the Tauri (Rust) core
apps/server/           Church server: sync, backups, church defaults, relay, live-state backup
apps/remote/           Phone remote-control page, served by the church server
apps/output/           Browser slideshow and subtitle overlay pages, served by the church server
apps/admin/            Admin web app for the church's administrators, served by the church server at /admin/
apps/website/          worship-q.com download page, on GitHub Pages

packages/protocol/     Shared record schemas, wire messages and the protocol version
packages/lyrics/       Lyrics parsing, pieces and piece identity
packages/search/       Song search keys: both Chinese scripts, pinyin and initials
packages/calendar/     Workspace-timezone dates and meeting days
packages/live-state/   Live state: commands, start rules, expiry, coordinator and followers
packages/store/        SQLite schema, migrations and data access
packages/session/      One operator device's session, tying the above together
packages/renderer/     Slideshow and subtitle fitting, wrapping and drawing
packages/sync/         Content synchronization with a church server
packages/remote/       Remote control on every operator computer: approvals and commands
packages/relay/        Relay between a workspace's devices, run by the server and on the LAN
```

The Rust core handles only these:

- windows, files and fonts
- the database
- the localhost pages
- the system keychain
- venue-network connections
- the connection to OBS on this computer

Everything else is TypeScript and is unit-tested without running the app.

## Where data lives

The app's data folder:

- macOS: `~/Library/Application Support/com.worship-q.desktop`
- Windows: `%APPDATA%\com.worship-q.desktop`

The first workspace's folder is the data folder itself. Each further workspace has its own
folder, `workspaces/<id>/`, inside it. Every workspace folder holds:

| Path                          | Holds                                                                                                             |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| The SQLite database           | The workspace's content and its church connection                                                                 |
| `backgrounds/`                | Imported images and videos                                                                                        |
| `backups/`                    | Backups saved before joining a church workspace. Backups of removed workspaces go in the data folder's `backups/` |
| `lan-cert.der`, `lan-key.der` | This workspace's certificate for venue-network connections                                                        |

The church device token lives in the system keychain, under the service
`com.worship-q.desktop`, rather than in the database. On macOS, `pnpm dev` signs the dev build
with the first Developer ID it finds (or `WORSHIPQ_DEV_SIGNING_IDENTITY`) under the release
identifier, so dev and release builds share that entry and connect as one computer. Without
a Developer ID, or with `WORSHIPQ_DEV_SIGNING=0`, the dev build keeps the token in
`dev-keychain.json` in the data folder instead. **Settings → Backup** saves a workspace's
database and backgrounds as one `.worshipq` file and restores them from it.

## Local ports

| Port               | Serves                                                                            |
| ------------------ | --------------------------------------------------------------------------------- |
| `127.0.0.1:47310`  | `/overlay/subtitle` and `/slideshow` pages, for OBS and browsers on this computer |
| `47311` (LAN, TLS) | Other devices of the workspace on the venue network, found by mDNS                |

## Versions and releases

The desktop app's version lives in `apps/desktop/package.json`, and `tauri.conf.json` reads
it from there. The root `package.json`, `Cargo.toml` and `Cargo.lock` must carry the same
version, and CI fails when they differ.

```sh
pnpm version:check          # are all the files on the same version?
pnpm version:bump 1.2.3     # set it by hand, outside release-please
```

[release-please](https://github.com/googleapis/release-please) keeps a Release PR open with
the next version and `apps/desktop/CHANGELOG.md`. It works these out from Conventional
Commit messages:

- `fix:` makes a patch release.
- `feat:` makes a minor release.
- `feat!:` or a `BREAKING CHANGE:` footer makes a major release.
- A `Release-As: x.y.z` footer sets the version directly.

Every commit counts, because the app is also built from `packages/`. The exception is a
commit that only touches `docs/`, `apps/server/`, `apps/remote/` or `apps/website/`. Those
don't ship in the app.

Merging the Release PR tags `vX.Y.Z` and creates a **draft** GitHub Release.
`.github/workflows/release.yml` then builds the macOS (universal) and Windows installers into
that draft, together with the signed updater feed `latest.json`. Nothing reaches users until
the draft is published:

1. Wait for the Release workflow's `check` job, which confirms `latest.json` covers every
   platform.
2. Install the draft's builds on a Mac and a Windows PC, and run through a service.
3. Publish the draft. The download links and the updates of installed apps now point at it.

If a release turns out bad, mark the previous release as latest again, or edit its
`latest.json` back. Then ship a fix. This stops further updates, but it doesn't downgrade
computers that already updated.

A release that raises the protocol version may need the church server updated first; phase 2
did, phase 3 does not. See
[Church server deployment](docs/server-deployment.md#updating-to-phase-2-protocol-version-2)
and [Updating to phase 3](docs/server-deployment.md#updating-to-phase-3-protocol-version-3).

Release builds need the repository secrets `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, which sign the updates. If you lose that key, installed
apps can no longer be updated.

## License

[MIT](LICENSE)
