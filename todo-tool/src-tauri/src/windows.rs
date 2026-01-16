use tauri::{AppHandle, Manager};

pub fn show_reminder_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("reminder") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn hide_quick_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("quick") {
        let _ = window.hide();
    }
}
