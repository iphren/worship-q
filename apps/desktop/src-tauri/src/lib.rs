//! Native core of the Worship Q desktop app.
//!
//! Kept deliberately small (decision D12): windows, files, fonts, the database, file
//! transfers and the localhost overlay page. All presentation, planning and
//! synchronization logic lives in the shared TypeScript packages.

mod cloud;
mod db;
mod files;
mod fonts;
mod keychain;
mod lan;
mod output;
mod overlay;
mod workspaces;

use std::fs;
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
            app.manage(db::AppData::open(dir)?);
            app.manage(overlay::Overlay::new());
            overlay::start(app.handle());
            app.manage(lan::Lan::new(app.handle().clone()));
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the operator window closes the output with it.
            if window.label() == "main" {
                if let WindowEvent::Destroyed = event {
                    window.app_handle().exit(0);
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
            output::open_output,
            output::close_output,
            output::window_output,
            output::output_monitor,
            output::output_mode,
            output::drag_output,
            output::output_website,
            output::monitor_labels,
            files::import_background,
            files::remove_background_file,
            files::background_path,
            files::export_backup,
            files::restore_backup,
            cloud::upload_background,
            cloud::download_background,
            cloud::upload_backup,
            cloud::import_deck,
            cloud::backup_before_join,
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
            workspaces::list_workspaces,
            workspaces::add_workspace,
            workspaces::switch_workspace,
            workspaces::remove_workspace,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Worship Q");
}

/// Restores the operator window where it was left, then grows it back to the minimum size.
///
/// The saved size is in physical pixels, so a window saved on a standard display and reopened
/// on a high-density one comes back at a fraction of its size, and macOS does not apply the
/// minimum size to sizes set by the app.
fn restore_main_window(window: &tauri::WebviewWindow) {
    let _ = window.restore_state(WINDOW_STATE_FLAGS);
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
