//! The OBS link (OBS control plan, decisions O1, O2, O7; task breakdown M1.1–M1.2).
//!
//! The desktop on the computer OBS runs on connects to OBS's own WebSocket server
//! (obs-websocket 5, built into OBS Studio) and holds that connection for the workspace. While
//! the link is wanted it keeps trying, so OBS and Worship Q can start in either order and
//! either can restart.
//!
//! The native side only connects, authenticates, passes requests and their answers, and
//! reports events and the connection's status. What the requests mean, the OBS state and
//! sharing it with the workspace are the interface's (`apps/desktop/src/app/obs.ts`).
//!
//! What the client sees in each case was measured on OBS 33 (`docs/spikes/obs.md`): a wrong
//! or missing password closes the socket with code 4009, OBS quitting sends `ExitStarted`
//! and closes with 1001, and OBS not running and its server being turned off both refuse
//! the TCP connection, which takes about 2.3 s to fail on Windows. Retries are therefore
//! counted from the failure, not from the start of an attempt.

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::future::Future;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{client_async, WebSocketStream};

/// OBS's default port for its WebSocket server.
pub const DEFAULT_PORT: u16 = 4455;
/// General (1), Config (2), Scenes (4), Outputs (64) and Ui (1024). Never the high-volume
/// categories such as `InputVolumeMeters`, which fire many times a second.
const EVENT_SUBSCRIPTIONS: u32 = 1 | 2 | 4 | 64 | 1024;
/// obs-websocket's close code for a failed or missing authentication.
const CLOSE_AUTHENTICATION_FAILED: u16 = 4009;
/// The only requests the interface may make: what the controls need, and nothing that
/// changes OBS's own settings, sources or files.
const ALLOWED_REQUESTS: &[&str] = &[
    "GetVersion",
    "GetSceneList",
    "GetCurrentProgramScene",
    "SetCurrentProgramScene",
    "GetStudioModeEnabled",
    "GetStreamStatus",
    "StartStream",
    "StopStream",
    "GetRecordStatus",
    "StartRecord",
    "StopRecord",
    "GetVirtualCamStatus",
    "StartVirtualCam",
    "StopVirtualCam",
    "GetSourceScreenshot",
];

/// Error code of a request made while not connected.
pub const NOT_CONNECTED: i64 = -1;
/// Error code of a request OBS did not answer in time.
pub const TIMED_OUT: i64 = -2;
/// Error code of a request the interface may not make.
pub const NOT_ALLOWED: i64 = -3;

// ── Status ─────────────────────────────────────────────────────────────────

/// The connection to OBS, as the status indicator shows it (plan §3).
#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum LinkState {
    /// The link is not wanted.
    Off,
    /// Nothing answers at the address: OBS is not running, or its WebSocket server is off.
    NotRunning,
    /// Starting, or OBS answered and the handshake is under way.
    Connecting,
    Connected,
    /// OBS answered and turned the connection away.
    Refused,
}

/// Why OBS turned the connection away.
#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Refusal {
    /// The password is wrong.
    Authentication,
    /// OBS asks for a password and none is set.
    PasswordRequired,
    /// Anything else, such as another program on the port; `message` says what.
    Other,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub state: LinkState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refusal: Option<Refusal>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    /// OBS Studio's version, once connected.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub obs_version: Option<String>,
}

impl Status {
    fn of(state: LinkState) -> Self {
        Status {
            state,
            refusal: None,
            message: None,
            obs_version: None,
        }
    }

    fn refused(refusal: Refusal, message: Option<String>) -> Self {
        Status {
            state: LinkState::Refused,
            refusal: Some(refusal),
            message,
            obs_version: None,
        }
    }
}

/// A request OBS refused, or one that could not be made.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RequestError {
    /// OBS's `requestStatus.code`, or one of `NOT_CONNECTED`, `TIMED_OUT`, `NOT_ALLOWED`.
    pub code: i64,
    pub comment: Option<String>,
}

impl RequestError {
    fn new(code: i64, comment: &str) -> Self {
        RequestError {
            code,
            comment: Some(comment.into()),
        }
    }
}

/// Where the connection reports what happens.
pub trait Sink: Send + Sync + 'static {
    fn status(&self, status: &Status);
    fn event(&self, event_type: &str, data: &Value);
}

#[derive(Clone, Copy, Debug)]
pub struct Timing {
    /// Wait after OBS was not reachable or the connection dropped.
    pub retry: Duration,
    /// Wait after OBS refused, so a wrong password is not tried many times a minute.
    pub refused_retry: Duration,
    pub connect_timeout: Duration,
    pub handshake_timeout: Duration,
    pub request_timeout: Duration,
}

impl Default for Timing {
    fn default() -> Self {
        Timing {
            retry: Duration::from_secs(3),
            refused_retry: Duration::from_secs(10),
            connect_timeout: Duration::from_secs(5),
            handshake_timeout: Duration::from_secs(10),
            request_timeout: Duration::from_secs(10),
        }
    }
}

// ── Addresses and authentication ───────────────────────────────────────────

/// Where OBS's WebSocket server is.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Target {
    pub host: String,
    pub port: u16,
}

impl Target {
    fn url(&self) -> String {
        if self.host.contains(':') {
            format!("ws://[{}]:{}", self.host, self.port)
        } else {
            format!("ws://{}:{}", self.host, self.port)
        }
    }
}

/// Reads an address as typed in Settings: `localhost:4455`, `192.168.1.20`, `ws://host:port`,
/// `[::1]:4455`. Empty means OBS's default on this computer. `localhost` is taken as
/// 127.0.0.1, where OBS listens: trying the IPv6 address first would add a refused attempt
/// to every try, and on Windows each refused attempt takes seconds.
pub fn parse_address(address: &str) -> Result<Target, String> {
    let mut rest = address.trim();
    for prefix in ["ws://", "WS://"] {
        if let Some(stripped) = rest.strip_prefix(prefix) {
            rest = stripped;
        }
    }
    let rest = rest.trim_end_matches('/');
    let (host, port) = if rest.is_empty() {
        ("127.0.0.1".to_string(), DEFAULT_PORT)
    } else if let Some(bracketed) = rest.strip_prefix('[') {
        let (host, after) = bracketed
            .split_once(']')
            .ok_or_else(|| "invalid address".to_string())?;
        let port = match after.strip_prefix(':') {
            Some(port) => port.parse().map_err(|_| "invalid port".to_string())?,
            None if after.is_empty() => DEFAULT_PORT,
            None => return Err("invalid address".into()),
        };
        (host.to_string(), port)
    } else if rest.matches(':').count() > 1 {
        // An IPv6 address without brackets has no port.
        (rest.to_string(), DEFAULT_PORT)
    } else if let Some((host, port)) = rest.split_once(':') {
        (
            host.to_string(),
            port.parse().map_err(|_| "invalid port".to_string())?,
        )
    } else {
        (rest.to_string(), DEFAULT_PORT)
    };
    let valid = !host.is_empty()
        && host.len() <= 253
        && host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | ':' | '_'));
    if !valid {
        return Err("invalid address".into());
    }
    if port == 0 {
        return Err("invalid port".into());
    }
    let host = if host.eq_ignore_ascii_case("localhost") {
        "127.0.0.1".to_string()
    } else {
        host
    };
    Ok(Target { host, port })
}

/// obs-websocket's authentication string:
/// base64(SHA-256(base64(SHA-256(password + salt)) + challenge)).
pub fn authentication(password: &str, salt: &str, challenge: &str) -> String {
    let secret = B64.encode(Sha256::digest(format!("{password}{salt}")));
    B64.encode(Sha256::digest(format!("{secret}{challenge}")))
}

// ── The connection ─────────────────────────────────────────────────────────

/// A request waiting to be sent.
pub struct Pending {
    request_type: String,
    data: Value,
    reply: oneshot::Sender<Result<Value, RequestError>>,
}

/// How an attempt or a connection ended.
#[derive(Debug, PartialEq)]
enum Ended {
    /// Nothing answered, or the handshake did not finish.
    NotRunning,
    Refused(Refusal, Option<String>),
    /// The connection was up and went away.
    Dropped,
    /// The link is no longer wanted.
    Stopped,
}

type Ws = WebSocketStream<TcpStream>;

/// Reports the status, once per change.
struct Reporter {
    sink: Arc<dyn Sink>,
    last: Option<Status>,
}

impl Reporter {
    fn set(&mut self, status: Status) {
        if self.last.as_ref() != Some(&status) {
            self.sink.status(&status);
            self.last = Some(status);
        }
    }

    fn state(&self) -> Option<LinkState> {
        self.last.as_ref().map(|status| status.state)
    }
}

fn not_connected() -> RequestError {
    RequestError::new(NOT_CONNECTED, "not connected to OBS")
}

/// Makes the connection task: it keeps OBS connected until the returned sender is dropped.
/// The caller spawns the future; aborting it ends the connection at once.
pub fn connection(
    target: Target,
    password: Option<String>,
    sink: Arc<dyn Sink>,
    timing: Timing,
) -> (
    mpsc::UnboundedSender<Pending>,
    impl Future<Output = ()> + Send + 'static,
) {
    let (tx, rx) = mpsc::unbounded_channel();
    (tx, supervise(target, password, sink, timing, rx))
}

/// Sends a request on a connection and waits for OBS's answer.
pub async fn request(
    requests: &mpsc::UnboundedSender<Pending>,
    request_type: &str,
    data: Value,
    timeout: Duration,
) -> Result<Value, RequestError> {
    if !ALLOWED_REQUESTS.contains(&request_type) {
        return Err(RequestError::new(NOT_ALLOWED, "request not allowed"));
    }
    let (reply, answer) = oneshot::channel();
    requests
        .send(Pending {
            request_type: request_type.to_string(),
            data,
            reply,
        })
        .map_err(|_| not_connected())?;
    match tokio::time::timeout(timeout, answer).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err(not_connected()),
        Err(_) => Err(RequestError::new(TIMED_OUT, "OBS did not answer in time")),
    }
}

async fn supervise(
    target: Target,
    password: Option<String>,
    sink: Arc<dyn Sink>,
    timing: Timing,
    mut requests: mpsc::UnboundedReceiver<Pending>,
) {
    let mut reporter = Reporter { sink, last: None };
    reporter.set(Status::of(LinkState::Connecting));
    loop {
        let opened = {
            let attempt = open(&target, password.as_deref(), &timing, &mut reporter);
            tokio::pin!(attempt);
            // Requests made while connecting fail at once rather than waiting for a
            // connection that may never come.
            loop {
                tokio::select! {
                    result = &mut attempt => break result,
                    pending = requests.recv() => match pending {
                        Some(pending) => { let _ = pending.reply.send(Err(not_connected())); }
                        None => return,
                    },
                }
            }
        };
        let ended = match opened {
            Ok((ws, obs_version)) => {
                reporter.set(Status {
                    obs_version: Some(obs_version),
                    ..Status::of(LinkState::Connected)
                });
                serve(ws, &reporter.sink, &mut requests).await
            }
            Err(ended) => ended,
        };
        let wait = match ended {
            Ended::Stopped => return,
            Ended::NotRunning | Ended::Dropped => {
                reporter.set(Status::of(LinkState::NotRunning));
                timing.retry
            }
            Ended::Refused(refusal, message) => {
                reporter.set(Status::refused(refusal, message));
                timing.refused_retry
            }
        };
        let sleep = tokio::time::sleep(wait);
        tokio::pin!(sleep);
        loop {
            tokio::select! {
                _ = &mut sleep => break,
                pending = requests.recv() => match pending {
                    Some(pending) => { let _ = pending.reply.send(Err(not_connected())); }
                    None => return,
                },
            }
        }
    }
}

/// Connects and identifies. Returns the socket and OBS's version.
async fn open(
    target: &Target,
    password: Option<&str>,
    timing: &Timing,
    reporter: &mut Reporter,
) -> Result<(Ws, String), Ended> {
    let tcp = tokio::time::timeout(
        timing.connect_timeout,
        TcpStream::connect((target.host.as_str(), target.port)),
    )
    .await
    .map_err(|_| Ended::NotRunning)?
    .map_err(|_| Ended::NotRunning)?;
    let _ = tcp.set_nodelay(true);
    // Something answered: from here a refusal is OBS's, and the wait is short.
    if reporter.state() != Some(LinkState::Connected) {
        reporter.set(Status::of(LinkState::Connecting));
    }
    tokio::time::timeout(timing.handshake_timeout, identify(target, tcp, password))
        .await
        .map_err(|_| Ended::NotRunning)?
}

async fn identify(
    target: &Target,
    tcp: TcpStream,
    password: Option<&str>,
) -> Result<(Ws, String), Ended> {
    let (mut ws, _) = client_async(target.url(), tcp).await.map_err(|e| {
        Ended::Refused(
            Refusal::Other,
            Some(format!("not an OBS WebSocket server ({e})")),
        )
    })?;
    let hello = handshake_message(&mut ws).await?;
    if hello["op"] != 0 {
        return Err(Ended::Refused(
            Refusal::Other,
            Some("not an OBS WebSocket server".into()),
        ));
    }
    let obs_version = hello["d"]["obsStudioVersion"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    let mut identify = json!({ "rpcVersion": 1, "eventSubscriptions": EVENT_SUBSCRIPTIONS });
    if let Some(auth) = hello["d"].get("authentication") {
        let password = password
            .filter(|p| !p.is_empty())
            .ok_or(Ended::Refused(Refusal::PasswordRequired, None))?;
        let salt = auth["salt"].as_str().unwrap_or_default();
        let challenge = auth["challenge"].as_str().unwrap_or_default();
        identify["authentication"] = json!(authentication(password, salt, challenge));
    }
    ws.send(Message::Text(
        json!({ "op": 1, "d": identify }).to_string().into(),
    ))
    .await
    .map_err(|_| Ended::NotRunning)?;
    let identified = handshake_message(&mut ws).await?;
    if identified["op"] != 2 {
        return Err(Ended::Refused(
            Refusal::Other,
            Some("unexpected answer from OBS".into()),
        ));
    }
    Ok((ws, obs_version))
}

/// The next message during the handshake; a close says why OBS refused.
async fn handshake_message(ws: &mut Ws) -> Result<Value, Ended> {
    loop {
        match ws.next().await {
            Some(Ok(Message::Text(text))) => {
                return serde_json::from_str(&text).map_err(|_| {
                    Ended::Refused(Refusal::Other, Some("not an OBS WebSocket server".into()))
                })
            }
            Some(Ok(Message::Close(Some(frame)))) => {
                let code = u16::from(frame.code);
                let reason = frame.reason.to_string();
                return Err(match code {
                    CLOSE_AUTHENTICATION_FAILED => Ended::Refused(Refusal::Authentication, None),
                    // Going away: OBS is quitting.
                    1001 => Ended::NotRunning,
                    _ => Ended::Refused(
                        Refusal::Other,
                        Some(if reason.is_empty() {
                            format!("closed with code {code}")
                        } else {
                            reason
                        }),
                    ),
                });
            }
            Some(Ok(Message::Close(None))) | None | Some(Err(_)) => return Err(Ended::NotRunning),
            Some(Ok(_)) => continue,
        }
    }
}

/// Carries requests and events until the connection ends or the link is no longer wanted.
async fn serve(
    ws: Ws,
    sink: &Arc<dyn Sink>,
    requests: &mut mpsc::UnboundedReceiver<Pending>,
) -> Ended {
    let (mut write, mut read) = ws.split();
    let mut waiting: HashMap<String, oneshot::Sender<Result<Value, RequestError>>> = HashMap::new();
    let mut next_id: u64 = 0;
    let ended = loop {
        tokio::select! {
            frame = read.next() => match frame {
                Some(Ok(Message::Text(text))) => {
                    let Ok(message) = serde_json::from_str::<Value>(&text) else { continue };
                    match message["op"].as_u64() {
                        Some(5) => {
                            let event_type = message["d"]["eventType"].as_str().unwrap_or_default();
                            sink.event(event_type, &message["d"]["eventData"]);
                        }
                        Some(7) => {
                            let id = message["d"]["requestId"].as_str().unwrap_or_default();
                            if let Some(reply) = waiting.remove(id) {
                                let status = &message["d"]["requestStatus"];
                                let result = if status["result"] == true {
                                    Ok(message["d"]
                                        .get("responseData")
                                        .cloned()
                                        .unwrap_or(Value::Null))
                                } else {
                                    Err(RequestError {
                                        code: status["code"].as_i64().unwrap_or(0),
                                        comment: status["comment"].as_str().map(String::from),
                                    })
                                };
                                let _ = reply.send(result);
                            }
                        }
                        _ => {}
                    }
                }
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break Ended::Dropped,
                Some(Ok(_)) => {}
            },
            pending = requests.recv() => match pending {
                Some(pending) => {
                    next_id += 1;
                    let id = next_id.to_string();
                    let frame = json!({
                        "op": 6,
                        "d": {
                            "requestType": pending.request_type,
                            "requestId": id,
                            "requestData": pending.data,
                        },
                    });
                    if write.send(Message::Text(frame.to_string().into())).await.is_err() {
                        let _ = pending.reply.send(Err(not_connected()));
                        break Ended::Dropped;
                    }
                    waiting.insert(id, pending.reply);
                }
                None => {
                    let _ = write.send(Message::Close(None)).await;
                    break Ended::Stopped;
                }
            },
        }
    };
    for (_, reply) in waiting.drain() {
        let _ = reply.send(Err(not_connected()));
    }
    ended
}

// ── OBS's own settings (decision O12) ──────────────────────────────────────

/// obs-websocket's settings, from its `config.json` on this computer.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all(serialize = "camelCase"))]
pub struct ObsConfig {
    #[serde(default)]
    pub server_enabled: bool,
    #[serde(default = "default_port")]
    pub server_port: u16,
    #[serde(default)]
    pub auth_required: bool,
    #[serde(default)]
    pub server_password: String,
}

fn default_port() -> u16 {
    DEFAULT_PORT
}

/// Reads the file's contents; anything unreadable is treated as no file.
pub fn parse_config(text: &str) -> Option<ObsConfig> {
    serde_json::from_str(text).ok()
}

/// Where obs-websocket keeps its settings, as found on OBS 33 (`docs/spikes/obs.md`).
fn config_path() -> Option<PathBuf> {
    let base = if cfg!(target_os = "windows") {
        PathBuf::from(std::env::var_os("APPDATA")?)
    } else if cfg!(target_os = "macos") {
        PathBuf::from(std::env::var_os("HOME")?).join("Library/Application Support")
    } else {
        PathBuf::from(std::env::var_os("HOME")?).join(".config")
    };
    Some(base.join("obs-studio/plugin_config/obs-websocket/config.json"))
}

// ── Tauri ──────────────────────────────────────────────────────────────────

struct Running {
    requests: mpsc::UnboundedSender<Pending>,
    task: tauri::async_runtime::JoinHandle<()>,
}

struct Inner {
    /// Counts connections, so a stopped one can no longer report.
    generation: u64,
    running: Option<Running>,
    status: Status,
}

pub struct Obs {
    app: AppHandle,
    inner: Arc<Mutex<Inner>>,
}

/// Emits to the interface, while its connection is the current one.
struct AppSink {
    app: AppHandle,
    inner: Arc<Mutex<Inner>>,
    generation: u64,
}

impl Sink for AppSink {
    fn status(&self, status: &Status) {
        let mut inner = self.inner.lock().unwrap();
        if inner.generation != self.generation {
            return;
        }
        inner.status = status.clone();
        drop(inner);
        let _ = self.app.emit("obs-status", status);
    }

    fn event(&self, event_type: &str, data: &Value) {
        if self.inner.lock().unwrap().generation != self.generation {
            return;
        }
        let _ = self.app.emit(
            "obs-event",
            json!({ "eventType": event_type, "eventData": data }),
        );
    }
}

impl Obs {
    pub fn new(app: AppHandle) -> Self {
        Obs {
            app,
            inner: Arc::new(Mutex::new(Inner {
                generation: 0,
                running: None,
                status: Status::of(LinkState::Off),
            })),
        }
    }

    /// Ends the connection; the interface loading again starts it afresh if it wants it.
    pub fn reset(&self) {
        self.stop();
    }

    fn stop(&self) {
        let mut inner = self.inner.lock().unwrap();
        inner.generation += 1;
        if let Some(running) = inner.running.take() {
            running.task.abort();
        }
        inner.status = Status::of(LinkState::Off);
    }
}

#[tauri::command]
pub fn obs_connect(
    obs: State<'_, Obs>,
    address: String,
    password: Option<String>,
) -> Result<(), String> {
    let target = parse_address(&address)?;
    obs.stop();
    let mut inner = obs.inner.lock().unwrap();
    let sink = Arc::new(AppSink {
        app: obs.app.clone(),
        inner: obs.inner.clone(),
        generation: inner.generation,
    });
    let (requests, task) = connection(target, password, sink, Timing::default());
    let task = tauri::async_runtime::spawn(task);
    inner.running = Some(Running { requests, task });
    Ok(())
}

#[tauri::command]
pub fn obs_disconnect(obs: State<'_, Obs>) {
    obs.stop();
    let _ = obs.app.emit("obs-status", Status::of(LinkState::Off));
}

#[tauri::command]
pub async fn obs_request(
    obs: State<'_, Obs>,
    request_type: String,
    request_data: Option<Value>,
) -> Result<Value, RequestError> {
    let requests = obs
        .inner
        .lock()
        .unwrap()
        .running
        .as_ref()
        .map(|running| running.requests.clone())
        .ok_or_else(not_connected)?;
    request(
        &requests,
        &request_type,
        request_data.unwrap_or(Value::Null),
        Timing::default().request_timeout,
    )
    .await
}

#[tauri::command]
pub fn obs_status(obs: State<'_, Obs>) -> Status {
    obs.inner.lock().unwrap().status.clone()
}

/// obs-websocket's settings on this computer, or nothing when they cannot be read.
#[tauri::command]
pub fn obs_read_config() -> Option<ObsConfig> {
    parse_config(&std::fs::read_to_string(config_path()?).ok()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::net::TcpListener;
    use tokio_tungstenite::accept_async;
    use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
    use tokio_tungstenite::tungstenite::protocol::CloseFrame;

    const SALT: &str = "lM1GncleQOaCu9lT1yeUZhFYnqhsLLP1G5lAGo3ixaI=";
    const CHALLENGE: &str = "+IxH4CnCiqpX1rM9scsNynZzbOe4KhDeYcTNS3PDaeY=";

    #[derive(Debug, Clone, PartialEq)]
    enum Note {
        Status(Status),
        Event(String, Value),
    }

    struct TestSink(mpsc::UnboundedSender<Note>);

    impl Sink for TestSink {
        fn status(&self, status: &Status) {
            let _ = self.0.send(Note::Status(status.clone()));
        }
        fn event(&self, event_type: &str, data: &Value) {
            let _ = self.0.send(Note::Event(event_type.into(), data.clone()));
        }
    }

    fn fast() -> Timing {
        Timing {
            retry: Duration::from_millis(40),
            refused_retry: Duration::from_millis(80),
            connect_timeout: Duration::from_millis(500),
            handshake_timeout: Duration::from_millis(500),
            request_timeout: Duration::from_millis(500),
        }
    }

    struct Client {
        requests: mpsc::UnboundedSender<Pending>,
        notes: mpsc::UnboundedReceiver<Note>,
        task: tokio::task::JoinHandle<()>,
    }

    fn start(port: u16, password: Option<&str>) -> Client {
        let (tx, notes) = mpsc::unbounded_channel();
        let target = Target {
            host: "127.0.0.1".into(),
            port,
        };
        let (requests, task) = connection(
            target,
            password.map(String::from),
            Arc::new(TestSink(tx)),
            fast(),
        );
        Client {
            requests,
            notes,
            task: tokio::spawn(task),
        }
    }

    impl Client {
        /// Waits for a status in the given state; returns every note seen on the way.
        async fn until(&mut self, state: LinkState) -> Vec<Note> {
            let mut seen = vec![];
            tokio::time::timeout(Duration::from_secs(5), async {
                while let Some(note) = self.notes.recv().await {
                    seen.push(note.clone());
                    if matches!(&note, Note::Status(s) if s.state == state) {
                        return;
                    }
                }
            })
            .await
            .unwrap_or_else(|_| panic!("no {state:?} status; saw {seen:?}"));
            seen
        }

        async fn next_event(&mut self) -> (String, Value) {
            tokio::time::timeout(Duration::from_secs(5), async {
                loop {
                    if let Some(Note::Event(kind, data)) = self.notes.recv().await {
                        return (kind, data);
                    }
                }
            })
            .await
            .expect("no event")
        }

        async fn ask(&self, kind: &str, data: Value) -> Result<Value, RequestError> {
            request(&self.requests, kind, data, Duration::from_secs(2)).await
        }
    }

    /// A free port with nothing listening on it.
    async fn free_port() -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        listener.local_addr().unwrap().port()
    }

    async fn send_json(ws: &mut WebSocketStream<TcpStream>, value: Value) {
        ws.send(Message::Text(value.to_string().into()))
            .await
            .unwrap();
    }

    async fn recv_json(ws: &mut WebSocketStream<TcpStream>) -> Option<Value> {
        loop {
            match ws.next().await? {
                Ok(Message::Text(text)) => return serde_json::from_str(&text).ok(),
                Ok(Message::Close(_)) | Err(_) => return None,
                Ok(_) => continue,
            }
        }
    }

    fn hello(auth: bool) -> Value {
        let mut d = json!({ "obsStudioVersion": "33.0.1", "obsWebSocketVersion": "5.7.6", "rpcVersion": 1 });
        if auth {
            d["authentication"] = json!({ "salt": SALT, "challenge": CHALLENGE });
        }
        json!({ "op": 0, "d": d })
    }

    /// How a fake OBS answers one connection.
    #[derive(Clone)]
    struct FakeObs {
        password: Option<&'static str>,
        /// Answers to requests by type: Ok(data) or Err(code).
        answers: HashMap<&'static str, Result<Value, i64>>,
        /// Requests left unanswered.
        silent: Vec<&'static str>,
        /// Sent after identifying.
        events: Vec<Value>,
    }

    impl FakeObs {
        fn new(password: Option<&'static str>) -> Self {
            FakeObs {
                password,
                answers: HashMap::new(),
                silent: vec![],
                events: vec![],
            }
        }

        /// Serves one connection; returns the identify message, or None if refused.
        async fn serve(&self, stream: TcpStream, seen: mpsc::UnboundedSender<Value>) {
            let mut ws = accept_async(stream).await.unwrap();
            send_json(&mut ws, hello(self.password.is_some())).await;
            let Some(identify) = recv_json(&mut ws).await else {
                return;
            };
            let _ = seen.send(identify.clone());
            if let Some(password) = self.password {
                let expected = authentication(password, SALT, CHALLENGE);
                if identify["d"]["authentication"] != json!(expected) {
                    let _ = ws
                        .close(Some(CloseFrame {
                            code: CloseCode::Library(4009),
                            reason: "Authentication failed.".into(),
                        }))
                        .await;
                    return;
                }
            }
            send_json(
                &mut ws,
                json!({ "op": 2, "d": { "negotiatedRpcVersion": 1 } }),
            )
            .await;
            for event in &self.events {
                send_json(&mut ws, json!({ "op": 5, "d": event })).await;
            }
            while let Some(message) = recv_json(&mut ws).await {
                let _ = seen.send(message.clone());
                let kind = message["d"]["requestType"].as_str().unwrap_or_default();
                if self.silent.contains(&kind) {
                    continue;
                }
                let id = message["d"]["requestId"].clone();
                let reply = match self.answers.get(kind) {
                    Some(Ok(data)) => json!({ "op": 7, "d": {
                        "requestType": kind, "requestId": id,
                        "requestStatus": { "result": true, "code": 100 },
                        "responseData": data } }),
                    Some(Err(code)) => json!({ "op": 7, "d": {
                        "requestType": kind, "requestId": id,
                        "requestStatus": { "result": false, "code": code, "comment": "refused" } } }),
                    None => json!({ "op": 7, "d": {
                        "requestType": kind, "requestId": id,
                        "requestStatus": { "result": true, "code": 100 } } }),
                };
                send_json(&mut ws, reply).await;
            }
        }
    }

    /// Listens on `port` and serves every connection as `fake` does.
    async fn listen(
        port: u16,
        fake: FakeObs,
    ) -> (tokio::task::JoinHandle<()>, mpsc::UnboundedReceiver<Value>) {
        let listener = TcpListener::bind(("127.0.0.1", port)).await.unwrap();
        let (tx, rx) = mpsc::unbounded_channel();
        let task = tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                let fake = fake.clone();
                let tx = tx.clone();
                tokio::spawn(async move { fake.serve(stream, tx).await });
            }
        });
        (task, rx)
    }

    /// Against the OBS running on this computer, with its own settings; run by hand with
    /// `cargo test --lib obs::tests::against_the_obs_on_this_computer -- --ignored --nocapture`.
    #[tokio::test]
    #[ignore]
    async fn against_the_obs_on_this_computer() {
        let config = obs_read_config().expect("obs-websocket's config.json is not readable");
        assert!(
            config.server_enabled,
            "OBS's WebSocket server is turned off"
        );
        let password = config.auth_required.then(|| config.server_password.clone());
        let mut client = start(config.server_port, password.as_deref());
        let notes = client.until(LinkState::Connected).await;
        println!("statuses: {notes:?}");
        let version = client.ask("GetVersion", Value::Null).await.unwrap();
        println!(
            "OBS {} / obs-websocket {}",
            version["obsVersion"], version["obsWebSocketVersion"]
        );
        let scenes = client.ask("GetSceneList", Value::Null).await.unwrap();
        let current = scenes["currentProgramSceneName"]
            .as_str()
            .unwrap()
            .to_string();
        println!("program: {current}; scenes: {}", scenes["scenes"]);
        for kind in ["GetStreamStatus", "GetRecordStatus", "GetVirtualCamStatus"] {
            println!("{kind}: {}", client.ask(kind, Value::Null).await.unwrap());
        }
        let shot = client
            .ask(
                "GetSourceScreenshot",
                json!({ "sourceName": current, "imageFormat": "webp", "imageWidth": 320, "imageCompressionQuality": 50 }),
            )
            .await
            .unwrap();
        let image = shot["imageData"].as_str().unwrap();
        println!("screenshot: {} bytes, {}", image.len(), &image[..30]);
        assert!(image.starts_with("data:image/webp;base64,"));
        // Asking for the scene already on program changes nothing and succeeds.
        assert!(client
            .ask("SetCurrentProgramScene", json!({ "sceneName": current }))
            .await
            .is_ok());
        assert_eq!(
            client
                .ask("SetInputSettings", json!({}))
                .await
                .unwrap_err()
                .code,
            NOT_ALLOWED
        );
        client.task.abort();
    }

    #[test]
    fn computes_the_authentication_string_of_the_protocol_document() {
        // The example in obs-websocket's protocol document, checked independently.
        assert_eq!(
            authentication("supersecretpassword", SALT, CHALLENGE),
            "1Ct943GAT+6YQUUX47Ia/ncufilbe6+oD6lY+5kaCu4="
        );
    }

    #[test]
    fn reads_addresses_as_typed() {
        let t = |host: &str, port| {
            Ok(Target {
                host: host.into(),
                port,
            })
        };
        assert_eq!(parse_address(""), t("127.0.0.1", 4455));
        assert_eq!(parse_address("localhost:4455"), t("127.0.0.1", 4455));
        assert_eq!(parse_address("LocalHost"), t("127.0.0.1", 4455));
        assert_eq!(
            parse_address(" ws://studio.local:4460/ "),
            t("studio.local", 4460)
        );
        assert_eq!(parse_address("192.168.1.20"), t("192.168.1.20", 4455));
        assert_eq!(parse_address("[::1]:4456"), t("::1", 4456));
        assert_eq!(parse_address("::1"), t("::1", 4455));
        assert!(parse_address("host:notaport").is_err());
        assert!(parse_address("host:0").is_err());
        assert!(parse_address("host:70000").is_err());
        assert!(parse_address("bad host").is_err());
        assert!(parse_address("evil/../path").is_err());
        assert_eq!(
            Target {
                host: "::1".into(),
                port: 1
            }
            .url(),
            "ws://[::1]:1"
        );
    }

    #[test]
    fn reads_obs_websocket_settings_and_tolerates_missing_keys() {
        let full = r#"{"alerts_enabled":false,"auth_required":true,"first_load":false,
            "server_enabled":false,"server_password":"abc","server_port":4460}"#;
        assert_eq!(
            parse_config(full),
            Some(ObsConfig {
                server_enabled: false,
                server_port: 4460,
                auth_required: true,
                server_password: "abc".into(),
            })
        );
        assert_eq!(parse_config("{}").unwrap().server_port, 4455);
        assert_eq!(parse_config("not json"), None);
        let shown = serde_json::to_value(parse_config(full).unwrap()).unwrap();
        assert_eq!(shown["serverPassword"], "abc");
        assert_eq!(shown["authRequired"], true);
    }

    #[tokio::test]
    async fn authenticates_then_carries_requests_and_events_both_ways() {
        let port = free_port().await;
        let mut fake = FakeObs::new(Some("secret"));
        fake.answers.insert(
            "GetSceneList",
            Ok(json!({ "currentProgramSceneName": "Lyrics", "scenes": [] })),
        );
        fake.events.push(json!({
            "eventType": "CurrentProgramSceneChanged",
            "eventData": { "sceneName": "Camera" },
        }));
        let (_server, mut seen) = listen(port, fake).await;
        let mut client = start(port, Some("secret"));

        let notes = client.until(LinkState::Connected).await;
        assert_eq!(notes[0], Note::Status(Status::of(LinkState::Connecting)));
        let connected = notes.iter().rev().find_map(|n| match n {
            Note::Status(s) => Some(s.clone()),
            _ => None,
        });
        assert_eq!(connected.unwrap().obs_version.as_deref(), Some("33.0.1"));
        let identify = seen.recv().await.unwrap();
        assert_eq!(identify["d"]["eventSubscriptions"], 1095);
        assert_eq!(identify["d"]["rpcVersion"], 1);

        let (kind, data) = client.next_event().await;
        assert_eq!(kind, "CurrentProgramSceneChanged");
        assert_eq!(data["sceneName"], "Camera");

        let scenes = client.ask("GetSceneList", Value::Null).await.unwrap();
        assert_eq!(scenes["currentProgramSceneName"], "Lyrics");
        // A request without response data answers null.
        assert_eq!(
            client
                .ask("SetCurrentProgramScene", json!({ "sceneName": "Camera" }))
                .await,
            Ok(Value::Null)
        );
        let set = loop {
            let message = seen.recv().await.unwrap();
            if message["d"]["requestType"] == "SetCurrentProgramScene" {
                break message;
            }
        };
        assert_eq!(set["d"]["requestData"]["sceneName"], "Camera");
        client.task.abort();
    }

    #[tokio::test]
    async fn sends_no_authentication_when_obs_asks_for_none() {
        let port = free_port().await;
        let (_server, mut seen) = listen(port, FakeObs::new(None)).await;
        // A stored password is harmless when the operator later turns authentication off.
        let mut client = start(port, Some("left over"));
        client.until(LinkState::Connected).await;
        let identify = seen.recv().await.unwrap();
        assert!(identify["d"].get("authentication").is_none());
        client.task.abort();
    }

    #[tokio::test]
    async fn keeps_trying_until_obs_starts_and_reports_not_running_meanwhile() {
        let port = free_port().await;
        let mut client = start(port, None);
        let first = client.until(LinkState::NotRunning).await;
        assert_eq!(first[0], Note::Status(Status::of(LinkState::Connecting)));
        // Failed attempts do not flicker through Connecting.
        tokio::time::sleep(Duration::from_millis(150)).await;
        if let Ok(note) = client.notes.try_recv() {
            panic!("status changed while OBS was still not running: {note:?}");
        }
        // OBS opens after Worship Q.
        let (_server, _seen) = listen(port, FakeObs::new(None)).await;
        client.until(LinkState::Connected).await;
        client.task.abort();
    }

    #[tokio::test]
    async fn reports_a_wrong_password_as_refused_and_keeps_trying_slowly() {
        let port = free_port().await;
        let (_server, mut seen) = listen(port, FakeObs::new(Some("right"))).await;
        let mut client = start(port, Some("wrong"));
        let notes = client.until(LinkState::Refused).await;
        let refused = notes.last().unwrap();
        assert_eq!(
            refused,
            &Note::Status(Status::refused(Refusal::Authentication, None))
        );
        seen.recv().await.unwrap();
        // It tries again, and is refused again without the status changing.
        tokio::time::timeout(Duration::from_secs(2), seen.recv())
            .await
            .expect("no second attempt")
            .unwrap();
        client.task.abort();
    }

    #[tokio::test]
    async fn says_a_password_is_needed_without_sending_a_wrong_one() {
        let port = free_port().await;
        let (_server, mut seen) = listen(port, FakeObs::new(Some("right"))).await;
        let mut client = start(port, Some(""));
        let notes = client.until(LinkState::Refused).await;
        assert_eq!(
            notes.last().unwrap(),
            &Note::Status(Status::refused(Refusal::PasswordRequired, None))
        );
        assert!(seen.try_recv().is_err(), "an identify was sent");
        client.task.abort();
    }

    #[tokio::test]
    async fn passes_on_obs_refusing_a_request() {
        let port = free_port().await;
        let mut fake = FakeObs::new(None);
        fake.answers.insert("StartStream", Err(500));
        let (_server, _seen) = listen(port, fake).await;
        let mut client = start(port, None);
        client.until(LinkState::Connected).await;
        assert_eq!(
            client.ask("StartStream", Value::Null).await,
            Err(RequestError {
                code: 500,
                comment: Some("refused".into())
            })
        );
        client.task.abort();
    }

    #[tokio::test]
    async fn refuses_requests_outside_the_allowed_set_without_sending_them() {
        let port = free_port().await;
        let (_server, mut seen) = listen(port, FakeObs::new(None)).await;
        let mut client = start(port, None);
        client.until(LinkState::Connected).await;
        seen.recv().await.unwrap();
        let refused = client.ask("SetInputSettings", json!({})).await;
        assert_eq!(refused.unwrap_err().code, NOT_ALLOWED);
        assert!(seen.try_recv().is_err());
        client.task.abort();
    }

    #[tokio::test]
    async fn fails_requests_at_once_while_not_connected() {
        let port = free_port().await;
        let mut client = start(port, None);
        client.until(LinkState::NotRunning).await;
        let started = std::time::Instant::now();
        let result = client.ask("GetSceneList", Value::Null).await;
        assert_eq!(result.unwrap_err().code, NOT_CONNECTED);
        assert!(started.elapsed() < Duration::from_millis(500));
        client.task.abort();
    }

    #[tokio::test]
    async fn times_out_a_request_obs_never_answers() {
        let port = free_port().await;
        let mut fake = FakeObs::new(None);
        fake.silent.push("GetStreamStatus");
        let (_server, _seen) = listen(port, fake).await;
        let mut client = start(port, None);
        client.until(LinkState::Connected).await;
        let result = request(
            &client.requests,
            "GetStreamStatus",
            Value::Null,
            Duration::from_millis(100),
        )
        .await;
        assert_eq!(result.unwrap_err().code, TIMED_OUT);
        // The connection is still good for the next request.
        assert!(client.ask("GetSceneList", Value::Null).await.is_ok());
        client.task.abort();
    }

    #[tokio::test]
    async fn fails_waiting_requests_when_obs_quits_then_reconnects_when_it_is_back() {
        let port = free_port().await;
        let listener = TcpListener::bind(("127.0.0.1", port)).await.unwrap();
        let mut client = start(port, None);
        // OBS accepts, then quits while a request is waiting: ExitStarted, then 1001.
        let (stream, _) = listener.accept().await.unwrap();
        let mut ws = accept_async(stream).await.unwrap();
        send_json(&mut ws, hello(false)).await;
        recv_json(&mut ws).await.unwrap();
        send_json(
            &mut ws,
            json!({ "op": 2, "d": { "negotiatedRpcVersion": 1 } }),
        )
        .await;
        client.until(LinkState::Connected).await;
        let requests = client.requests.clone();
        let waiting = tokio::spawn(async move {
            request(
                &requests,
                "GetSceneList",
                Value::Null,
                Duration::from_secs(5),
            )
            .await
        });
        recv_json(&mut ws).await.unwrap();
        send_json(
            &mut ws,
            json!({ "op": 5, "d": { "eventType": "ExitStarted", "eventData": null } }),
        )
        .await;
        let _ = ws
            .close(Some(CloseFrame {
                code: CloseCode::Away,
                reason: "Server stopping.".into(),
            }))
            .await;
        drop(ws);
        assert_eq!(client.next_event().await.0, "ExitStarted");
        client.until(LinkState::NotRunning).await;
        assert_eq!(waiting.await.unwrap().unwrap_err().code, NOT_CONNECTED);

        // OBS is opened again: the same client connects without being told.
        drop(listener);
        let (_server, _seen) = listen(port, FakeObs::new(None)).await;
        client.until(LinkState::Connected).await;
        client.task.abort();
    }

    #[tokio::test]
    async fn treats_another_program_on_the_port_as_refused() {
        let port = free_port().await;
        let listener = TcpListener::bind(("127.0.0.1", port)).await.unwrap();
        tokio::spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                use tokio::io::AsyncWriteExt;
                let _ = stream
                    .write_all(b"HTTP/1.1 404 Not Found\r\ncontent-length: 0\r\n\r\n")
                    .await;
            }
        });
        let mut client = start(port, None);
        let notes = client.until(LinkState::Refused).await;
        match notes.last().unwrap() {
            Note::Status(status) => assert_eq!(status.refusal, Some(Refusal::Other)),
            other => panic!("{other:?}"),
        }
        client.task.abort();
    }

    #[tokio::test]
    async fn stops_when_the_link_is_no_longer_wanted() {
        let port = free_port().await;
        let (_server, _seen) = listen(port, FakeObs::new(None)).await;
        let Client {
            requests,
            mut notes,
            task,
        } = start(port, None);
        loop {
            if let Some(Note::Status(s)) = notes.recv().await {
                if s.state == LinkState::Connected {
                    break;
                }
            }
        }
        drop(requests);
        tokio::time::timeout(Duration::from_secs(2), task)
            .await
            .expect("the connection did not end")
            .unwrap();
    }
}
