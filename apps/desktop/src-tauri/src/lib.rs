//! Native core of the Worship Q desktop app.
//!
//! Kept deliberately small (decision D12): windows, files, fonts and the database. All
//! presentation and planning logic lives in the shared TypeScript packages.

mod db;
mod files;
mod fonts;
mod output;

use std::fs;
use tauri::{Manager, WindowEvent};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            fs::create_dir_all(dir.join(files::BACKGROUNDS_DIR))?;
            app.manage(db::AppData::open(dir)?);
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the operator window closes the output with it.
            if window.label() == "main" {
                if let WindowEvent::Destroyed = event {
                    window.app_handle().exit(0);
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
            output::output_is_open,
            output::monitor_labels,
            files::import_background,
            files::remove_background_file,
            files::background_path,
            files::export_backup,
            files::restore_backup,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Worship Q");
}
