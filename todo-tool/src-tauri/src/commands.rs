use chrono::{Datelike, Local, TimeZone, Utc};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

use crate::events::{StatePayload, EVENT_STATE_UPDATED};
use crate::models::{BackupSchedule, RepeatRule, Settings, Task};
use crate::repeat::next_due_timestamp;
use crate::state::AppState;
use crate::storage::{Storage, StorageError};
use crate::tray::update_tray_count;

#[derive(Debug, serde::Serialize)]
pub struct CommandResult<T> {
    pub ok: bool,
    pub data: Option<T>,
    pub error: Option<String>,
}

fn ok<T>(data: T) -> CommandResult<T> {
    CommandResult {
        ok: true,
        data: Some(data),
        error: None,
    }
}

fn err<T>(message: &str) -> CommandResult<T> {
    CommandResult {
        ok: false,
        data: None,
        error: Some(message.to_string()),
    }
}

fn persist(app: &AppHandle, state: &AppState) -> Result<(), StorageError> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|err| StorageError::Io(std::io::Error::other(err.to_string())))?;
    let storage = Storage::new(root);
    storage.ensure_dirs()?;
    let now = Utc::now().timestamp();
    let mut settings = state.settings();
    let should_backup = should_auto_backup(&settings, now);
    if should_backup {
        settings.last_backup_at = Some(now);
        state.update_settings(settings.clone());
    }
    storage.save_tasks(&state.tasks_file(), should_backup)?;
    storage.save_settings(&state.settings_file())?;
    update_tray_count(app, &state.tasks());
    let payload = StatePayload {
        tasks: state.tasks(),
        settings: state.settings(),
    };
    let _ = app.emit(EVENT_STATE_UPDATED, payload);
    Ok(())
}

fn should_auto_backup(settings: &Settings, now: i64) -> bool {
    match settings.backup_schedule {
        BackupSchedule::None => false,
        BackupSchedule::Daily => is_new_day(settings.last_backup_at, now),
        BackupSchedule::Weekly => is_new_week(settings.last_backup_at, now),
        BackupSchedule::Monthly => is_new_month(settings.last_backup_at, now),
    }
}

fn is_new_day(last: Option<i64>, now: i64) -> bool {
    match last {
        None => true,
        Some(ts) => {
            let last_date = Local
                .timestamp_opt(ts, 0)
                .single()
                .map(|dt| dt.date_naive());
            let now_date = Local
                .timestamp_opt(now, 0)
                .single()
                .map(|dt| dt.date_naive());
            last_date != now_date
        }
    }
}

fn is_new_week(last: Option<i64>, now: i64) -> bool {
    match last {
        None => true,
        Some(ts) => {
            let last_date = Local.timestamp_opt(ts, 0).single().map(|dt| dt.iso_week());
            let now_date = Local.timestamp_opt(now, 0).single().map(|dt| dt.iso_week());
            last_date != now_date
        }
    }
}

fn is_new_month(last: Option<i64>, now: i64) -> bool {
    match last {
        None => true,
        Some(ts) => {
            let last_date = Local
                .timestamp_opt(ts, 0)
                .single()
                .map(|dt| (dt.year(), dt.month()));
            let now_date = Local
                .timestamp_opt(now, 0)
                .single()
                .map(|dt| (dt.year(), dt.month()));
            last_date != now_date
        }
    }
}

#[tauri::command]
pub fn load_state(app: AppHandle, state: State<AppState>) -> CommandResult<(Vec<Task>, Settings)> {
    let root = match app.path().app_data_dir() {
        Ok(path) => path,
        Err(e) => return err(&format!("app_data_dir error: {e}")),
    };
    let storage = Storage::new(root);
    if let Err(error) = storage.ensure_dirs() {
        return err(&format!("storage error: {error:?}"));
    }
    let tasks = storage
        .load_tasks()
        .map(|data| data.tasks)
        .unwrap_or_default();
    let settings = storage
        .load_settings()
        .map(|data| data.settings)
        .unwrap_or_else(|_| Settings::default());
    state.update_settings(settings.clone());
    ok((tasks, settings))
}

#[tauri::command]
pub fn create_task(app: AppHandle, state: State<AppState>, task: Task) -> CommandResult<Task> {
    let mut task = task;
    if task.sort_order == 0 {
        task.sort_order = task.created_at * 1000;
    }
    state.add_task(task.clone());
    if let Err(error) = persist(&app, &state) {
        return err(&format!("storage error: {error:?}"));
    }
    ok(task)
}

#[tauri::command]
pub fn update_task(app: AppHandle, state: State<AppState>, task: Task) -> CommandResult<Task> {
    let mut task = task;
    if task.sort_order == 0 {
        task.sort_order = task.created_at * 1000;
    }
    state.update_task(task.clone());
    if let Err(error) = persist(&app, &state) {
        return err(&format!("storage error: {error:?}"));
    }
    ok(task)
}

#[tauri::command]
pub fn swap_sort_order(
    app: AppHandle,
    state: State<AppState>,
    first_id: String,
    second_id: String,
) -> CommandResult<bool> {
    let now = Utc::now().timestamp();
    if !state.swap_sort_order(&first_id, &second_id, now) {
        return err("task not found");
    }
    if let Err(error) = persist(&app, &state) {
        return err(&format!("storage error: {error:?}"));
    }
    ok(true)
}

#[tauri::command]
pub fn complete_task(
    app: AppHandle,
    state: State<AppState>,
    task_id: String,
) -> CommandResult<Task> {
    let completed = match state.complete_task(&task_id) {
        Some(task) => task,
        None => return err("task not found"),
    };

    if let RepeatRule::None = completed.repeat {
        if let Err(error) = persist(&app, &state) {
            return err(&format!("storage error: {error:?}"));
        }
        return ok(completed);
    }

    let next_due = next_due_timestamp(completed.due_at, &completed.repeat);

    let mut next = completed.clone();
    next.id = format!("{}-{}", completed.id, Utc::now().timestamp());
    next.completed = false;
    next.completed_at = None;
    next.created_at = Utc::now().timestamp();
    next.updated_at = Utc::now().timestamp();
    next.sort_order = Utc::now().timestamp_millis();
    next.due_at = next_due;
    next.reminder.last_fired_at = None;
    next.reminder.forced_dismissed = false;
    next.reminder.snoozed_until = None;

    state.add_task(next.clone());

    if let Err(error) = persist(&app, &state) {
        return err(&format!("storage error: {error:?}"));
    }

    ok(next)
}

#[tauri::command]
pub fn update_settings(
    app: AppHandle,
    state: State<AppState>,
    settings: Settings,
) -> CommandResult<Settings> {
    let previous = state.settings();

    // Shortcut validation/registration is the #1 place users can lock themselves out:
    // if we unregister the old one and fail to register the new one, the app becomes unreachable
    // from the keyboard. So we validate + register with a rollback path and only then persist.
    let mut shortcut_changed = false;
    if previous.shortcut != settings.shortcut {
        shortcut_changed = true;
        let next_shortcut = match settings
            .shortcut
            .parse::<tauri_plugin_global_shortcut::Shortcut>()
        {
            Ok(value) => value,
            Err(parse_err) => return err(&format!("invalid shortcut: {parse_err}")),
        };

        let _ = app.global_shortcut().unregister_all();
        if let Err(register_err) = app.global_shortcut().register(next_shortcut) {
            // Best-effort restore the previous shortcut so the user can still summon the quick window.
            if let Ok(prev_shortcut) = previous
                .shortcut
                .parse::<tauri_plugin_global_shortcut::Shortcut>()
            {
                let _ = app.global_shortcut().register(prev_shortcut);
            }
            return err(&format!("failed to register shortcut: {register_err}"));
        }
    }

    state.update_settings(settings.clone());
    if let Err(error) = persist(&app, &state) {
        // Roll back in-memory settings to keep the running app consistent.
        state.update_settings(previous.clone());
        if shortcut_changed {
            let _ = app.global_shortcut().unregister_all();
            if let Ok(prev_shortcut) = previous
                .shortcut
                .parse::<tauri_plugin_global_shortcut::Shortcut>()
            {
                let _ = app.global_shortcut().register(prev_shortcut);
            }
        }
        return err(&format!("storage error: {error:?}"));
    }

    ok(settings)
}

#[tauri::command]
pub fn snooze_task(
    app: AppHandle,
    state: State<AppState>,
    task_id: String,
    until: i64,
) -> CommandResult<bool> {
    let mut tasks = state.tasks();
    if let Some(task) = tasks.iter_mut().find(|t| t.id == task_id) {
        task.reminder.snoozed_until = Some(until);
        task.reminder.last_fired_at = Some(Utc::now().timestamp());
        state.update_task(task.clone());
    }
    if let Err(error) = persist(&app, &state) {
        return err(&format!("storage error: {error:?}"));
    }
    ok(true)
}

#[tauri::command]
pub fn dismiss_forced(
    app: AppHandle,
    state: State<AppState>,
    task_id: String,
) -> CommandResult<bool> {
    let mut tasks = state.tasks();
    if let Some(task) = tasks.iter_mut().find(|t| t.id == task_id) {
        task.reminder.forced_dismissed = true;
        task.reminder.last_fired_at = Some(Utc::now().timestamp());
        state.update_task(task.clone());
    }
    if let Err(error) = persist(&app, &state) {
        return err(&format!("storage error: {error:?}"));
    }
    ok(true)
}

#[tauri::command]
pub fn delete_task(app: AppHandle, state: State<AppState>, task_id: String) -> CommandResult<bool> {
    state.remove_task(&task_id);
    if let Err(error) = persist(&app, &state) {
        return err(&format!("storage error: {error:?}"));
    }
    ok(true)
}

#[tauri::command]
pub fn delete_tasks(
    app: AppHandle,
    state: State<AppState>,
    task_ids: Vec<String>,
) -> CommandResult<bool> {
    state.remove_tasks(&task_ids);
    if let Err(error) = persist(&app, &state) {
        return err(&format!("storage error: {error:?}"));
    }
    ok(true)
}

#[derive(Debug, serde::Serialize)]
pub struct BackupEntry {
    pub name: String,
    pub modified_at: i64,
}

#[tauri::command]
pub fn list_backups(app: AppHandle) -> CommandResult<Vec<BackupEntry>> {
    let root = match app.path().app_data_dir() {
        Ok(path) => path,
        Err(e) => return err(&format!("app_data_dir error: {e}")),
    };
    let storage = Storage::new(root);
    if let Err(error) = storage.ensure_dirs() {
        return err(&format!("storage error: {error:?}"));
    }
    let entries = match storage.list_backups() {
        Ok(list) => list
            .into_iter()
            .map(|(name, modified_at)| BackupEntry { name, modified_at })
            .collect(),
        Err(error) => return err(&format!("storage error: {error:?}")),
    };
    ok(entries)
}

#[tauri::command]
pub fn create_backup(app: AppHandle, state: State<AppState>) -> CommandResult<bool> {
    let root = match app.path().app_data_dir() {
        Ok(path) => path,
        Err(e) => return err(&format!("app_data_dir error: {e}")),
    };
    let storage = Storage::new(root);
    if let Err(error) = storage.ensure_dirs() {
        return err(&format!("storage error: {error:?}"));
    }
    if let Err(error) = storage.save_tasks(&state.tasks_file(), true) {
        return err(&format!("storage error: {error:?}"));
    }
    let now = Utc::now().timestamp();
    let mut settings = state.settings();
    settings.last_backup_at = Some(now);
    state.update_settings(settings.clone());
    if let Err(error) = storage.save_settings(&state.settings_file()) {
        return err(&format!("storage error: {error:?}"));
    }
    ok(true)
}

#[tauri::command]
pub fn restore_backup(
    app: AppHandle,
    state: State<AppState>,
    filename: String,
) -> CommandResult<Vec<Task>> {
    let root = match app.path().app_data_dir() {
        Ok(path) => path,
        Err(e) => return err(&format!("app_data_dir error: {e}")),
    };
    let storage = Storage::new(root);
    if let Err(error) = storage.ensure_dirs() {
        return err(&format!("storage error: {error:?}"));
    }
    let data = match storage.restore_backup(&filename) {
        Ok(data) => data,
        Err(error) => return err(&format!("storage error: {error:?}")),
    };
    state.replace_tasks(data.tasks.clone());
    update_tray_count(&app, &state.tasks());
    let payload = StatePayload {
        tasks: state.tasks(),
        settings: state.settings(),
    };
    let _ = app.emit(EVENT_STATE_UPDATED, payload);
    ok(data.tasks)
}

#[tauri::command]
pub fn import_backup(
    app: AppHandle,
    state: State<AppState>,
    path: String,
) -> CommandResult<Vec<Task>> {
    let root = match app.path().app_data_dir() {
        Ok(path) => path,
        Err(e) => return err(&format!("app_data_dir error: {e}")),
    };
    let storage = Storage::new(root);
    if let Err(error) = storage.ensure_dirs() {
        return err(&format!("storage error: {error:?}"));
    }
    let data = match storage.restore_from_path(std::path::Path::new(&path)) {
        Ok(data) => data,
        Err(error) => return err(&format!("storage error: {error:?}")),
    };
    state.replace_tasks(data.tasks.clone());
    update_tray_count(&app, &state.tasks());
    let payload = StatePayload {
        tasks: state.tasks(),
        settings: state.settings(),
    };
    let _ = app.emit(EVENT_STATE_UPDATED, payload);
    ok(data.tasks)
}
