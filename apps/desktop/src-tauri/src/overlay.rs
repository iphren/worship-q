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
use axum::extract::{Path, State as AxumState};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Redirect, Response};
use axum::routing::get;
use axum::Router;
use std::io::SeekFrom;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State, Wry};
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
}

impl Overlay {
    pub fn new() -> Self {
        let (frames, _) = watch::channel(String::from("null"));
        let (slideshow_frames, _) = watch::channel(String::from("null"));
        Self {
            frames,
            slideshow_frames,
            error: Mutex::new(None),
        }
    }
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
            Err(e) => *handle.state::<Overlay>().error.lock().unwrap() = Some(e.to_string()),
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

async fn page(AxumState(state): AxumState<ServerState>) -> Response {
    serve_page(&state.app, "overlay.html")
}

async fn slideshow_page(AxumState(state): AxumState<ServerState>) -> Response {
    serve_page(&state.app, "slideshow.html")
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
    upgrade.on_upgrade(move |ws| follow(ws, state.frames))
}

async fn slideshow_socket(
    AxumState(state): AxumState<ServerState>,
    upgrade: WebSocketUpgrade,
) -> Response {
    upgrade.on_upgrade(move |ws| follow(ws, state.slideshow_frames))
}

/// Sends the current frame, then every new one, until the page goes away.
async fn follow(mut ws: WebSocket, mut frames: watch::Receiver<String>) {
    loop {
        let frame = frames.borrow_and_update().clone();
        if ws.send(Message::Text(frame.into())).await.is_err() {
            return;
        }
        tokio::select! {
            changed = frames.changed() => if changed.is_err() { return },
            incoming = ws.recv() => match incoming {
                // The page sends nothing; a closed or failed socket ends here.
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => return,
                _ => {}
            },
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
        format!("http://127.0.0.1:{OVERLAY_PORT}/overlay/subtitle"),
        overlay.error.lock().unwrap().clone(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

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
