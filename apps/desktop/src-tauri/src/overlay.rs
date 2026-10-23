//! The subtitle overlay page for OBS and similar software on this computer.
//!
//! Served on localhost only, at a fixed address, so OBS keeps the same Browser Source URL
//! across restarts. The page receives each new subtitle frame over a WebSocket; the frames
//! themselves are made by the interface, which owns the presentation.

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State as AxumState};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Redirect, Response};
use axum::routing::get;
use axum::Router;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State, Wry};
use tokio::sync::watch;

/// Chosen to be unlikely to clash; it never changes, so OBS needs no reconfiguring.
pub const OVERLAY_PORT: u16 = 47_310;
const DEV_URL: &str = "http://localhost:1420";

pub struct Overlay {
    frames: watch::Sender<String>,
    /// Why the server could not start, if it could not.
    pub error: Mutex<Option<String>>,
}

impl Overlay {
    pub fn new() -> Self {
        let (frames, _) = watch::channel(String::from("null"));
        Self {
            frames,
            error: Mutex::new(None),
        }
    }
}

#[derive(Clone)]
struct ServerState {
    app: AppHandle<Wry>,
    frames: watch::Receiver<String>,
}

pub fn start(app: &AppHandle<Wry>) {
    let overlay = app.state::<Overlay>();
    let state = ServerState {
        app: app.clone(),
        frames: overlay.frames.subscribe(),
    };
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let router = Router::new()
            .route("/", get(|| async { Redirect::temporary("/overlay/subtitle") }))
            .route("/overlay/subtitle", get(page))
            .route("/assets/{*file}", get(asset))
            .route("/ws", get(socket))
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
    if let Some(response) = bundled(&state.app, "overlay.html") {
        return response;
    }
    if cfg!(dev) {
        // In development the page comes from the Vite server and connects back here.
        let url = format!("{DEV_URL}/overlay.html?port={OVERLAY_PORT}");
        return Redirect::temporary(&url).into_response();
    }
    StatusCode::NOT_FOUND.into_response()
}

async fn asset(
    AxumState(state): AxumState<ServerState>,
    Path(file): Path<String>,
) -> Response {
    if file.contains("..") {
        return StatusCode::NOT_FOUND.into_response();
    }
    bundled(&state.app, &format!("assets/{file}"))
        .unwrap_or_else(|| StatusCode::NOT_FOUND.into_response())
}

async fn socket(
    AxumState(state): AxumState<ServerState>,
    upgrade: WebSocketUpgrade,
) -> Response {
    upgrade.on_upgrade(move |ws| follow(ws, state.frames))
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

/// Makes `frame` (JSON) what every overlay page shows.
#[tauri::command]
pub fn overlay_publish(overlay: State<'_, Overlay>, frame: String) {
    overlay.frames.send_replace(frame);
}

/// The overlay page's address, and why it is unavailable if it is.
#[tauri::command]
pub fn overlay_status(overlay: State<'_, Overlay>) -> (String, Option<String>) {
    (
        format!("http://127.0.0.1:{OVERLAY_PORT}/overlay/subtitle"),
        overlay.error.lock().unwrap().clone(),
    )
}
