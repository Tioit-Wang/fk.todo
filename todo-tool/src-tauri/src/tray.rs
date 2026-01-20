use chrono::{Local, TimeZone};

use crate::models::Task;

#[cfg(all(feature = "app", not(test)))]
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Manager, Runtime,
};

#[cfg(all(feature = "app", not(test)))]
const TRAY_ID: &str = "main";

#[cfg(all(feature = "app", not(test)))]
pub fn init_tray(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let show_quick = MenuItem::with_id(app, "show_quick", "打开快捷窗口", true, None::<&str>)?;
    let show_main = MenuItem::with_id(app, "show_main", "打开主界面", true, None::<&str>)?;
    let show_settings = MenuItem::with_id(app, "show_settings", "设置", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_quick, &show_main, &show_settings, &quit])?;

    let _tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "quit" => app.exit(0),
            "show_quick" => {
                if let Some(window) = app.get_webview_window("quick") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "show_main" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                    // Always bring the main window back to its primary view.
                    let _ = window.eval("window.location.hash = '#/main'");
                }
            }
            "show_settings" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = window.eval("window.location.hash = '#/main/settings'");
                }
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("quick") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}

#[cfg(all(feature = "app", not(test)))]
pub fn update_tray_count<R: Runtime>(app: &AppHandle<R>, tasks: &[Task]) {
    let tooltip = tray_tooltip(tasks, Local::now());

    // In production we update the real tray icon. In tests we avoid touching platform tray APIs
    // (and keep coverage focused on the tooltip computation logic).
    {
        if let Some(tray) = app.tray_by_id(TRAY_ID) {
            let _ = tray.set_tooltip(Some(tooltip));
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

fn tray_tooltip(tasks: &[Task], now: chrono::DateTime<Local>) -> String {
    let count = pending_count_at(tasks, now);
    format!("待办: {count}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ReminderConfig, RepeatRule, Task};

    fn make_task(id: &str, due_at: i64, completed: bool) -> Task {
        Task {
            id: id.to_string(),
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

        let tooltip = tray_tooltip(&tasks, now);
        assert_eq!(tooltip, "待办: 2");
    }
}
