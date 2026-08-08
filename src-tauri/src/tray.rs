// System tray icon: left-click toggles the main window; right-click menu
// offers show / hide / new tab / quit.
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItemBuilder::new("显示窗口").id("tray-show").build(app)?;
    let hide = MenuItemBuilder::new("隐藏窗口").id("tray-hide").build(app)?;
    let new_tab = MenuItemBuilder::new("新建标签页").id("tray-new").build(app)?;
    let quit = MenuItemBuilder::new("退出 Jotpad").id("tray-quit").build(app)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;

    let menu = MenuBuilder::new(app)
        .item(&show)
        .item(&hide)
        .item(&sep1)
        .item(&new_tab)
        .item(&sep2)
        .item(&quit)
        .build()?;

    // No icon available -> skip tray silently.
    let icon = match app.default_window_icon().cloned() {
        Some(i) => i,
        None => return Ok(()),
    };

    TrayIconBuilder::with_id("main-tray")
        .icon(icon)
        .tooltip("Jotpad")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(w) = app.get_webview_window("main") {
                    if w.is_visible().unwrap_or(false) {
                        let _ = w.hide();
                    } else {
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                }
            }
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray-show" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            "tray-hide" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }
            "tray-new" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                    let _ = app.emit("tray://click", "new");
                }
            }
            "tray-quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;

    Ok(())
}
