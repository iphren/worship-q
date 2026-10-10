//! The slideshow output window: borderless and full screen on a chosen monitor.

use std::collections::HashMap;

use serde::Deserialize;
use tauri::{
    AppHandle, Manager, Monitor, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder,
};

pub const OUTPUT_LABEL: &str = "output";

/// How the interface identifies a monitor: by more than its index, which can change.
#[derive(Deserialize)]
pub struct MonitorIdentity {
    name: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

fn find_monitor(monitors: Vec<Monitor>, wanted: &MonitorIdentity) -> Option<Monitor> {
    let name = |m: &Monitor| m.name().map(|n| n == &wanted.name).unwrap_or(false);
    let position =
        |m: &Monitor| m.position().x == wanted.x as i32 && m.position().y == wanted.y as i32;
    let size = |m: &Monitor| {
        m.size().width == wanted.width as u32 && m.size().height == wanted.height as u32
    };
    let rules: [&dyn Fn(&Monitor) -> bool; 3] = [
        &|m| name(m) && position(m) && size(m),
        &|m| name(m) && size(m),
        &|m| position(m) && size(m),
    ];
    for rule in rules {
        if let Some(index) = monitors.iter().position(rule) {
            return monitors.into_iter().nth(index);
        }
    }
    None
}

/// The names the system shows for the connected displays, keyed by the monitor name the
/// interface knows. Empty where the system offers nothing better than that name.
#[cfg(target_os = "macos")]
#[tauri::command]
pub fn monitor_labels() -> HashMap<String, String> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSScreen;
    use objc2_foundation::{ns_string, NSNumber};

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGDisplayModelNumber(display: u32) -> u32;
    }

    let mut labels = HashMap::new();
    // Commands that are not async run on the main thread, where screens may be read.
    let Some(mtm) = MainThreadMarker::new() else {
        return labels;
    };
    for screen in NSScreen::screens(mtm) {
        let description = screen.deviceDescription();
        let Some(number) = description.objectForKey(ns_string!("NSScreenNumber")) else {
            continue;
        };
        let Ok(number) = number.downcast::<NSNumber>() else {
            continue;
        };
        // Monitors are named after their model number, as the windowing library does.
        let model = unsafe { CGDisplayModelNumber(number.unsignedIntValue()) };
        labels.insert(
            format!("Monitor #{model}"),
            screen.localizedName().to_string(),
        );
    }
    labels
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn monitor_labels() -> HashMap<String, String> {
    HashMap::new()
}

/// Opens the output on the given monitor, or moves it there if it is already open.
#[tauri::command]
pub async fn open_output(app: AppHandle, monitor: MonitorIdentity) -> Result<(), String> {
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "main window missing".to_string())?;
    let monitors = main.available_monitors().map_err(|e| e.to_string())?;
    let target = find_monitor(monitors, &monitor).ok_or_else(|| "monitor-not-found".to_string())?;
    let position = PhysicalPosition::new(target.position().x, target.position().y);
    let size = PhysicalSize::new(target.size().width, target.size().height);
    let scale = target.scale_factor();

    let window = match app.get_webview_window(OUTPUT_LABEL) {
        Some(existing) => {
            existing.set_fullscreen(false).map_err(|e| e.to_string())?;
            existing
        }
        None => WebviewWindowBuilder::new(&app, OUTPUT_LABEL, WebviewUrl::App("index.html".into()))
            .title("Worship Q — Slideshow")
            .decorations(false)
            .skip_taskbar(true)
            .focused(false)
            .position(position.x as f64 / scale, position.y as f64 / scale)
            .inner_size(size.width as f64 / scale, size.height as f64 / scale)
            .build()
            .map_err(|e| e.to_string())?,
    };
    window.set_position(position).map_err(|e| e.to_string())?;
    window.set_size(size).map_err(|e| e.to_string())?;
    window.set_fullscreen(true).map_err(|e| e.to_string())?;
    // Keep the keyboard with the operator.
    let _ = main.set_focus();
    Ok(())
}

#[tauri::command]
pub async fn close_output(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(OUTPUT_LABEL) {
        window.destroy().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn output_is_open(app: AppHandle) -> bool {
    app.get_webview_window(OUTPUT_LABEL).is_some()
}
