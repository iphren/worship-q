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

/// The bounds and quality of a slide's small copy, as the server makes it.
const THUMBNAIL_WIDTH: u32 = 320;
const THUMBNAIL_HEIGHT: u32 = 240;
const THUMBNAIL_QUALITY: u8 = 75;

/// The slide image a thumbnail is made from: `deck-<uuid>-<page>-t.jpg` from
/// `deck-<uuid>-<page>.jpg`. Nothing for any other name.
fn thumbnail_source(thumbnail: &str) -> Option<String> {
    let middle = thumbnail.strip_prefix("deck-")?.strip_suffix("-t.jpg")?;
    let (id, page) = middle.split_at_checked(36)?;
    let page = page.strip_prefix('-')?;
    let id_ok = id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-');
    let page_ok = page.len() >= 3 && page.bytes().all(|b| b.is_ascii_digit());
    (id_ok && page_ok).then(|| format!("deck-{middle}.jpg"))
}

/// Makes `thumbnail` from its slide image in `dir`: fitted within 320 × 240, never enlarged,
/// written beside it and renamed into place. False when the slide image is not there.
fn make_thumbnail_in(dir: &Path, thumbnail: &str) -> Result<bool, String> {
    let Some(source) = thumbnail_source(thumbnail) else {
        return Err(format!("not a thumbnail name: {thumbnail}"));
    };
    let source = dir.join(source);
    if !source.is_file() {
        return Ok(false);
    }
    let image = image::open(&source).map_err(err)?;
    let small = if image.width() > THUMBNAIL_WIDTH || image.height() > THUMBNAIL_HEIGHT {
        image.resize(
            THUMBNAIL_WIDTH,
            THUMBNAIL_HEIGHT,
            image::imageops::FilterType::Triangle,
        )
    } else {
        image
    };
    let partial = dir.join(format!("{thumbnail}.partial"));
    let mut out = io::BufWriter::new(File::create(&partial).map_err(err)?);
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, THUMBNAIL_QUALITY)
        .encode_image(&small.to_rgb8())
        .map_err(err)?;
    out.flush().map_err(err)?;
    drop(out);
    fs::rename(&partial, dir.join(thumbnail)).map_err(err)?;
    Ok(true)
}

/// Makes a slide's small copy for phones from its image, when this computer has the image
/// but not the copy (native apps M2.16): decks downloaded before M2.8 came without them.
/// True when the copy is there afterwards.
#[tauri::command(async)]
pub fn make_thumbnail(data: State<'_, AppData>, file_name: String) -> Result<bool, String> {
    let dir = backgrounds_dir(&data);
    if dir.join(checked_name(&file_name)?).is_file() {
        return Ok(true);
    }
    make_thumbnail_in(&dir, &file_name)
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

#[cfg(test)]
mod tests {
    use super::{make_thumbnail_in, thumbnail_source};

    const ID: &str = "0f8fad5b-d9cb-469f-a165-70867728950e";

    #[test]
    fn finds_a_thumbnails_slide_image() {
        assert_eq!(
            thumbnail_source(&format!("deck-{ID}-001-t.jpg")),
            Some(format!("deck-{ID}-001.jpg"))
        );
        assert_eq!(
            thumbnail_source(&format!("deck-{ID}-1234-t.jpg")),
            Some(format!("deck-{ID}-1234.jpg"))
        );
        for name in [
            format!("deck-{ID}-001.jpg"),
            format!("deck-{ID}-01-t.jpg"),
            format!("deck-{ID}-0a1-t.jpg"),
            format!("deck-../{ID}-001-t.jpg"),
            "deck-x-001-t.jpg".to_string(),
            "background.jpg".to_string(),
        ] {
            assert_eq!(thumbnail_source(&name), None, "{name}");
        }
    }

    #[test]
    fn makes_a_small_copy_as_the_server_does() {
        let dir = std::env::temp_dir().join(format!("wq-thumbnail-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let thumbnail = format!("deck-{ID}-001-t.jpg");
        // No slide image yet: nothing is made.
        assert!(!make_thumbnail_in(&dir, &thumbnail).unwrap());

        image::RgbImage::from_pixel(1920, 1080, image::Rgb([200, 30, 30]))
            .save(dir.join(format!("deck-{ID}-001.jpg")))
            .unwrap();
        assert!(make_thumbnail_in(&dir, &thumbnail).unwrap());
        let small = image::open(dir.join(&thumbnail)).unwrap();
        assert_eq!((small.width(), small.height()), (320, 180));
        assert!(std::fs::metadata(dir.join(&thumbnail)).unwrap().len() < 256 * 1024);
        assert!(!dir.join(format!("{thumbnail}.partial")).exists());

        // A slide smaller than the bounds is not enlarged.
        image::RgbImage::from_pixel(200, 100, image::Rgb([0, 0, 0]))
            .save(dir.join(format!("deck-{ID}-002.jpg")))
            .unwrap();
        assert!(make_thumbnail_in(&dir, &format!("deck-{ID}-002-t.jpg")).unwrap());
        let kept = image::open(dir.join(format!("deck-{ID}-002-t.jpg"))).unwrap();
        assert_eq!((kept.width(), kept.height()), (200, 100));

        assert!(make_thumbnail_in(&dir, "background.jpg").is_err());
        let _ = std::fs::remove_dir_all(dir);
    }
}
