# Workspace Folders — Acceptance record

**Date:** 21 November 2026 (branch `workspace-folders`); walkthrough pending  
**Source:** [Workspace Folders Plan](../workspace-folders-plan.md) §3.

Automated tests run in CI (`cargo test` in `apps/desktop/src-tauri`); the walkthrough (W7)
needs a real install upgraded from an earlier version and is still to do.

## Before building (§4)

The Tauri sources were searched for `data.dir.join` and `app_data_dir`. Every file the app
writes into a workspace folder is already in §1's table; nothing was added.

## Tasks

| Task | Status | Evidence |
| --- | --- | --- |
| W1 new installs | Done | `workspaces.rs` test `a_new_install_opens_a_workspace_under_workspaces`: a fresh data folder opens `workspaces/<hex>`, `workspaces.json` names it, and the next start opens the same one |
| W2 recovery | Done | `an_existing_install_without_a_list_opens_default` (an install that never wrote `workspaces.json` keeps `default`, and its other workspaces are listed again); `a_damaged_list_opens_the_first_workspace_folder_found`; `a_damaged_list_with_nothing_found_makes_a_new_workspace`; `a_list_naming_a_removed_workspace_opens_another` |
| W3 removing `default` | Done | `removing_default_deletes_only_its_own_files`: from an old-layout folder, the database and its journals, LAN identity, `backgrounds/`, `videos/` and `converted/` go; `workspaces.json`, `workspaces/`, `instances/`, `dev-keychain.json` and `backups/` remain. `removes_another_workspace_and_refuses_the_open_one` |
| W4 removed-workspace backups | Done | Both removal tests: the returned path is under `removed-workspaces/` and the file exists. Earlier backups stay in `backups/` |
| W5 asset scope | Done; by walkthrough | `tauri.conf.json` configures no scope; `lib.rs` allows the open workspace's `backgrounds/` and `videos/` at startup |
| W6 **Remove…** on every workspace but the open one | Done; by walkthrough | `WorkspaceSwitcher.tsx` |
| W7 walkthrough | Pending | Table below |

## Changes from the plan

- Recovery (W2) lists every workspace it finds, not only the one it opens: `default` first when
  its database exists, then the folders under `workspaces/` in name order. A damaged list no
  longer hides the other workspaces.
- A registry entry whose folder is gone is dropped when the list is read.
- `backups/` is never deleted when `default` is removed: §1 marks it as belonging to both, and
  it may hold earlier removed-workspace backups.

## Walkthrough (W7)

| Step | Expected | Result |
| --- | --- | --- |
| Install the previous release; add songs, a background and a video to the first workspace; add a second workspace with its own songs | — | |
| Upgrade to this build and start | The first workspace opens as before, with its songs, background and video | |
| Open the workspace list | **Remove…** on every workspace but the open one, the first included | |
| Switch to the second workspace; remove the first | A backup is reported under `removed-workspaces/` | |
| Look in the app's data folder | `worship-q.db`, `backgrounds/`, `videos/`, `converted/`, `lan-*.der` gone; `workspaces.json`, `workspaces/`, `instances/`, `backups/` remain | |
| Restart | The second workspace opens with its songs, backgrounds and videos; the list shows only it | |
| Restore the backup into a new workspace | The first workspace's songs and backgrounds are back | |
| Fresh install (empty data folder) | The first workspace is under `workspaces/<id>`; a background shows and a video plays | |
