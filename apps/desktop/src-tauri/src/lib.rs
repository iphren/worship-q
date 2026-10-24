//! Native core of the Worship Q desktop app.
//!
//! Kept deliberately small (decision D12): windows, files, fonts, the database, file
//! transfers and the localhost overlay page. All presentation, planning and
//! synchronization logic lives in the shared TypeScript packages.

mod cloud;
mod db;
mod files;
mod fonts;
mod output;
mod overlay;
mod workspaces;

use std::fs;
use tauri::{Emitter, Manager, WindowEvent};
use tauri_plugin_window_state::StateFlags;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        // The operator window opens where it was left. The output is placed on a chosen
        // monitor each time, so it is left out.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    StateFlags::SIZE
                        | StateFlags::POSITION
                        | StateFlags::MAXIMIZED
                        | StateFlags::FULLSCREEN,
                )
                .with_denylist(&[output::OUTPUT_LABEL])
                .build(),
        )
        .setup(|app| {
            let root = app.path().app_data_dir()?;
            let dir = workspaces::active_dir(&root);
            fs::create_dir_all(dir.join(files::BACKGROUNDS_DIR))?;
            // The configured scope covers only the first workspace's backgrounds.
            app.asset_protocol_scope()
                .allow_directory(dir.join(files::BACKGROUNDS_DIR), true)?;
            app.manage(db::AppData::open(dir)?);
            app.manage(overlay::Overlay::new());
            overlay::start(app.handle());
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
            workspaces::list_workspaces,
            workspaces::add_workspace,
            workspaces::switch_workspace,
            workspaces::remove_workspace,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Worship Q");
}
