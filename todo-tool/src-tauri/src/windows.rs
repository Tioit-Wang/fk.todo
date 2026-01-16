use tauri::{AppHandle, Manager, WebviewWindowBuilder};

pub fn ensure_reminder_window(app: &AppHandle) -> Result<(), tauri::Error> {
    if app.get_webview_window("reminder").is_some() {
        return Ok(());
    }
    WebviewWindowBuilder::new(
        app,
        "reminder",
        tauri::WebviewUrl::App("/#/reminder".into()),
    )
    .title("Reminder")
    .decorations(false)
    .resizable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(false)
    .build()?;
    Ok(())
}

pub fn show_reminder_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("reminder") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn show_quick_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("quick") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn hide_quick_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("quick") {
        let _ = window.hide();
    }
}
