mod db;
mod commands;

use std::sync::Mutex;
use rusqlite::Connection;
use tauri::Manager;

pub struct AppState(pub Mutex<Connection>);

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
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
            app.manage(commands::terminal::TermState(std::sync::Mutex::new(None)));
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
            commands::scripts::add_script,
            commands::scripts::update_script,
            commands::scripts::delete_script,
            commands::scripts::run_script,
            commands::scripts::browse_for_script,
            commands::scripts::read_text_file,
            commands::scripts::open_script_editor,
            commands::scripts::open_script_location,
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
            commands::workflows::get_workflows,
            commands::workflows::add_workflow,
            commands::workflows::update_workflow,
            commands::workflows::delete_workflow,
            commands::workflows::run_workflow,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running CTRL");
}
