//! Native core of the Worship Q desktop app.
//!
//! Kept deliberately small (decision D12): windows, files, fonts, the database, file
//! transfers, the localhost overlay page, venue-network connections and the OBS link. All presentation, planning and
//! synchronization logic lives in the shared TypeScript packages.

mod cloud;
mod db;
mod files;
mod fonts;
mod keychain;
mod lan;
mod media;
mod obs;
mod output;
mod overlay;
mod workspaces;

use std::fs;
use tauri::webview::PageLoadEvent;
use tauri::{Emitter, LogicalSize, Manager, WindowEvent};
use tauri_plugin_window_state::{StateFlags, WindowExt};

const WINDOW_STATE_FLAGS: StateFlags = StateFlags::SIZE
    .union(StateFlags::POSITION)
    .union(StateFlags::MAXIMIZED)
    .union(StateFlags::FULLSCREEN);

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // The operator window opens where it was left. The output is placed on a chosen
        // monitor each time, so it is left out. The operator window is restored in `setup`
        // so its size can be checked against the minimum afterwards.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(WINDOW_STATE_FLAGS)
                .with_denylist(&[output::OUTPUT_LABEL])
                .skip_initial_state("main")
                .build(),
        )
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                restore_main_window(&window);
            }
            let root = app.path().app_data_dir()?;
            let dir = workspaces::active_dir(&root);
            fs::create_dir_all(dir.join(files::BACKGROUNDS_DIR))?;
            // The configured scope covers only the first workspace's backgrounds.
            app.asset_protocol_scope()
                .allow_directory(dir.join(files::BACKGROUNDS_DIR), true)?;
            // This computer's copies of videos, played by the slideshow (U8).
            fs::create_dir_all(dir.join(media::VIDEOS_DIR))?;
            app.asset_protocol_scope()
                .allow_directory(dir.join(media::VIDEOS_DIR), true)?;
            app.manage(db::AppData::open(dir)?);
            app.manage(overlay::Overlay::new());
            overlay::start(app.handle());
            app.manage(lan::Lan::new(app.handle().clone()));
            app.manage(obs::Obs::new(app.handle().clone()));
            app.manage(media::Transfers::default());
            Ok(())
        })
        // The app's own pages may list audio devices (U24): WebView2 would otherwise show its
        // own prompt, and macOS shows only the system's, once. Everything else as usual.
        // Presented websites are left to the default.
        .on_permission_request(|webview, kind| {
            let own = matches!(webview.label(), "main" | output::OUTPUT_LABEL);
            match kind {
                tauri::webview::PermissionKind::Microphone if own => {
                    tauri::webview::PermissionResponse::Allow
                }
                _ => tauri::webview::PermissionResponse::Default,
            }
        })
        .on_page_load(|webview, payload| {
            // The page loading again (viewer mode, workspaces) starts the interface afresh,
            // but the LAN server and its connections live here and would outlast it.
            if webview.label() == "main" && payload.event() == PageLoadEvent::Started {
                if let Some(lan) = webview.try_state::<lan::Lan>() {
                    lan.reset();
                }
                if let Some(obs) = webview.try_state::<obs::Obs>() {
                    obs.reset();
                }
            }
        })
        .on_window_event(|window, event| {
            // Closing the operator window closes the output with it.
            if window.label() == "main" {
                match event {
                    WindowEvent::Destroyed => window.app_handle().exit(0),
                    // The restored size can arrive in another display's pixels, and the
                    // scale factor is only settled once the window is on its display.
                    WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. } => {
                        grow_to_minimum(window);
                    }
                    _ => {}
                }
            }
            // Closing the output from the system closes the slideshow like the interface does,
            // so it stays closed instead of being opened again.
            if window.label() == output::OUTPUT_LABEL {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.app_handle().emit(output::CLOSE_REQUEST_EVENT, ());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            db::db_select,
            db::db_batch,
            fonts::list_font_families,
            fonts::font_missing_chars,
            open_website,
            output::open_output,
            output::close_output,
            output::window_output,
            output::output_monitor,
            output::output_mode,
            output::drag_output,
            output::output_website,
            output::monitor_labels,
            output::output_audio_sink,
            files::import_background,
            files::remove_background_file,
            files::background_path,
            files::export_backup,
            files::restore_backup,
            cloud::upload_background,
            cloud::download_background,
            cloud::upload_backup,
            cloud::backup_before_join,
            cloud::computer_name,
            media::file_size,
            media::upload_media,
            media::download_media,
            media::cancel_transfer,
            media::store_video,
            media::video_location,
            media::list_videos,
            media::remove_video,
            media::copy_file,
            media::convert_heic,
            media::remove_converted,
            media::allow_media_file,
            overlay::overlay_publish,
            overlay::overlay_status,
            keychain::keychain_set,
            keychain::keychain_get,
            keychain::keychain_delete,
            lan::lan_status,
            lan::lan_serve,
            lan::lan_stop_serving,
            lan::lan_set_credentials,
            lan::lan_send,
            lan::lan_drop,
            lan::lan_advertise,
            lan::lan_browse,
            lan::lan_connect,
            lan::lan_disconnect,
            obs::obs_connect,
            obs::obs_disconnect,
            obs::obs_request,
            obs::obs_status,
            obs::obs_read_config,
            workspaces::list_workspaces,
            workspaces::add_workspace,
            workspaces::switch_workspace,
            workspaces::remove_workspace,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Worship Q");
}

const WEBSITE: &str = "https://worship-q.com";

/// Opens the app's website in the browser, where the latest version is. The address is fixed
/// here, so the interface cannot be made to open anything else.
#[tauri::command]
fn open_website() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("open");
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = std::process::Command::new("rundll32");
        command.arg("url.dll,FileProtocolHandler");
        command
    };
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let mut command = std::process::Command::new("xdg-open");
    command.arg(WEBSITE).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

/// Restores the operator window where it was left, then grows it back to the minimum size.
///
/// The saved size is in physical pixels, so a window saved on a standard display and reopened
/// on a high-density one comes back at a fraction of its size, and macOS does not apply the
/// minimum size to sizes set by the app. The check is repeated on resizes and scale changes
/// (`on_window_event`), because during setup the scale factor can still be the old display's.
fn restore_main_window(window: &tauri::WebviewWindow) {
    let _ = window.restore_state(WINDOW_STATE_FLAGS);
    grow_to_minimum(&window.as_ref().window());
}

/// Grows the operator window to its configured minimum size if it is smaller.
fn grow_to_minimum(window: &tauri::Window) {
    if window.is_maximized().unwrap_or(false) || window.is_fullscreen().unwrap_or(false) {
        return;
    }
    let Some(config) = window
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == "main")
    else {
        return;
    };
    let (Ok(size), Ok(scale)) = (window.inner_size(), window.scale_factor()) else {
        return;
    };
    let size = size.to_logical::<f64>(scale);
    let width = size.width.max(config.min_width.unwrap_or(0.0));
    let height = size.height.max(config.min_height.unwrap_or(0.0));
    if width != size.width || height != size.height {
        let _ = window.set_size(LogicalSize::new(width, height));
    }
}
