//! The slideshow output window: borderless and full screen on a chosen monitor.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Manager, Monitor, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder,
};

pub const OUTPUT_LABEL: &str = "output";
/// Tells the interface the operator asked to close the slideshow from its own window.
pub const CLOSE_REQUEST_EVENT: &str = "output-close-request";
/// The share of its screen the slideshow takes when it is first put in a window.
const WINDOWED_SHARE: f64 = 0.6;
/// True while the output is a window the operator can drag, instead of covering a screen.
static WINDOWED: AtomicBool = AtomicBool::new(false);

/// How the interface identifies a monitor: by more than its index, which can change.
#[derive(Deserialize, Serialize)]
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

/// Puts the output window above the menu bar and Dock so a borderless window covers its
/// screen, or back among ordinary windows. macOS full screen is avoided: it moves the window
/// to its own Space, and a window closed during that transition can be left on screen with
/// no way to dismiss it.
#[cfg(target_os = "macos")]
fn set_covering(window: &tauri::WebviewWindow, covering: bool) -> Result<(), String> {
    use objc2_app_kit::{NSMainMenuWindowLevel, NSNormalWindowLevel, NSWindow};

    let target = window.clone();
    window
        .run_on_main_thread(move || {
            if let Ok(pointer) = target.ns_window() {
                let ns_window = unsafe { &*(pointer as *const NSWindow) };
                ns_window.setLevel(if covering {
                    NSMainMenuWindowLevel + 1
                } else {
                    NSNormalWindowLevel
                });
            }
        })
        .map_err(|e| e.to_string())
}

/// Where the output sits on a monitor: covering it, or centred in a part of it when windowed.
fn frame(monitor: &Monitor, windowed: bool) -> (PhysicalPosition<i32>, PhysicalSize<u32>) {
    let (origin, screen) = (monitor.position(), monitor.size());
    if !windowed {
        return (*origin, *screen);
    }
    let width = (screen.width as f64 * WINDOWED_SHARE) as u32;
    let height = (screen.height as f64 * WINDOWED_SHARE) as u32;
    let x = origin.x + ((screen.width - width) / 2) as i32;
    let y = origin.y + ((screen.height - height) / 2) as i32;
    (
        PhysicalPosition::new(x, y),
        PhysicalSize::new(width, height),
    )
}

/// Makes the output cover the monitor, or sit on it as a window the operator can drag to any
/// screen. Either way it has no title bar: a windowed output is dragged by its picture.
fn place(window: &tauri::WebviewWindow, monitor: &Monitor, windowed: bool) -> Result<(), String> {
    let (position, size) = frame(monitor, windowed);
    #[cfg(not(target_os = "macos"))]
    window.set_fullscreen(false).map_err(|e| e.to_string())?;
    window.set_shadow(windowed).map_err(|e| e.to_string())?;
    window.set_size(size).map_err(|e| e.to_string())?;
    window.set_position(position).map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "macos"))]
    window
        .set_fullscreen(!windowed)
        .map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    set_covering(window, !windowed)?;
    WINDOWED.store(windowed, Ordering::Relaxed);
    Ok(())
}

/// Opens the output on the given monitor, or moves it there if it is already open.
#[tauri::command]
pub async fn open_output(
    app: AppHandle,
    monitor: MonitorIdentity,
    windowed: bool,
) -> Result<(), String> {
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "main window missing".to_string())?;
    let monitors = main.available_monitors().map_err(|e| e.to_string())?;
    let target = find_monitor(monitors, &monitor).ok_or_else(|| "monitor-not-found".to_string())?;

    let window = match app.get_webview_window(OUTPUT_LABEL) {
        Some(existing) => existing,
        None => {
            let (position, size) = frame(&target, windowed);
            let scale = target.scale_factor();
            WebviewWindowBuilder::new(&app, OUTPUT_LABEL, WebviewUrl::App("index.html".into()))
                .title("Worship Q — Slideshow")
                .decorations(false)
                .shadow(windowed)
                .skip_taskbar(true)
                .focused(false)
                .position(position.x as f64 / scale, position.y as f64 / scale)
                .inner_size(size.width as f64 / scale, size.height as f64 / scale)
                .build()
                .map_err(|e| e.to_string())?
        }
    };
    place(&window, &target, windowed)?;
    // Keep the keyboard with the operator.
    let _ = main.set_focus();
    Ok(())
}

#[tauri::command]
pub async fn close_output(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(OUTPUT_LABEL) {
        // Hidden first, so nothing is left on screen should the system be slow to let go of it.
        let _ = window.hide();
        window.destroy().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Turns the full-screen output into a window on the screen it is on.
#[tauri::command]
pub async fn window_output(app: AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window(OUTPUT_LABEL) else {
        return Ok(());
    };
    match window.current_monitor().map_err(|e| e.to_string())? {
        Some(monitor) => place(&window, &monitor, true),
        None => Ok(()),
    }
}

/// The monitor the output window is on right now, wherever the operator dragged it.
#[tauri::command]
pub fn output_monitor(app: AppHandle) -> Option<MonitorIdentity> {
    let monitor = app
        .get_webview_window(OUTPUT_LABEL)?
        .current_monitor()
        .ok()??;
    Some(MonitorIdentity {
        name: monitor.name().cloned().unwrap_or_default(),
        x: monitor.position().x as f64,
        y: monitor.position().y as f64,
        width: monitor.size().width as f64,
        height: monitor.size().height as f64,
    })
}

/// How the output is shown: `fullscreen`, `windowed`, or nothing when it is closed.
#[tauri::command]
pub fn output_mode(app: AppHandle) -> Option<&'static str> {
    app.get_webview_window(OUTPUT_LABEL)?;
    Some(if WINDOWED.load(Ordering::Relaxed) {
        "windowed"
    } else {
        "fullscreen"
    })
}

/// Lets the operator move a windowed output by dragging anywhere on it. An output covering
/// a screen stays where it is.
#[tauri::command]
pub fn drag_output(app: AppHandle) -> Result<(), String> {
    match app.get_webview_window(OUTPUT_LABEL) {
        Some(window) if WINDOWED.load(Ordering::Relaxed) => {
            window.start_dragging().map_err(|e| e.to_string())
        }
        _ => Ok(()),
    }
}
