//! Media transfers with the church instance (media uploads plan): uploads and downloads that
//! report their progress and can be cancelled, this computer's copies of videos, and turning
//! iPhone photos into JPEG on a Mac. Kept in the native core so that large files stream
//! between disk and network without passing through the interface.

use crate::db::AppData;
use serde::Serialize;
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};

/// Must match `PROTOCOL_HEADER` in the protocol package; see `cloud.rs` for the version.
const PROTOCOL_HEADER: &str = "x-worship-q-protocol";
const PROTOCOL_VERSION: &str = "2";
/// The event each transfer reports its progress with.
pub const PROGRESS_EVENT: &str = "media-progress";
/// This computer's copies of videos, beside the backgrounds (U8, U14).
pub const VIDEOS_DIR: &str = "videos";
/// At most ten progress events a second, plus the last one.
const PROGRESS_EVERY: Duration = Duration::from_millis(100);

fn err(e: impl ToString) -> String {
    e.to_string()
}

#[derive(Clone, Serialize, Debug, PartialEq)]
pub struct Progress {
    pub id: String,
    pub sent: u64,
    pub total: u64,
}

/// The transfers under way, by the identifier the interface gave them, so they can be
/// cancelled.
#[derive(Default)]
pub struct Transfers {
    running: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl Transfers {
    fn start(&self, id: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        self.running
            .lock()
            .unwrap()
            .insert(id.to_string(), flag.clone());
        flag
    }

    fn finish(&self, id: &str) {
        self.running.lock().unwrap().remove(id);
    }

    fn cancel(&self, id: &str) -> bool {
        match self.running.lock().unwrap().get(id) {
            Some(flag) => {
                flag.store(true, Ordering::SeqCst);
                true
            }
            None => false,
        }
    }
}

/// Reads through to `inner`, counting what passed and reporting it at most ten times a
/// second and once at the end. Fails once `cancelled` is set, which ends the request.
struct Counting<R, F: FnMut(u64, u64)> {
    inner: R,
    done: u64,
    total: u64,
    last: Option<Instant>,
    reported: Option<u64>,
    cancelled: Arc<AtomicBool>,
    report: F,
}

impl<R: Read, F: FnMut(u64, u64)> Counting<R, F> {
    fn new(inner: R, total: u64, cancelled: Arc<AtomicBool>, report: F) -> Self {
        Self {
            inner,
            done: 0,
            total,
            last: None,
            reported: None,
            cancelled,
            report,
        }
    }
}

impl<R: Read, F: FnMut(u64, u64)> Read for Counting<R, F> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if self.cancelled.load(Ordering::SeqCst) {
            return Err(io::Error::other("cancelled"));
        }
        let n = self.inner.read(buf)?;
        self.done += n as u64;
        let finished = n == 0 || (self.total > 0 && self.done >= self.total);
        let due = self.last.is_none_or(|at| at.elapsed() >= PROGRESS_EVERY);
        // The end is reported once, however often the reader is called after it.
        if (due || finished) && self.reported != Some(self.done) {
            self.last = Some(Instant::now());
            self.reported = Some(self.done);
            (self.report)(self.done, self.total.max(self.done));
        }
        Ok(n)
    }
}

fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        // A 200 MB video on a slow venue connection.
        .timeout(Duration::from_secs(60 * 60))
        .build()
        .map_err(err)
}

/// Why an upload failed, as a short code the interface explains: `too-large:<bytes>` when
/// the instance refused the size, `proxy-too-large` when a proxy in front of it did,
/// `refused:<message>` with the instance's reason, `connection-closed` when the connection
/// broke while sending, and `cancelled`, `unauthorized`, `update-needed`,
/// `decks-unavailable`, `not-found` or `server answered <status>` otherwise.
fn answer_error(status: u16, body: &str) -> String {
    let json = serde_json::from_str::<serde_json::Value>(body).ok();
    let field = |name: &str| {
        json.as_ref()
            .and_then(|v| v[name].as_str().map(String::from))
    };
    match status {
        413 => match json.as_ref().and_then(|v| v["limitBytes"].as_u64()) {
            Some(limit) => format!("too-large:{limit}"),
            None => "proxy-too-large".into(),
        },
        401 => "unauthorized".into(),
        426 => "update-needed".into(),
        501 => "decks-unavailable".into(),
        404 => field("error").unwrap_or_else(|| "not-found".into()),
        400 | 422 => match field("message") {
            Some(message) => format!("refused:{message}"),
            None => field("error").unwrap_or_else(|| format!("server answered {status}")),
        },
        status => format!("server answered {status}"),
    }
}

fn send_error(error: reqwest::Error, cancelled: &AtomicBool) -> String {
    if cancelled.load(Ordering::SeqCst) {
        "cancelled".into()
    } else if error.is_connect() || error.is_timeout() {
        format!("connection: {error}")
    } else {
        // nginx closes the connection on a body over its limit after 30 s (M0.5).
        "connection-closed".into()
    }
}

/// Streams `source` to `url` with POST, reporting progress; returns the answer's body.
pub fn upload_file(
    url: &str,
    token: &str,
    source: &Path,
    cancelled: Arc<AtomicBool>,
    report: impl FnMut(u64, u64) + Send + 'static,
) -> Result<String, String> {
    let file = File::open(source).map_err(|e| format!("file: {e}"))?;
    let total = file.metadata().map_err(err)?.len();
    let reader = Counting::new(file, total, cancelled.clone(), report);
    let response = client()?
        .post(url)
        .bearer_auth(token)
        .header(PROTOCOL_HEADER, PROTOCOL_VERSION)
        .header("content-type", "application/octet-stream")
        .body(reqwest::blocking::Body::sized(reader, total))
        .send()
        .map_err(|e| send_error(e, &cancelled))?;
    let status = response.status().as_u16();
    let body = response.text().map_err(err)?;
    if (200..300).contains(&status) {
        Ok(body)
    } else {
        Err(answer_error(status, &body))
    }
}

/// Fetches `url` into `destination` through a `.partial` file, which takes the final name
/// only once complete; nothing is left behind when it fails or is cancelled.
pub fn download_file(
    url: &str,
    token: &str,
    destination: &Path,
    cancelled: Arc<AtomicBool>,
    report: impl FnMut(u64, u64),
) -> Result<(), String> {
    let response = client()?
        .get(url)
        .bearer_auth(token)
        .header(PROTOCOL_HEADER, PROTOCOL_VERSION)
        .send()
        .map_err(|e| send_error(e, &cancelled))?;
    let status = response.status().as_u16();
    if !(200..300).contains(&status) {
        let body = response.text().unwrap_or_default();
        return Err(answer_error(status, &body));
    }
    let total = response.content_length().unwrap_or(0);
    let mut partial = destination.as_os_str().to_owned();
    partial.push(".partial");
    let partial = PathBuf::from(partial);
    if let Some(dir) = destination.parent() {
        fs::create_dir_all(dir).map_err(err)?;
    }
    let result = (|| -> io::Result<()> {
        let mut reader = Counting::new(response, total, cancelled.clone(), report);
        let mut out = File::create(&partial)?;
        io::copy(&mut reader, &mut out)?;
        out.flush()?;
        out.sync_all()?;
        if total > 0 && reader.done != total {
            return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "incomplete"));
        }
        fs::rename(&partial, destination)
    })();
    if let Err(error) = result {
        let _ = fs::remove_file(&partial);
        return Err(if cancelled.load(Ordering::SeqCst) {
            "cancelled".into()
        } else if error.raw_os_error() == Some(28) || error.raw_os_error() == Some(112) {
            // ENOSPC on macOS, ERROR_DISK_FULL on Windows.
            "disk-full".into()
        } else {
            err(error)
        });
    }
    Ok(())
}

fn emitter(app: &AppHandle, id: &str) -> impl FnMut(u64, u64) + Send + 'static {
    let app = app.clone();
    let id = id.to_string();
    move |sent, total| {
        let _ = app.emit(
            PROGRESS_EVENT,
            Progress {
                id: id.clone(),
                sent,
                total,
            },
        );
    }
}

/// The size of a file chosen by the operator, for checking it against the limits before
/// anything is sent (U2). Refuses folders.
#[tauri::command(async)]
pub fn file_size(path: String) -> Result<u64, String> {
    let meta = fs::metadata(&path).map_err(|e| format!("file: {e}"))?;
    if !meta.is_file() {
        return Err("not-a-file".into());
    }
    Ok(meta.len())
}

/// Sends a file to one of the instance's upload routes (`images`, `videos`, `decks`),
/// reporting `media-progress` events under `upload_id`. Returns the instance's answer.
#[tauri::command(async)]
#[allow(clippy::too_many_arguments)]
pub async fn upload_media(
    app: AppHandle,
    transfers: State<'_, Transfers>,
    server: String,
    token: String,
    upload_id: String,
    route: String,
    source: String,
    name: String,
) -> Result<String, String> {
    if !["images", "videos", "decks"].contains(&route.as_str()) {
        return Err(format!("unknown route {route}"));
    }
    let url =
        reqwest::Url::parse_with_params(&format!("{server}/api/v1/{route}"), &[("name", name)])
            .map_err(err)?;
    let cancelled = transfers.start(&upload_id);
    let report = emitter(&app, &upload_id);
    let result = tauri::async_runtime::spawn_blocking(move || {
        upload_file(url.as_str(), &token, Path::new(&source), cancelled, report)
    })
    .await
    .map_err(err)
    .and_then(|r| r);
    transfers.finish(&upload_id);
    result
}

/// Fetches `path` of the instance (such as `/api/v1/decks/<id>/original`) into
/// `destination`, reporting `media-progress` events under `transfer_id`.
#[tauri::command(async)]
pub async fn download_media(
    app: AppHandle,
    transfers: State<'_, Transfers>,
    server: String,
    token: String,
    transfer_id: String,
    path: String,
    destination: String,
) -> Result<(), String> {
    if !path.starts_with("/api/v1/") {
        return Err("invalid path".into());
    }
    let url = format!("{server}{path}");
    let cancelled = transfers.start(&transfer_id);
    let report = emitter(&app, &transfer_id);
    let result = tauri::async_runtime::spawn_blocking(move || {
        download_file(&url, &token, Path::new(&destination), cancelled, report)
    })
    .await
    .map_err(err)
    .and_then(|r| r);
    transfers.finish(&transfer_id);
    result
}

/// Stops an upload or download; false when it is not running.
#[tauri::command]
pub fn cancel_transfer(transfers: State<'_, Transfers>, id: String) -> bool {
    transfers.cancel(&id)
}

pub fn videos_dir(data: &AppData) -> PathBuf {
    data.dir.join(VIDEOS_DIR)
}

/// A stored video's name, as the instance makes it: `video-<uuid>.<ext>`, never a path.
pub fn checked_video(file: &str) -> Result<&str, String> {
    let (stem, extension) = file.rsplit_once('.').ok_or("invalid video name")?;
    let id = stem.strip_prefix("video-").ok_or("invalid video name")?;
    let ok = id.len() == 36
        && id.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
        && ["mp4", "m4v", "mov", "webm"].contains(&extension);
    if ok {
        Ok(file)
    } else {
        Err(format!("invalid video name: {file}"))
    }
}

/// Copies an uploaded video into this computer's storage, so it plays here without
/// downloading it back (U14).
#[tauri::command(async)]
pub fn store_video(data: State<'_, AppData>, source: String, file: String) -> Result<(), String> {
    let dir = videos_dir(&data);
    fs::create_dir_all(&dir).map_err(err)?;
    let target = dir.join(checked_video(&file)?);
    let partial = dir.join(format!("{file}.partial"));
    let result = fs::copy(&source, &partial).and_then(|_| fs::rename(&partial, &target));
    if result.is_err() {
        let _ = fs::remove_file(&partial);
    }
    result.map(|_| ()).map_err(err)
}

/// Where a video's copy is or will be kept; `exists` says whether it is there.
#[derive(Serialize)]
pub struct VideoLocation {
    path: String,
    exists: bool,
}

#[tauri::command]
pub fn video_location(data: State<'_, AppData>, file: String) -> Result<VideoLocation, String> {
    let path = videos_dir(&data).join(checked_video(&file)?);
    Ok(VideoLocation {
        exists: path.is_file(),
        path: path.to_string_lossy().into_owned(),
    })
}

/// The videos this computer keeps; half-fetched files are left out.
#[tauri::command]
pub fn list_videos(data: State<'_, AppData>) -> Vec<String> {
    let Ok(entries) = fs::read_dir(videos_dir(&data)) else {
        return Vec::new();
    };
    entries
        .filter_map(|e| e.ok()?.file_name().into_string().ok())
        .filter(|name| checked_video(name).is_ok())
        .collect()
}

/// Deletes this computer's copy of a video, and any half-fetched one.
#[tauri::command(async)]
pub fn remove_video(data: State<'_, AppData>, file: String) -> Result<(), String> {
    let dir = videos_dir(&data);
    let path = dir.join(checked_video(&file)?);
    let _ = fs::remove_file(dir.join(format!("{file}.partial")));
    match fs::remove_file(path) {
        Err(e) if e.kind() != io::ErrorKind::NotFound => Err(err(e)),
        _ => Ok(()),
    }
}

/// Saves a copy of a file this computer has, for **Download original** of a video (U18).
#[tauri::command(async)]
pub fn copy_file(source: String, destination: String) -> Result<(), String> {
    let mut partial = PathBuf::from(&destination).into_os_string();
    partial.push(".partial");
    let result = fs::copy(&source, &partial).and_then(|_| fs::rename(&partial, &destination));
    if result.is_err() {
        let _ = fs::remove_file(&partial);
    }
    result.map(|_| ()).map_err(err)
}

/// Lets the interface load a video the operator chose, so it can read its duration and size
/// in a hidden player before sending it (U14). Only that one file is allowed.
#[tauri::command]
pub fn allow_media_file(app: AppHandle, path: String) -> Result<(), String> {
    let meta = fs::metadata(&path).map_err(|e| format!("file: {e}"))?;
    if !meta.is_file() {
        return Err("not-a-file".into());
    }
    app.asset_protocol_scope().allow_file(&path).map_err(err)
}

/// Turns a HEIC photo into a full-size JPEG at quality 90, keeping its orientation, with
/// macOS's own image library (U25), into a temporary file the caller removes. Elsewhere it
/// answers `unsupported`; a damaged file answers `unreadable`.
pub fn heic_to_jpeg(source: &Path, temp_dir: &Path) -> Result<PathBuf, String> {
    #[cfg(target_os = "macos")]
    {
        fs::create_dir_all(temp_dir).map_err(err)?;
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(err)?
            .as_nanos();
        let stem = source
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("photo");
        let out = temp_dir.join(format!("{stamp}-{stem}.jpg"));
        // `sips` is ImageIO's command; it keeps the photo's metadata, orientation included.
        let status = std::process::Command::new("/usr/bin/sips")
            .args(["-s", "format", "jpeg", "-s", "formatOptions", "90"])
            .arg(source)
            .arg("--out")
            .arg(&out)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map_err(err)?;
        if status.success() && out.is_file() && fs::metadata(&out).map(|m| m.len()).unwrap_or(0) > 0
        {
            Ok(out)
        } else {
            let _ = fs::remove_file(&out);
            Err("unreadable".into())
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (source, temp_dir);
        Err("unsupported".into())
    }
}

#[tauri::command(async)]
pub fn convert_heic(data: State<'_, AppData>, source: String) -> Result<String, String> {
    let out = heic_to_jpeg(Path::new(&source), &data.dir.join("converted"))?;
    Ok(out.to_string_lossy().into_owned())
}

/// Removes a temporary file made by `convert_heic`; nothing outside its folder.
#[tauri::command(async)]
pub fn remove_converted(data: State<'_, AppData>, path: String) -> Result<(), String> {
    let dir = data.dir.join("converted");
    let path = PathBuf::from(path);
    if path.parent() != Some(dir.as_path()) {
        return Err("not a converted file".into());
    }
    match fs::remove_file(path) {
        Err(e) if e.kind() != io::ErrorKind::NotFound => Err(err(e)),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader};
    use std::net::TcpListener;
    use std::thread;

    /// A one-request HTTP server: reads the request, body included, and answers with
    /// `status` and `body`. Returns its address and what it received.
    fn serve_once(
        status: u16,
        body: &'static str,
    ) -> (String, thread::JoinHandle<(String, Vec<u8>)>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = format!("http://{}", listener.local_addr().unwrap());
        let handle = thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut head = String::new();
            let mut length = 0usize;
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).unwrap_or(0) == 0 {
                    break;
                }
                if line.to_ascii_lowercase().starts_with("content-length:") {
                    length = line[15..].trim().parse().unwrap();
                }
                head.push_str(&line);
                if line == "\r\n" {
                    break;
                }
            }
            let mut received = vec![0u8; length];
            let _ = reader.read_exact(&mut received);
            let mut stream = stream;
            let _ = write!(
                stream,
                "HTTP/1.1 {status} X\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            );
            (head, received)
        });
        (address, handle)
    }

    fn temp_file(name: &str, bytes: &[u8]) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "worship-q-media-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        fs::write(&path, bytes).unwrap();
        path
    }

    #[test]
    fn upload_reports_progress_in_order_up_to_the_total() {
        let bytes = vec![7u8; 3 * 1024 * 1024];
        let source = temp_file("clip.mp4", &bytes);
        let (address, server) = serve_once(200, r#"{"file":"video-x.mp4"}"#);
        let events = Arc::new(Mutex::new(Vec::new()));
        let seen = events.clone();
        let answer = upload_file(
            &format!("{address}/api/v1/videos?name=clip.mp4"),
            "token",
            &source,
            Arc::new(AtomicBool::new(false)),
            move |sent, total| seen.lock().unwrap().push((sent, total)),
        )
        .unwrap();
        assert_eq!(answer, r#"{"file":"video-x.mp4"}"#);
        let (head, received) = server.join().unwrap();
        assert!(head.starts_with("POST /api/v1/videos?name=clip.mp4"));
        assert!(head
            .to_ascii_lowercase()
            .contains("authorization: bearer token"));
        assert_eq!(received.len(), bytes.len());
        let events = events.lock().unwrap();
        assert!(!events.is_empty());
        assert!(events.windows(2).all(|w| w[0].0 <= w[1].0));
        assert_eq!(
            *events.last().unwrap(),
            (bytes.len() as u64, bytes.len() as u64)
        );
    }

    #[test]
    fn a_small_file_still_reports_its_end() {
        let source = temp_file("a.jpg", b"tiny");
        let (address, server) = serve_once(200, "{}");
        let events = Arc::new(Mutex::new(Vec::new()));
        let seen = events.clone();
        upload_file(
            &format!("{address}/api/v1/images"),
            "t",
            &source,
            Arc::new(AtomicBool::new(false)),
            move |sent, total| seen.lock().unwrap().push((sent, total)),
        )
        .unwrap();
        server.join().unwrap();
        assert_eq!(*events.lock().unwrap().last().unwrap(), (4, 4));
    }

    #[test]
    fn cancelling_stops_the_upload() {
        let source = temp_file("clip.mp4", &vec![1u8; 1024 * 1024]);
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = format!("http://{}", listener.local_addr().unwrap());
        // Accepts and reads slowly, so the client is still sending when it is cancelled.
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buffer = [0u8; 1024];
            while let Ok(n) = stream.read(&mut buffer) {
                if n == 0 {
                    break;
                }
                thread::sleep(Duration::from_millis(5));
            }
        });
        let cancelled = Arc::new(AtomicBool::new(true));
        let result = upload_file(
            &format!("{address}/api/v1/videos"),
            "t",
            &source,
            cancelled,
            |_, _| {},
        );
        assert_eq!(result.unwrap_err(), "cancelled");
    }

    #[test]
    fn refusals_become_codes() {
        assert_eq!(
            answer_error(413, r#"{"error":"too-large","limitBytes":209715200}"#),
            "too-large:209715200"
        );
        assert_eq!(answer_error(413, "<html>413</html>"), "proxy-too-large");
        assert_eq!(
            answer_error(
                422,
                r#"{"error":"conversion-failed","message":"Bad file."}"#
            ),
            "refused:Bad file."
        );
        assert_eq!(answer_error(400, r#"{"error":"empty"}"#), "empty");
        assert_eq!(
            answer_error(404, r#"{"error":"no-original"}"#),
            "no-original"
        );
        assert_eq!(answer_error(401, ""), "unauthorized");
        assert_eq!(answer_error(501, ""), "decks-unavailable");
        assert_eq!(answer_error(500, ""), "server answered 500");
    }

    #[test]
    fn a_413_from_the_server_maps_to_too_large() {
        let source = temp_file("big.mp4", b"0123456789");
        let (address, server) = serve_once(413, r#"{"error":"too-large","limitBytes":5}"#);
        let result = upload_file(
            &format!("{address}/api/v1/videos"),
            "t",
            &source,
            Arc::new(AtomicBool::new(false)),
            |_, _| {},
        );
        server.join().unwrap();
        assert_eq!(result.unwrap_err(), "too-large:5");
    }

    #[test]
    fn a_download_takes_its_name_only_when_complete() {
        let (address, server) = serve_once(200, "original bytes");
        let destination = temp_file("x", b"").with_file_name("talk.pptx");
        let events = Arc::new(Mutex::new(Vec::new()));
        let seen = events.clone();
        download_file(
            &format!("{address}/api/v1/decks/x/original"),
            "t",
            &destination,
            Arc::new(AtomicBool::new(false)),
            move |sent, total| seen.lock().unwrap().push((sent, total)),
        )
        .unwrap();
        server.join().unwrap();
        assert_eq!(fs::read(&destination).unwrap(), b"original bytes");
        assert_eq!(*events.lock().unwrap().last().unwrap(), (14, 14));
        let mut partial = destination.clone().into_os_string();
        partial.push(".partial");
        assert!(!PathBuf::from(partial).exists());
    }

    #[test]
    fn a_failed_or_cancelled_download_leaves_nothing() {
        let (address, server) = serve_once(404, r#"{"error":"no-original"}"#);
        let destination = temp_file("y", b"").with_file_name("gone.pptx");
        let result = download_file(
            &format!("{address}/api/v1/decks/x/original"),
            "t",
            &destination,
            Arc::new(AtomicBool::new(false)),
            |_, _| {},
        );
        server.join().unwrap();
        assert_eq!(result.unwrap_err(), "no-original");
        assert!(!destination.exists());

        let (address, server) = serve_once(200, "some bytes");
        let destination = destination.with_file_name("cancelled.pptx");
        let result = download_file(
            &format!("{address}/api/v1/files/x"),
            "t",
            &destination,
            Arc::new(AtomicBool::new(true)),
            |_, _| {},
        );
        server.join().unwrap();
        assert_eq!(result.unwrap_err(), "cancelled");
        assert!(!destination.exists());
        let mut partial = destination.into_os_string();
        partial.push(".partial");
        assert!(!PathBuf::from(partial).exists());
    }

    #[test]
    fn video_names_are_checked() {
        assert!(checked_video("video-0f8fad5b-d9cb-469f-a165-70867728950e.mp4").is_ok());
        assert!(checked_video("video-0f8fad5b-d9cb-469f-a165-70867728950e.avi").is_err());
        assert!(checked_video("../video-0f8fad5b-d9cb-469f-a165-70867728950e.mp4").is_err());
        assert!(checked_video("bg-1.mp4").is_err());
    }

    /// An uncompressed (stored) PNG of the given size, grey, for making test photos.
    #[cfg(target_os = "macos")]
    fn png_bytes(width: u32, height: u32) -> Vec<u8> {
        fn crc32(bytes: &[u8]) -> u32 {
            let mut crc = 0xffff_ffffu32;
            for &b in bytes {
                crc ^= b as u32;
                for _ in 0..8 {
                    crc = if crc & 1 != 0 {
                        (crc >> 1) ^ 0xedb8_8320
                    } else {
                        crc >> 1
                    };
                }
            }
            !crc
        }
        let mut raw = Vec::new();
        for _ in 0..height {
            raw.push(0);
            raw.extend(std::iter::repeat_n(128u8, width as usize * 3));
        }
        let (mut a, mut b) = (1u32, 0u32);
        for &x in &raw {
            a = (a + x as u32) % 65521;
            b = (b + a) % 65521;
        }
        let mut z = vec![0x78, 0x01];
        let blocks: Vec<&[u8]> = raw.chunks(65535).collect();
        for (i, block) in blocks.iter().enumerate() {
            z.push(if i + 1 == blocks.len() { 1 } else { 0 });
            let len = block.len() as u16;
            z.extend(len.to_le_bytes());
            z.extend((!len).to_le_bytes());
            z.extend_from_slice(block);
        }
        z.extend(((b << 16) | a).to_be_bytes());
        let chunk = |kind: &[u8], data: &[u8]| {
            let mut out = (data.len() as u32).to_be_bytes().to_vec();
            let mut body = kind.to_vec();
            body.extend_from_slice(data);
            out.extend(&body);
            out.extend(crc32(&body).to_be_bytes());
            out
        };
        let mut header = width.to_be_bytes().to_vec();
        header.extend(height.to_be_bytes());
        header.extend([8, 2, 0, 0, 0]);
        let mut png = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
        png.extend(chunk(b"IHDR", &header));
        png.extend(chunk(b"IDAT", &z));
        png.extend(chunk(b"IEND", &[]));
        png
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_heic_photo_becomes_a_jpeg_of_the_same_size() {
        // Made here with `sips` from a generated PNG.
        let dir = temp_file("x", b"").parent().unwrap().to_path_buf();
        let png = dir.join("source.png");
        let heic = dir.join("photo.heic");
        fs::write(&png, png_bytes(400, 300)).unwrap();
        let path = |p: &Path| p.to_string_lossy().into_owned();
        let made = std::process::Command::new("/usr/bin/sips")
            .args(["-s", "format", "heic", &path(&png), "--out", &path(&heic)])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .unwrap()
            .success();
        if !made {
            eprintln!("this Mac cannot write HEIC; skipped");
            return;
        }
        let started = Instant::now();
        let out = heic_to_jpeg(&heic, &dir.join("converted")).unwrap();
        assert!(started.elapsed() < Duration::from_secs(5));
        let bytes = fs::read(&out).unwrap();
        assert_eq!(&bytes[..2], &[0xff, 0xd8]);
        let size = std::process::Command::new("/usr/bin/sips")
            .args(["-g", "pixelWidth", "-g", "pixelHeight", &path(&out)])
            .output()
            .unwrap();
        let text = String::from_utf8_lossy(&size.stdout);
        assert!(text.contains("pixelWidth: 400"), "{text}");
        assert!(text.contains("pixelHeight: 300"), "{text}");

        let damaged = dir.join("damaged.heic");
        fs::write(&damaged, b"not a photo").unwrap();
        assert_eq!(
            heic_to_jpeg(&damaged, &dir.join("converted")).unwrap_err(),
            "unreadable"
        );
    }
}
