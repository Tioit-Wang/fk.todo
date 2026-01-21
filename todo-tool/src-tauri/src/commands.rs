use chrono::{Datelike, Local, TimeZone, Utc};
use std::path::PathBuf;

use crate::events::StatePayload;
#[cfg(all(feature = "app", not(test)))]
use crate::events::EVENT_STATE_UPDATED;
use crate::models::{BackupSchedule, RepeatRule, Settings, Task};
use crate::repeat::next_due_timestamp;
use crate::state::AppState;
use crate::storage::{Storage, StorageError};

#[cfg(all(feature = "app", not(test)))]
use crate::tray::update_tray_count;
#[cfg(all(feature = "app", not(test)))]
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
#[cfg(all(feature = "app", not(test)))]
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

#[derive(Debug, serde::Serialize)]
pub struct CommandResult<T> {
    pub ok: bool,
    pub data: Option<T>,
    pub error: Option<String>,
}

trait CommandCtx {
    fn app_data_dir(&self) -> Result<PathBuf, StorageError>;
    fn emit_state_updated(&self, payload: StatePayload);
    fn update_tray_count(&self, tasks: &[Task], settings: &Settings);
    fn shortcut_unregister_all(&self);
    fn shortcut_validate(&self, shortcut: &str) -> Result<(), String>;
    fn shortcut_register(&self, shortcut: &str) -> Result<(), String>;
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

fn persist(ctx: &impl CommandCtx, state: &AppState) -> Result<(), StorageError> {
    let root = ctx.app_data_dir()?;
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
    ctx.update_tray_count(&state.tasks(), &settings);
    let payload = StatePayload {
        tasks: state.tasks(),
        settings: state.settings(),
    };
    ctx.emit_state_updated(payload);
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

#[cfg(all(feature = "app", not(test)))]
struct TauriCommandCtx<'a, R: Runtime> {
    app: &'a AppHandle<R>,
}

#[cfg(all(feature = "app", not(test)))]
impl<R: Runtime> CommandCtx for TauriCommandCtx<'_, R> {
    fn app_data_dir(&self) -> Result<PathBuf, StorageError> {
        self.app
            .path()
            .app_data_dir()
            .map_err(|err| StorageError::Io(std::io::Error::other(err.to_string())))
    }

    fn emit_state_updated(&self, payload: StatePayload) {
        let _ = self.app.emit(EVENT_STATE_UPDATED, payload);
    }

    fn update_tray_count(&self, tasks: &[Task], settings: &Settings) {
        update_tray_count(self.app, tasks, settings);
    }

    fn shortcut_unregister_all(&self) {
        let _ = self.app.global_shortcut().unregister_all();
    }

    fn shortcut_validate(&self, shortcut: &str) -> Result<(), String> {
        let shortcut = shortcut.trim();
        if shortcut.is_empty() {
            return Err("empty shortcut".to_string());
        }
        shortcut
            .parse::<Shortcut>()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    fn shortcut_register(&self, shortcut: &str) -> Result<(), String> {
        let shortcut = shortcut.trim();
        if shortcut.is_empty() {
            return Err("empty shortcut".to_string());
        }
        // Help type inference for `FromStr` in older compilers / trait contexts.
        let parsed = shortcut.parse::<Shortcut>().map_err(|e| e.to_string())?;
        self.app
            .global_shortcut()
            .register(parsed)
            .map_err(|e| e.to_string())
    }
}

fn load_state_impl(
    ctx: &impl CommandCtx,
    state: &AppState,
) -> CommandResult<(Vec<Task>, Settings)> {
    let root = match ctx.app_data_dir() {
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

fn create_task_impl(ctx: &impl CommandCtx, state: &AppState, task: Task) -> CommandResult<Task> {
    let mut task = task;
    if task.sort_order == 0 {
        task.sort_order = task.created_at * 1000;
    }
    state.add_task(task.clone());
    if let Err(error) = persist(ctx, state) {
        return err(&format!("storage error: {error:?}"));
    }
    ok(task)
}

fn update_task_impl(ctx: &impl CommandCtx, state: &AppState, task: Task) -> CommandResult<Task> {
    let mut task = task;
    if task.sort_order == 0 {
        task.sort_order = task.created_at * 1000;
    }
    state.update_task(task.clone());
    if let Err(error) = persist(ctx, state) {
        return err(&format!("storage error: {error:?}"));
    }
    ok(task)
}

fn swap_sort_order_impl(
    ctx: &impl CommandCtx,
    state: &AppState,
    first_id: String,
    second_id: String,
) -> CommandResult<bool> {
    let now = Utc::now().timestamp();
    if !state.swap_sort_order(&first_id, &second_id, now) {
        return err("task not found");
    }
    if let Err(error) = persist(ctx, state) {
        return err(&format!("storage error: {error:?}"));
    }
    ok(true)
}

fn complete_task_impl(
    ctx: &impl CommandCtx,
    state: &AppState,
    task_id: String,
) -> CommandResult<Task> {
    let completed = match state.complete_task(&task_id) {
        Some(task) => task,
        None => return err("task not found"),
    };

    if let RepeatRule::None = completed.repeat {
        if let Err(error) = persist(ctx, state) {
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

    if let Err(error) = persist(ctx, state) {
        return err(&format!("storage error: {error:?}"));
    }

    ok(next)
}

fn update_settings_impl(
    ctx: &impl CommandCtx,
    state: &AppState,
    mut settings: Settings,
) -> CommandResult<Settings> {
    let previous = state.settings();
    let previous_shortcut = previous.shortcut.trim().to_string();
    let next_shortcut = settings.shortcut.trim().to_string();
    let previous_language = previous.language.trim().to_lowercase();
    let next_language = settings.language.trim().to_lowercase();

    // Normalize user input so tests/production behave the same and the persisted config is stable.
    settings.shortcut = next_shortcut.clone();
    settings.language = match next_language.as_str() {
        "auto" | "zh" | "en" => next_language.clone(),
        _ => Settings::default().language,
    };

    // Shortcut validation/registration is the #1 place users can lock themselves out:
    // if we unregister the old one and fail to register the new one, the app becomes unreachable
    // from the keyboard. So we validate + register with a rollback path and only then persist.
    let mut shortcut_changed = false;
    if previous_shortcut != next_shortcut {
        shortcut_changed = true;
        if let Err(parse_err) = ctx.shortcut_validate(&next_shortcut) {
            return err(&format!("invalid shortcut: {parse_err}"));
        }

        ctx.shortcut_unregister_all();
        if let Err(register_err) = ctx.shortcut_register(&next_shortcut) {
            // Best-effort restore the previous shortcut so the user can still summon the quick window.
            let _ = ctx.shortcut_register(&previous_shortcut);
            return err(&format!("failed to register shortcut: {register_err}"));
        }
    }

    // Currently language is a UI concern (and must never brick the app). We normalize above and
    // keep persistence best-effort only through the usual `persist()` path.
    let _language_changed = previous_language != settings.language;

    state.update_settings(settings.clone());
    if let Err(error) = persist(ctx, state) {
        // Roll back in-memory settings to keep the running app consistent.
        state.update_settings(previous.clone());
        if shortcut_changed {
            ctx.shortcut_unregister_all();
            let _ = ctx.shortcut_register(&previous_shortcut);
        }
        return err(&format!("storage error: {error:?}"));
    }

    ok(settings)
}

fn snooze_task_impl(
    ctx: &impl CommandCtx,
    state: &AppState,
    task_id: String,
    until: i64,
) -> CommandResult<bool> {
    let mut tasks = state.tasks();
    if let Some(task) = tasks.iter_mut().find(|t| t.id == task_id) {
        task.reminder.snoozed_until = Some(until);
        task.reminder.last_fired_at = Some(Utc::now().timestamp());
        state.update_task(task.clone());
    }
    if let Err(error) = persist(ctx, state) {
        return err(&format!("storage error: {error:?}"));
    }
    ok(true)
}

fn dismiss_forced_impl(
    ctx: &impl CommandCtx,
    state: &AppState,
    task_id: String,
) -> CommandResult<bool> {
    let mut tasks = state.tasks();
    if let Some(task) = tasks.iter_mut().find(|t| t.id == task_id) {
        task.reminder.forced_dismissed = true;
        task.reminder.last_fired_at = Some(Utc::now().timestamp());
        state.update_task(task.clone());
    }
    if let Err(error) = persist(ctx, state) {
        return err(&format!("storage error: {error:?}"));
    }
    ok(true)
}

fn delete_task_impl(
    ctx: &impl CommandCtx,
    state: &AppState,
    task_id: String,
) -> CommandResult<bool> {
    state.remove_task(&task_id);
    if let Err(error) = persist(ctx, state) {
        return err(&format!("storage error: {error:?}"));
    }
    ok(true)
}

fn delete_tasks_impl(
    ctx: &impl CommandCtx,
    state: &AppState,
    task_ids: Vec<String>,
) -> CommandResult<bool> {
    state.remove_tasks(&task_ids);
    if let Err(error) = persist(ctx, state) {
        return err(&format!("storage error: {error:?}"));
    }
    ok(true)
}

#[cfg(all(feature = "app", not(test)))]
#[tauri::command]
pub fn load_state(app: AppHandle, state: State<AppState>) -> CommandResult<(Vec<Task>, Settings)> {
    let ctx = TauriCommandCtx { app: &app };
    load_state_impl(&ctx, state.inner())
}

#[cfg(all(feature = "app", not(test)))]
#[tauri::command]
pub fn create_task(app: AppHandle, state: State<AppState>, task: Task) -> CommandResult<Task> {
    let ctx = TauriCommandCtx { app: &app };
    create_task_impl(&ctx, state.inner(), task)
}

#[cfg(all(feature = "app", not(test)))]
#[tauri::command]
pub fn update_task(app: AppHandle, state: State<AppState>, task: Task) -> CommandResult<Task> {
    let ctx = TauriCommandCtx { app: &app };
    update_task_impl(&ctx, state.inner(), task)
}

#[cfg(all(feature = "app", not(test)))]
#[tauri::command]
pub fn swap_sort_order(
    app: AppHandle,
    state: State<AppState>,
    first_id: String,
    second_id: String,
) -> CommandResult<bool> {
    let ctx = TauriCommandCtx { app: &app };
    swap_sort_order_impl(&ctx, state.inner(), first_id, second_id)
}

#[cfg(all(feature = "app", not(test)))]
#[tauri::command]
pub fn complete_task(
    app: AppHandle,
    state: State<AppState>,
    task_id: String,
) -> CommandResult<Task> {
    let ctx = TauriCommandCtx { app: &app };
    complete_task_impl(&ctx, state.inner(), task_id)
}

#[cfg(all(feature = "app", not(test)))]
#[tauri::command]
pub fn update_settings(
    app: AppHandle,
    state: State<AppState>,
    settings: Settings,
) -> CommandResult<Settings> {
    let ctx = TauriCommandCtx { app: &app };
    update_settings_impl(&ctx, state.inner(), settings)
}

#[cfg(all(feature = "app", not(test)))]
#[tauri::command]
pub fn snooze_task(
    app: AppHandle,
    state: State<AppState>,
    task_id: String,
    until: i64,
) -> CommandResult<bool> {
    let ctx = TauriCommandCtx { app: &app };
    snooze_task_impl(&ctx, state.inner(), task_id, until)
}

#[cfg(all(feature = "app", not(test)))]
#[tauri::command]
pub fn dismiss_forced(
    app: AppHandle,
    state: State<AppState>,
    task_id: String,
) -> CommandResult<bool> {
    let ctx = TauriCommandCtx { app: &app };
    dismiss_forced_impl(&ctx, state.inner(), task_id)
}

#[cfg(all(feature = "app", not(test)))]
#[tauri::command]
pub fn delete_task(app: AppHandle, state: State<AppState>, task_id: String) -> CommandResult<bool> {
    let ctx = TauriCommandCtx { app: &app };
    delete_task_impl(&ctx, state.inner(), task_id)
}

#[cfg(all(feature = "app", not(test)))]
#[tauri::command]
pub fn delete_tasks(
    app: AppHandle,
    state: State<AppState>,
    task_ids: Vec<String>,
) -> CommandResult<bool> {
    let ctx = TauriCommandCtx { app: &app };
    delete_tasks_impl(&ctx, state.inner(), task_ids)
}

#[derive(Debug, serde::Serialize)]
pub struct BackupEntry {
    pub name: String,
    pub modified_at: i64,
}

fn list_backups_impl(ctx: &impl CommandCtx) -> CommandResult<Vec<BackupEntry>> {
    let root = match ctx.app_data_dir() {
        Ok(path) => path,
        Err(e) => return err(&format!("app_data_dir error: {e}")),
    };
    let storage = Storage::new(root);

    // If the backup directory does not exist yet, create it and return an empty list.
    let list = match storage.list_backups() {
        Ok(list) => list,
        Err(StorageError::Io(io)) if io.kind() == std::io::ErrorKind::NotFound => {
            if let Err(error) = storage.ensure_dirs() {
                return err(&format!("storage error: {error:?}"));
            }
            Vec::new()
        }
        Err(error) => return err(&format!("storage error: {error:?}")),
    };

    ok(list
        .into_iter()
        .map(|(name, modified_at)| BackupEntry { name, modified_at })
        .collect())
}

fn delete_backup_impl(ctx: &impl CommandCtx, filename: String) -> CommandResult<bool> {
    let root = match ctx.app_data_dir() {
        Ok(path) => path,
        Err(e) => return err(&format!("app_data_dir error: {e}")),
    };
    let storage = Storage::new(root);
    if let Err(error) = storage.ensure_dirs() {
        return err(&format!("storage error: {error:?}"));
    }
    if let Err(error) = storage.delete_backup(&filename) {
        return err(&format!("storage error: {error:?}"));
    }
    ok(true)
}

fn create_backup_impl(ctx: &impl CommandCtx, state: &AppState) -> CommandResult<bool> {
    let root = match ctx.app_data_dir() {
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

fn restore_backup_impl(
    ctx: &impl CommandCtx,
    state: &AppState,
    filename: String,
) -> CommandResult<Vec<Task>> {
    let root = match ctx.app_data_dir() {
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
    ctx.update_tray_count(&state.tasks(), &state.settings());
    let payload = StatePayload {
        tasks: state.tasks(),
        settings: state.settings(),
    };
    ctx.emit_state_updated(payload);
    ok(data.tasks)
}

fn import_backup_impl(
    ctx: &impl CommandCtx,
    state: &AppState,
    path: String,
) -> CommandResult<Vec<Task>> {
    let root = match ctx.app_data_dir() {
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
    ctx.update_tray_count(&state.tasks(), &state.settings());
    let payload = StatePayload {
        tasks: state.tasks(),
        settings: state.settings(),
    };
    ctx.emit_state_updated(payload);
    ok(data.tasks)
}

#[cfg(all(feature = "app", not(test)))]
#[tauri::command]
pub fn list_backups(app: AppHandle) -> CommandResult<Vec<BackupEntry>> {
    let ctx = TauriCommandCtx { app: &app };
    list_backups_impl(&ctx)
}

#[cfg(all(feature = "app", not(test)))]
#[tauri::command]
pub fn delete_backup(app: AppHandle, filename: String) -> CommandResult<bool> {
    let ctx = TauriCommandCtx { app: &app };
    delete_backup_impl(&ctx, filename)
}

#[cfg(all(feature = "app", not(test)))]
#[tauri::command]
pub fn create_backup(app: AppHandle, state: State<AppState>) -> CommandResult<bool> {
    let ctx = TauriCommandCtx { app: &app };
    create_backup_impl(&ctx, state.inner())
}

#[cfg(all(feature = "app", not(test)))]
#[tauri::command]
pub fn restore_backup(
    app: AppHandle,
    state: State<AppState>,
    filename: String,
) -> CommandResult<Vec<Task>> {
    let ctx = TauriCommandCtx { app: &app };
    restore_backup_impl(&ctx, state.inner(), filename)
}

#[cfg(all(feature = "app", not(test)))]
#[tauri::command]
pub fn import_backup(
    app: AppHandle,
    state: State<AppState>,
    path: String,
) -> CommandResult<Vec<Task>> {
    let ctx = TauriCommandCtx { app: &app };
    import_backup_impl(&ctx, state.inner(), path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ReminderConfig, ReminderKind, RepeatRule, Task};
    use std::fs;
    use std::sync::Mutex;

    struct TestCtx {
        root: tempfile::TempDir,
        app_data_dir_error: Option<String>,
        app_data_dir_override: Option<PathBuf>,
        emitted: Mutex<Vec<StatePayload>>,
        tray_updates: Mutex<usize>,
        shortcut_unregistered: Mutex<usize>,
        shortcut_registered: Mutex<usize>,
        shortcut_register_error: Mutex<Option<String>>,
    }

    impl TestCtx {
        fn new() -> Self {
            Self {
                root: tempfile::tempdir().unwrap(),
                app_data_dir_error: None,
                app_data_dir_override: None,
                emitted: Mutex::new(Vec::new()),
                tray_updates: Mutex::new(0),
                shortcut_unregistered: Mutex::new(0),
                shortcut_registered: Mutex::new(0),
                shortcut_register_error: Mutex::new(None),
            }
        }

        fn with_app_data_dir_error(message: &str) -> Self {
            let mut ctx = Self::new();
            ctx.app_data_dir_error = Some(message.to_string());
            ctx
        }

        fn root_path(&self) -> &std::path::Path {
            self.root.path()
        }

        fn set_app_data_dir_override(&mut self, path: PathBuf) {
            self.app_data_dir_override = Some(path);
        }

        fn set_shortcut_register_error(&self, message: Option<&str>) {
            *self.shortcut_register_error.lock().unwrap() = message.map(|s| s.to_string());
        }
    }

    impl CommandCtx for TestCtx {
        fn app_data_dir(&self) -> Result<PathBuf, StorageError> {
            if let Some(message) = &self.app_data_dir_error {
                return Err(StorageError::Io(std::io::Error::other(message.clone())));
            }
            if let Some(path) = &self.app_data_dir_override {
                return Ok(path.clone());
            }
            Ok(self.root.path().to_path_buf())
        }

        fn emit_state_updated(&self, payload: StatePayload) {
            self.emitted.lock().unwrap().push(payload);
        }

        fn update_tray_count(&self, _tasks: &[Task], _settings: &Settings) {
            *self.tray_updates.lock().unwrap() += 1;
        }

        fn shortcut_unregister_all(&self) {
            *self.shortcut_unregistered.lock().unwrap() += 1;
        }

        fn shortcut_validate(&self, shortcut: &str) -> Result<(), String> {
            let shortcut = shortcut.trim();
            if shortcut.is_empty() {
                return Err("empty shortcut".to_string());
            }

            // A lightweight validator for unit tests. Production builds validate using the
            // real Tauri shortcut parser (see `TauriCommandCtx`).
            if shortcut.starts_with("CommandOrControl+Shift+")
                && shortcut.len() > "CommandOrControl+Shift+".len()
            {
                return Ok(());
            }

            Err("parse error".to_string())
        }

        fn shortcut_register(&self, shortcut: &str) -> Result<(), String> {
            self.shortcut_validate(shortcut)?;
            *self.shortcut_registered.lock().unwrap() += 1;
            if let Some(message) = self.shortcut_register_error.lock().unwrap().clone() {
                return Err(message);
            }
            Ok(())
        }
    }

    fn make_task(id: &str, due_at: i64) -> Task {
        Task {
            id: id.to_string(),
            title: format!("task-{id}"),
            due_at,
            important: false,
            completed: false,
            completed_at: None,
            created_at: 1,
            updated_at: 1,
            sort_order: 0,
            quadrant: 1,
            notes: None,
            steps: Vec::new(),
            sample_tag: None,
            reminder: ReminderConfig {
                kind: ReminderKind::Normal,
                ..ReminderConfig::default()
            },
            repeat: RepeatRule::None,
        }
    }

    fn make_state(tasks: Vec<Task>) -> AppState {
        AppState::new(tasks, Settings::default())
    }

    #[test]
    fn ok_and_err_helpers_construct_expected_shape() {
        let r = ok(123);
        assert!(r.ok);
        assert_eq!(r.data, Some(123));
        assert_eq!(r.error, None);

        let r: CommandResult<i32> = err("nope");
        assert!(!r.ok);
        assert_eq!(r.data, None);
        assert_eq!(r.error, Some("nope".to_string()));
    }

    #[test]
    fn test_ctx_shortcut_register_propagates_validation_error() {
        let ctx = TestCtx::new();
        let err = ctx
            .shortcut_register("bad-shortcut")
            .expect_err("should fail shortcut_validate");
        assert_eq!(err, "parse error");
    }

    #[test]
    fn auto_backup_predicates_cover_all_schedules() {
        let now = Local
            .with_ymd_and_hms(2024, 1, 2, 12, 0, 0)
            .single()
            .unwrap()
            .timestamp();
        let yesterday = Local
            .with_ymd_and_hms(2024, 1, 1, 12, 0, 0)
            .single()
            .unwrap()
            .timestamp();

        let mut settings = Settings::default();
        settings.backup_schedule = BackupSchedule::None;
        settings.last_backup_at = None;
        assert!(!should_auto_backup(&settings, now));

        settings.backup_schedule = BackupSchedule::Daily;
        settings.last_backup_at = None;
        assert!(should_auto_backup(&settings, now));
        settings.last_backup_at = Some(yesterday);
        assert!(should_auto_backup(&settings, now));
        settings.last_backup_at = Some(now);
        assert!(!should_auto_backup(&settings, now));

        settings.backup_schedule = BackupSchedule::Weekly;
        settings.last_backup_at = None;
        assert!(should_auto_backup(&settings, now));

        let week_start = Local
            .with_ymd_and_hms(2024, 1, 1, 12, 0, 0)
            .single()
            .unwrap()
            .timestamp();
        let same_week = Local
            .with_ymd_and_hms(2024, 1, 2, 12, 0, 0)
            .single()
            .unwrap()
            .timestamp();
        let next_week = Local
            .with_ymd_and_hms(2024, 1, 8, 12, 0, 0)
            .single()
            .unwrap()
            .timestamp();
        settings.last_backup_at = Some(week_start);
        assert!(!should_auto_backup(&settings, same_week));
        assert!(should_auto_backup(&settings, next_week));

        settings.backup_schedule = BackupSchedule::Monthly;
        settings.last_backup_at = None;
        assert!(should_auto_backup(&settings, now));

        let month_start = Local
            .with_ymd_and_hms(2024, 1, 15, 12, 0, 0)
            .single()
            .unwrap()
            .timestamp();
        let same_month = Local
            .with_ymd_and_hms(2024, 1, 20, 12, 0, 0)
            .single()
            .unwrap()
            .timestamp();
        let next_month = Local
            .with_ymd_and_hms(2024, 2, 1, 12, 0, 0)
            .single()
            .unwrap()
            .timestamp();
        settings.last_backup_at = Some(month_start);
        assert!(!should_auto_backup(&settings, same_month));
        assert!(should_auto_backup(&settings, next_month));
    }

    #[test]
    fn persist_success_and_error_paths() {
        let ctx = TestCtx::new();
        let state = AppState::new(vec![make_task("a", 1000)], Settings::default());

        persist(&ctx, &state).unwrap();
        assert!(ctx.root_path().join("backups").is_dir());
        assert!(ctx.root_path().join("data.json").is_file());
        assert!(ctx.root_path().join("settings.json").is_file());
        assert_eq!(ctx.emitted.lock().unwrap().len(), 1);
        assert_eq!(*ctx.tray_updates.lock().unwrap(), 1);

        let bad_ctx = TestCtx::with_app_data_dir_error("nope");
        assert!(persist(&bad_ctx, &state).is_err());

        let ctx2 = TestCtx::new();
        fs::write(ctx2.root_path().join("backups"), b"x").unwrap();
        assert!(persist(&ctx2, &state).is_err());

        let ctx3 = TestCtx::new();
        fs::create_dir_all(ctx3.root_path().join("data.json")).unwrap();
        assert!(persist(&ctx3, &state).is_err());

        let ctx4 = TestCtx::new();
        fs::create_dir_all(ctx4.root_path().join("settings.json")).unwrap();
        assert!(persist(&ctx4, &state).is_err());
    }

    #[test]
    fn load_state_and_task_mutation_commands_cover_success_and_error_paths() {
        let state = make_state(Vec::new());

        // app_data_dir error path.
        let bad_ctx = TestCtx::with_app_data_dir_error("nope");
        let res = load_state_impl(&bad_ctx, &state);
        assert!(!res.ok);

        // ensure_dirs error path.
        let ctx2 = TestCtx::new();
        fs::write(ctx2.root_path().join("backups"), b"x").unwrap();
        let res = load_state_impl(&ctx2, &state);
        assert!(!res.ok);

        // success path (missing files => defaults).
        let ctx3 = TestCtx::new();
        let res = load_state_impl(&ctx3, &state);
        assert!(res.ok);
        let (tasks, settings) = res.data.unwrap();
        assert!(tasks.is_empty());
        assert_eq!(settings.shortcut, Settings::default().shortcut);
        assert_eq!(state.settings().shortcut, Settings::default().shortcut);

        // create_task fills sort_order when missing.
        let mut t = make_task("a", 1000);
        t.created_at = 2;
        let res = create_task_impl(&ctx3, &state, t);
        assert!(res.ok);
        let created_task = res.data.unwrap();
        assert_eq!(created_task.sort_order, 2000);

        // create_task keeps an explicit sort_order as-is.
        let ctx_sort = TestCtx::new();
        let state_sort = make_state(Vec::new());
        let mut t2 = make_task("b", 1000);
        t2.sort_order = 123;
        let res = create_task_impl(&ctx_sort, &state_sort, t2);
        assert!(res.ok);
        assert_eq!(res.data.unwrap().sort_order, 123);

        // create_task persist failure path.
        let ctx_fail = TestCtx::new();
        fs::write(ctx_fail.root_path().join("backups"), b"x").unwrap();
        let state_fail = make_state(Vec::new());
        let res_fail = create_task_impl(&ctx_fail, &state_fail, make_task("x", 1));
        assert!(!res_fail.ok);

        // update_task updates by id and fills sort_order when zero.
        let mut updated = created_task.clone();
        updated.title = "updated".into();
        updated.sort_order = 0;
        let res = update_task_impl(&ctx3, &state, updated);
        assert!(res.ok);
        assert_eq!(state.tasks().len(), 1);
        assert_eq!(state.tasks()[0].title, "updated");
        assert_ne!(state.tasks()[0].sort_order, 0);

        // update_task persist failure path.
        let update_ctx_fail = TestCtx::with_app_data_dir_error("nope");
        let state_update_fail = make_state(vec![state.tasks()[0].clone()]);
        let mut updated_fail = state_update_fail.tasks()[0].clone();
        updated_fail.title = "should-fail".into();
        let res = update_task_impl(&update_ctx_fail, &state_update_fail, updated_fail);
        assert!(!res.ok);

        // swap_sort_order not-found path.
        let res = swap_sort_order_impl(&ctx3, &state, "a".into(), "missing".into());
        assert!(!res.ok);
        assert_eq!(res.error, Some("task not found".to_string()));

        // swap_sort_order success path.
        let mut b = make_task("b", 1000);
        b.sort_order = 999;
        state.add_task(b);
        let res = swap_sort_order_impl(&ctx3, &state, "a".into(), "b".into());
        assert!(res.ok);
        let tasks = state.tasks();
        let a = tasks.iter().find(|t| t.id == "a").unwrap();
        let b = tasks.iter().find(|t| t.id == "b").unwrap();
        assert_eq!(a.sort_order, 999);
        assert_eq!(b.sort_order, 2000);

        // swap_sort_order persist failure path.
        let swap_ctx_fail = TestCtx::with_app_data_dir_error("nope");
        let state_swap_fail = make_state(vec![
            tasks.iter().find(|t| t.id == "a").unwrap().clone(),
            tasks.iter().find(|t| t.id == "b").unwrap().clone(),
        ]);
        let res = swap_sort_order_impl(&swap_ctx_fail, &state_swap_fail, "a".into(), "b".into());
        assert!(!res.ok);
    }

    #[test]
    fn complete_task_covers_not_found_non_repeat_repeat_and_persist_error() {
        let ctx = TestCtx::new();

        // Not found.
        let state = make_state(Vec::new());
        let res = complete_task_impl(&ctx, &state, "missing".into());
        assert!(!res.ok);

        // RepeatRule::None returns completed task.
        let state = make_state(vec![make_task("a", 1000)]);
        let res = complete_task_impl(&ctx, &state, "a".into());
        assert!(res.ok);
        assert!(res.data.unwrap().completed);

        // RepeatRule != None creates a new task instance.
        let mut task = make_task("r", 1000);
        task.repeat = RepeatRule::Daily {
            workday_only: false,
        };
        let state = make_state(vec![task]);
        let res = complete_task_impl(&ctx, &state, "r".into());
        assert!(res.ok);
        let next = res.data.unwrap();
        assert!(!next.completed);
        assert!(next.id.starts_with("r-"));
        assert!(state.tasks().len() >= 2);

        // Persist error path.
        let ctx_fail = TestCtx::new();
        fs::write(ctx_fail.root_path().join("backups"), b"x").unwrap();
        let state_fail = make_state(vec![make_task("x", 1)]);
        let res = complete_task_impl(&ctx_fail, &state_fail, "x".into());
        assert!(!res.ok);

        // Persist error path when RepeatRule != None (covers the second persist callsite).
        let ctx_fail_repeat = TestCtx::new();
        fs::write(ctx_fail_repeat.root_path().join("backups"), b"x").unwrap();
        let mut repeat_task = make_task("y", 1000);
        repeat_task.repeat = RepeatRule::Daily {
            workday_only: false,
        };
        let state_fail_repeat = make_state(vec![repeat_task]);
        let res = complete_task_impl(&ctx_fail_repeat, &state_fail_repeat, "y".into());
        assert!(!res.ok);
    }

    #[test]
    fn update_settings_validates_shortcuts_registers_and_rolls_back() {
        let ctx = TestCtx::new();
        let state = make_state(Vec::new());

        // Shortcut unchanged => no registration.
        let mut settings = state.settings();
        settings.theme = "dark".into();
        let res = update_settings_impl(&ctx, &state, settings.clone());
        assert!(res.ok);
        assert_eq!(*ctx.shortcut_unregistered.lock().unwrap(), 0);
        assert_eq!(*ctx.shortcut_registered.lock().unwrap(), 0);

        // Invalid shortcut.
        let mut invalid = settings.clone();
        invalid.shortcut = "not-a-shortcut".into();
        let res = update_settings_impl(&ctx, &state, invalid);
        assert!(!res.ok);

        // Shortcut changed => register.
        let mut changed = settings.clone();
        changed.shortcut = "CommandOrControl+Shift+Y".into();
        let res = update_settings_impl(&ctx, &state, changed.clone());
        assert!(res.ok);
        assert!(state.settings().shortcut.ends_with('Y'));
        assert_eq!(*ctx.shortcut_unregistered.lock().unwrap(), 1);
        assert_eq!(*ctx.shortcut_registered.lock().unwrap(), 1);

        // Register failure => best-effort restore previous shortcut.
        ctx.set_shortcut_register_error(Some("boom"));
        let mut changed2 = settings.clone();
        changed2.shortcut = "CommandOrControl+Shift+Z".into();
        let prev_shortcut = state.settings().shortcut;
        let res = update_settings_impl(&ctx, &state, changed2);
        assert!(!res.ok);
        assert_eq!(state.settings().shortcut, prev_shortcut);
        ctx.set_shortcut_register_error(None);

        // Persist failure => rollback both in-memory settings and shortcut.
        // Replace settings.json with a directory so `save_settings` fails reliably.
        let settings_path = ctx.root_path().join("settings.json");
        let _ = fs::remove_file(&settings_path);
        fs::create_dir_all(&settings_path).unwrap();
        let before = state.settings().shortcut;
        let mut changed3 = settings;
        changed3.shortcut = "CommandOrControl+Shift+T".into();
        let res = update_settings_impl(&ctx, &state, changed3);
        assert!(!res.ok);
        assert_eq!(state.settings().shortcut, before);
        assert!(*ctx.shortcut_unregistered.lock().unwrap() >= 2);
        assert!(*ctx.shortcut_registered.lock().unwrap() >= 2);

        // Persist failure with shortcut unchanged should not attempt shortcut rollback logic.
        // This covers the `shortcut_changed == false` rollback branch in the persist error path.
        let ctx_no_change = TestCtx::new();
        let state_no_change = make_state(Vec::new());
        let settings_path = ctx_no_change.root_path().join("settings.json");
        let _ = fs::remove_file(&settings_path);
        fs::create_dir_all(&settings_path).unwrap();
        let before = state_no_change.settings();
        let mut settings_no_change = before.clone();
        settings_no_change.theme = "light".into();
        let res = update_settings_impl(&ctx_no_change, &state_no_change, settings_no_change);
        assert!(!res.ok);
        assert_eq!(state_no_change.settings().shortcut, before.shortcut);
        assert_eq!(state_no_change.settings().theme, before.theme);
        assert_eq!(*ctx_no_change.shortcut_unregistered.lock().unwrap(), 0);
        assert_eq!(*ctx_no_change.shortcut_registered.lock().unwrap(), 0);
    }

    #[test]
    fn update_settings_rejects_empty_shortcut_without_side_effects() {
        let ctx = TestCtx::new();
        let state = make_state(Vec::new());

        let mut settings = state.settings();
        settings.shortcut = "   ".into();

        let res = update_settings_impl(&ctx, &state, settings);
        assert!(!res.ok);
        assert!(res
            .error
            .as_deref()
            .unwrap_or_default()
            .contains("empty shortcut"));

        // Validation happens before any shortcut unregister/register calls.
        assert_eq!(*ctx.shortcut_unregistered.lock().unwrap(), 0);
        assert_eq!(*ctx.shortcut_registered.lock().unwrap(), 0);
        assert_eq!(state.settings().shortcut, Settings::default().shortcut);
    }

    #[test]
    fn snooze_dismiss_and_delete_cover_found_not_found_and_persist_error() {
        let ctx = TestCtx::new();
        let state = make_state(vec![make_task("a", 1000), make_task("b", 2000)]);

        // snooze_task: found + not found.
        let res = snooze_task_impl(&ctx, &state, "a".into(), 1234);
        assert!(res.ok);
        let a = state.tasks().into_iter().find(|t| t.id == "a").unwrap();
        assert_eq!(a.reminder.snoozed_until, Some(1234));
        assert!(a.reminder.last_fired_at.is_some());

        let res = snooze_task_impl(&ctx, &state, "missing".into(), 1);
        assert!(res.ok);

        // dismiss_forced: found + not found.
        let res = dismiss_forced_impl(&ctx, &state, "a".into());
        assert!(res.ok);
        let a = state.tasks().into_iter().find(|t| t.id == "a").unwrap();
        assert!(a.reminder.forced_dismissed);

        let res = dismiss_forced_impl(&ctx, &state, "missing".into());
        assert!(res.ok);

        // delete_task + delete_tasks.
        let res = delete_task_impl(&ctx, &state, "a".into());
        assert!(res.ok);
        assert!(state.tasks().iter().all(|t| t.id != "a"));

        let res = delete_tasks_impl(&ctx, &state, vec!["b".into(), "missing".into()]);
        assert!(res.ok);
        assert!(state.tasks().is_empty());

        // Persist error path: make backups a file so ensure_dirs fails.
        let ctx_fail = TestCtx::new();
        fs::write(ctx_fail.root_path().join("backups"), b"x").unwrap();
        let state_fail = make_state(vec![make_task("x", 1)]);
        assert!(!snooze_task_impl(&ctx_fail, &state_fail, "x".into(), 1).ok);
        assert!(!dismiss_forced_impl(&ctx_fail, &state_fail, "x".into()).ok);
        assert!(!delete_task_impl(&ctx_fail, &state_fail, "x".into()).ok);
        assert!(!delete_tasks_impl(&ctx_fail, &state_fail, vec!["x".into()]).ok);
    }

    #[test]
    fn backup_commands_list_create_restore_and_import_cover_paths() {
        // list_backups app_data_dir error.
        let bad_ctx = TestCtx::with_app_data_dir_error("nope");
        assert!(!list_backups_impl(&bad_ctx).ok);

        // list_backups NotFound => ensure_dirs + empty list.
        let ctx = TestCtx::new();
        let res = list_backups_impl(&ctx);
        assert!(res.ok);
        assert!(res.data.unwrap().is_empty());

        // list_backups NotFound + ensure_dirs failure => error.
        let mut ctx_not_dir = TestCtx::new();
        let root_file = ctx_not_dir.root_path().join("not-a-dir");
        fs::write(&root_file, b"x").unwrap();
        ctx_not_dir.set_app_data_dir_override(root_file);
        assert!(!list_backups_impl(&ctx_not_dir).ok);

        // list_backups invalid backups path => error.
        let ctx2 = TestCtx::new();
        fs::write(ctx2.root_path().join("backups"), b"x").unwrap();
        assert!(!list_backups_impl(&ctx2).ok);

        // list_backups Ok path with at least one entry.
        let ctx3 = TestCtx::new();
        fs::create_dir_all(ctx3.root_path().join("backups")).unwrap();
        fs::write(
            ctx3.root_path().join("backups").join("data-test.json"),
            b"{}",
        )
        .unwrap();
        let res = list_backups_impl(&ctx3);
        assert!(res.ok);
        assert!(res
            .data
            .unwrap()
            .iter()
            .any(|entry| entry.name == "data-test.json"));

        // delete_backup covers error + success.
        let bad_ctx = TestCtx::with_app_data_dir_error("nope");
        assert!(!delete_backup_impl(&bad_ctx, "data-test.json".into()).ok);

        let ctx_del_fail = TestCtx::new();
        fs::write(ctx_del_fail.root_path().join("backups"), b"x").unwrap();
        assert!(!delete_backup_impl(&ctx_del_fail, "data-test.json".into()).ok);

        let ctx_del_ok = TestCtx::new();
        fs::create_dir_all(ctx_del_ok.root_path().join("backups")).unwrap();
        fs::write(
            ctx_del_ok.root_path().join("backups").join("data-test.json"),
            b"{}",
        )
        .unwrap();
        let res = delete_backup_impl(&ctx_del_ok, "data-test.json".into());
        assert!(res.ok);

        // create_backup covers error branches + success.
        let state = make_state(vec![make_task("a", 1000)]);

        let bad_ctx = TestCtx::with_app_data_dir_error("nope");
        assert!(!create_backup_impl(&bad_ctx, &state).ok);

        let ctx4 = TestCtx::new();
        fs::write(ctx4.root_path().join("backups"), b"x").unwrap();
        assert!(!create_backup_impl(&ctx4, &state).ok);

        let ctx5 = TestCtx::new();
        fs::create_dir_all(ctx5.root_path().join("data.json")).unwrap();
        assert!(!create_backup_impl(&ctx5, &state).ok);

        let ctx6 = TestCtx::new();
        fs::create_dir_all(ctx6.root_path().join("settings.json")).unwrap();
        assert!(!create_backup_impl(&ctx6, &state).ok);

        let ctx7 = TestCtx::new();
        let state2 = make_state(vec![make_task("x", 1000)]);
        let res = create_backup_impl(&ctx7, &state2);
        assert!(res.ok);
        assert!(state2.settings().last_backup_at.is_some());

        // restore/import: app_data_dir error + ensure_dirs error.
        let state_any = make_state(Vec::new());
        let bad_ctx = TestCtx::with_app_data_dir_error("nope");
        assert!(!restore_backup_impl(&bad_ctx, &state_any, "anything.json".into()).ok);
        assert!(!import_backup_impl(&bad_ctx, &state_any, "anything.json".into()).ok);

        let mut ctx_not_dir = TestCtx::new();
        let root_file = ctx_not_dir.root_path().join("not-a-dir");
        fs::write(&root_file, b"x").unwrap();
        ctx_not_dir.set_app_data_dir_override(root_file);
        assert!(!restore_backup_impl(&ctx_not_dir, &state_any, "anything.json".into()).ok);
        assert!(!import_backup_impl(&ctx_not_dir, &state_any, "anything.json".into()).ok);

        // restore_backup: error + success.
        let ctx_restore = TestCtx::new();
        let state_restore_src = make_state(vec![make_task("r", 1000)]);
        persist(&ctx_restore, &state_restore_src).unwrap();

        let storage = Storage::new(ctx_restore.root_path().to_path_buf());
        storage.ensure_dirs().unwrap();
        storage
            .create_backup(&ctx_restore.root_path().join("data.json"))
            .unwrap();
        let backup_name = storage.list_backups().unwrap()[0].0.clone();

        let state_restore_dst = make_state(Vec::new());
        assert!(!restore_backup_impl(&ctx_restore, &state_restore_dst, "missing.json".into()).ok);
        let res = restore_backup_impl(&ctx_restore, &state_restore_dst, backup_name);
        assert!(res.ok);
        assert_eq!(state_restore_dst.tasks().len(), 1);
        assert!(!ctx_restore.emitted.lock().unwrap().is_empty());

        // import_backup: error + success.
        let external = ctx_restore.root_path().join("external.json");
        fs::write(
            &external,
            serde_json::to_string_pretty(&state_restore_src.tasks_file()).unwrap(),
        )
        .unwrap();
        let state_import_dst = make_state(Vec::new());
        let res = import_backup_impl(
            &ctx_restore,
            &state_import_dst,
            external.to_string_lossy().to_string(),
        );
        assert!(res.ok);
        assert_eq!(state_import_dst.tasks().len(), 1);
        assert!(!import_backup_impl(&ctx_restore, &state_import_dst, "no-such-file".into()).ok);
    }
}
