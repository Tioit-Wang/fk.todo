// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod commands;
mod events;
mod models;
mod scheduler;
mod state;
mod storage;
mod tray;
mod windows;
mod repeat;

use tauri::{Manager, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

use crate::commands::*;
use crate::scheduler::start_scheduler;
use crate::state::AppState;
use crate::storage::Storage;
use crate::tray::init_tray;
use crate::windows::hide_quick_window;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        if let Some(window) = app.get_webview_window("quick") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let storage = Storage::new(app.path().app_data_dir()?);
            storage.ensure_dirs()?;

            let tasks = storage.load_tasks().map(|data| data.tasks).unwrap_or_default();
            let settings = storage
                .load_settings()
                .map(|data| data.settings)
                .unwrap_or_default();
            let shortcut: Shortcut = settings.shortcut.parse()?;

            let state = AppState::new(tasks, settings);
            app.manage(state.clone());

            WebviewWindowBuilder::new(
                app,
                "quick",
                tauri::WebviewUrl::App("/#/quick".into()),
            )
            .title("Todo Quick")
            .inner_size(420.0, 520.0)
            .resizable(true)
            .visible(false)
            .build()?;

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

            init_tray(app)?;
            app.handle().global_shortcut().register(shortcut)?;
            start_scheduler(app.handle().clone(), state.clone());

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let label = window.label().to_string();
                if label == "quick" {
                    hide_quick_window(&window.app_handle());
                    api.prevent_close();
                    return;
                }
                if label == "main" {
                    let state = window.app_handle().state::<AppState>();
                    let settings = state.settings();
                    match settings.close_behavior {
                        crate::models::CloseBehavior::Exit => {
                            window.app_handle().exit(0);
                        }
                        crate::models::CloseBehavior::HideToTray => {
                            let _ = window.hide();
                            api.prevent_close();
                        }
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            load_state,
            create_task,
            update_task,
            complete_task,
            update_settings,
            snooze_task,
            dismiss_forced,
            delete_task,
            delete_tasks,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
