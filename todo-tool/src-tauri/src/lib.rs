// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod ai;
mod commands;
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
                            if let Err(err) = window.unminimize() {
                                log::warn!("shortcut: failed to unminimize quick window: {err}");
                            }
                            if let Err(err) = window.show() {
                                log::warn!("shortcut: failed to show quick window: {err}");
                            }
                            if let Err(err) = window.set_focus() {
                                log::warn!("shortcut: failed to focus quick window: {err}");
                            }
                        } else {
                            log::warn!("shortcut: quick window missing");
                        }
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let boot = std::time::Instant::now();

            let app_data_dir = app.path().app_data_dir()?;

            if let Err(err) = crate::logging::init_logging(&app_data_dir) {
                // Logger init should never brick the app; keep it best-effort.
                eprintln!("failed to initialize logger: {err}");
            }

            log::info!(
                "boot: setup begin tauri_is_dev={} debug_assertions={} elapsed_ms={}",
                tauri::is_dev(),
                cfg!(debug_assertions),
                boot.elapsed().as_millis()
            );
            log::info!(
                "boot: config dev_url={}",
                app.config()
                    .build
                    .dev_url
                    .as_ref()
                    .map(|url| url.as_str())
                    .unwrap_or("<none>")
            );

            log::info!(
                "app starting name={} version={} os={} arch={} app_data_dir={}",
                env!("CARGO_PKG_NAME"),
                env!("CARGO_PKG_VERSION"),
                std::env::consts::OS,
                std::env::consts::ARCH,
                app_data_dir.display()
            );

            let storage = Storage::new(app_data_dir.clone());
            storage.ensure_dirs().map_err(|err| {
                log::error!(
                    "boot: ensure_dirs failed root={} err={} elapsed_ms={}",
                    app_data_dir.display(),
                    err,
                    boot.elapsed().as_millis()
                );
                err
            })?;
            log::info!(
                "boot: ensure_dirs ok root={} elapsed_ms={}",
                app_data_dir.display(),
                boot.elapsed().as_millis()
            );

            let data_path = app_data_dir.join("data.json");
            let tasks_file = match storage.load_tasks() {
                Ok(file) => {
                    log::info!(
                        "boot: loaded data.json schema_version={} tasks={} projects={} elapsed_ms={}",
                        file.schema_version,
                        file.tasks.len(),
                        file.projects.len(),
                        boot.elapsed().as_millis()
                    );
                    file
                }
                Err(err) => {
                    match &err {
                        crate::storage::StorageError::Io(io_err)
                            if io_err.kind() == std::io::ErrorKind::NotFound =>
                        {
                            log::info!(
                                "boot: data.json missing path={} -> defaults elapsed_ms={}",
                                data_path.display(),
                                boot.elapsed().as_millis()
                            );
                        }
                        _ => {
                            log::warn!(
                                "boot: failed to load data.json path={} -> defaults err={} elapsed_ms={}",
                                data_path.display(),
                                err,
                                boot.elapsed().as_millis()
                            );
                        }
                    }
                    crate::models::TasksFile {
                        schema_version: 1,
                        tasks: Vec::new(),
                        projects: Vec::new(),
                    }
                }
            };
            let tasks = tasks_file.tasks;
            let projects = tasks_file.projects;

            let settings_path = app_data_dir.join("settings.json");
            let mut settings_missing = false;
            let settings_file = match storage.load_settings() {
                Ok(file) => {
                    let settings = &file.settings;
                    log::info!(
                        "boot: loaded settings.json schema_version={} theme={} language={} close_behavior={:?} minimize_behavior={:?} backup_schedule={:?} update_behavior={:?} shortcut={} ai_enabled={} deepseek_key_present={} elapsed_ms={}",
                        file.schema_version,
                        settings.theme,
                        settings.language,
                        settings.close_behavior,
                        settings.minimize_behavior,
                        settings.backup_schedule,
                        settings.update_behavior,
                        settings.shortcut,
                        settings.ai_enabled,
                        !settings.deepseek_api_key.trim().is_empty(),
                        boot.elapsed().as_millis()
                    );
                    file
                }
                Err(err) => {
                    match &err {
                        crate::storage::StorageError::Io(io_err)
                            if io_err.kind() == std::io::ErrorKind::NotFound =>
                        {
                            settings_missing = true;
                            log::info!(
                                "boot: settings.json missing path={} -> defaults elapsed_ms={}",
                                settings_path.display(),
                                boot.elapsed().as_millis()
                            );
                        }
                        _ => {
                            log::warn!(
                                "boot: failed to load settings.json path={} -> defaults err={} elapsed_ms={}",
                                settings_path.display(),
                                err,
                                boot.elapsed().as_millis()
                            );
                        }
                    }
                    crate::models::SettingsFile {
                        schema_version: 1,
                        settings: crate::models::Settings::default(),
                    }
                }
            };
            let mut settings = settings_file.settings;

            // Normalize potentially user-edited settings files. We keep the app bootable even if
            // the shortcut is invalid/unregisterable, otherwise users can brick the app.
            let mut settings_dirty = false;
            if settings_missing {
                // First run: ensure settings.json is created so future loads are deterministic.
                settings_dirty = true;
            }
            let original_shortcut = settings.shortcut.clone();
            let original_language = settings.language.clone();
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

            // AI settings: keep persisted config stable (and avoid bricking AI flows on empty model).
            let trimmed_ai_model = settings.ai_model.trim().to_string();
            if trimmed_ai_model != settings.ai_model {
                settings.ai_model = trimmed_ai_model;
                settings_dirty = true;
            }
            if settings.ai_model.is_empty() {
                settings.ai_model = crate::models::Settings::default().ai_model;
                settings_dirty = true;
            }
            let trimmed_deepseek_key = settings.deepseek_api_key.trim().to_string();
            if trimmed_deepseek_key != settings.deepseek_api_key {
                settings.deepseek_api_key = trimmed_deepseek_key;
                settings_dirty = true;
            }

            if settings.migrate_ai_prompt_if_legacy_default() {
                log::info!("boot: migrated ai_prompt (legacy default -> latest default)");
                settings_dirty = true;
            }

            if settings.shortcut != original_shortcut {
                log::info!(
                    "boot: normalized shortcut from=\"{}\" to=\"{}\" elapsed_ms={}",
                    original_shortcut,
                    settings.shortcut,
                    boot.elapsed().as_millis()
                );
            }
            if settings.language != original_language {
                log::info!(
                    "boot: normalized language from=\"{}\" to=\"{}\" elapsed_ms={}",
                    original_language,
                    settings.language,
                    boot.elapsed().as_millis()
                );
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
            log::info!("boot: building main window elapsed_ms={}", boot.elapsed().as_millis());
            let main_builder =
                WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("/#/main".into()))
                    .title("MustDo")
                    .inner_size(1200.0, 980.0)
                    .min_inner_size(960.0, 980.0)
                    .resizable(false)
                    .minimizable(true)
                    .decorations(false);

            // macOS builds skip `transparent` because Tauri gates it behind `macos-private-api`.
            #[cfg(not(target_os = "macos"))]
            let main_builder = main_builder.transparent(true);

            main_builder.visible(true).build().map_err(|err| {
                log::error!("boot: failed to build main window: {err}");
                err
            })?;
            log::info!("boot: main window built elapsed_ms={}", boot.elapsed().as_millis());

            log::info!("boot: building quick window elapsed_ms={}", boot.elapsed().as_millis());
            let quick_builder =
                WebviewWindowBuilder::new(app, "quick", tauri::WebviewUrl::App("/#/quick".into()))
                    .title("MustDo")
                    .inner_size(500.0, 650.0)
                    .min_inner_size(500.0, 650.0)
                    .max_inner_size(500.0, 650.0)
                    .resizable(false)
                    .minimizable(true)
                    .decorations(false)
                    .skip_taskbar(true);

            // macOS builds skip `transparent` because Tauri gates it behind `macos-private-api`.
            #[cfg(not(target_os = "macos"))]
            let quick_builder = quick_builder.transparent(true);

            quick_builder.visible(false).build().map_err(|err| {
                log::error!("boot: failed to build quick window: {err}");
                err
            })?;
            log::info!("boot: quick window built elapsed_ms={}", boot.elapsed().as_millis());

            // The app uses custom titlebars; remove maximization to keep the layout predictable.
            if let Some(window) = app.get_webview_window("main") {
                if let Err(err) = window.set_maximizable(false) {
                    log::warn!("boot: failed to disable maximize for main window: {err}");
                }
            } else {
                log::warn!("boot: main window missing after build");
            }
            if let Some(window) = app.get_webview_window("quick") {
                if let Err(err) = window.set_maximizable(false) {
                    log::warn!("boot: failed to disable maximize for quick window: {err}");
                }
            } else {
                log::warn!("boot: quick window missing after build");
            }

            log::info!("boot: init tray elapsed_ms={}", boot.elapsed().as_millis());
            init_tray(app, &state.settings()).map_err(|err| {
                log::error!("boot: init tray failed: {err}");
                err
            })?;
            log::info!("boot: tray ready elapsed_ms={}", boot.elapsed().as_millis());
            update_tray_count(app.handle(), &state.tasks(), &state.settings());

            if let Some(shortcut) = shortcut {
                match app.handle().global_shortcut().register(shortcut) {
                    Ok(()) => {
                        log::info!(
                            "boot: global shortcut registered shortcut={} elapsed_ms={}",
                            state.settings().shortcut,
                            boot.elapsed().as_millis()
                        );
                    }
                    Err(err) => {
                        log::warn!("failed to register global shortcut: {err}");
                    }
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
            log::info!(
                "boot: setup completed elapsed_ms={}",
                boot.elapsed().as_millis()
            );
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
            frontend_log,
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
