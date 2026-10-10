# Worship Q

_Every screen. In harmony._

Church lyrics and presentation software. This repository currently holds phase 1: a local
desktop app that needs no church instance, account or network.

- [Requirements and architecture](docs/worship-q-requirements-and-architecture.md)
- [Phase 1 task breakdown](docs/phase-1-task-breakdown.md)
- [Volunteer guide](docs/volunteer-guide.md)

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

## Layout

```text
apps/desktop/          Desktop app: React interface and the Tauri (Rust) core
packages/protocol/     Shared record schemas and types
packages/lyrics/       Lyrics parsing, pieces and piece identity
packages/calendar/     Workspace-timezone dates and meeting days
packages/live-state/   Live state: commands, start rules, expiry
packages/store/        SQLite schema, migrations and data access
packages/session/      One operator device's session, tying the above together
packages/renderer/     Slideshow fitting, wrapping and drawing
```

The Rust core is limited to windows, files, fonts and the database. Everything else is
TypeScript and is unit-tested without the app running.

## Where data lives

One SQLite database and a `backgrounds` folder in the app's data directory:

- macOS: `~/Library/Application Support/com.worship-q.desktop`
- Windows: `%APPDATA%\com.worship-q.desktop`

Settings → Backup saves and restores both as a single `.worshipq` file.
