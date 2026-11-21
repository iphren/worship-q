# Worship Q — Workspace Folders Plan

**Drafted:** 21 November 2026
**Status:** Agreed direction with the project owner; not scheduled. To be built after v2.11.0, on
its own branch: it changes where data lives and has nothing to do with the public server.
**Source:** the operator's question of 21 November 2026 on why the first workspace has no
**Remove…** button; `apps/desktop/src-tauri/src/workspaces.rs` and the folders the app writes,
as of version 2.10.1.

## 1. Where it stands

Each workspace on a computer is a folder with its own database and files. The workspaces added
later live in `workspaces/<id>` under the app's data folder, with `<id>` a lowercase hex number.
The first one, with the id `default`, lives in the app's data folder itself
(`workspace_dir` in `workspaces.rs`), mixed with files that belong to the whole app.

What the app's data folder holds today:

| Path | Belongs to |
| --- | --- |
| `worship-q.db`, with its `-wal` and `-shm` journals | The first workspace |
| `backgrounds/`, `videos/`, `converted/` | The first workspace |
| `lan-cert.der`, `lan-key.der` | The first workspace (its LAN identity) |
| `backup-snapshot.db`, `restore-staging/`, `upload-backup.worshipq` | The first workspace, while backing up or restoring |
| `backups/` | **Both:** the first workspace's own backups (`cloud.rs`) and the backups saved when any workspace is removed (`remove_workspace`) |
| `workspaces.json` | The app: the list of workspaces and the open one |
| `workspaces/` | The app: every other workspace |
| `instances/` | The app: which copies are running |
| `dev-keychain.json` | The app: device secrets where the system keychain is not used |

Because of this:

- **The first workspace cannot be removed.** Removing a workspace deletes its folder, and the
  first one's folder is the app's own (`remove_workspace` refuses `default`).
- **A damaged `workspaces.json` falls back to `default`** (`read_registry`), so it must always
  exist.
- **The configured asset scope** in `tauri.conf.json` (`$APPDATA/backgrounds/**`) covers only
  the first workspace; the others are allowed at startup (`lib.rs`).

## 2. Decisions

- **New installs:** the first workspace gets a normal id and folder, `workspaces/<id>`. No
  `default` is made.
- **Existing installs keep `default` where it is.** Nothing is moved. Moving a live SQLite
  database and possibly gigabytes of videos at startup risks an interrupted move (crash, battery,
  antivirus) that leaves an operator without their songs before a service, and gains them
  nothing but a **Remove…** button.
- **Any workspace but the open one can be removed,** `default` included. The backup is saved
  first, as today. For `default`, only the files §1 lists as the first workspace's are deleted,
  never the app's data folder.
- **A damaged or missing `workspaces.json`** opens `default` if it exists, else the first folder
  under `workspaces/`, else a new empty workspace.
- **The removed-workspace backups move to their own folder,** `removed-workspaces/` beside
  `workspaces/`, so they are not mixed with the first workspace's own `backups/`. Earlier ones
  stay where they are.

## 3. Tasks

| # | Task | Where | Tests |
| --- | --- | --- | --- |
| W1 | New installs: the registry's default makes a hex id under `workspaces/`, written on first start; `default` stays a recognised id for existing installs | `workspaces.rs` (`Registry::default`, `read_registry`) | A fresh data folder opens a workspace under `workspaces/`, and `workspaces.json` names it |
| W2 | Recovery: a missing or damaged registry opens `default` if its database exists, else the first workspace folder found, else a new one | `workspaces.rs` (`read_registry`) | Each of the three cases, and a registry naming a removed id |
| W3 | Removing `default`: back it up, drop it from the registry, then delete only the first workspace's files from §1's table; refused while it is open | `workspaces.rs` (`remove_workspace`) | An old-layout folder with app-wide files beside the workspace's: after removing, only the app-wide files remain |
| W4 | Removed-workspace backups saved in `removed-workspaces/` | `workspaces.rs` | The returned path is under `removed-workspaces/` |
| W5 | Asset scope: every workspace's `backgrounds/` and `videos/` allowed at startup, not by the configured `$APPDATA/backgrounds/**` alone | `lib.rs`, `tauri.conf.json` | A new install shows a background and plays a video |
| W6 | The workspace list offers **Remove…** on every workspace but the open one | `WorkspaceSwitcher.tsx` (the `entry.id !== 'default'` check) | — |
| W7 | Walkthrough: upgrade an install that has `default` and other workspaces; remove `default` from another workspace; restart; check the remaining workspaces, their songs, backgrounds and videos | — | Recorded in `docs/acceptance/` |

## 4. Before building

- Check for any other file the app writes into a workspace folder since this was drafted
  (search the Tauri sources for `data.dir.join` and `app_data_dir`), and add it to §1's table:
  W3 deletes only what the table lists.
- The single-copy check (`instances/`) and the dev keychain stay in the app's data folder; they
  are not per workspace.
