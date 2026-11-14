//! The start of a web page, fetched here because the interface cannot read other sites
//! itself. The interface takes a website's title from it to name a new website item.

use base64::Engine;
use serde::Serialize;
use std::io::Read;
use std::time::Duration;

/// Enough for the `<head>` of nearly any page; a title further in is not worth waiting for.
const MAX_BYTES: usize = 128 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageStart {
    /// The `Content-Type` header, which may name the page's character set.
    content_type: Option<String>,
    /// The bytes read, in base64, decoded by the interface in the page's character set.
    body: String,
}

/// Reads the start of an `http` or `https` page: up to the end of its `<head>`, or
/// `MAX_BYTES`, within a few seconds.
#[tauri::command(async)]
pub async fn fetch_page_start(url: String) -> Result<PageStart, String> {
    tauri::async_runtime::spawn_blocking(move || fetch(&url))
        .await
        .map_err(|e| e.to_string())?
}

fn fetch(url: &str) -> Result<PageStart, String> {
    let url = reqwest::Url::parse(url).map_err(|e| e.to_string())?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err("not a web address".into());
    }
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(6))
        .user_agent("Mozilla/5.0 (compatible; WorshipQ)")
        .build()
        .map_err(|e| e.to_string())?;
    let mut response = client
        .get(url)
        .header("accept", "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5")
        .send()
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("site answered {}", response.status().as_u16()));
    }
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let mut body = Vec::new();
    let mut chunk = [0u8; 8192];
    while body.len() < MAX_BYTES {
        let read = response.read(&mut chunk).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..read]);
        // The title is in the head; the rest of the page is not needed.
        if ends_head(&body[body.len().saturating_sub(read + 7)..]) {
            break;
        }
    }
    body.truncate(MAX_BYTES);
    Ok(PageStart {
        content_type,
        body: base64::engine::general_purpose::STANDARD.encode(body),
    })
}

fn ends_head(bytes: &[u8]) -> bool {
    bytes.windows(7).any(|window| window.eq_ignore_ascii_case(b"</head>"))
}
