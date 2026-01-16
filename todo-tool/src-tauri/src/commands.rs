use chrono::Utc;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

use crate::models::{RepeatRule, Settings, Task};
use crate::repeat::next_due_timestamp;
use crate::events::EVENT_STATE_UPDATED;
use crate::state::AppState;
use crate::storage::{Storage, StorageError};

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
        .map_err(|err| StorageError::Io(std::io::Error::new(std::io::ErrorKind::Other, err.to_string())))?;
    let storage = Storage::new(root);
    storage.ensure_dirs()?;
    storage.save_tasks(&state.tasks_file())?;
    storage.save_settings(&state.settings_file())?;
    let _ = app.emit(EVENT_STATE_UPDATED, state.tasks_file());
    Ok(())
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
    let tasks = storage.load_tasks().map(|data| data.tasks).unwrap_or_default();
    let settings = storage
        .load_settings()
        .map(|data| data.settings)
        .unwrap_or_else(|_| Settings::default());
    state.update_settings(settings.clone());
    ok((tasks, settings))
}

#[tauri::command]
pub fn create_task(app: AppHandle, state: State<AppState>, task: Task) -> CommandResult<Task> {
    state.add_task(task.clone());
    if let Err(error) = persist(&app, &state) {
        return err(&format!("storage error: {error:?}"));
    }
    ok(task)
}

#[tauri::command]
pub fn update_task(app: AppHandle, state: State<AppState>, task: Task) -> CommandResult<Task> {
    state.update_task(task.clone());
    if let Err(error) = persist(&app, &state) {
        return err(&format!("storage error: {error:?}"));
    }
    ok(task)
}

#[tauri::command]
pub fn complete_task(app: AppHandle, state: State<AppState>, task_id: String) -> CommandResult<Task> {
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
pub fn update_settings(app: AppHandle, state: State<AppState>, settings: Settings) -> CommandResult<Settings> {
    state.update_settings(settings.clone());
    if let Err(error) = persist(&app, &state) {
        return err(&format!("storage error: {error:?}"));
    }
    if let Ok(shortcut) = settings.shortcut.parse::<tauri_plugin_global_shortcut::Shortcut>() {
        let _ = app.global_shortcut().unregister_all();
        let _ = app.global_shortcut().register(shortcut);
    }
    ok(settings)
}

#[tauri::command]
pub fn snooze_task(app: AppHandle, state: State<AppState>, task_id: String, until: i64) -> CommandResult<bool> {
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
pub fn dismiss_forced(app: AppHandle, state: State<AppState>, task_id: String) -> CommandResult<bool> {
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
pub fn delete_tasks(app: AppHandle, state: State<AppState>, task_ids: Vec<String>) -> CommandResult<bool> {
    state.remove_tasks(&task_ids);
    if let Err(error) = persist(&app, &state) {
        return err(&format!("storage error: {error:?}"));
    }
    ok(true)
}
