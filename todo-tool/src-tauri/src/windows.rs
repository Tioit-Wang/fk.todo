use tauri::{AppHandle, Manager, Runtime};

pub fn show_reminder_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("reminder") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn hide_quick_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("quick") {
        let _ = window.hide();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn show_and_hide_window_functions_are_noops_when_windows_missing() {
        let app = tauri::test::mock_app();
        let handle = app.handle();

        // Should not panic.
        show_reminder_window(&handle);
        hide_quick_window(&handle);
    }

    #[test]
    fn show_reminder_window_and_hide_quick_window_work_when_present() {
        let app = tauri::test::mock_app();

        let reminder = tauri::WebviewWindowBuilder::new(&app, "reminder", Default::default())
            .visible(false)
            .build()
            .unwrap();
        assert!(!reminder.is_visible().unwrap());

        let quick = tauri::WebviewWindowBuilder::new(&app, "quick", Default::default())
            .visible(true)
            .build()
            .unwrap();
        assert!(quick.is_visible().unwrap());

        let handle = app.handle();
        show_reminder_window(&handle);
        hide_quick_window(&handle);

        assert!(reminder.is_visible().unwrap());
        assert!(!quick.is_visible().unwrap());
    }
}
