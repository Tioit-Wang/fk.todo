use chrono::{Local, TimeZone};
#[cfg(all(feature = "app", not(test)))]
use sys_locale::get_locale;

#[cfg(all(feature = "app", not(test)))]
use crate::models::Settings;
use crate::models::Task;

#[cfg(all(feature = "app", not(test)))]
use crate::events::{NavigatePayload, EVENT_NAVIGATE};
#[cfg(all(feature = "app", not(test)))]
use crate::windows::show_settings_window;
#[cfg(all(feature = "app", not(test)))]
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Emitter, Manager, Runtime,
};

#[cfg(all(feature = "app", not(test)))]
const TRAY_ID: &str = "main";

#[derive(Clone, Copy)]
enum TrayLanguage {
    Zh,
    En,
}

#[allow(dead_code)]
struct TrayLabels {
    show_quick: &'static str,
    show_main: &'static str,
    show_settings: &'static str,
    quit: &'static str,
    tooltip_prefix: &'static str,
}

#[cfg(all(feature = "app", not(test)))]
fn resolve_tray_language(language: &str) -> TrayLanguage {
    let normalized = language.trim().to_lowercase();
    match normalized.as_str() {
        "zh" => TrayLanguage::Zh,
        "en" => TrayLanguage::En,
        _ => detect_system_language(),
    }
}

#[cfg(all(feature = "app", not(test)))]
fn detect_system_language() -> TrayLanguage {
    let locale = get_locale().unwrap_or_default().to_lowercase();
    if locale.starts_with("zh") {
        TrayLanguage::Zh
    } else {
        TrayLanguage::En
    }
}

fn tray_labels(lang: TrayLanguage) -> TrayLabels {
    match lang {
        TrayLanguage::Zh => TrayLabels {
            show_quick: "打开快捷窗口",
            show_main: "打开主界面",
            show_settings: "设置",
            quit: "退出",
            tooltip_prefix: "待办",
        },
        TrayLanguage::En => TrayLabels {
            show_quick: "Open quick window",
            show_main: "Open main window",
            show_settings: "Settings",
            quit: "Quit",
            tooltip_prefix: "Pending",
        },
    }
}

#[cfg(all(feature = "app", not(test)))]
fn build_tray_menu<R: Runtime, M: Manager<R>>(
    app: &M,
    lang: TrayLanguage,
) -> Result<Menu<R>, Box<dyn std::error::Error>> {
    let labels = tray_labels(lang);
    let show_quick = MenuItem::with_id(app, "show_quick", labels.show_quick, true, None::<&str>)?;
    let show_main = MenuItem::with_id(app, "show_main", labels.show_main, true, None::<&str>)?;
    let show_settings = MenuItem::with_id(
        app,
        "show_settings",
        labels.show_settings,
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", labels.quit, true, None::<&str>)?;
    Ok(Menu::with_items(
        app,
        &[&show_quick, &show_main, &show_settings, &quit],
    )?)
}

#[cfg(all(feature = "app", not(test)))]
pub fn init_tray(app: &mut App, settings: &Settings) -> Result<(), Box<dyn std::error::Error>> {
    let icon = app.default_window_icon().cloned().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "default window icon is missing",
        )
    })?;

    let lang = resolve_tray_language(&settings.language);
    let menu = build_tray_menu(app, lang)?;

    let _tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let id = event.id.as_ref();
            log::info!("tray: menu_event id={id}");

            match id {
                "quit" => app.exit(0),
                "show_quick" => {
                    if let Some(window) = app.get_webview_window("quick") {
                        if let Err(err) = window.unminimize() {
                            log::warn!("tray: failed to unminimize quick window: {err}");
                        }
                        if let Err(err) = window.show() {
                            log::warn!("tray: failed to show quick window: {err}");
                        }
                        if let Err(err) = window.set_focus() {
                            log::warn!("tray: failed to focus quick window: {err}");
                        }
                    } else {
                        log::warn!("tray: quick window missing");
                    }
                }
                "show_main" => {
                    if let Some(window) = app.get_webview_window("main") {
                        if let Err(err) = window.unminimize() {
                            log::warn!("tray: failed to unminimize main window: {err}");
                        }
                        if let Err(err) = window.show() {
                            log::warn!("tray: failed to show main window: {err}");
                        }
                        if let Err(err) = window.set_focus() {
                            log::warn!("tray: failed to focus main window: {err}");
                        }
                        // Ask the frontend to navigate; avoids injecting JS via eval.
                        if let Err(err) = window.emit(
                            EVENT_NAVIGATE,
                            NavigatePayload {
                                hash: "#/main".to_string(),
                            },
                        ) {
                            log::warn!("tray: failed to emit navigate event: {err}");
                        }
                    } else {
                        log::warn!("tray: main window missing");
                    }
                }
                "show_settings" => {
                    if let Err(err) = show_settings_window(app) {
                        log::warn!("tray: failed to show settings window: {err}");
                    }
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                log::info!("tray: left_click");
                if let Some(window) = app.get_webview_window("quick") {
                    if let Err(err) = window.unminimize() {
                        log::warn!("tray: failed to unminimize quick window (left click): {err}");
                    }
                    if let Err(err) = window.show() {
                        log::warn!("tray: failed to show quick window (left click): {err}");
                    }
                    if let Err(err) = window.set_focus() {
                        log::warn!("tray: failed to focus quick window (left click): {err}");
                    }
                } else {
                    log::warn!("tray: quick window missing (left click)");
                }
            }
        })
        .build(app)?;

    Ok(())
}

#[cfg(all(feature = "app", not(test)))]
pub fn update_tray_count<R: Runtime>(app: &AppHandle<R>, tasks: &[Task], settings: &Settings) {
    let lang = resolve_tray_language(&settings.language);
    let tooltip = tray_tooltip(tasks, Local::now(), lang);

    // In production we update the real tray icon. In tests we avoid touching platform tray APIs
    // (and keep coverage focused on the tooltip computation logic).
    {
        if let Some(tray) = app.tray_by_id(TRAY_ID) {
            if let Err(err) = tray.set_tooltip(Some(tooltip)) {
                log::warn!("tray: failed to update tooltip: {err}");
            }
            match build_tray_menu(app, lang) {
                Ok(menu) => {
                    if let Err(err) = tray.set_menu(Some(menu)) {
                        log::warn!("tray: failed to update menu: {err}");
                    }
                }
                Err(err) => {
                    log::warn!("tray: failed to rebuild menu: {err}");
                }
            }
        }
    }
}

fn pending_count_at(tasks: &[Task], now: chrono::DateTime<Local>) -> usize {
    let now_ts = now.timestamp();
    let today = now.date_naive();
    tasks
        .iter()
        .filter(|task| !task.completed)
        .filter(|task| {
            if task.due_at < now_ts {
                return true;
            }
            let due = Local.timestamp_opt(task.due_at, 0).single();
            if let Some(due_time) = due {
                return due_time.date_naive() == today;
            }
            false
        })
        .count()
}

fn tray_tooltip(tasks: &[Task], now: chrono::DateTime<Local>, lang: TrayLanguage) -> String {
    let count = pending_count_at(tasks, now);
    let labels = tray_labels(lang);
    format!("{}: {count}", labels.tooltip_prefix)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ReminderConfig, RepeatRule, Task};

    fn make_task(id: &str, due_at: i64, completed: bool) -> Task {
        Task {
            id: id.to_string(),
            project_id: "inbox".to_string(),
            title: format!("task-{id}"),
            due_at,
            important: false,
            completed,
            completed_at: None,
            created_at: 1,
            updated_at: 1,
            sort_order: 1,
            quadrant: 1,
            notes: None,
            steps: Vec::new(),
            tags: Vec::new(),
            sample_tag: None,
            reminder: ReminderConfig::default(),
            repeat: RepeatRule::None,
        }
    }

    #[test]
    fn pending_count_counts_overdue_and_today_tasks() {
        let now = Local::now();
        let now_ts = now.timestamp();

        let tasks = vec![
            // Overdue (counts via due_at < now_ts).
            make_task("overdue", now_ts - 60, false),
            // Due today but in the future (counts via same-day match).
            make_task("today", now_ts + 60, false),
            // Far future (not today; should not count).
            make_task("future", now_ts + 2 * 24 * 60 * 60, false),
            // Completed tasks are excluded.
            make_task("done", now_ts - 60, true),
            // Out-of-range timestamp should be ignored (timestamp_opt(None)).
            make_task("invalid", i64::MAX, false),
        ];

        let count = pending_count_at(&tasks, now);
        assert_eq!(count, 2);

        let tooltip = tray_tooltip(&tasks, now, TrayLanguage::Zh);
        assert_eq!(tooltip, "待办: 2");

        let tooltip_en = tray_tooltip(&tasks, now, TrayLanguage::En);
        assert_eq!(tooltip_en, "Pending: 2");
    }
}
