use tauri::{AppHandle, Manager};

/// Hides to tray instead of quitting — the whole point of having a tray icon
/// is that closing the window doesn't lose the app. Use the tray's "Quit CTRL"
/// (or exit_app) for a real exit.
#[tauri::command]
pub fn close_window(app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.hide();
    }
}

#[tauri::command]
pub fn exit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub fn minimize_window(app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.minimize();
    }
}

#[tauri::command]
pub fn toggle_maximize(app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let maximized = win.is_maximized().unwrap_or(false);
        if maximized {
            let _ = win.unmaximize();
        } else {
            let _ = win.maximize();
        }
    }
}
