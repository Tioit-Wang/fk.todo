use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

fn ensure_reminder_window<R: Runtime>(app: &AppHandle<R>) -> Option<WebviewWindow<R>> {
    if let Some(window) = app.get_webview_window("reminder") {
        log::debug!("ensure_reminder_window: reminder window already exists");
        return Some(window);
    }

    log::info!("ensure_reminder_window: building reminder window");
    let reminder_builder =
        WebviewWindowBuilder::new(app, "reminder", WebviewUrl::App("/#/reminder".into()))
            .title("MustDo")
            .decorations(false)
            .resizable(false)
            // "Forced reminder" should not be bypassable by minimizing a skip-taskbar window.
            .minimizable(false)
            // The reminder overlay looks best with a transparent window background, but on macOS
            // this is gated behind `macos-private-api`, so we only enable it on non-macOS by default.
            // The actual banner UI is rendered by the frontend.
            .always_on_top(true)
            .skip_taskbar(true)
            .visible(false);

    // macOS builds skip `transparent` because Tauri gates it behind `macos-private-api`.
    #[cfg(not(target_os = "macos"))]
    let reminder_builder = reminder_builder.transparent(true);

    match reminder_builder.build() {
        Ok(window) => {
            // The app uses custom titlebars; remove maximization to keep the layout predictable.
            let _ = window.set_maximizable(false);
            log::info!("ensure_reminder_window: reminder window built");
            Some(window)
        }
        Err(err) => {
            log::error!("failed to build reminder window: {err}");
            None
        }
    }
}

fn ensure_settings_window<R: Runtime>(app: &AppHandle<R>) -> Option<WebviewWindow<R>> {
    if let Some(window) = app.get_webview_window("settings") {
        log::debug!("ensure_settings_window: settings window already exists");
        return Some(window);
    }

    log::info!("ensure_settings_window: building settings window");
    let settings_builder =
        WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("/#/settings".into()))
            .title("MustDo")
            .inner_size(820.0, 900.0)
            .min_inner_size(820.0, 900.0)
            .max_inner_size(820.0, 900.0)
            .resizable(false)
            .minimizable(true)
            .decorations(false)
            .visible(false);

    // macOS builds skip `transparent` because Tauri gates it behind `macos-private-api`.
    #[cfg(not(target_os = "macos"))]
    let settings_builder = settings_builder.transparent(true);

    match settings_builder.build() {
        Ok(window) => {
            // The app uses custom titlebars; remove maximization to keep the layout predictable.
            let _ = window.set_maximizable(false);
            log::info!("ensure_settings_window: settings window built");
            Some(window)
        }
        Err(err) => {
            log::error!("failed to build settings window: {err}");
            None
        }
    }
}

pub fn show_reminder_window<R: Runtime>(app: &AppHandle<R>) {
    log::debug!("show_reminder_window: request");
    if let Some(window) = ensure_reminder_window(app) {
        // Best-effort: this window is skip-taskbar; if it was minimized it may look like
        // "only beep, no UI". Always try to restore it.
        if let Err(err) = window.unminimize() {
            log::warn!("show_reminder_window: failed to unminimize reminder window: {err}");
        }
        if let Err(err) = window.set_always_on_top(true) {
            log::warn!("show_reminder_window: failed to set always_on_top: {err}");
        }
        if let Err(err) = window.show() {
            log::warn!("show_reminder_window: failed to show reminder window: {err}");
        }
        if let Err(err) = window.set_focus() {
            log::warn!("show_reminder_window: failed to focus reminder window: {err}");
        }
    } else {
        log::warn!("show_reminder_window: reminder window is unavailable");
    }
}

pub fn show_settings_window<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    log::debug!("show_settings_window: request");
    let window =
        ensure_settings_window(app).ok_or_else(|| "settings window is unavailable".to_string())?;

    // Best-effort: if the user changed monitor setup (or the OS restored an off-screen position),
    // centering avoids the "window opened but I can't see it" class of bugs.
    if let Err(err) = window.center() {
        log::warn!("show_settings_window: failed to center settings window: {err}");
    }

    window
        .unminimize()
        .map_err(|err| format!("failed to unminimize settings window: {err}"))?;
    window
        .show()
        .map_err(|err| format!("failed to show settings window: {err}"))?;
    window
        .set_focus()
        .map_err(|err| format!("failed to focus settings window: {err}"))?;

    // Extra guard: on some platforms/driver combos, `show()` can succeed while the window
    // remains effectively invisible. If that happens, return an error so the frontend can
    // fall back to the in-window settings route.
    match window.is_visible() {
        Ok(true) => Ok(()),
        Ok(false) => Err("settings window is not visible after show()".to_string()),
        Err(err) => {
            log::warn!("show_settings_window: failed to query visibility: {err}");
            Ok(())
        }
    }
}

pub fn hide_quick_window<R: Runtime>(app: &AppHandle<R>) -> bool {
    if let Some(window) = app.get_webview_window("quick") {
        if let Err(err) = window.hide() {
            log::warn!("hide_quick_window: failed to hide quick window: {err}");
            return false;
        }
        return true;
    }
    log::warn!("hide_quick_window: quick window missing");
    false
}

pub fn hide_settings_window<R: Runtime>(app: &AppHandle<R>) -> bool {
    if let Some(window) = app.get_webview_window("settings") {
        if let Err(err) = window.hide() {
            log::warn!("hide_settings_window: failed to hide settings window: {err}");
            return false;
        }
        return true;
    }
    log::warn!("hide_settings_window: settings window missing");
    false
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
