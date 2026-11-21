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
        .header(
            "accept",
            "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5",
        )
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
    bytes
        .windows(7)
        .any(|window| window.eq_ignore_ascii_case(b"</head>"))
}

/// Enough of a watch page to reach its length, about 850 KB in (YouTube control spike M0.2).
const MAX_WATCH_BYTES: usize = 2 * 1024 * 1024;
/// How far past the length to look for the live stream marker, about 3 KB after it.
const LIVE_MARKER_WINDOW: usize = 16 * 1024;

/// A YouTube video's length in seconds, read from its watch page with no key (YouTube control
/// D3): the `<meta itemprop="duration">` in its body. None for a live stream, whose length
/// there means nothing, or when the page cannot be read or has none, within a few seconds.
#[tauri::command(async)]
pub async fn youtube_length(id: String) -> Result<Option<f64>, String> {
    tauri::async_runtime::spawn_blocking(move || read_length(&id))
        .await
        .map_err(|e| e.to_string())?
}

fn read_length(id: &str) -> Result<Option<f64>, String> {
    let plain = |c: char| c.is_ascii_alphanumeric() || c == '_' || c == '-';
    if id.len() != 11 || !id.chars().all(plain) {
        return Err("not a YouTube video".into());
    }
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(8))
        .user_agent("Mozilla/5.0 (compatible; WorshipQ)")
        .build()
        .map_err(|e| e.to_string())?;
    let mut response = client
        .get(format!("https://www.youtube.com/watch?v={id}"))
        .header("accept", "text/html")
        .header("accept-language", "en")
        .send()
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("site answered {}", response.status().as_u16()));
    }
    let mut body = Vec::new();
    let mut chunk = [0u8; 16 * 1024];
    let mut found_at: Option<usize> = None;
    while body.len() < MAX_WATCH_BYTES {
        let read = response.read(&mut chunk).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..read]);
        if found_at.is_none() {
            found_at = find(&body, DURATION_TAG);
        }
        if found_at.is_some_and(|at| body.len() >= at + LIVE_MARKER_WINDOW) {
            break;
        }
    }
    Ok(watch_page_length(&String::from_utf8_lossy(&body)))
}

const DURATION_TAG: &[u8] = b"<meta itemprop=\"duration\" content=\"";

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

/// The length a watch page gives, or None for a live stream or a page without one.
fn watch_page_length(page: &str) -> Option<f64> {
    let tag = std::str::from_utf8(DURATION_TAG).ok()?;
    let at = page.find(tag)? + tag.len();
    let after = &page[at..];
    let window = &after[..after.len().min(LIVE_MARKER_WINDOW)];
    if window.contains("itemprop=\"isLiveBroadcast\" content=\"True\"") {
        return None;
    }
    let value = &after[..after.find('"')?];
    iso_duration(value).filter(|seconds| *seconds > 0.0)
}

/// Seconds in an ISO 8601 length as YouTube writes it: `PT3M34S`, `PT1H2M3S`, `P1DT2H`.
fn iso_duration(value: &str) -> Option<f64> {
    let rest = value.strip_prefix('P')?;
    let (days, time) = match rest.split_once('T') {
        Some((days, time)) => (days, time),
        None => (rest, ""),
    };
    let mut seconds = 0.0;
    if !days.is_empty() {
        seconds += days.strip_suffix('D')?.parse::<f64>().ok()? * 86_400.0;
    }
    let mut number = String::new();
    for c in time.chars() {
        match c {
            '0'..='9' | '.' => number.push(c),
            'H' | 'M' | 'S' => {
                let n: f64 = number.parse().ok()?;
                number.clear();
                seconds += n * match c {
                    'H' => 3600.0,
                    'M' => 60.0,
                    _ => 1.0,
                };
            }
            _ => return None,
        }
    }
    number.is_empty().then_some(seconds)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_iso_lengths() {
        assert_eq!(iso_duration("PT3M34S"), Some(214.0));
        assert_eq!(iso_duration("PT1H2M3S"), Some(3723.0));
        assert_eq!(iso_duration("PT45S"), Some(45.0));
        assert_eq!(iso_duration("P1DT1S"), Some(86_401.0));
        assert_eq!(iso_duration("PT"), Some(0.0));
        assert_eq!(iso_duration("3M34S"), None);
        assert_eq!(iso_duration("PT3X"), None);
        assert_eq!(iso_duration("PT3"), None);
    }

    #[test]
    fn reads_a_watch_page_and_leaves_out_live_streams() {
        let video = r#"<body>…<meta itemprop="duration" content="PT3M34S"><meta itemprop="width" content="1280">"#;
        assert_eq!(watch_page_length(video), Some(214.0));
        let live = r#"<meta itemprop="duration" content="PT2026691M52S"><span itemprop="publication" itemscope itemtype="http://schema.org/BroadcastEvent"><meta itemprop="isLiveBroadcast" content="True">"#;
        assert_eq!(watch_page_length(live), None);
        assert_eq!(watch_page_length("<html>no length</html>"), None);
        assert_eq!(
            watch_page_length(r#"<meta itemprop="duration" content="PT0S">"#),
            None
        );
    }

    #[test]
    fn asks_only_for_a_youtube_video() {
        assert!(read_length("not an id").is_err());
        assert!(read_length("dQw4w9WgXc/").is_err());
    }
}

#[cfg(test)]
mod network {
    /// Reads real watch pages; run by hand with `cargo test -- --ignored network`.
    #[test]
    #[ignore = "needs the internet"]
    fn reads_real_lengths() {
        let length = super::read_length("dQw4w9WgXcQ").unwrap().unwrap();
        assert!((212.0..=215.0).contains(&length), "{length}");
        assert_eq!(super::read_length("gCNeDWCI0vo").unwrap(), None);
    }
}
