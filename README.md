# Worship Q

_Every screen. In harmony._

Church lyrics and presentation software. This repository currently holds phase 1: a local
desktop app that needs no church instance, account or network.

- [Requirements and architecture](docs/worship-q-requirements-and-architecture.md)
- [Phase 1 task breakdown](docs/phase-1-task-breakdown.md)
- [Volunteer guide](docs/volunteer-guide.md)
- [Church server deployment](docs/server-deployment.md)

## Run it

Needs Node 22, pnpm 9 and a Rust toolchain ([Tauri prerequisites](https://tauri.app/start/prerequisites/)).

```sh
pnpm install
pnpm dev        # desktop app with live reload
pnpm build      # installer for this platform, under apps/desktop/src-tauri/target/release/bundle
```

```sh
pnpm test       # unit tests
pnpm typecheck
pnpm lint
pnpm format
```

## Versions and releases

The desktop app's version lives in `apps/desktop/package.json`; `tauri.conf.json` reads it,
and the root `package.json`, `Cargo.toml` and `Cargo.lock` are kept equal. CI fails when
they differ.

Releases come from [release-please](https://github.com/googleapis/release-please): it keeps
a Release PR open with the next version and `apps/desktop/CHANGELOG.md`, worked out from the
Conventional Commit messages (`fix:` patch, `feat:` minor, `feat!:` major). Merging that PR
tags `vX.Y.Z` and creates a draft GitHub Release, and `.github/workflows/release.yml` builds
the macOS (universal) and Windows installers into it, with the signed updater feed
`latest.json`. Nothing reaches users until the draft is published:

1. Wait for the Release workflow's `check` job, which confirms `latest.json` covers every
   platform.
2. Install the draft's builds on a Mac and a Windows PC and run through a service.
3. Publish the draft. The download links and installed apps' updates now point at it.

If a release turns out bad, mark the previous release as latest again (or edit its
`latest.json` back) and ship a fix.

Release builds need the `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
repository secrets, which sign the updates. Losing that key means installed apps can no longer
be updated.

```sh
pnpm version:check          # are all the files on the same version?
pnpm version:bump 1.2.3     # set it by hand, outside release-please
```

## Layout

```text
apps/desktop/          Desktop app: React interface and the Tauri (Rust) core
packages/protocol/     Shared record schemas and types
packages/lyrics/       Lyrics parsing, pieces and piece identity
packages/calendar/     Workspace-timezone dates and meeting days
packages/live-state/   Live state: commands, start rules, expiry
packages/store/        SQLite schema, migrations and data access
packages/session/      One operator device's session, tying the above together
packages/renderer/     Slideshow and subtitle fitting, wrapping and drawing
packages/sync/         Content synchronization with a church server
packages/remote/       Remote control on the presenting computer: approvals, commands
apps/server/           Church server: sync, backups, church defaults, remote-control relay
apps/remote/           Phone remote-control page, served by the church server
apps/website/          worship-q.com: the download page, on GitHub Pages
```

The Rust core is limited to windows, files, fonts and the database. Everything else is
TypeScript and is unit-tested without the app running.

## Where data lives

One SQLite database and a `backgrounds` folder in the app's data directory:

- macOS: `~/Library/Application Support/com.worship-q.desktop`
- Windows: `%APPDATA%\com.worship-q.desktop`

Settings → Backup saves and restores both as a single `.worshipq` file.

## Website

`apps/website` is the download page at [worship-q.com](https://worship-q.com). Its build
reads the latest published release and writes in its installer links (`*_universal.dmg`,
`*_x64-setup.exe`), version and date. `.github/workflows/website.yml` deploys it to GitHub
Pages whenever a release is published or the site changes; run it by hand after pointing
"latest" at another release.

```sh
pnpm --filter @worship-q/website dev
```

## Church server

```sh
pnpm --filter @worship-q/remote-web build
pnpm --filter @worship-q/server dev       # http://localhost:8080, data in apps/server/data
pnpm --filter @worship-q/server cli workspace create "Test"
```

See [Church server deployment](docs/server-deployment.md) for Docker and CloudFront.

## License

[MIT](LICENSE)
