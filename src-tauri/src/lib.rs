mod db;
mod commands;

use std::sync::Mutex;
use rusqlite::Connection;
use tauri::{Emitter, Manager};

pub struct AppState(pub Mutex<Connection>);

const GLOBAL_HOTKEY: &str = "CommandOrControl+Shift+Space";

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    use tauri_plugin_global_shortcut::ShortcutState;
                    if event.state() == ShortcutState::Pressed
                        && shortcut.matches(
                            tauri_plugin_global_shortcut::Modifiers::CONTROL | tauri_plugin_global_shortcut::Modifiers::SHIFT,
                            tauri_plugin_global_shortcut::Code::Space,
                        )
                    {
                        commands::tray::show_main_window(app);
                        let _ = app.emit("hotkey-summon", ());
                    }
                })
                .build(),
        )
        .setup(|app| {
            // Global hotkey summons the window from anywhere — best-effort: another
            // app may already own this combo, in which case CTRL just runs without it.
            {
                use tauri_plugin_global_shortcut::GlobalShortcutExt;
                if let Err(e) = app.global_shortcut().register(GLOBAL_HOTKEY) {
                    eprintln!("[CTRL] could not register global hotkey {GLOBAL_HOTKEY}: {e}");
                }
            }
            // Window close (X button) hides to tray instead of quitting.
            if let Some(win) = app.get_webview_window("main") {
                let win2 = win.clone();
                win.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = win2.hide();
                    }
                });
            }
            // DB lives next to the exe (portable)
            let exe_dir = std::env::current_exe().ok()
                .and_then(|p| p.parent().map(|d| d.to_path_buf()))
                .unwrap_or_else(|| std::path::PathBuf::from("."));
            let db_path = std::env::var("CTRL_DB")
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|_| exe_dir.join("ctrl.db"));
            let conn = Connection::open(&db_path)
                .expect("failed to open ctrl.db");
            db::init(&conn).expect("failed to init db schema");
            app.manage(AppState(Mutex::new(conn)));
            app.manage(commands::terminal::TermState(std::sync::Mutex::new(std::collections::HashMap::new())));
            if let Err(e) = commands::tray::build_tray(&app.handle().clone()) {
                eprintln!("[CTRL] tray icon setup failed: {e}");
            }
            // Start workflow scheduler (startup triggers + schedule polling)
            commands::workflows::start_workflow_scheduler(app.handle().clone());
            // Start watcher scheduler (system-state polling every 30s)
            commands::watchers::start_watcher_scheduler(app.handle().clone());
            // Clean up stale temp files from previous sessions
            if let Ok(tmp) = std::fs::read_dir(std::env::temp_dir()) {
                for entry in tmp.flatten() {
                    let name = entry.file_name();
                    let name = name.to_string_lossy();
                    if name.starts_with("ctrl_") || name == "ctrl_built.ps1" || name == "ctrl_built.bat" {
                        let _ = std::fs::remove_file(entry.path());
                    }
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::tools::get_tools,
            commands::tools::add_tool,
            commands::tools::update_tool,
            commands::tools::delete_tool,
            commands::tools::launch_tool,
            commands::tools::browse_for_exe,
            commands::scripts::get_scripts,
            commands::scripts::run_script,
            commands::scripts::open_script_editor,
            commands::scripts::watch_script_edit,
            commands::scripts::launch_shortcut,
            commands::fixes::get_fixes,
            commands::fixes::add_fix,
            commands::fixes::update_fix,
            commands::fixes::delete_fix,
            commands::fixes::run_fix,
            commands::projects::get_projects,
            commands::projects::add_project,
            commands::projects::update_project,
            commands::projects::delete_project,
            commands::projects::open_project_path,
            commands::builder::get_builder_actions,
            commands::builder::build_script,
            commands::builder::run_built_script,
            commands::builder::save_built_script,
            commands::dashboard::get_pinned,
            commands::dashboard::pin_item,
            commands::dashboard::unpin_item,
            commands::dashboard::reorder_pins,
            commands::misc::get_stats,
            commands::misc::get_sys_info,
            commands::misc::get_last_runs,
            commands::misc::get_recent_activity,
            commands::misc::get_run_history,
            commands::misc::get_run_history_filtered,
            commands::misc::export_text_file,
            commands::misc::global_search,
            commands::misc::open_data_folder,
            commands::misc::get_perf_stats,
            commands::misc::open_path,
            commands::snippets::get_snippets,
            commands::snippets::add_snippet,
            commands::snippets::update_snippet,
            commands::snippets::delete_snippet,
            commands::window::close_window,
            commands::window::minimize_window,
            commands::window::toggle_maximize,
            commands::window::exit_app,
            commands::workflows::get_workflows,
            commands::workflows::add_workflow,
            commands::workflows::update_workflow,
            commands::workflows::delete_workflow,
            commands::workflows::run_workflow,
            commands::workflows::toggle_workflow,
            commands::tweaks::run_tweak_cmd,
            commands::tweaks::get_custom_tweaks,
            commands::tweaks::add_custom_tweak,
            commands::tweaks::update_custom_tweak,
            commands::tweaks::delete_custom_tweak,
            commands::env_vars::get_env_vars,
            commands::env_vars::set_env_var,
            commands::env_vars::delete_env_var,
            commands::env_vars::open_env_editor,
            commands::env_vars::add_to_path,
            commands::backup::get_backup_jobs,
            commands::backup::add_backup_job,
            commands::backup::update_backup_job,
            commands::backup::delete_backup_job,
            commands::backup::run_backup,
            commands::backup::browse_for_folder,
            commands::terminal::list_shells,
            commands::terminal::pty_open,
            commands::terminal::pty_write,
            commands::terminal::pty_resize,
            commands::terminal::pty_close,
            commands::terminal::open_elevated_terminal,
            commands::terminal::is_elevated,
            commands::exec::stop_current_run,
            commands::exec::kill_process,
            commands::external_apps::get_ql_items,
            commands::external_apps::list_external_apps,
            commands::external_apps::add_external_app,
            commands::external_apps::remove_external_app,
            commands::external_apps::launch_external,
            commands::external_apps::pick_exe_file,
            commands::scriptstash::ss_get_state,
            commands::scriptstash::ss_add_profile,
            commands::scriptstash::ss_rename_profile,
            commands::scriptstash::ss_remove_profile,
            commands::scriptstash::ss_duplicate_profile,
            commands::scriptstash::ss_add_script,
            commands::scriptstash::ss_edit_script,
            commands::scriptstash::ss_remove_scripts,
            commands::scriptstash::ss_toggle_scripts,
            commands::scriptstash::ss_reorder_scripts,
            commands::scriptstash::ss_duplicate_script,
            commands::scriptstash::ss_set_script_profiles,
            commands::scriptstash::ss_copy_scripts_to_profile,
            commands::scriptstash::ss_export_profile,
            commands::scriptstash::ss_import_profile,
            commands::scriptstash::ss_import_pick_file,
            commands::scriptstash::ss_export_pick_file,
            commands::scriptstash::ss_open_in_editor,
            commands::profiles::get_profiles,
            commands::profiles::add_profile,
            commands::profiles::update_profile,
            commands::profiles::delete_profile,
            commands::profiles::get_active_profile,
            commands::profiles::activate_profile,
            commands::profiles::restore_previous,
            commands::watchers::get_watchers,
            commands::watchers::add_watcher,
            commands::watchers::update_watcher,
            commands::watchers::delete_watcher,
            commands::watchers::toggle_watcher,
        ])
        .run(tauri::generate_context!())
        .expect("error while running CTRL");
}
