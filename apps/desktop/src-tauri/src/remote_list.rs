//! The phone and tablet app's list of the workspaces it controls (native apps plan M2.10):
//! one small file in the app's data folder. Their grants are in the keychain, not here.

use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const FILE: &str = "remote-workspaces.json";
/// Far more than a phone controls; refuses anything that is clearly not the list.
const MAX_BYTES: usize = 1 << 20;

fn err(e: impl ToString) -> String {
    e.to_string()
}

fn path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(err)?.join(FILE))
}

fn read(path: &Path) -> Result<Option<String>, String> {
    match fs::read_to_string(path) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(err(e)),
    }
}

/// Writes beside the file and renames it into place, so a crash leaves the old list or the
/// new one, never half of one.
fn write(path: &Path, json: &str) -> Result<(), String> {
    if json.len() > MAX_BYTES {
        return Err("the workspace list is too large".into());
    }
    serde_json::from_str::<serde_json::Value>(json).map_err(err)?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(err)?;
    }
    let partial = path.with_extension("json.partial");
    fs::write(&partial, json).map_err(err)?;
    fs::rename(&partial, path).map_err(err)
}

/// The list as last written, or nothing before the first workspace is added.
#[tauri::command(async)]
pub fn remote_list_read(app: AppHandle) -> Result<Option<String>, String> {
    read(&path(&app)?)
}

#[tauri::command(async)]
pub fn remote_list_write(app: AppHandle, json: String) -> Result<(), String> {
    write(&path(&app)?, &json)
}

#[cfg(test)]
mod tests {
    use super::{read, write};

    #[test]
    fn keeps_the_list_whole() {
        let dir = std::env::temp_dir().join(format!("wq-remote-list-{}", std::process::id()));
        let path = dir.join("remote-workspaces.json");
        assert_eq!(read(&path).unwrap(), None);
        write(&path, r#"{"entries":[]}"#).unwrap();
        assert_eq!(read(&path).unwrap().as_deref(), Some(r#"{"entries":[]}"#));
        assert!(write(&path, "not json").is_err());
        assert_eq!(read(&path).unwrap().as_deref(), Some(r#"{"entries":[]}"#));
        assert!(!path.with_extension("json.partial").exists());
        let _ = std::fs::remove_dir_all(dir);
    }
}
