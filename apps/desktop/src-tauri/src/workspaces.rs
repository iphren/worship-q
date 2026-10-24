//! Several workspaces on one computer, each in its own folder with its own database,
//! backgrounds and church connection, so their contents never mix. The first one is the
//! app's data folder itself; others are in `workspaces/<id>/` inside it. The app opens
//! the active one, and switching restarts it.

use crate::db::{AppData, DB_FILE};
use crate::files::export_to;
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const REGISTRY_FILE: &str = "workspaces.json";
const WORKSPACES_DIR: &str = "workspaces";
/// The workspace kept in the app's data folder itself.
const FIRST: &str = "default";

#[derive(Serialize, Deserialize)]
struct Registry {
    active: String,
    ids: Vec<String>,
}

impl Default for Registry {
    fn default() -> Self {
        Self {
            active: FIRST.into(),
            ids: vec![FIRST.into()],
        }
    }
}

fn err(e: impl ToString) -> String {
    e.to_string()
}

fn read_registry(root: &Path) -> Registry {
    let registry = fs::read(root.join(REGISTRY_FILE))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Registry>(&bytes).ok())
        .unwrap_or_default();
    // A damaged file never leaves the app without a workspace to open.
    if registry.ids.contains(&registry.active) {
        registry
    } else {
        Registry {
            active: FIRST.into(),
            ..registry
        }
    }
}

fn write_registry(root: &Path, registry: &Registry) -> Result<(), String> {
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

/// Identifiers made here are lowercase hex; anything else is refused before it names a
/// folder.
fn known(registry: &Registry, id: &str) -> Result<(), String> {
    let valid = id == FIRST || (!id.is_empty() && id.chars().all(|c| c.is_ascii_hexdigit()));
    if valid && registry.ids.iter().any(|known| known == id) {
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
    let id = format!(
        "{:x}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(err)?
            .as_nanos()
    );
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
/// of it in the app's data folder. Returns where the backup was saved.
#[tauri::command(async)]
pub fn remove_workspace(app: AppHandle, id: String) -> Result<String, String> {
    let root = root(&app)?;
    let mut registry = read_registry(&root);
    known(&registry, &id)?;
    if id == registry.active || id == FIRST {
        return Err("this workspace cannot be removed".into());
    }
    let dir = workspace_dir(&root, &id);
    let backups = root.join("backups");
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
    registry.ids.retain(|known| *known != id);
    write_registry(&root, &registry)?;
    fs::remove_dir_all(&dir).map_err(err)?;
    Ok(backup.to_string_lossy().into_owned())
}
