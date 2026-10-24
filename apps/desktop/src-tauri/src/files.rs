//! Files owned by the app: imported backgrounds and whole-workspace backups.

use crate::db::{open_connection, AppData, DB_FILE};
use rusqlite::Connection;
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use tauri::State;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

pub const BACKGROUNDS_DIR: &str = "backgrounds";
const MANIFEST_FILE: &str = "manifest.json";
/// Decision D9: JPEG and PNG images, MP4 video.
const ALLOWED_EXTENSIONS: [&str; 4] = ["jpg", "jpeg", "png", "mp4"];

fn err(e: impl ToString) -> String {
    e.to_string()
}

/// A background file name is a bare name with an allowed extension, never a path.
pub fn checked_name(file_name: &str) -> Result<&str, String> {
    let plain = Path::new(file_name)
        .file_name()
        .and_then(|n| n.to_str())
        .map(|n| n == file_name)
        .unwrap_or(false);
    let extension = Path::new(file_name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    if plain && !file_name.starts_with('.') && ALLOWED_EXTENSIONS.contains(&extension.as_str()) {
        Ok(file_name)
    } else {
        Err(format!("invalid background file name: {file_name}"))
    }
}

pub fn backgrounds_dir(data: &AppData) -> PathBuf {
    data.dir.join(BACKGROUNDS_DIR)
}

/// Copies a chosen image or video into the app's own storage.
#[tauri::command(async)]
pub fn import_background(
    data: State<'_, AppData>,
    source: String,
    file_name: String,
) -> Result<(), String> {
    let target = backgrounds_dir(&data).join(checked_name(&file_name)?);
    fs::create_dir_all(backgrounds_dir(&data)).map_err(err)?;
    fs::copy(&source, &target).map_err(err)?;
    Ok(())
}

#[tauri::command(async)]
pub fn remove_background_file(data: State<'_, AppData>, file_name: String) -> Result<(), String> {
    let target = backgrounds_dir(&data).join(checked_name(&file_name)?);
    match fs::remove_file(target) {
        Err(e) if e.kind() != io::ErrorKind::NotFound => Err(err(e)),
        _ => Ok(()),
    }
}

/// Absolute path of a stored background, or nothing when the file is missing.
#[tauri::command]
pub fn background_path(data: State<'_, AppData>, file_name: String) -> Option<String> {
    let target = backgrounds_dir(&data).join(checked_name(&file_name).ok()?);
    target
        .is_file()
        .then(|| target.to_string_lossy().into_owned())
}

/// Writes the whole local workspace, database and backgrounds, to one backup file.
#[tauri::command(async)]
pub fn export_backup(data: State<'_, AppData>, destination: String) -> Result<(), String> {
    export_to(&data, Path::new(&destination))
}

pub fn export_to(data: &AppData, destination: &Path) -> Result<(), String> {
    let snapshot = data.dir.join("backup-snapshot.db");
    let _ = fs::remove_file(&snapshot);
    {
        let conn = data.conn.lock().map_err(err)?;
        conn.execute("VACUUM INTO ?1", [snapshot.to_string_lossy().as_ref()])
            .map_err(err)?;
    }
    let result = write_backup(data, &snapshot, destination);
    let _ = fs::remove_file(&snapshot);
    result
}

fn write_backup(data: &AppData, snapshot: &Path, destination: &Path) -> Result<(), String> {
    let mut zip = ZipWriter::new(File::create(destination).map_err(err)?);
    let compressed = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    // Images and video are already compressed.
    let stored = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Stored)
        .large_file(true);

    zip.start_file(MANIFEST_FILE, compressed).map_err(err)?;
    zip.write_all(br#"{"app":"worship-q","format":1}"#)
        .map_err(err)?;

    zip.start_file(DB_FILE, compressed).map_err(err)?;
    io::copy(&mut File::open(snapshot).map_err(err)?, &mut zip).map_err(err)?;

    if let Ok(entries) = fs::read_dir(backgrounds_dir(data)) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if checked_name(&name).is_err() || !entry.path().is_file() {
                continue;
            }
            zip.start_file(format!("{BACKGROUNDS_DIR}/{name}"), stored)
                .map_err(err)?;
            io::copy(&mut File::open(entry.path()).map_err(err)?, &mut zip).map_err(err)?;
        }
    }
    zip.finish().map_err(err)?;
    Ok(())
}

/// Replaces the local workspace with the contents of a backup file. Nothing is replaced
/// unless the backup is readable and not from a newer version of the app.
#[tauri::command(async)]
pub fn restore_backup(
    data: State<'_, AppData>,
    source: String,
    max_schema_version: i64,
) -> Result<(), String> {
    let staging = data.dir.join("restore-staging");
    let _ = fs::remove_dir_all(&staging);
    fs::create_dir_all(staging.join(BACKGROUNDS_DIR)).map_err(err)?;
    let result = extract_backup(Path::new(&source), &staging)
        .and_then(|_| check_backup(&staging.join(DB_FILE), max_schema_version))
        .and_then(|_| swap_in(&data, &staging));
    let _ = fs::remove_dir_all(&staging);
    result
}

fn extract_backup(source: &Path, staging: &Path) -> Result<(), String> {
    let mut archive = ZipArchive::new(File::open(source).map_err(err)?)
        .map_err(|_| "not-a-backup".to_string())?;
    let mut found_db = false;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(err)?;
        let name = entry.name().to_string();
        // Only known entries are written, each to a fixed place.
        let target = if name == DB_FILE {
            found_db = true;
            staging.join(DB_FILE)
        } else if let Some(file) = name.strip_prefix(&format!("{BACKGROUNDS_DIR}/")) {
            match checked_name(file) {
                Ok(file) => staging.join(BACKGROUNDS_DIR).join(file),
                Err(_) => continue,
            }
        } else {
            continue;
        };
        let mut out = File::create(target).map_err(err)?;
        let mut buffer = [0u8; 64 * 1024];
        loop {
            let read = entry.read(&mut buffer).map_err(err)?;
            if read == 0 {
                break;
            }
            out.write_all(&buffer[..read]).map_err(err)?;
        }
    }
    if found_db {
        Ok(())
    } else {
        Err("not-a-backup".to_string())
    }
}

fn check_backup(db: &Path, max_schema_version: i64) -> Result<(), String> {
    let conn = Connection::open(db).map_err(|_| "not-a-backup".to_string())?;
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|_| "not-a-backup".to_string())?;
    let workspaces: i64 = conn
        .query_row("SELECT count(*) FROM workspace", [], |row| row.get(0))
        .map_err(|_| "not-a-backup".to_string())?;
    if version > max_schema_version {
        return Err("backup-too-new".to_string());
    }
    if version < 1 || workspaces < 1 {
        return Err("not-a-backup".to_string());
    }
    Ok(())
}

fn swap_in(data: &AppData, staging: &Path) -> Result<(), String> {
    let mut conn = data.conn.lock().map_err(err)?;
    // Release the database file before replacing it.
    *conn = Connection::open_in_memory().map_err(err)?;
    let replaced = (|| -> io::Result<()> {
        let backgrounds = backgrounds_dir(data);
        if backgrounds.exists() {
            fs::remove_dir_all(&backgrounds)?;
        }
        fs::rename(staging.join(BACKGROUNDS_DIR), &backgrounds)?;
        let _ = fs::remove_file(data.db_path());
        fs::rename(staging.join(DB_FILE), data.db_path())
    })();
    *conn = open_connection(&data.db_path()).map_err(err)?;
    replaced.map_err(err)
}
