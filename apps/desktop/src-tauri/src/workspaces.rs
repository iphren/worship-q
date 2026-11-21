//! Several workspaces on one computer, each in its own folder with its own database,
//! backgrounds and church connection, so their contents never mix. Each is in
//! `workspaces/<id>/` inside the app's data folder, except on installs from before this
//! layout, whose first workspace (`default`) is the app's data folder itself and stays
//! there. The app opens the active one, and switching restarts it.

use crate::db::{AppData, DB_FILE};
use crate::files::{export_to, BACKGROUNDS_DIR};
use crate::lan::{CERT_FILE, KEY_FILE};
use crate::media::VIDEOS_DIR;
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const REGISTRY_FILE: &str = "workspaces.json";
const WORKSPACES_DIR: &str = "workspaces";
/// Where the backup of a removed workspace is saved.
const REMOVED_DIR: &str = "removed-workspaces";
/// The first workspace of an install from before `workspaces/`, kept in the app's data
/// folder itself.
const FIRST: &str = "default";
/// The first workspace's own files and folders, beside the app's. Removing it deletes these
/// and nothing else.
const FIRST_FILES: [&str; 7] = [
    DB_FILE,
    "worship-q.db-wal",
    "worship-q.db-shm",
    CERT_FILE,
    KEY_FILE,
    "backup-snapshot.db",
    "upload-backup.worshipq",
];
const FIRST_DIRS: [&str; 4] = [BACKGROUNDS_DIR, VIDEOS_DIR, "converted", "restore-staging"];

#[derive(Serialize, Deserialize)]
struct Registry {
    active: String,
    ids: Vec<String>,
}

fn err(e: impl ToString) -> String {
    e.to_string()
}

/// Identifiers made here are lowercase hex; anything else is refused before it names a
/// folder.
fn valid_id(id: &str) -> bool {
    id == FIRST || (!id.is_empty() && id.chars().all(|c| c.is_ascii_hexdigit()))
}

fn new_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    format!("{nanos:x}")
}

/// Whether the workspace is still on this computer.
fn present(root: &Path, id: &str) -> bool {
    if id == FIRST {
        root.join(DB_FILE).is_file()
    } else {
        workspace_dir(root, id).is_dir()
    }
}

fn read_registry(root: &Path) -> Registry {
    let saved = fs::read(root.join(REGISTRY_FILE))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Registry>(&bytes).ok());
    if let Some(mut registry) = saved {
        registry.ids.retain(|id| valid_id(id) && present(root, id));
        if let Some(first) = registry.ids.first().cloned() {
            if !registry.ids.contains(&registry.active) {
                registry.active = first;
            }
            return registry;
        }
    }
    recover(root)
}

/// A missing or damaged list never leaves the app without a workspace to open: it is made
/// again from the folders found, or a new workspace is made when there are none.
fn recover(root: &Path) -> Registry {
    let mut ids = Vec::new();
    if present(root, FIRST) {
        ids.push(FIRST.to_string());
    }
    let mut found: Vec<String> = fs::read_dir(root.join(WORKSPACES_DIR))
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|id| id != FIRST && valid_id(id))
        .collect();
    found.sort();
    ids.extend(found);
    if ids.is_empty() {
        let id = new_id();
        // Should the folder not be made, opening the workspace reports why.
        let _ = fs::create_dir_all(workspace_dir(root, &id));
        ids.push(id);
    }
    let registry = Registry {
        active: ids[0].clone(),
        ids,
    };
    let _ = write_registry(root, &registry);
    registry
}

fn write_registry(root: &Path, registry: &Registry) -> Result<(), String> {
    fs::create_dir_all(root).map_err(err)?;
    let partial = root.join(format!("{REGISTRY_FILE}.partial"));
    fs::write(&partial, serde_json::to_vec_pretty(registry).map_err(err)?).map_err(err)?;
    fs::rename(&partial, root.join(REGISTRY_FILE)).map_err(err)
}

fn workspace_dir(root: &Path, id: &str) -> PathBuf {
    if id == FIRST {
        root.to_path_buf()
    } else {
        root.join(WORKSPACES_DIR).join(id)
    }
}

/// The folder of the workspace the app opens.
pub fn active_dir(root: &Path) -> PathBuf {
    workspace_dir(root, &read_registry(root).active)
}

fn root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(err)
}

fn known(registry: &Registry, id: &str) -> Result<(), String> {
    if valid_id(id) && registry.ids.iter().any(|known| known == id) {
        Ok(())
    } else {
        Err(format!("no workspace {id}"))
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEntry {
    id: String,
    active: bool,
    /// The workspace's name; null before it was first opened.
    name: Option<String>,
    /// The church instance it is connected to, if any.
    server: Option<String>,
}

/// Reads a workspace's name and church connection without opening it for writing.
fn describe(dir: &Path) -> (Option<String>, Option<String>) {
    let Ok(conn) = Connection::open_with_flags(dir.join(DB_FILE), OpenFlags::SQLITE_OPEN_READ_ONLY)
    else {
        return (None, None);
    };
    // Values in `sync_state` are JSON.
    let state = |key: &str| -> Option<String> {
        let raw: String = conn
            .query_row(
                "SELECT value FROM sync_state WHERE key = ?1",
                [key],
                |row| row.get(0),
            )
            .optional()
            .ok()
            .flatten()?;
        serde_json::from_str::<Option<String>>(&raw).ok().flatten()
    };
    let own_name = conn
        .query_row("SELECT name FROM workspace LIMIT 1", [], |row| {
            row.get::<_, String>(0)
        })
        .optional()
        .ok()
        .flatten();
    // Once joined, the church's name for the workspace is the one people know it by.
    let joined = state("joinedAt").is_some();
    let name = joined
        .then(|| state("workspaceName"))
        .flatten()
        .filter(|n| !n.is_empty())
        .or(own_name);
    (name, joined.then(|| state("server")).flatten())
}

#[tauri::command(async)]
pub fn list_workspaces(app: AppHandle) -> Result<Vec<WorkspaceEntry>, String> {
    let root = root(&app)?;
    let registry = read_registry(&root);
    Ok(registry
        .ids
        .iter()
        .map(|id| {
            let (name, server) = describe(&workspace_dir(&root, id));
            WorkspaceEntry {
                id: id.clone(),
                active: *id == registry.active,
                name,
                server,
            }
        })
        .collect())
}

/// Makes a new, empty workspace and reopens the app in it.
#[tauri::command]
pub fn add_workspace(app: AppHandle) -> Result<(), String> {
    let root = root(&app)?;
    let mut registry = read_registry(&root);
    let id = new_id();
    fs::create_dir_all(workspace_dir(&root, &id)).map_err(err)?;
    registry.ids.push(id.clone());
    registry.active = id;
    write_registry(&root, &registry)?;
    app.restart();
}

/// Reopens the app in another workspace on this computer.
#[tauri::command]
pub fn switch_workspace(app: AppHandle, id: String) -> Result<(), String> {
    let root = root(&app)?;
    let mut registry = read_registry(&root);
    known(&registry, &id)?;
    registry.active = id;
    write_registry(&root, &registry)?;
    app.restart();
}

/// Removes a workspace other than the open one from this computer, after saving a backup
/// of it in `removed-workspaces/` in the app's data folder. Returns where the backup was
/// saved.
#[tauri::command(async)]
pub fn remove_workspace(app: AppHandle, id: String) -> Result<String, String> {
    let backup = remove(&root(&app)?, &id)?;
    Ok(backup.to_string_lossy().into_owned())
}

fn remove(root: &Path, id: &str) -> Result<PathBuf, String> {
    let mut registry = read_registry(root);
    known(&registry, id)?;
    if id == registry.active {
        return Err("the open workspace cannot be removed".into());
    }
    let dir = workspace_dir(root, id);
    let backups = root.join(REMOVED_DIR);
    fs::create_dir_all(&backups).map_err(err)?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(err)?
        .as_secs();
    let backup = backups.join(format!("removed-workspace-{stamp}.worshipq"));
    if dir.join(DB_FILE).exists() {
        let data = AppData::open(dir.clone()).map_err(err)?;
        export_to(&data, &backup)?;
    }
    registry.ids.retain(|known| known != id);
    write_registry(root, &registry)?;
    if id == FIRST {
        // Its folder is the app's own: only its files go.
        for file in FIRST_FILES {
            ignore_missing(fs::remove_file(dir.join(file)))?;
        }
        for folder in FIRST_DIRS {
            ignore_missing(fs::remove_dir_all(dir.join(folder)))?;
        }
    } else {
        fs::remove_dir_all(&dir).map_err(err)?;
    }
    Ok(backup)
}

fn ignore_missing(result: io::Result<()>) -> Result<(), String> {
    match result {
        Err(e) if e.kind() != io::ErrorKind::NotFound => Err(err(e)),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "worship-q-workspaces-{name}-{}-{}",
            std::process::id(),
            new_id()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn make_db(dir: &Path) {
        fs::create_dir_all(dir).unwrap();
        let data = AppData::open(dir.to_path_buf()).unwrap();
        data.conn
            .lock()
            .unwrap()
            .execute_batch(
                "CREATE TABLE workspace (name TEXT); INSERT INTO workspace VALUES ('A');",
            )
            .unwrap();
    }

    fn saved(root: &Path) -> Registry {
        serde_json::from_slice(&fs::read(root.join(REGISTRY_FILE)).unwrap()).unwrap()
    }

    #[test]
    fn a_new_install_opens_a_workspace_under_workspaces() {
        let root = scratch("fresh");
        let dir = active_dir(&root);
        assert_eq!(dir.parent().unwrap(), root.join(WORKSPACES_DIR));
        assert!(dir.is_dir());
        let id = dir.file_name().unwrap().to_str().unwrap().to_string();
        assert!(id != FIRST && valid_id(&id));
        let registry = saved(&root);
        assert_eq!(registry.active, id);
        assert_eq!(registry.ids, vec![id]);
        assert_eq!(active_dir(&root), dir);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn an_existing_install_without_a_list_opens_default() {
        let root = scratch("old");
        make_db(&root);
        fs::create_dir_all(root.join(WORKSPACES_DIR).join("abc")).unwrap();
        assert_eq!(active_dir(&root), root);
        assert_eq!(saved(&root).ids, vec![FIRST.to_string(), "abc".into()]);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_damaged_list_opens_the_first_workspace_folder_found() {
        let root = scratch("damaged");
        fs::write(root.join(REGISTRY_FILE), b"{not json").unwrap();
        fs::create_dir_all(root.join(WORKSPACES_DIR).join("b2")).unwrap();
        fs::create_dir_all(root.join(WORKSPACES_DIR).join("a1")).unwrap();
        fs::create_dir_all(root.join(WORKSPACES_DIR).join("not-hex")).unwrap();
        assert_eq!(active_dir(&root), root.join(WORKSPACES_DIR).join("a1"));
        assert_eq!(saved(&root).ids, vec!["a1".to_string(), "b2".into()]);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_damaged_list_with_nothing_found_makes_a_new_workspace() {
        let root = scratch("empty");
        fs::write(root.join(REGISTRY_FILE), b"").unwrap();
        let dir = active_dir(&root);
        assert_eq!(dir.parent().unwrap(), root.join(WORKSPACES_DIR));
        assert!(dir.is_dir());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_list_naming_a_removed_workspace_opens_another() {
        let root = scratch("gone");
        fs::create_dir_all(root.join(WORKSPACES_DIR).join("c3")).unwrap();
        write_registry(
            &root,
            &Registry {
                active: "dd".into(),
                ids: vec!["dd".into(), "c3".into()],
            },
        )
        .unwrap();
        let registry = read_registry(&root);
        assert_eq!(registry.active, "c3");
        assert_eq!(registry.ids, vec!["c3".to_string()]);
        // Every workspace in the list gone: made again from the folders.
        fs::remove_dir_all(root.join(WORKSPACES_DIR).join("c3")).unwrap();
        make_db(&root);
        assert_eq!(read_registry(&root).active, FIRST);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn removing_default_deletes_only_its_own_files() {
        let root = scratch("remove-default");
        make_db(&root);
        for file in ["worship-q.db-wal", CERT_FILE, KEY_FILE, "dev-keychain.json"] {
            fs::write(root.join(file), b"x").unwrap();
        }
        for folder in [
            BACKGROUNDS_DIR,
            VIDEOS_DIR,
            "converted",
            "instances",
            "backups",
        ] {
            fs::create_dir_all(root.join(folder)).unwrap();
            fs::write(root.join(folder).join("f"), b"x").unwrap();
        }
        let other = root.join(WORKSPACES_DIR).join("e5");
        make_db(&other);
        write_registry(
            &root,
            &Registry {
                active: "e5".into(),
                ids: vec![FIRST.into(), "e5".into()],
            },
        )
        .unwrap();

        let backup = remove(&root, FIRST).unwrap();
        assert_eq!(backup.parent().unwrap(), root.join(REMOVED_DIR));
        assert!(backup.is_file());

        let mut left: Vec<String> = fs::read_dir(&root)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().into_string().unwrap())
            .collect();
        left.sort();
        assert_eq!(
            left,
            [
                "backups",
                "dev-keychain.json",
                "instances",
                REMOVED_DIR,
                WORKSPACES_DIR,
                REGISTRY_FILE
            ]
        );
        assert!(other.join(DB_FILE).is_file());
        let registry = saved(&root);
        assert_eq!(registry.ids, vec!["e5".to_string()]);
        assert_eq!(active_dir(&root), other);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn removes_another_workspace_and_refuses_the_open_one() {
        let root = scratch("remove");
        make_db(&root);
        let other = root.join(WORKSPACES_DIR).join("f6");
        make_db(&other);
        write_registry(
            &root,
            &Registry {
                active: FIRST.into(),
                ids: vec![FIRST.into(), "f6".into()],
            },
        )
        .unwrap();
        assert!(remove(&root, FIRST).is_err());
        assert!(remove(&root, "../x").is_err());
        let backup = remove(&root, "f6").unwrap();
        assert!(backup.starts_with(root.join(REMOVED_DIR)));
        assert!(backup.is_file());
        assert!(!other.exists());
        assert!(root.join(DB_FILE).is_file());
        assert_eq!(saved(&root).ids, vec![FIRST.to_string()]);
        let _ = fs::remove_dir_all(&root);
    }
}
