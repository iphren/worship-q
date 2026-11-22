//! The subtitle overlay and slideshow pages for OBS and browsers on this computer.
//!
//! Served on localhost only, at a fixed address, so OBS keeps the same Browser Source URL
//! across restarts. Each page receives its frames over a WebSocket; the frames themselves
//! are made by the interface, which owns the presentation. The slideshow page (plan M7.7,
//! spec §10 localhost exception) works without internet: the app holds the connection to the
//! coordinator, and the page only needs the app. Background and slide files are served
//! alongside, since an ordinary browser cannot read the app's own files, and so are this
//! computer's copies of videos, in byte ranges as browsers ask for them.

use crate::db::AppData;
use crate::files::{backgrounds_dir, checked_name};
use crate::media::{checked_video, videos_dir};
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, RawQuery, State as AxumState};
use axum::http::{header, HeaderMap, StatusCode, Uri};
use axum::response::{IntoResponse, Redirect, Response};
use axum::routing::get;
use axum::Router;
use std::io::{Read, SeekFrom, Write};
use std::net::{SocketAddr, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State, Wry};
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio::sync::watch;

/// Chosen to be unlikely to clash; it never changes, so OBS needs no reconfiguring.
pub const OVERLAY_PORT: u16 = 47_310;
const DEV_URL: &str = "http://localhost:1420";

pub struct Overlay {
    frames: watch::Sender<String>,
    slideshow_frames: watch::Sender<String>,
    /// Why the server could not start, if it could not.
    pub error: Mutex<Option<String>>,
    /// Something else already had the address when this copy started.
    taken: AtomicBool,
}

impl Overlay {
    pub fn new() -> Self {
        let (frames, _) = watch::channel(String::from("null"));
        let (slideshow_frames, _) = watch::channel(String::from("null"));
        Self {
            frames,
            slideshow_frames,
            error: Mutex::new(None),
            taken: AtomicBool::new(false),
        }
    }

    /// True while another copy of the app holds the overlay address. This also finds a
    /// version from before copies marked themselves as running (`instances`), though only
    /// from the copy opened second, which is the one left without the address.
    pub fn held_by_another_copy(&self) -> bool {
        self.taken.load(Ordering::Relaxed) && answers_as_worship_q()
    }
}

/// Asks whatever holds the overlay address for the subtitle page, to tell the app from
/// another program on the same port.
fn answers_as_worship_q() -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], OVERLAY_PORT));
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(300)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(500)));
    if stream
        .write_all(b"GET /overlay/subtitle HTTP/1.0\r\nHost: localhost\r\n\r\n")
        .is_err()
    {
        return false;
    }
    let mut answer = Vec::new();
    let _ = stream.take(16 * 1024).read_to_end(&mut answer);
    is_worship_q(&String::from_utf8_lossy(&answer))
}

/// The subtitle page itself, or in development the redirect to it on the Vite server.
fn is_worship_q(answer: &str) -> bool {
    answer.contains("<title>Worship Q Subtitles</title>")
        || answer.contains(&format!("/overlay.html?port={OVERLAY_PORT}"))
}

#[derive(Clone)]
struct ServerState {
    app: AppHandle<Wry>,
    frames: watch::Receiver<String>,
    slideshow_frames: watch::Receiver<String>,
}

pub fn start(app: &AppHandle<Wry>) {
    let overlay = app.state::<Overlay>();
    let state = ServerState {
        app: app.clone(),
        frames: overlay.frames.subscribe(),
        slideshow_frames: overlay.slideshow_frames.subscribe(),
    };
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let router = Router::new()
            .route(
                "/",
                get(|| async { Redirect::temporary("/overlay/subtitle") }),
            )
            .route("/overlay/subtitle", get(page))
            .route("/slideshow", get(slideshow_page))
            .route(YOUTUBE_ROUTE, get(youtube))
            .route("/assets/{*file}", get(asset))
            .route("/files/{name}", get(file))
            .route("/videos/{name}", get(video))
            .route("/ws", get(socket))
            .route("/ws/slideshow", get(slideshow_socket))
            .with_state(state);
        match tokio::net::TcpListener::bind(("127.0.0.1", OVERLAY_PORT)).await {
            Ok(listener) => {
                if let Err(e) = axum::serve(listener, router).await {
                    *handle.state::<Overlay>().error.lock().unwrap() = Some(e.to_string());
                }
            }
            Err(e) => {
                let overlay = handle.state::<Overlay>();
                if e.kind() == std::io::ErrorKind::AddrInUse {
                    overlay.taken.store(true, Ordering::Relaxed);
                }
                *overlay.error.lock().unwrap() = Some(e.to_string());
            }
        }
    });
}

fn bundled(app: &AppHandle<Wry>, path: &str) -> Option<Response> {
    let asset = app.asset_resolver().get(path.to_string())?;
    Some(
        (
            [
                (header::CONTENT_TYPE, asset.mime_type),
                (header::CACHE_CONTROL, "no-cache".to_string()),
            ],
            asset.bytes,
        )
            .into_response(),
    )
}

async fn page(AxumState(state): AxumState<ServerState>, headers: HeaderMap, uri: Uri) -> Response {
    to_localhost(&headers, &uri).unwrap_or_else(|| serve_page(&state.app, "overlay.html"))
}

async fn slideshow_page(
    AxumState(state): AxumState<ServerState>,
    headers: HeaderMap,
    uri: Uri,
) -> Response {
    to_localhost(&headers, &uri).unwrap_or_else(|| serve_page(&state.app, "slideshow.html"))
}

/// Sends a browser that asked for a page at `127.0.0.1`, as OBS sources saved with that
/// address do, to the same page at `localhost`, where YouTube plays the music videos
/// it refuses at `127.0.0.1` (`youtube_page`). The page's own requests then follow it there.
/// A request without a `User-Agent` is answered where it is: browsers and OBS always send
/// one, and older copies of the app checking who holds the port (`answers_as_worship_q`)
/// never do, and look for the page itself.
fn to_localhost(headers: &HeaderMap, uri: &Uri) -> Option<Response> {
    let host = headers.get(header::HOST)?.to_str().ok()?;
    if host.split(':').next() != Some("127.0.0.1") || !headers.contains_key(header::USER_AGENT) {
        return None;
    }
    let path = uri.path_and_query().map_or("/", |p| p.as_str());
    let url = format!("http://localhost:{OVERLAY_PORT}{path}");
    Some(Redirect::temporary(&url).into_response())
}

fn serve_page(app: &AppHandle<Wry>, name: &str) -> Response {
    if cfg!(dev) {
        // In development the page comes from the Vite server and connects back here, never
        // from a build left in `dist`, which would show old code.
        let url = format!("{DEV_URL}/{name}?port={OVERLAY_PORT}");
        return Redirect::temporary(&url).into_response();
    }
    bundled(app, name).unwrap_or_else(|| StatusCode::NOT_FOUND.into_response())
}

const YOUTUBE_ROUTE: &str = "/youtube/{id}";
/// Where the interface's addresses for a YouTube video alone begin (`youtubeEmbedUrl`).
const YOUTUBE_EMBED: &str = "https://www.youtube-nocookie.com/embed/";

/// The page on this computer that shows the video of a YouTube embed address, or nothing
/// when the address is not one or the server is not running. The slideshow window shows the
/// video through this page because YouTube refuses to play a video opened on its own: it
/// plays only inside a page with a web address, which the app's own pages do not have.
/// The page is named `localhost`, not `127.0.0.1`: YouTube refuses most music videos in a
/// page at `127.0.0.1` ("video unavailable", error 150) but plays them at `localhost`. The
/// server listens on `127.0.0.1`, which `localhost` reaches.
pub fn youtube_page(overlay: &Overlay, embed: &str) -> Option<String> {
    if overlay.error.lock().unwrap().is_some() {
        return None;
    }
    let (id, query) = embed.strip_prefix(YOUTUBE_EMBED)?.split_once('?')?;
    if !plain_video(id, query) {
        return None;
    }
    Some(format!(
        "http://localhost:{OVERLAY_PORT}/youtube/{id}?{query}"
    ))
}

/// Whether a video's identifier and its settings are plain, so the page can be for nothing
/// but a YouTube video.
fn plain_video(id: &str, query: &str) -> bool {
    let plain = |c: char| c.is_ascii_alphanumeric() || c == '_' || c == '-';
    id.len() == 11
        && id.chars().all(plain)
        && query.chars().all(|c| plain(c) || c == '=' || c == '&')
}

/// The page that plays a video, following the slideshow's clock (YouTube control D6): the
/// built `youtube.html`, which reads the video from the address. In development it comes
/// from the Vite server, told the video and where this server is.
async fn youtube(
    AxumState(state): AxumState<ServerState>,
    Path(id): Path<String>,
    RawQuery(query): RawQuery,
    headers: HeaderMap,
    uri: Uri,
) -> Response {
    if let Some(redirect) = to_localhost(&headers, &uri) {
        return redirect;
    }
    if !plain_video(&id, query.as_deref().unwrap_or("")) {
        return StatusCode::NOT_FOUND.into_response();
    }
    if cfg!(dev) {
        let url = format!("{DEV_URL}/youtube.html?port={OVERLAY_PORT}&v={id}");
        return Redirect::temporary(&url).into_response();
    }
    bundled(&state.app, "youtube.html").unwrap_or_else(|| StatusCode::NOT_FOUND.into_response())
}

/// A stored background or slide image, for the slideshow page in an ordinary browser.
async fn file(AxumState(state): AxumState<ServerState>, Path(name): Path<String>) -> Response {
    let Ok(name) = checked_name(&name) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let path = backgrounds_dir(&state.app.state::<AppData>()).join(name);
    let Ok(bytes) = tokio::fs::read(&path).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let mime = match path.extension().and_then(|e| e.to_str()) {
        Some("png") => "image/png",
        Some("mp4") => "video/mp4",
        _ => "image/jpeg",
    };
    (
        [
            (header::CONTENT_TYPE, mime.to_string()),
            // File names carry an identifier and never change their content.
            (
                header::CACHE_CONTROL,
                "private, max-age=31536000, immutable".to_string(),
            ),
        ],
        bytes,
    )
        .into_response()
}

/// The most a single answer carries; a browser asks again for the rest, so a long video is
/// never read into memory whole.
const MAX_CHUNK: u64 = 8 * 1024 * 1024;

/// The bytes a `Range` header asks for, as `(first, last)` inclusive, cut to `MAX_CHUNK`.
/// `None` for no header (from the start); `Err` for a range that cannot be satisfied.
fn byte_range(range: Option<&str>, total: u64) -> Result<(u64, u64), ()> {
    let whole = |first: u64| (first, (first + MAX_CHUNK).min(total) - 1);
    let Some(range) = range else {
        return if total == 0 { Err(()) } else { Ok(whole(0)) };
    };
    let spec = range.trim().strip_prefix("bytes=").ok_or(())?;
    // Only the first of several ranges is answered, which browsers accept.
    let spec = spec.split(',').next().unwrap_or_default().trim();
    let (first, last) = spec.split_once('-').ok_or(())?;
    let (first, last) = match (first.trim(), last.trim()) {
        ("", "") => return Err(()),
        ("", suffix) => {
            let length: u64 = suffix.parse().map_err(|_| ())?;
            if length == 0 {
                return Err(());
            }
            (total.saturating_sub(length), total.saturating_sub(1))
        }
        (first, "") => {
            let first: u64 = first.parse().map_err(|_| ())?;
            if first >= total {
                return Err(());
            }
            return Ok(whole(first));
        }
        (first, last) => (
            first.parse().map_err(|_| ())?,
            last.parse::<u64>()
                .map_err(|_| ())?
                .min(total.saturating_sub(1)),
        ),
    };
    if total == 0 || first > last || first >= total {
        return Err(());
    }
    Ok((first, last.min(first + MAX_CHUNK - 1)))
}

fn video_mime(name: &str) -> &'static str {
    match name.rsplit_once('.').map(|(_, e)| e) {
        Some("webm") => "video/webm",
        Some("mov") => "video/quicktime",
        _ => "video/mp4",
    }
}

/// This computer's copy of a video, for the slideshow page in an ordinary browser.
async fn video(
    AxumState(state): AxumState<ServerState>,
    Path(name): Path<String>,
    headers: HeaderMap,
) -> Response {
    let Ok(name) = checked_video(&name) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let path = videos_dir(&state.app.state::<AppData>()).join(name);
    let Ok(mut opened) = tokio::fs::File::open(&path).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let Ok(total) = opened.metadata().await.map(|m| m.len()) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let asked = headers.get(header::RANGE).and_then(|v| v.to_str().ok());
    let Ok((first, last)) = byte_range(asked, total) else {
        return (
            StatusCode::RANGE_NOT_SATISFIABLE,
            [(header::CONTENT_RANGE, format!("bytes */{total}"))],
        )
            .into_response();
    };
    let mut bytes = vec![0; (last - first + 1) as usize];
    if opened.seek(SeekFrom::Start(first)).await.is_err()
        || opened.read_exact(&mut bytes).await.is_err()
    {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
    (
        StatusCode::PARTIAL_CONTENT,
        [
            (header::CONTENT_TYPE, video_mime(name).to_string()),
            (header::ACCEPT_RANGES, "bytes".to_string()),
            (
                header::CONTENT_RANGE,
                format!("bytes {first}-{last}/{total}"),
            ),
            (header::CACHE_CONTROL, "no-cache".to_string()),
        ],
        bytes,
    )
        .into_response()
}

async fn asset(AxumState(state): AxumState<ServerState>, Path(file): Path<String>) -> Response {
    if file.contains("..") {
        return StatusCode::NOT_FOUND.into_response();
    }
    bundled(&state.app, &format!("assets/{file}"))
        .unwrap_or_else(|| StatusCode::NOT_FOUND.into_response())
}

async fn socket(AxumState(state): AxumState<ServerState>, upgrade: WebSocketUpgrade) -> Response {
    upgrade.on_upgrade(move |ws| follow(ws, state.frames, None))
}

async fn slideshow_socket(
    AxumState(state): AxumState<ServerState>,
    upgrade: WebSocketUpgrade,
) -> Response {
    upgrade.on_upgrade(move |ws| follow(ws, state.slideshow_frames, Some(state.app)))
}

/// The event the interface hears a YouTube page's report on (YouTube control D6, D7).
pub const YOUTUBE_REPORT_EVENT: &str = "youtube-report";

/// A YouTube page's report, `{"youtube": …}`, passed on as it is: only its shape is checked
/// here, and the interface reads it.
fn youtube_report(text: &str) -> Option<serde_json::Value> {
    if text.len() > 1024 {
        return None;
    }
    let value: serde_json::Value = serde_json::from_str(text).ok()?;
    let report = value.get("youtube")?;
    report.get("kind")?.as_str()?;
    report.get("id")?.as_str()?;
    Some(report.clone())
}

/// Sends the current frame, then every new one, until the page goes away. On the slideshow
/// socket (`app` given) a YouTube page's reports are passed on to the interface.
async fn follow(
    mut ws: WebSocket,
    mut frames: watch::Receiver<String>,
    app: Option<AppHandle<Wry>>,
) {
    let mut send = true;
    loop {
        if send {
            let frame = frames.borrow_and_update().clone();
            if ws.send(Message::Text(frame.into())).await.is_err() {
                return;
            }
        }
        tokio::select! {
            changed = frames.changed() => {
                if changed.is_err() { return }
                send = true;
            }
            incoming = ws.recv() => {
                send = false;
                match incoming {
                    Some(Ok(Message::Text(text))) => {
                        if let (Some(app), Some(report)) = (&app, youtube_report(&text)) {
                            let _ = app.emit(YOUTUBE_REPORT_EVENT, report);
                        }
                    }
                    // A closed or failed socket ends here.
                    Some(Ok(Message::Close(_))) | None | Some(Err(_)) => return,
                    _ => {}
                }
            }
        }
    }
}

/// Makes `frame` (JSON) what every overlay page shows, or every slideshow page when `kind`
/// is `slideshow`.
#[tauri::command]
pub fn overlay_publish(overlay: State<'_, Overlay>, frame: String, kind: Option<String>) {
    match kind.as_deref() {
        Some("slideshow") => overlay.slideshow_frames.send_replace(frame),
        _ => overlay.frames.send_replace(frame),
    };
}

/// The overlay page's address, and why it is unavailable if it is.
#[tauri::command]
pub fn overlay_status(overlay: State<'_, Overlay>) -> (String, Option<String>) {
    (
        format!("http://localhost:{OVERLAY_PORT}/overlay/subtitle"),
        overlay.error.lock().unwrap().clone(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_the_app_on_the_overlay_address() {
        let page = "HTTP/1.0 200 OK\r\n\r\n<!doctype html><title>Worship Q Subtitles</title>";
        assert!(is_worship_q(page));
        let redirect = "HTTP/1.0 307 Temporary Redirect\r\nlocation: http://localhost:1420/overlay.html?port=47310\r\n\r\n";
        assert!(is_worship_q(redirect));
        assert!(!is_worship_q(
            "HTTP/1.0 200 OK\r\n\r\n<title>Something else</title>"
        ));
        assert!(!is_worship_q(""));
    }

    #[test]
    fn takes_only_a_plain_youtube_video() {
        assert!(plain_video("dQw4w9WgXcQ", "playsinline=1&rel=0"));
        assert!(!plain_video("short", ""));
        assert!(!plain_video("dQw4w9WgXc\"", ""));
        assert!(!plain_video("dQw4w9WgXcQ", "a=\"><script>"));
    }

    #[test]
    fn passes_on_only_youtube_reports() {
        let report =
            youtube_report(r#"{"youtube":{"kind":"length","id":"dQw4w9WgXcQ","seconds":213}}"#);
        assert_eq!(report.unwrap()["seconds"], 213);
        assert!(youtube_report(r#"{"youtube":{"id":"dQw4w9WgXcQ"}}"#).is_none());
        assert!(youtube_report(r#"{"other":1}"#).is_none());
        assert!(youtube_report("not json").is_none());
        assert!(youtube_report(&format!(
            r#"{{"youtube":{{"kind":"{}","id":"x"}}}}"#,
            "a".repeat(2000)
        ))
        .is_none());
    }

    #[test]
    fn sends_browsers_at_the_ip_address_to_localhost() {
        let uri: Uri = "/slideshow?size=small".parse().unwrap();
        let headers = |host: &str, agent: bool| {
            let mut headers = HeaderMap::new();
            headers.insert(header::HOST, host.parse().unwrap());
            if agent {
                headers.insert(header::USER_AGENT, "OBS".parse().unwrap());
            }
            headers
        };
        let redirect = to_localhost(&headers("127.0.0.1:47310", true), &uri).unwrap();
        assert_eq!(redirect.status(), StatusCode::TEMPORARY_REDIRECT);
        assert_eq!(
            redirect.headers()[header::LOCATION],
            "http://localhost:47310/slideshow?size=small"
        );
        // Already at localhost, or an older copy of the app checking the port: answered.
        assert!(to_localhost(&headers("localhost:47310", true), &uri).is_none());
        assert!(to_localhost(&headers("127.0.0.1:47310", false), &uri).is_none());
        assert!(to_localhost(&HeaderMap::new(), &uri).is_none());
    }

    #[test]
    fn sends_the_slideshow_window_to_the_video_page() {
        let overlay = Overlay::new();
        let embed = "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0";
        assert_eq!(
            youtube_page(&overlay, embed).as_deref(),
            Some("http://localhost:47310/youtube/dQw4w9WgXcQ?autoplay=1&rel=0")
        );
        assert!(youtube_page(&overlay, "https://example.org/embed/dQw4w9WgXcQ?a=1").is_none());
        // Without the server the web page is shown, as before.
        *overlay.error.lock().unwrap() = Some("address in use".into());
        assert!(youtube_page(&overlay, embed).is_none());
    }

    #[test]
    fn ranges() {
        assert_eq!(byte_range(Some("bytes=0-99"), 1000), Ok((0, 99)));
        assert_eq!(byte_range(Some("bytes=900-"), 1000), Ok((900, 999)));
        assert_eq!(byte_range(Some("bytes=-100"), 1000), Ok((900, 999)));
        assert_eq!(byte_range(Some("bytes=990-2000"), 1000), Ok((990, 999)));
        assert_eq!(byte_range(Some("bytes=0-1,5-9"), 1000), Ok((0, 1)));
        assert_eq!(byte_range(None, 1000), Ok((0, 999)));
        assert_eq!(byte_range(Some("bytes=1000-"), 1000), Err(()));
        assert_eq!(byte_range(Some("bytes=5-1"), 1000), Err(()));
        assert_eq!(byte_range(Some("bytes=-0"), 1000), Err(()));
        assert_eq!(byte_range(Some("items=0-1"), 1000), Err(()));
        assert_eq!(byte_range(None, 0), Err(()));
    }

    #[test]
    fn ranges_are_cut_to_a_chunk() {
        let total = 100 * MAX_CHUNK;
        assert_eq!(byte_range(Some("bytes=0-"), total), Ok((0, MAX_CHUNK - 1)));
        assert_eq!(byte_range(None, total), Ok((0, MAX_CHUNK - 1)));
        assert_eq!(
            byte_range(Some(&format!("bytes=5-{total}")), total),
            Ok((5, MAX_CHUNK + 4))
        );
    }
}
