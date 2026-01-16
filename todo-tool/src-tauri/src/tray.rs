use chrono::{Local, TimeZone};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Manager,
};

use crate::models::Task;

const TRAY_ID: &str = "main";

pub fn init_tray(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let show_quick = MenuItem::with_id(app, "show_quick", "打开快捷窗口", true, None::<&str>)?;
    let show_main = MenuItem::with_id(app, "show_main", "打开主界面", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_quick, &show_main, &quit])?;

    let _tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "quit" => app.exit(0),
            "show_quick" => {
                if let Some(window) = app.get_webview_window("quick") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "show_main" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
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
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}

pub fn update_tray_count(app: &AppHandle, tasks: &[Task]) {
    let count = pending_count(tasks);
    let tooltip = format!("待办: {count}");
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_tooltip(Some(tooltip));
    }
}

fn pending_count(tasks: &[Task]) -> usize {
    let now = Local::now();
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
