// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod commands;
mod ai;
mod events;
#[cfg(all(feature = "app", not(test)))]
mod logging;
mod models;
mod repeat;
mod scheduler;
mod state;
mod storage;
mod tray;
#[cfg(all(feature = "app", not(test)))]
mod windows;

#[cfg(all(feature = "app", not(test)))]
use tauri::{Manager, WebviewWindowBuilder, WindowEvent};
#[cfg(all(feature = "app", not(test)))]
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

#[cfg(all(feature = "app", not(test)))]
use crate::commands::*;
#[cfg(all(feature = "app", not(test)))]
use crate::scheduler::start_scheduler;
#[cfg(all(feature = "app", not(test)))]
use crate::state::AppState;
#[cfg(all(feature = "app", not(test)))]
use crate::storage::Storage;
#[cfg(all(feature = "app", not(test)))]
use crate::tray::init_tray;
#[cfg(all(feature = "app", not(test)))]
use crate::tray::update_tray_count;
#[cfg(all(feature = "app", not(test)))]
use crate::windows::{hide_quick_window, hide_settings_window};

#[cfg_attr(all(mobile, feature = "app"), tauri::mobile_entry_point)]
#[cfg(all(feature = "app", not(test)))]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        // When the user is recording a shortcut in Settings, ignore the global
                        // shortcut handler so we don't accidentally pop up the quick window.
                        let state = app.state::<AppState>();
                        if state.is_shortcut_capture_active() {
                            return;
                        }
                        if let Some(window) = app.get_webview_window("quick") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;

            if let Err(err) = crate::logging::init_logging(&app_data_dir) {
                // Logger init should never brick the app; keep it best-effort.
                eprintln!("failed to initialize logger: {err}");
            }

            log::info!(
                "app starting name={} version={} os={} arch={} app_data_dir={}",
                env!("CARGO_PKG_NAME"),
                env!("CARGO_PKG_VERSION"),
                std::env::consts::OS,
                std::env::consts::ARCH,
                app_data_dir.display()
            );

            let storage = Storage::new(app_data_dir);
            storage.ensure_dirs()?;

            let tasks_file = match storage.load_tasks() {
                Ok(file) => file,
                Err(err) => {
                    log::warn!("failed to load tasks file; using defaults: {err}");
                    crate::models::TasksFile {
                        schema_version: 1,
                        tasks: Vec::new(),
                        projects: Vec::new(),
                    }
                }
            };
            let tasks = tasks_file.tasks;
            let projects = tasks_file.projects;
            let mut settings = match storage.load_settings() {
                Ok(file) => file.settings,
                Err(err) => {
                    log::warn!("failed to load settings file; using defaults: {err}");
                    crate::models::Settings::default()
                }
            };

            // Normalize potentially user-edited settings files. We keep the app bootable even if
            // the shortcut is invalid/unregisterable, otherwise users can brick the app.
            let mut settings_dirty = false;
            let trimmed_shortcut = settings.shortcut.trim().to_string();
            if trimmed_shortcut != settings.shortcut {
                settings.shortcut = trimmed_shortcut;
                settings_dirty = true;
            }

            let trimmed_language = settings.language.trim().to_lowercase();
            let normalized_language = match trimmed_language.as_str() {
                "auto" | "zh" | "en" => trimmed_language,
                _ => {
                    let fallback = crate::models::Settings::default().language;
                    if fallback != settings.language {
                        settings_dirty = true;
                    }
                    fallback
                }
            };
            if normalized_language != settings.language {
                settings.language = normalized_language;
                settings_dirty = true;
            }

            let shortcut = match settings.shortcut.parse::<Shortcut>() {
                Ok(shortcut) => Some(shortcut),
                Err(parse_err) => {
                    log::warn!("invalid shortcut in settings; falling back: {parse_err}");
                    let fallback = crate::models::Settings::default().shortcut;
                    if fallback != settings.shortcut {
                        settings.shortcut = fallback.clone();
                        settings_dirty = true;
                    }
                    match fallback.parse::<Shortcut>() {
                        Ok(shortcut) => Some(shortcut),
                        Err(parse_err) => {
                            log::error!("invalid default shortcut (unexpected): {parse_err}");
                            None
                        }
                    }
                }
            };

            log::info!(
                "loaded state tasks={} projects={} theme={} language={} close_behavior={:?} backup_schedule={:?}",
                tasks.len(),
                projects.len(),
                settings.theme,
                settings.language,
                settings.close_behavior,
                settings.backup_schedule
            );

            let state = AppState::new(tasks, projects, settings);
            app.manage(state.clone());

            // Create the main window programmatically so we can enable transparency on non-macOS
            // without requiring macOS private APIs.
            let main_builder =
                WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("/#/main".into()))
                    .title("MustDo")
                    .inner_size(1200.0, 980.0)
                    .min_inner_size(960.0, 980.0)
                    .resizable(false)
                    .decorations(false);

            // macOS builds skip `transparent` because Tauri gates it behind `macos-private-api`.
            #[cfg(not(target_os = "macos"))]
            let main_builder = main_builder.transparent(true);

            main_builder.visible(true).build()?;

            let quick_builder =
                WebviewWindowBuilder::new(app, "quick", tauri::WebviewUrl::App("/#/quick".into()))
                    .title("MustDo")
                    .inner_size(500.0, 650.0)
                    .min_inner_size(500.0, 650.0)
                    .max_inner_size(500.0, 650.0)
                    .resizable(false)
                    .decorations(false)
                    .skip_taskbar(true);

            // macOS builds skip `transparent` because Tauri gates it behind `macos-private-api`.
            #[cfg(not(target_os = "macos"))]
            let quick_builder = quick_builder.transparent(true);

            quick_builder.visible(false).build()?;

            // The app uses custom titlebars; remove maximization to keep the layout predictable.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_maximizable(false);
            }
            if let Some(window) = app.get_webview_window("quick") {
                let _ = window.set_maximizable(false);
            }

            init_tray(app, &state.settings())?;
            update_tray_count(app.handle(), &state.tasks(), &state.settings());

            if let Some(shortcut) = shortcut {
                if let Err(err) = app.handle().global_shortcut().register(shortcut) {
                    log::warn!("failed to register global shortcut: {err}");
                }
            }

            if settings_dirty {
                if let Err(err) = storage.save_settings(&state.settings_file()) {
                    log::warn!("failed to persist normalized settings: {err}");
                } else {
                    log::info!("persisted normalized settings");
                }
            }
            start_scheduler(app.handle().clone(), state.clone());
            log::info!("app setup completed");

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let label = window.label().to_string();
                if label == "quick" {
                    if hide_quick_window(window.app_handle()) {
                        api.prevent_close();
                    }
                    return;
                }
                if label == "settings" {
                    if hide_settings_window(window.app_handle()) {
                        api.prevent_close();
                    }
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
                            match window.hide() {
                                Ok(()) => {
                                    api.prevent_close();
                                }
                                Err(err) => {
                                    // If the hide request fails, allow the close to proceed so the
                                    // user isn't stuck with a non-functional close button.
                                    log::warn!(
                                        "failed to hide main window on close request; falling back to native close: {err}"
                                    );
                                }
                            }
                        }
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            load_state,
            create_project,
            update_project,
            swap_project_sort_order,
            delete_project,
            create_task,
            ai_plan_task,
            update_task,
            bulk_update_tasks,
            swap_sort_order,
            complete_task,
            bulk_complete_tasks,
            update_settings,
            show_settings_window,
            snooze_task,
            dismiss_forced,
            delete_task,
            delete_tasks,
            list_backups,
            delete_backup,
            create_backup,
            restore_backup,
            import_backup,
            export_tasks_json,
            export_tasks_csv,
            export_tasks_markdown,
            set_shortcut_capture_active,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
