//! File transfers with the church instance: background files and off-site backups. Kept in
//! the native core so that large videos stream between disk and network without passing
//! through the interface.

use crate::db::AppData;
use crate::files::{backgrounds_dir, checked_name, export_to};
use std::fs::{self, File};
use std::io;
use std::time::Duration;
use tauri::State;

/// Must match `PROTOCOL_HEADER` and `PROTOCOL_VERSION` in the protocol package.
const PROTOCOL_HEADER: &str = "x-worship-q-protocol";
const PROTOCOL_VERSION: &str = "2";

fn err(e: impl ToString) -> String {
    e.to_string()
}

fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        // Videos can be large on a slow venue connection.
        .timeout(Duration::from_secs(60 * 30))
        .build()
        .map_err(err)
}

fn check(response: reqwest::blocking::Response) -> Result<reqwest::blocking::Response, String> {
    match response.status().as_u16() {
        200..=299 => Ok(response),
        401 => Err("unauthorized".into()),
        426 => Err("update-needed".into()),
        status => Err(format!("server answered {status}")),
    }
}

fn upload(url: String, token: String, path: std::path::PathBuf) -> Result<(), String> {
    let file = File::open(&path).map_err(err)?;
    let length = file.metadata().map_err(err)?.len();
    let body = reqwest::blocking::Body::sized(file, length);
    let response = client()?
        .put(url)
        .bearer_auth(token)
        .header(PROTOCOL_HEADER, PROTOCOL_VERSION)
        .header("content-type", "application/octet-stream")
        .body(body)
        .send()
        .map_err(err)?;
    check(response).map(|_| ())
}

/// Sends a stored background file to the instance.
#[tauri::command(async)]
pub async fn upload_background(
    data: State<'_, AppData>,
    server: String,
    token: String,
    file_name: String,
) -> Result<(), String> {
    let path = backgrounds_dir(&data).join(checked_name(&file_name)?);
    let url = format!("{server}/api/v1/files/{file_name}");
    tauri::async_runtime::spawn_blocking(move || upload(url, token, path))
        .await
        .map_err(err)?
}

/// Fetches a background file from the instance into the app's storage.
#[tauri::command(async)]
pub async fn download_background(
    data: State<'_, AppData>,
    server: String,
    token: String,
    file_name: String,
) -> Result<(), String> {
    let dir = backgrounds_dir(&data);
    let target = dir.join(checked_name(&file_name)?);
    let partial = dir.join(format!("{file_name}.partial"));
    let url = format!("{server}/api/v1/files/{file_name}");
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let mut response = check(
            client()?
                .get(url)
                .bearer_auth(token)
                .header(PROTOCOL_HEADER, PROTOCOL_VERSION)
                .send()
                .map_err(err)?,
        )?;
        fs::create_dir_all(&dir).map_err(err)?;
        let result = (|| -> io::Result<()> {
            let mut out = File::create(&partial)?;
            io::copy(&mut response, &mut out)?;
            out.sync_all()?;
            fs::rename(&partial, &target)
        })();
        if result.is_err() {
            let _ = fs::remove_file(&partial);
        }
        result.map_err(err)
    })
    .await
    .map_err(err)?
}

/// Sends a slide deck chosen by the operator to the instance, which converts it into images.
/// Returns the instance's description of the converted deck, as JSON.
#[tauri::command(async)]
pub async fn import_deck(server: String, token: String, source: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let path = std::path::PathBuf::from(&source);
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or("invalid file name")?
            .to_string();
        let url =
            reqwest::Url::parse_with_params(&format!("{server}/api/v1/decks"), &[("name", name)])
                .map_err(err)?;
        let file = File::open(&path).map_err(err)?;
        let length = file.metadata().map_err(err)?.len();
        let response = client()?
            .post(url)
            .bearer_auth(token)
            .header(PROTOCOL_HEADER, PROTOCOL_VERSION)
            .header("content-type", "application/octet-stream")
            .body(reqwest::blocking::Body::sized(file, length))
            .send()
            .map_err(err)?;
        let status = response.status().as_u16();
        let body = response.text().map_err(err)?;
        match status {
            200..=299 => Ok(body),
            // The instance explains why it could not convert the file.
            422 => Err(serde_json::from_str::<serde_json::Value>(&body)
                .ok()
                .and_then(|v| v["message"].as_str().map(String::from))
                .unwrap_or_else(|| "the slides could not be converted".into())),
            401 => Err("unauthorized".into()),
            426 => Err("update-needed".into()),
            501 => Err("decks-unavailable".into()),
            status => Err(format!("server answered {status}")),
        }
    })
    .await
    .map_err(err)?
}

/// Makes a backup of the whole workspace and sends it to the instance.
#[tauri::command(async)]
pub async fn upload_backup(
    data: State<'_, AppData>,
    server: String,
    token: String,
) -> Result<(), String> {
    let path = data.dir.join("upload-backup.worshipq");
    export_to(&data, &path)?;
    let url = format!("{server}/api/v1/backups");
    let sent = path.clone();
    let result = tauri::async_runtime::spawn_blocking(move || upload(url, token, sent))
        .await
        .map_err(err)?;
    let _ = fs::remove_file(&path);
    result
}

/// Saves a backup inside the app's data folder before the workspace joins a church, so
/// nothing is lost whatever the join does. Returns where it was saved.
#[tauri::command(async)]
pub fn backup_before_join(data: State<'_, AppData>) -> Result<String, String> {
    let dir = data.dir.join("backups");
    fs::create_dir_all(&dir).map_err(err)?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(err)?
        .as_secs();
    let path = dir.join(format!("before-joining-church-{stamp}.worshipq"));
    export_to(&data, &path)?;
    Ok(path.to_string_lossy().into_owned())
}
