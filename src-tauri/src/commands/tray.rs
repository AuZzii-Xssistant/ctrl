//! System tray icon + menu — lets CTRL stay reachable (pinned items, show/hide,
//! quit) without the main window open. Menu is rebuilt from the `pinned` table
//! whenever pins change (see dashboard.rs's pin_item/unpin_item), so it never
//! drifts from what's actually pinned.

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager,
};

use crate::AppState;

/// (item_type, item_id, name) for each pinned item, in dashboard sort order.
fn fetch_pinned(app: &AppHandle) -> Vec<(String, i64, String)> {
    let Some(state) = app.try_state::<AppState>() else {
        return vec![];
    };
    let Ok(db) = state.0.lock() else {
        return vec![];
    };
    let Ok(mut stmt) = db
        .prepare("SELECT item_type, item_id FROM pinned ORDER BY group_name, sort_order LIMIT 10")
    else {
        return vec![];
    };
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)));
    let Ok(rows) = rows else { return vec![] };
    rows.filter_map(|r| r.ok())
        .filter_map(|(item_type, item_id)| {
            let name = crate::commands::dashboard::resolve_item_name(&db, &item_type, item_id);
            if name.is_empty() {
                None
            } else {
                Some((item_type, item_id, name))
            }
        })
        .collect()
}

/// Name of the active System Profile, if any (see commands::profiles).
fn fetch_active_profile(app: &AppHandle) -> Option<String> {
    let state = app.try_state::<AppState>()?;
    let db = state.0.lock().ok()?;
    db.query_row(
        "SELECT p.name FROM profile_state s JOIN profiles p ON p.id=s.active_profile_id WHERE s.id=1",
        [],
        |r| r.get::<_, String>(0),
    ).ok()
}

/// (Re)build the tray icon and its menu. Safe to call repeatedly — replaces
/// any existing tray icon rather than stacking a second one.
pub fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "tray_show", "Show CTRL", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;

    let active_profile = fetch_active_profile(app)
        .map(|name| {
            MenuItem::with_id(
                app,
                "tray_active_profile",
                format!("Profile: {name}"),
                false,
                None::<&str>,
            )
        })
        .transpose()?;
    let sep_profile = if active_profile.is_some() {
        Some(PredefinedMenuItem::separator(app)?)
    } else {
        None
    };

    let pins = fetch_pinned(app);
    let mut pin_items: Vec<MenuItem<tauri::Wry>> = Vec::new();
    if pins.is_empty() {
        pin_items.push(MenuItem::with_id(
            app,
            "tray_no_pins",
            "No pinned items",
            false,
            None::<&str>,
        )?);
    } else {
        for (item_type, item_id, name) in &pins {
            let id = format!("tray_launch:{item_type}:{item_id}");
            pin_items.push(MenuItem::with_id(app, id, name, true, None::<&str>)?);
        }
    }
    let sep2 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "tray_quit", "Quit CTRL", true, None::<&str>)?;

    let mut builder_items: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = vec![&show, &sep1];
    if let Some(ap) = &active_profile {
        builder_items.push(ap);
        builder_items.push(sep_profile.as_ref().unwrap());
    }
    for item in &pin_items {
        builder_items.push(item);
    }
    builder_items.push(&sep2);
    builder_items.push(&quit);

    let menu = Menu::with_items(app, &builder_items)?;

    // Remove any previous tray icon before creating a new one (rebuild path).
    if let Some(existing) = app.tray_by_id("main") {
        app.remove_tray_by_id(&existing.id().clone());
    }

    TrayIconBuilder::with_id("main")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .tooltip(">_ CTRL")
        .icon(
            app.default_window_icon()
                .cloned()
                .ok_or(tauri::Error::AssetNotFound("icon".into()))?,
        )
        .on_menu_event(move |app, event| {
            let id = event.id().as_ref();
            if id == "tray_show" {
                show_main_window(app);
            } else if id == "tray_quit" {
                app.exit(0);
            } else if let Some(rest) = id.strip_prefix("tray_launch:") {
                if let Some((item_type, item_id)) = rest.split_once(':') {
                    if let Ok(item_id) = item_id.parse::<i64>() {
                        crate::commands::dashboard::launch_pinned_from_tray(
                            app, item_type, item_id,
                        );
                    }
                }
            }
        })
        .build(app)?;

    Ok(())
}

pub fn show_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}
