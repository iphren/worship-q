//! Connections on the venue network (plan M5; decisions D19, D20).
//!
//! The coordinator serves the live-state protocol over TLS WebSockets on a fixed port, with a
//! self-signed certificate made once per workspace folder. Other devices learn its
//! fingerprint through the church server or an invitation and check it before speaking, so
//! another device on the venue network can neither read the traffic nor pose as the
//! coordinator. Each connection then proves itself: a desktop with its device token, which
//! is checked against the workspace's device list cached from the server; a phone with its
//! grant, which the interface checks as it does through the relay.
//!
//! The native side only moves bytes and checks credentials. Who is coordinator and what the
//! messages mean is decided by the interface, which runs the same relay logic as the church
//! server over these connections.

use crate::db::AppData;
use futures_util::{SinkExt, StreamExt};
use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::{ring, CryptoProvider};
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer, ServerName, UnixTime};
use rustls::{ClientConfig, DigitallySignedStruct, ServerConfig, SignatureScheme};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::net::{IpAddr, SocketAddr};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State, Wry};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio_rustls::{TlsAcceptor, TlsConnector};
use tokio_tungstenite::tungstenite::Message;

/// Next to the overlay port; it never changes, so firewall rules stay valid.
pub const LAN_PORT: u16 = 47_311;
const SERVICE_TYPE: &str = "_worship-q._tcp.local.";
const CERT_FILE: &str = "lan-cert.der";
const KEY_FILE: &str = "lan-key.der";
/// The name the certificate is made for and the client expects; it is pinned, not resolved.
const CERT_NAME: &str = "worship-q.local";
/// A connection that has not proved itself in this time is closed.
const AUTH_TIMEOUT: Duration = Duration::from_secs(10);

fn err(e: impl ToString) -> String {
    e.to_string()
}

/// Lowercase SHA-256 hex of a secret, as the church server stores device tokens.
pub fn sha256_hex(value: &str) -> String {
    let digest = Sha256::digest(value.as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// The certificate's fingerprint as shown and compared: SHA-256 of the DER, colon-separated.
fn fingerprint_of(cert: &[u8]) -> String {
    let digest = Sha256::digest(cert);
    digest
        .iter()
        .map(|b| format!("{b:02X}"))
        .collect::<Vec<_>>()
        .join(":")
}

struct Identity {
    cert: CertificateDer<'static>,
    key: PrivateKeyDer<'static>,
    fingerprint: String,
}

/// Loads the workspace folder's certificate, making one the first time (plan M5.1).
fn load_identity(dir: &std::path::Path) -> Result<Identity, String> {
    let cert_path = dir.join(CERT_FILE);
    let key_path = dir.join(KEY_FILE);
    let (cert, key) = match (fs::read(&cert_path), fs::read(&key_path)) {
        (Ok(cert), Ok(key)) if !cert.is_empty() && !key.is_empty() => (cert, key),
        _ => {
            let generated =
                rcgen::generate_simple_self_signed(vec![CERT_NAME.to_string()]).map_err(err)?;
            let cert = generated.cert.der().to_vec();
            let key = generated.key_pair.serialize_der();
            fs::write(&cert_path, &cert).map_err(err)?;
            fs::write(&key_path, &key).map_err(err)?;
            (cert, key)
        }
    };
    let fingerprint = fingerprint_of(&cert);
    Ok(Identity {
        cert: CertificateDer::from(cert),
        key: PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(key)),
        fingerprint,
    })
}

fn provider() -> Arc<CryptoProvider> {
    Arc::new(ring::default_provider())
}

/// Accepts exactly the certificate whose fingerprint was given, whatever it says about itself.
#[derive(Debug)]
struct Pinned {
    fingerprint: String,
    provider: Arc<CryptoProvider>,
}

impl ServerCertVerifier for Pinned {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        if fingerprint_of(end_entity).eq_ignore_ascii_case(&self.fingerprint) {
            Ok(ServerCertVerified::assertion())
        } else {
            Err(rustls::Error::General(
                "certificate fingerprint mismatch".into(),
            ))
        }
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider
            .signature_verification_algorithms
            .supported_schemes()
    }
}

/// A desktop the coordinator accepts on the LAN, from the workspace's device list.
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Credential {
    token_hash: String,
    device_id: String,
    name: String,
}

#[derive(Default)]
struct Inner {
    identity: Option<Identity>,
    credentials: HashMap<String, Credential>,
    /// Open connections, accepted or made, by identifier: what to send to each.
    connections: HashMap<String, mpsc::UnboundedSender<Option<String>>>,
    server: Option<tauri::async_runtime::JoinHandle<()>>,
    daemon: Option<ServiceDaemon>,
    advertised: Option<String>,
    error: Option<String>,
}

pub struct Lan {
    app: AppHandle<Wry>,
    inner: Arc<Mutex<Inner>>,
    counter: AtomicU64,
}

impl Lan {
    pub fn new(app: AppHandle<Wry>) -> Self {
        Self {
            app,
            inner: Arc::new(Mutex::new(Inner::default())),
            counter: AtomicU64::new(1),
        }
    }

    fn next_id(&self, prefix: &str) -> String {
        format!("{prefix}-{}", self.counter.fetch_add(1, Ordering::Relaxed))
    }

    fn identity(&self, data: &AppData) -> Result<String, String> {
        let mut inner = self.inner.lock().map_err(err)?;
        if inner.identity.is_none() {
            inner.identity = Some(load_identity(&data.dir)?);
        }
        Ok(inner.identity.as_ref().unwrap().fingerprint.clone())
    }

    fn daemon(inner: &mut Inner) -> Result<ServiceDaemon, String> {
        if inner.daemon.is_none() {
            inner.daemon = Some(ServiceDaemon::new().map_err(err)?);
        }
        Ok(inner.daemon.as_ref().unwrap().clone())
    }
}

/// This computer's IPv4 addresses on its networks, for invitations and the server.
fn local_addresses() -> Vec<String> {
    if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|interface| match interface.ip() {
            IpAddr::V4(ip) if !ip.is_loopback() && !ip.is_link_local() => Some(ip.to_string()),
            _ => None,
        })
        .collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanStatus {
    fingerprint: String,
    port: u16,
    addresses: Vec<String>,
    serving: bool,
    error: Option<String>,
}

/// This computer's certificate fingerprint, addresses and port, making the certificate if
/// needed (plan M5.1, M5.2).
#[tauri::command(async)]
pub fn lan_status(lan: State<'_, Lan>, data: State<'_, AppData>) -> Result<LanStatus, String> {
    let fingerprint = lan.identity(&data)?;
    let inner = lan.inner.lock().map_err(err)?;
    Ok(LanStatus {
        fingerprint,
        port: LAN_PORT,
        addresses: local_addresses(),
        serving: inner.server.is_some(),
        error: inner.error.clone(),
    })
}

/// The desktops accepted on the LAN, by token hash (plan M5.3).
#[tauri::command]
pub fn lan_set_credentials(
    lan: State<'_, Lan>,
    credentials: Vec<Credential>,
) -> Result<(), String> {
    let mut inner = lan.inner.lock().map_err(err)?;
    inner.credentials = credentials
        .into_iter()
        .map(|c| (c.token_hash.to_ascii_lowercase(), c))
        .collect();
    Ok(())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase", tag = "kind")]
enum Opened {
    /// Another desktop of the workspace, proved by its device token.
    Desktop {
        id: String,
        device_id: String,
        name: String,
        hello: Value,
    },
    /// A phone or browser; the interface checks its invitation or grant.
    Remote { id: String, hello: Value },
}

/// Starts serving the live-state protocol over TLS on the LAN port (plan M5.3).
#[tauri::command(async)]
pub fn lan_serve(lan: State<'_, Lan>, data: State<'_, AppData>) -> Result<(), String> {
    lan.identity(&data)?;
    let mut inner = lan.inner.lock().map_err(err)?;
    if inner.server.is_some() {
        return Ok(());
    }
    let identity = inner.identity.as_ref().unwrap();
    let config = ServerConfig::builder_with_provider(provider())
        .with_safe_default_protocol_versions()
        .map_err(err)?
        .with_no_client_auth()
        .with_single_cert(vec![identity.cert.clone()], identity.key.clone_key())
        .map_err(err)?;
    let acceptor = TlsAcceptor::from(Arc::new(config));
    let app = lan.app.clone();
    let shared = lan.inner.clone();
    let counter = Arc::new(AtomicU64::new(1));
    inner.error = None;
    inner.server = Some(tauri::async_runtime::spawn(async move {
        let listener = match TcpListener::bind(("0.0.0.0", LAN_PORT)).await {
            Ok(listener) => listener,
            Err(e) => {
                if let Ok(mut inner) = shared.lock() {
                    inner.error = Some(e.to_string());
                    inner.server = None;
                }
                return;
            }
        };
        loop {
            let Ok((tcp, _)) = listener.accept().await else {
                continue;
            };
            let acceptor = acceptor.clone();
            let app = app.clone();
            let shared = shared.clone();
            let id = format!("lan-in-{}", counter.fetch_add(1, Ordering::Relaxed));
            tauri::async_runtime::spawn(async move {
                let Ok(tls) = acceptor.accept(tcp).await else {
                    return;
                };
                let Ok(ws) = tokio_tungstenite::accept_async(tls).await else {
                    return;
                };
                serve_connection(app, shared, id, ws).await;
            });
        }
    }));
    Ok(())
}

/// Stops serving; open connections end.
#[tauri::command]
pub fn lan_stop_serving(lan: State<'_, Lan>) -> Result<(), String> {
    let mut inner = lan.inner.lock().map_err(err)?;
    if let Some(server) = inner.server.take() {
        server.abort();
    }
    for (id, sender) in inner.connections.drain() {
        if id.starts_with("lan-in-") {
            let _ = sender.send(None);
        }
    }
    Ok(())
}

type Ws<S> = tokio_tungstenite::WebSocketStream<S>;

/// One accepted connection: proves itself first, then every message goes to the interface,
/// and everything the interface sends comes back out (plan M5.3; spec criterion 32).
async fn serve_connection<S>(app: AppHandle<Wry>, shared: Arc<Mutex<Inner>>, id: String, ws: Ws<S>)
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    let (mut sink, mut stream) = ws.split();
    let first = tokio::time::timeout(AUTH_TIMEOUT, stream.next()).await;
    let Ok(Some(Ok(Message::Text(first)))) = first else {
        let _ = sink.close().await;
        return;
    };
    let Ok(message) = serde_json::from_str::<Value>(&first) else {
        let _ = sink.close().await;
        return;
    };
    let opened = if let Some(token) = message.get("token").and_then(Value::as_str) {
        let credential = shared
            .lock()
            .ok()
            .and_then(|inner| inner.credentials.get(&sha256_hex(token)).cloned());
        let Some(credential) = credential else {
            let _ = sink
                .send(Message::Text(
                    r#"{"type":"rejected","reason":"unauthorized"}"#.into(),
                ))
                .await;
            let _ = sink.close().await;
            return;
        };
        let mut hello = message.clone();
        // The token itself never reaches the interface.
        if let Some(object) = hello.as_object_mut() {
            object.remove("token");
        }
        Opened::Desktop {
            id: id.clone(),
            device_id: credential.device_id,
            name: credential.name,
            hello,
        }
    } else if message.get("type").and_then(Value::as_str) == Some("hello") {
        Opened::Remote {
            id: id.clone(),
            hello: message,
        }
    } else {
        let _ = sink.close().await;
        return;
    };
    let (tx, mut rx) = mpsc::unbounded_channel::<Option<String>>();
    if let Ok(mut inner) = shared.lock() {
        inner.connections.insert(id.clone(), tx);
    }
    let _ = app.emit("lan-open", opened);
    loop {
        tokio::select! {
            incoming = stream.next() => match incoming {
                Some(Ok(Message::Text(text))) => {
                    let _ = app.emit("lan-message", LanMessage { id: id.clone(), data: text.to_string() });
                }
                Some(Ok(Message::Ping(payload))) => { let _ = sink.send(Message::Pong(payload)).await; }
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                _ => {}
            },
            outgoing = rx.recv() => match outgoing {
                Some(Some(text)) => { if sink.send(Message::Text(text.into())).await.is_err() { break; } }
                Some(None) | None => break,
            },
        }
    }
    let _ = sink.close().await;
    if let Ok(mut inner) = shared.lock() {
        inner.connections.remove(&id);
    }
    let _ = app.emit("lan-close", LanClose { id, reason: None });
}

#[derive(Serialize, Clone)]
struct LanMessage {
    id: String,
    data: String,
}

#[derive(Serialize, Clone)]
struct LanClose {
    id: String,
    reason: Option<String>,
}

/// Sends a message on an open connection, accepted or made.
#[tauri::command]
pub fn lan_send(lan: State<'_, Lan>, id: String, data: String) -> Result<(), String> {
    let inner = lan.inner.lock().map_err(err)?;
    if let Some(sender) = inner.connections.get(&id) {
        let _ = sender.send(Some(data));
    }
    Ok(())
}

/// Closes a connection.
#[tauri::command]
pub fn lan_drop(lan: State<'_, Lan>, id: String) -> Result<(), String> {
    let mut inner = lan.inner.lock().map_err(err)?;
    if let Some(sender) = inner.connections.remove(&id) {
        let _ = sender.send(None);
    }
    Ok(())
}

/// Advertises this computer as the workspace's coordinator on the LAN, or stops (D20).
/// Only the workspace's server identifier, the device and the fingerprint are announced.
#[tauri::command(async)]
pub fn lan_advertise(
    lan: State<'_, Lan>,
    data: State<'_, AppData>,
    workspace: String,
    device_id: String,
    name: String,
    on: bool,
) -> Result<(), String> {
    let fingerprint = lan.identity(&data)?;
    let mut inner = lan.inner.lock().map_err(err)?;
    let daemon = Lan::daemon(&mut inner)?;
    if let Some(fullname) = inner.advertised.take() {
        let _ = daemon.unregister(&fullname);
    }
    if !on {
        return Ok(());
    }
    let mut properties = HashMap::new();
    properties.insert("ws".to_string(), workspace);
    properties.insert("dev".to_string(), device_id.clone());
    properties.insert("fp".to_string(), fingerprint);
    properties.insert("name".to_string(), name);
    let host = format!(
        "{}.local.",
        device_id.replace(|c: char| !c.is_ascii_alphanumeric(), "-")
    );
    let info = ServiceInfo::new(SERVICE_TYPE, &device_id, &host, "", LAN_PORT, properties)
        .map_err(err)?
        .enable_addr_auto();
    let fullname = info.get_fullname().to_string();
    daemon.register(info).map_err(err)?;
    inner.advertised = Some(fullname);
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    device_id: String,
    name: String,
    fingerprint: String,
    addresses: Vec<String>,
    port: u16,
}

/// Looks for the workspace's coordinator on the LAN for a few seconds (D14, D20).
#[tauri::command(async)]
pub async fn lan_browse(
    lan: State<'_, Lan>,
    workspace: String,
    seconds: u64,
) -> Result<Vec<Found>, String> {
    let daemon = {
        let mut inner = lan.inner.lock().map_err(err)?;
        Lan::daemon(&mut inner)?
    };
    let receiver = daemon.browse(SERVICE_TYPE).map_err(err)?;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(seconds.clamp(1, 30));
    let mut found: HashMap<String, Found> = HashMap::new();
    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            break;
        }
        let event = tokio::task::block_in_place(|| receiver.recv_timeout(remaining));
        match event {
            Ok(ServiceEvent::ServiceResolved(info)) => {
                let properties = info.get_properties();
                let value = |key: &str| {
                    properties
                        .get_property_val_str(key)
                        .map(str::to_string)
                        .unwrap_or_default()
                };
                if value("ws") != workspace {
                    continue;
                }
                let addresses: Vec<String> = info
                    .get_addresses()
                    .iter()
                    .filter(|ip| ip.is_ipv4())
                    .map(|ip| ip.to_string())
                    .collect::<HashSet<_>>()
                    .into_iter()
                    .collect();
                found.insert(
                    value("dev"),
                    Found {
                        device_id: value("dev"),
                        name: value("name"),
                        fingerprint: value("fp"),
                        addresses,
                        port: info.get_port(),
                    },
                );
            }
            Ok(_) => {}
            Err(_) => break,
        }
    }
    let _ = daemon.stop_browse(SERVICE_TYPE);
    Ok(found.into_values().collect())
}

/// Connects to a coordinator on the LAN, checking its certificate against `fingerprint`
/// before anything is sent (plan M5.5). `hello` is sent first, with the device token added,
/// so the coordinator can prove who is connecting. Returns the connection's identifier.
#[tauri::command(async)]
pub async fn lan_connect(
    lan: State<'_, Lan>,
    address: String,
    port: u16,
    fingerprint: String,
    token: String,
    hello: Value,
) -> Result<String, String> {
    let config = ClientConfig::builder_with_provider(provider())
        .with_safe_default_protocol_versions()
        .map_err(err)?
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(Pinned {
            fingerprint,
            provider: provider(),
        }))
        .with_no_client_auth();
    let connector = TlsConnector::from(Arc::new(config));
    let ip: IpAddr = address.parse().map_err(err)?;
    let tcp = tokio::time::timeout(
        Duration::from_secs(5),
        TcpStream::connect(SocketAddr::new(ip, port)),
    )
    .await
    .map_err(|_| "timed out".to_string())?
    .map_err(err)?;
    let name = ServerName::try_from(CERT_NAME).map_err(err)?;
    let tls = connector.connect(name, tcp).await.map_err(err)?;
    let (ws, _) = tokio_tungstenite::client_async(format!("wss://{CERT_NAME}/ws"), tls)
        .await
        .map_err(err)?;
    let (mut sink, mut stream) = ws.split();
    let mut first = hello;
    if let Some(object) = first.as_object_mut() {
        object.insert("token".to_string(), Value::String(token));
    }
    sink.send(Message::Text(first.to_string().into()))
        .await
        .map_err(err)?;
    let id = lan.next_id("lan-out");
    let (tx, mut rx) = mpsc::unbounded_channel::<Option<String>>();
    {
        let mut inner = lan.inner.lock().map_err(err)?;
        inner.connections.insert(id.clone(), tx);
    }
    let app = lan.app.clone();
    let shared = lan.inner.clone();
    let connection = id.clone();
    tauri::async_runtime::spawn(async move {
        let mut reason = None;
        loop {
            tokio::select! {
                incoming = stream.next() => match incoming {
                    Some(Ok(Message::Text(text))) => {
                        let _ = app.emit("lan-message", LanMessage { id: connection.clone(), data: text.to_string() });
                    }
                    Some(Ok(Message::Ping(payload))) => { let _ = sink.send(Message::Pong(payload)).await; }
                    Some(Ok(Message::Close(frame))) => { reason = frame.map(|f| f.reason.to_string()); break; }
                    None => break,
                    Some(Err(e)) => { reason = Some(e.to_string()); break; }
                    _ => {}
                },
                outgoing = rx.recv() => match outgoing {
                    Some(Some(text)) => { if sink.send(Message::Text(text.into())).await.is_err() { break; } }
                    Some(None) | None => break,
                },
            }
        }
        let _ = sink.close().await;
        if let Ok(mut inner) = shared.lock() {
            inner.connections.remove(&connection);
        }
        let _ = app.emit(
            "lan-close",
            LanClose {
                id: connection,
                reason,
            },
        );
    });
    Ok(id)
}

/// Ends a connection this computer made.
#[tauri::command]
pub fn lan_disconnect(lan: State<'_, Lan>, id: String) -> Result<(), String> {
    lan_drop(lan, id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn makes_the_certificate_once_and_keeps_it() {
        let dir = std::env::temp_dir().join(format!("worship-q-lan-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let first = load_identity(&dir).unwrap();
        let second = load_identity(&dir).unwrap();
        assert_eq!(first.fingerprint, second.fingerprint);
        assert_eq!(first.fingerprint.len(), 32 * 3 - 1);
        fs::remove_file(dir.join(CERT_FILE)).unwrap();
        let third = load_identity(&dir).unwrap();
        assert_ne!(first.fingerprint, third.fingerprint);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn hashes_tokens_as_the_server_does() {
        assert_eq!(
            sha256_hex("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
