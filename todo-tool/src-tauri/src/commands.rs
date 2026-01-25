use chrono::{Datelike, Local, TimeZone, Utc};
use std::fs;
use std::path::Path;
use std::path::PathBuf;

#[cfg(all(feature = "app", not(test)))]
use crate::ai::{AiPlan, AiPlanRequest};
use crate::events::StatePayload;
#[cfg(all(feature = "app", not(test)))]
use crate::events::EVENT_STATE_UPDATED;
use crate::models::{BackupSchedule, Project, ReminderKind, RepeatRule, Settings, Task};
use crate::repeat::next_due_timestamp;
use crate::state::AppState;
use crate::storage::{Storage, StorageError};

#[cfg(all(feature = "app", not(test)))]
use crate::tray::update_tray_count;
#[cfg(all(feature = "app", not(test)))]
use crate::windows::show_settings_window as show_settings_window_impl;
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

    // Test seam: `serde_json::to_vec_pretty` is effectively infallible for our TasksFile
    // schema. For 100% coverage (and to keep the error-handling path tested), unit tests can
    // opt into a forced serialization error.
    fn force_json_serialize_error(&self) -> bool {
        false
    }
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
    let root = ctx.app_data_dir().map_err(|err| {
        log::error!("persist: app_data_dir failed: {err}");
        err
    })?;
    let storage = Storage::new(root.clone());
    storage.ensure_dirs().map_err(|err| {
        log::error!(
            "persist: ensure_dirs failed root={} err={err}",
            root.display()
        );
        err
    })?;
    let now = Utc::now().timestamp();
    let mut settings = state.settings();
    let should_backup = should_auto_backup(&settings, now);
    if should_backup {
        log::info!(
            "persist: auto backup triggered schedule={:?} last_backup_at={:?} now={now}",
            settings.backup_schedule,
            settings.last_backup_at
        );
        settings.last_backup_at = Some(now);
        state.update_settings(settings.clone());
    }

    let tasks_file = state.tasks_file();
    storage
        .save_tasks(&tasks_file, should_backup)
        .map_err(|err| {
            log::error!(
                "persist: save_tasks failed root={} with_backup={} err={err}",
                root.display(),
                should_backup
            );
            err
        })?;

    let settings_file = state.settings_file();
    storage.save_settings(&settings_file).map_err(|err| {
        log::error!(
            "persist: save_settings failed root={} err={err}",
            root.display()
        );
        err
    })?;
    // Snapshot once so tray updates + events always reflect a consistent view.
    let snapshot = state.snapshot();
    ctx.update_tray_count(&snapshot.tasks, &snapshot.settings);
    ctx.emit_state_updated(StatePayload {
        tasks: snapshot.tasks,
        projects: snapshot.projects,
        settings: snapshot.settings,
    });
    log::debug!(
        "persist: ok root={} tasks={} projects={} with_backup={}",
        root.display(),
        tasks_file.tasks.len(),
        tasks_file.projects.len(),
        should_backup
    );
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
        if let Err(err) = self.app.emit(EVENT_STATE_UPDATED, payload) {
            log::warn!("emit state_updated failed: {err}");
        }
    }

    fn update_tray_count(&self, tasks: &[Task], settings: &Settings) {
        update_tray_count(self.app, tasks, settings);
    }

    fn shortcut_unregister_all(&self) {
        if let Err(err) = self.app.global_shortcut().unregister_all() {
            log::warn!("shortcut unregister_all failed: {err}");
        }
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

fn load_state_impl(ctx: &impl CommandCtx, state: &AppState) -> CommandResult<StatePayload> {
    log::info!("cmd=load_state start");
    let root = match ctx.app_data_dir() {
        Ok(path) => path,
        Err(e) => return err(&format!("app_data_dir error: {e}")),
    };
    let storage = Storage::new(root);
    if let Err(error) = storage.ensure_dirs() {
        return err(&format!("storage error: {error:?}"));
    }
    let tasks_file = match storage.load_tasks() {
        Ok(file) => file,
        Err(err) => {
            log::warn!("cmd=load_state failed to load data.json; using defaults: {err}");
            crate::models::TasksFile {
                schema_version: 1,
                tasks: Vec::new(),
                projects: Vec::new(),
            }
        }
    };
    let settings = match storage.load_settings() {
        Ok(file) => file.settings,
        Err(err) => {
            log::warn!("cmd=load_state failed to load settings.json; using defaults: {err}");
            Settings::default()
        }
    };

    state.replace_projects(tasks_file.projects);
    state.replace_tasks(tasks_file.tasks);
    state.update_settings(settings);
    let snapshot = state.snapshot();
    log::info!(
        "cmd=load_state ok tasks={} projects={} theme={} language={} close_behavior={:?} backup_schedule={:?}",
        snapshot.tasks.len(),
        snapshot.projects.len(),
        snapshot.settings.theme,
        snapshot.settings.language,
        snapshot.settings.close_behavior,
        snapshot.settings.backup_schedule
    );
    ok(StatePayload {
        tasks: snapshot.tasks,
        projects: snapshot.projects,
        settings: snapshot.settings,
    })
}

fn create_project_impl(
    ctx: &impl CommandCtx,
    state: &AppState,
    project: Project,
) -> CommandResult<Project> {
    let mut project = project;
    project.id = project.id.trim().to_string();
    project.name = project.name.trim().to_string();
    if project.id.is_empty() {
        return err("project id is required");
    }
    if project.name.is_empty() {
        return err("project name is required");
    }
    if state
        .projects()
        .iter()
        .any(|existing| existing.id == project.id)
    {
        return err("project already exists");
    }

    let now = Utc::now();
    if project.created_at == 0 {
        project.created_at = now.timestamp();
    }
    project.updated_at = now.timestamp();
    if project.sort_order == 0 {
        project.sort_order = project.created_at * 1000;
    }

    log::info!(
        "cmd=create_project id={} name_len={} pinned={} sort_order={} created_at={}",
        project.id,
        project.name.len(),
        project.pinned,
        project.sort_order,
        project.created_at
    );
    state.add_project(project.clone());
    if let Err(error) = persist(ctx, state) {
        log::error!(
            "cmd=create_project persist failed id={} err={error}",
            project.id
        );
        return err(&format!("storage error: {error:?}"));
    }
    ok(project)
}

fn update_project_impl(
    ctx: &impl CommandCtx,
    state: &AppState,
    project: Project,
) -> CommandResult<Project> {
    let mut project = project;
    project.id = project.id.trim().to_string();
    project.name = project.name.trim().to_string();
    if project.id.is_empty() {
        return err("project id is required");
    }
    if project.name.is_empty() {
        return err("project name is required");
    }

    let existing = match state.projects().into_iter().find(|p| p.id == project.id) {
        Some(project) => project,
        None => return err("project not found"),
    };

    let now = Utc::now();
    if project.created_at == 0 {
        project.created_at = existing.created_at;
    }
    if project.sort_order == 0 {
        project.sort_order = existing.sort_order;
    }
    // Keep inbox pinned by default so the left nav remains usable.
    if project.id == "inbox" {
        project.pinned = true;
        // Inbox is a built-in project: keep its name stable (UI can localize it).
        project.name = existing.name.clone();
    }
    project.updated_at = now.timestamp();

    log::info!(
        "cmd=update_project id={} name_len={} pinned={} sort_order={} created_at={} updated_at={}",
        project.id,
        project.name.len(),
        project.pinned,
        project.sort_order,
        project.created_at,
        project.updated_at
    );
    state.update_project(project.clone());
    if let Err(error) = persist(ctx, state) {
        log::error!(
            "cmd=update_project persist failed id={} err={error}",
            project.id
        );
        return err(&format!("storage error: {error:?}"));
    }
    ok(project)
}

fn swap_project_sort_order_impl(
    ctx: &impl CommandCtx,
    state: &AppState,
    first_id: String,
    second_id: String,
) -> CommandResult<bool> {
    let now = Utc::now().timestamp();
    if !state.swap_project_sort_order(&first_id, &second_id, now) {
        return err("project not found");
    }
    log::info!(
        "cmd=swap_project_sort_order ok first_id={} second_id={} at={}",
        first_id,
        second_id,
        now
    );
    if let Err(error) = persist(ctx, state) {
        log::error!(
            "cmd=swap_project_sort_order persist failed first_id={} second_id={} err={error}",
            first_id,
            second_id
        );
        return err(&format!("storage error: {error:?}"));
    }
    ok(true)
}

fn delete_project_impl(
    ctx: &impl CommandCtx,
    state: &AppState,
    project_id: String,
) -> CommandResult<bool> {
    let project_id = project_id.trim().to_string();
    if project_id.is_empty() {
        return err("project id is required");
    }
    if project_id == "inbox" {
        return err("cannot delete inbox project");
    }
    if !state.projects().iter().any(|p| p.id == project_id) {
        return err("project not found");
    }

    // Best-effort: move tasks to inbox so we never leave dangling project references.
    let now = Utc::now().timestamp();
    let mut tasks_to_move = Vec::new();
    for task in state.tasks() {
        if task.project_id == project_id {
            let mut next = task.clone();
            next.project_id = "inbox".to_string();
            next.updated_at = now;
            tasks_to_move.push(next);
        }
    }
    let moved_count = tasks_to_move.len();
    for task in tasks_to_move {
        state.update_task(task);
    }

    log::info!(
        "cmd=delete_project id={} moved_tasks={} at={}",
        project_id,
        moved_count,
        now
    );
    state.remove_project(&project_id);
    if let Err(error) = persist(ctx, state) {
        log::error!(
            "cmd=delete_project persist failed id={} err={error}",
            project_id
        );
        return err(&format!("storage error: {error:?}"));
    }
    ok(true)
}

fn create_task_impl(ctx: &impl CommandCtx, state: &AppState, task: Task) -> CommandResult<Task> {
    let mut task = task;
    let original_project_id = task.project_id.clone();
    if task.sort_order == 0 {
        task.sort_order = task.created_at * 1000;
    }
    if !state
        .projects()
        .iter()
        .any(|project| project.id == task.project_id)
    {
        log::warn!(
            "cmd=create_task unknown project_id; using inbox task_id={} original_project_id={}",
            task.id,
            original_project_id
        );
        task.project_id = "inbox".to_string();
    }
    log::info!(
        "cmd=create_task id={} project_id={} due_at={} important={} quadrant={} reminder_kind={:?} repeat={:?}",
        task.id,
        task.project_id,
        task.due_at,
        task.important,
        task.quadrant,
        task.reminder.kind,
        task.repeat
    );
    state.add_task(task.clone());
    if let Err(error) = persist(ctx, state) {
        log::error!("cmd=create_task persist failed id={} err={error}", task.id);
        return err(&format!("storage error: {error:?}"));
    }
    ok(task)
}

fn update_task_impl(ctx: &impl CommandCtx, state: &AppState, task: Task) -> CommandResult<Task> {
    let mut task = task;
    let original_project_id = task.project_id.clone();
    if task.sort_order == 0 {
        task.sort_order = task.created_at * 1000;
    }
    if !state
        .projects()
        .iter()
        .any(|project| project.id == task.project_id)
    {
        log::warn!(
            "cmd=update_task unknown project_id; using inbox task_id={} original_project_id={}",
            task.id,
            original_project_id
        );
        task.project_id = "inbox".to_string();
    }
    log::info!(
        "cmd=update_task id={} project_id={} due_at={} important={} quadrant={} reminder_kind={:?} repeat={:?}",
        task.id,
        task.project_id,
        task.due_at,
        task.important,
        task.quadrant,
        task.reminder.kind,
        task.repeat
    );
    state.update_task(task.clone());
    if let Err(error) = persist(ctx, state) {
        log::error!("cmd=update_task persist failed id={} err={error}", task.id);
        return err(&format!("storage error: {error:?}"));
    }
    ok(task)
}

fn bulk_update_tasks_impl(
    ctx: &impl CommandCtx,
    state: &AppState,
    tasks: Vec<Task>,
) -> CommandResult<bool> {
    let projects = state.projects();
    let total = tasks.len();
    let mut remapped_projects = 0usize;
    for mut task in tasks {
        if task.sort_order == 0 {
            task.sort_order = task.created_at * 1000;
        }
        if !projects.iter().any(|project| project.id == task.project_id) {
            remapped_projects += 1;
            task.project_id = "inbox".to_string();
        }
        state.update_task(task);
    }
    log::info!(
        "cmd=bulk_update_tasks count={} remapped_projects={}",
        total,
        remapped_projects
    );
    if let Err(error) = persist(ctx, state) {
        log::error!("cmd=bulk_update_tasks persist failed err={error}");
        return err(&format!("storage error: {error:?}"));
    }
    ok(true)
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
    log::info!(
        "cmd=swap_sort_order ok first_id={} second_id={} at={}",
        first_id,
        second_id,
        now
    );
    if let Err(error) = persist(ctx, state) {
        log::error!(
            "cmd=swap_sort_order persist failed first_id={} second_id={} err={error}",
            first_id,
            second_id
        );
        return err(&format!("storage error: {error:?}"));
    }
    ok(true)
}

fn build_next_repeat_task(completed: &Task, next_due: i64) -> Task {
    let now = Utc::now();
    let mut next = completed.clone();
    next.id = format!("{}-{}", completed.id, now.timestamp());
    next.completed = false;
    next.completed_at = None;
    next.created_at = now.timestamp();
    next.updated_at = now.timestamp();
    next.sort_order = now.timestamp_millis();
    next.due_at = next_due;
    next.reminder.last_fired_at = None;
    next.reminder.forced_dismissed = false;
    next.reminder.snoozed_until = None;
    next.reminder.repeat_fired_count = 0;

    // Preserve the reminder offset semantics across repeat instances.
    // (Otherwise a copied `remind_at` in the past would trigger immediately on the next cycle.)
    if next.reminder.kind == ReminderKind::None {
        next.reminder.remind_at = None;
    } else {
        let old_default_target = if completed.reminder.kind == ReminderKind::Normal {
            completed.due_at - 10 * 60
        } else {
            completed.due_at
        };
        let old_target = completed.reminder.remind_at.unwrap_or(old_default_target);
        let offset = (completed.due_at - old_target).max(0);
        next.reminder.remind_at = Some(next_due - offset);
    }

    next
}

fn complete_task_impl(
    ctx: &impl CommandCtx,
    state: &AppState,
    task_id: String,
) -> CommandResult<Task> {
    let completed = match state.complete_task(&task_id) {
        Some(task) => task,
        None => {
            log::warn!("cmd=complete_task task not found id={}", task_id);
            return err("task not found");
        }
    };

    if let RepeatRule::None = completed.repeat {
        log::info!("cmd=complete_task id={} repeat=none", completed.id);
        if let Err(error) = persist(ctx, state) {
            log::error!(
                "cmd=complete_task persist failed id={} err={error}",
                completed.id
            );
            return err(&format!("storage error: {error:?}"));
        }
        return ok(completed);
    }

    let next_due = next_due_timestamp(completed.due_at, &completed.repeat);
    let next = build_next_repeat_task(&completed, next_due);

    log::info!(
        "cmd=complete_task id={} repeat={:?} next_id={} next_due={}",
        completed.id,
        completed.repeat,
        next.id,
        next_due
    );
    state.add_task(next.clone());

    if let Err(error) = persist(ctx, state) {
        log::error!(
            "cmd=complete_task persist failed id={} err={error}",
            completed.id
        );
        return err(&format!("storage error: {error:?}"));
    }

    ok(next)
}

fn bulk_complete_tasks_impl(
    ctx: &impl CommandCtx,
    state: &AppState,
    task_ids: Vec<String>,
) -> CommandResult<bool> {
    let total = task_ids.len();
    let mut completed_count = 0usize;
    let mut repeated_created = 0usize;
    for task_id in task_ids {
        let completed = match state.complete_task(&task_id) {
            Some(task) => task,
            None => continue,
        };
        completed_count += 1;

        if let RepeatRule::None = completed.repeat {
            continue;
        }

        let next_due = next_due_timestamp(completed.due_at, &completed.repeat);
        let next = build_next_repeat_task(&completed, next_due);
        state.add_task(next);
        repeated_created += 1;
    }

    log::info!(
        "cmd=bulk_complete_tasks requested={} completed={} repeated_created={}",
        total,
        completed_count,
        repeated_created
    );
    if let Err(error) = persist(ctx, state) {
        log::error!("cmd=bulk_complete_tasks persist failed err={error}");
        return err(&format!("storage error: {error:?}"));
    }
    ok(true)
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
    let shortcut_requested_change = previous_shortcut != next_shortcut;

    // Normalize user input so tests/production behave the same and the persisted config is stable.
    settings.shortcut = next_shortcut.clone();
    settings.language = match next_language.as_str() {
        "auto" | "zh" | "en" => next_language.clone(),
        _ => {
            log::warn!(
                "cmd=update_settings invalid language; using default requested={}",
                next_language
            );
            Settings::default().language
        }
    };

    // AI settings: keep API key stable and prevent enabling without a key.
    settings.deepseek_api_key = settings.deepseek_api_key.trim().to_string();
    if settings.ai_enabled && settings.deepseek_api_key.is_empty() {
        return err("deepseek api key required (settings.deepseek_api_key)");
    }

    log::info!(
        "cmd=update_settings start theme={} language={} close_behavior={:?} minimize_behavior={:?} backup_schedule={:?} update_behavior={:?} repeat_interval_sec={} repeat_max_times={} shortcut_change={}",
        settings.theme,
        settings.language,
        settings.close_behavior,
        settings.minimize_behavior,
        settings.backup_schedule,
        settings.update_behavior,
        settings.reminder_repeat_interval_sec,
        settings.reminder_repeat_max_times,
        shortcut_requested_change
    );

    // Shortcut validation/registration is the #1 place users can lock themselves out:
    // if we unregister the old one and fail to register the new one, the app becomes unreachable
    // from the keyboard. So we validate + register with a rollback path and only then persist.
    let mut shortcut_changed = false;
    if shortcut_requested_change {
        shortcut_changed = true;
        if let Err(parse_err) = ctx.shortcut_validate(&next_shortcut) {
            log::warn!(
                "cmd=update_settings invalid shortcut requested={} err={}",
                next_shortcut,
                parse_err
            );
            return err(&format!("invalid shortcut: {parse_err}"));
        }

        ctx.shortcut_unregister_all();
        if let Err(register_err) = ctx.shortcut_register(&next_shortcut) {
            // Best-effort restore the previous shortcut so the user can still summon the quick window.
            let _ = ctx.shortcut_register(&previous_shortcut);
            log::error!(
                "cmd=update_settings failed to register shortcut requested={} err={}",
                next_shortcut,
                register_err
            );
            return err(&format!("failed to register shortcut: {register_err}"));
        }
        log::info!(
            "cmd=update_settings shortcut updated old={} new={}",
            previous_shortcut,
            next_shortcut
        );
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
        log::error!("cmd=update_settings persist failed err={error}");
        return err(&format!("storage error: {error:?}"));
    }

    log::info!(
        "cmd=update_settings ok theme={} language={} close_behavior={:?} minimize_behavior={:?} backup_schedule={:?} update_behavior={:?}",
        settings.theme,
        settings.language,
        settings.close_behavior,
        settings.minimize_behavior,
        settings.backup_schedule,
        settings.update_behavior
    );
    ok(settings)
}

fn snooze_task_impl(
    ctx: &impl CommandCtx,
    state: &AppState,
    task_id: String,
    until: i64,
) -> CommandResult<bool> {
    log::info!("cmd=snooze_task start task_id={} until={}", task_id, until);
    let mut tasks = state.tasks();
    let mut found = false;
    if let Some(task) = tasks.iter_mut().find(|t| t.id == task_id) {
        found = true;
        task.reminder.snoozed_until = Some(until);
        task.reminder.last_fired_at = Some(Utc::now().timestamp());
        state.update_task(task.clone());
    }
    if !found {
        log::warn!("cmd=snooze_task task not found task_id={}", task_id);
    }
    if let Err(error) = persist(ctx, state) {
        log::error!(
            "cmd=snooze_task persist failed task_id={} err={error}",
            task_id
        );
        return err(&format!("storage error: {error:?}"));
    }
    ok(true)
}

fn dismiss_forced_impl(
    ctx: &impl CommandCtx,
    state: &AppState,
    task_id: String,
) -> CommandResult<bool> {
    log::info!("cmd=dismiss_forced start task_id={}", task_id);
    let mut tasks = state.tasks();
    let mut found = false;
    if let Some(task) = tasks.iter_mut().find(|t| t.id == task_id) {
        found = true;
        task.reminder.forced_dismissed = true;
        task.reminder.last_fired_at = Some(Utc::now().timestamp());
        state.update_task(task.clone());
    }
    if !found {
        log::warn!("cmd=dismiss_forced task not found task_id={}", task_id);
    }
    if let Err(error) = persist(ctx, state) {
        log::error!(
            "cmd=dismiss_forced persist failed task_id={} err={error}",
            task_id
        );
        return err(&format!("storage error: {error:?}"));
    }
    ok(true)
}

fn delete_task_impl(
    ctx: &impl CommandCtx,
    state: &AppState,
    task_id: String,
) -> CommandResult<bool> {
    log::info!("cmd=delete_task task_id={}", task_id);
    state.remove_task(&task_id);
    if let Err(error) = persist(ctx, state) {
        log::error!(
            "cmd=delete_task persist failed task_id={} err={error}",
            task_id
        );
        return err(&format!("storage error: {error:?}"));
    }
    ok(true)
}

fn delete_tasks_impl(
    ctx: &impl CommandCtx,
    state: &AppState,
    task_ids: Vec<String>,
) -> CommandResult<bool> {
    log::info!("cmd=delete_tasks count={}", task_ids.len());
    state.remove_tasks(&task_ids);
    if let Err(error) = persist(ctx, state) {
        log::error!("cmd=delete_tasks persist failed err={error}");
        return err(&format!("storage error: {error:?}"));
    }
    ok(true)
}

#[cfg(all(feature = "app", not(test)))]
#[tauri::command]
pub fn load_state(app: AppHandle, state: State<AppState>) -> CommandResult<StatePayload> {
    let ctx = TauriCommandCtx { app: &app };
    load_state_impl(&ctx, state.inner())
}

#[cfg(all(feature = "app", not(test)))]
#[tauri::command]
pub fn create_project(
    app: AppHandle,
    state: State<AppState>,
    project: Project,
) -> CommandResult<Project> {
    let ctx = TauriCommandCtx { app: &app };
    create_project_impl(&ctx, state.inner(), project)
}

#[cfg(all(feature = "app", not(test)))]
#[tauri::command]
pub fn update_project(
    app: AppHandle,
    state: State<AppState>,
    project: Project,
) -> CommandResult<Project> {
    let ctx = TauriCommandCtx { app: &app };
    update_project_impl(&ctx, state.inner(), project)
}

#[cfg(all(feature = "app", not(test)))]
#[tauri::command]
pub fn swap_project_sort_order(
    app: AppHandle,
    state: State<AppState>,
    first_id: String,
    second_id: String,
) -> CommandResult<bool> {
    let ctx = TauriCommandCtx { app: &app };
    swap_project_sort_order_impl(&ctx, state.inner(), first_id, second_id)
}

#[cfg(all(feature = "app", not(test)))]
#[tauri::command]
pub fn delete_project(
    app: AppHandle,
    state: State<AppState>,
    project_id: String,
) -> CommandResult<bool> {
    let ctx = TauriCommandCtx { app: &app };
    delete_project_impl(&ctx, state.inner(), project_id)
}

#[cfg(all(feature = "app", not(test)))]
#[tauri::command]
pub fn create_task(app: AppHandle, state: State<AppState>, task: Task) -> CommandResult<Task> {
    let ctx = TauriCommandCtx { app: &app };
    create_task_impl(&ctx, state.inner(), task)
}

#[cfg(all(feature = "app", not(test)))]
#[tauri::command]
pub async fn ai_plan_task(
    state: State<'_, AppState>,
    request: AiPlanRequest,
) -> Result<AiPlan, String> {
    let settings = state.inner().settings();
    if !settings.ai_enabled {
        return Err("ai is disabled (settings.ai_enabled=false)".to_string());
    }
    if settings.deepseek_api_key.trim().is_empty() {
        return Err("deepseek api key missing (settings.deepseek_api_key)".to_string());
    }

    log::info!(
        "cmd=ai_plan_task start due_at={} important={} reminder_kind={:?} repeat={:?} raw_len={} title_len={} tags={}",
        request.due_at,
        request.important,
        request.reminder_kind,
        request.repeat,
        request.raw_input.len(),
        request.title.len(),
        request.tags.len()
    );

    match crate::ai::plan_with_deepseek(&settings, &request).await {
        Ok(plan) => Ok(plan),
        Err(message) => {
            log::warn!("cmd=ai_plan_task failed err={}", message);
            Err(message)
        }
    }
}

#[cfg(all(feature = "app", not(test)))]
#[tauri::command]
pub fn update_task(app: AppHandle, state: State<AppState>, task: Task) -> CommandResult<Task> {
    let ctx = TauriCommandCtx { app: &app };
    update_task_impl(&ctx, state.inner(), task)
}

#[cfg(all(feature = "app", not(test)))]
#[tauri::command]
pub fn bulk_update_tasks(
    app: AppHandle,
    state: State<AppState>,
    tasks: Vec<Task>,
) -> CommandResult<bool> {
    let ctx = TauriCommandCtx { app: &app };
    bulk_update_tasks_impl(&ctx, state.inner(), tasks)
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
pub fn bulk_complete_tasks(
    app: AppHandle,
    state: State<AppState>,
    task_ids: Vec<String>,
) -> CommandResult<bool> {
    let ctx = TauriCommandCtx { app: &app };
    bulk_complete_tasks_impl(&ctx, state.inner(), task_ids)
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
pub fn show_settings_window(app: AppHandle) -> CommandResult<bool> {
    log::info!("cmd=show_settings_window");
    match show_settings_window_impl(&app) {
        Ok(()) => ok(true),
        Err(message) => {
            log::error!("cmd=show_settings_window failed: {message}");
            err(&message)
        }
    }
}

#[cfg(all(feature = "app", not(test)))]
#[tauri::command]
pub fn frontend_log(level: String, message: String, context: Option<serde_json::Value>) -> bool {
    const MAX_CHARS: usize = 4000;

    let lvl = level.trim().to_lowercase();
    let trimmed = message.trim();

    let mut msg: String = trimmed.chars().take(MAX_CHARS).collect();
    if trimmed.chars().count() > MAX_CHARS {
        msg.push_str("...");
    }

    let ctx = context
        .and_then(|v| serde_json::to_string(&v).ok())
        .unwrap_or_default();

    match lvl.as_str() {
        "error" => log::error!("frontend_log: {msg} ctx={ctx}"),
        "warn" | "warning" => log::warn!("frontend_log: {msg} ctx={ctx}"),
        "debug" => log::debug!("frontend_log: {msg} ctx={ctx}"),
        "trace" => log::trace!("frontend_log: {msg} ctx={ctx}"),
        _ => log::info!("frontend_log: {msg} ctx={ctx}"),
    }

    true
}

#[cfg(all(feature = "app", not(test)))]
#[tauri::command]
pub fn set_shortcut_capture_active(state: State<AppState>, active: bool) -> CommandResult<bool> {
    log::info!("cmd=set_shortcut_capture_active active={}", active);
    state.set_shortcut_capture_active(active);
    ok(true)
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
    log::info!("cmd=list_backups start");
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
                log::error!("cmd=list_backups ensure_dirs failed err={error}");
                return err(&format!("storage error: {error:?}"));
            }
            log::info!("cmd=list_backups backup dir missing; created");
            Vec::new()
        }
        Err(error) => {
            log::error!("cmd=list_backups list failed err={error}");
            return err(&format!("storage error: {error:?}"));
        }
    };

    let entries: Vec<BackupEntry> = list
        .into_iter()
        .map(|(name, modified_at)| BackupEntry { name, modified_at })
        .collect();
    log::info!("cmd=list_backups ok count={}", entries.len());
    ok(entries)
}

fn delete_backup_impl(ctx: &impl CommandCtx, filename: String) -> CommandResult<bool> {
    log::info!("cmd=delete_backup start filename={}", filename);
    let root = match ctx.app_data_dir() {
        Ok(path) => path,
        Err(e) => return err(&format!("app_data_dir error: {e}")),
    };
    let storage = Storage::new(root);
    if let Err(error) = storage.ensure_dirs() {
        log::error!(
            "cmd=delete_backup ensure_dirs failed filename={} err={error}",
            filename
        );
        return err(&format!("storage error: {error:?}"));
    }
    if let Err(error) = storage.delete_backup(&filename) {
        log::error!("cmd=delete_backup failed filename={} err={error}", filename);
        return err(&format!("storage error: {error:?}"));
    }
    log::info!("cmd=delete_backup ok filename={}", filename);
    ok(true)
}

fn create_backup_impl(ctx: &impl CommandCtx, state: &AppState) -> CommandResult<bool> {
    log::info!("cmd=create_backup start");
    let root = match ctx.app_data_dir() {
        Ok(path) => path,
        Err(e) => return err(&format!("app_data_dir error: {e}")),
    };
    let storage = Storage::new(root);
    if let Err(error) = storage.ensure_dirs() {
        log::error!("cmd=create_backup ensure_dirs failed err={error}");
        return err(&format!("storage error: {error:?}"));
    }
    let tasks_file = state.tasks_file();
    log::info!(
        "cmd=create_backup saving tasks with backup tasks={} projects={}",
        tasks_file.tasks.len(),
        tasks_file.projects.len()
    );
    if let Err(error) = storage.save_tasks(&tasks_file, true) {
        log::error!("cmd=create_backup save_tasks failed err={error}");
        return err(&format!("storage error: {error:?}"));
    }
    let now = Utc::now().timestamp();
    let mut settings = state.settings();
    settings.last_backup_at = Some(now);
    state.update_settings(settings.clone());
    if let Err(error) = storage.save_settings(&state.settings_file()) {
        log::error!("cmd=create_backup save_settings failed err={error}");
        return err(&format!("storage error: {error:?}"));
    }
    log::info!("cmd=create_backup ok last_backup_at={now}");
    ok(true)
}

fn restore_backup_impl(
    ctx: &impl CommandCtx,
    state: &AppState,
    filename: String,
) -> CommandResult<Vec<Task>> {
    log::info!("cmd=restore_backup start filename={}", filename);
    let root = match ctx.app_data_dir() {
        Ok(path) => path,
        Err(e) => return err(&format!("app_data_dir error: {e}")),
    };
    let storage = Storage::new(root);
    if let Err(error) = storage.ensure_dirs() {
        log::error!(
            "cmd=restore_backup ensure_dirs failed filename={} err={error}",
            filename
        );
        return err(&format!("storage error: {error:?}"));
    }
    let data = match storage.restore_backup(&filename) {
        Ok(data) => data,
        Err(error) => {
            log::error!(
                "cmd=restore_backup failed filename={} err={error}",
                filename
            );
            return err(&format!("storage error: {error:?}"));
        }
    };
    log::info!(
        "cmd=restore_backup loaded filename={} tasks={} projects={}",
        filename,
        data.tasks.len(),
        data.projects.len()
    );
    state.replace_projects(data.projects.clone());
    state.replace_tasks(data.tasks.clone());
    ctx.update_tray_count(&state.tasks(), &state.settings());
    let payload = StatePayload {
        tasks: state.tasks(),
        projects: state.projects(),
        settings: state.settings(),
    };
    ctx.emit_state_updated(payload);
    log::info!("cmd=restore_backup ok filename={}", filename);
    ok(data.tasks)
}

fn import_backup_impl(
    ctx: &impl CommandCtx,
    state: &AppState,
    path: String,
) -> CommandResult<Vec<Task>> {
    log::info!("cmd=import_backup start path={}", path);
    let root = match ctx.app_data_dir() {
        Ok(path) => path,
        Err(e) => return err(&format!("app_data_dir error: {e}")),
    };
    let storage = Storage::new(root);
    if let Err(error) = storage.ensure_dirs() {
        log::error!(
            "cmd=import_backup ensure_dirs failed path={} err={error}",
            path
        );
        return err(&format!("storage error: {error:?}"));
    }
    let data = match storage.restore_from_path(std::path::Path::new(&path)) {
        Ok(data) => data,
        Err(error) => {
            log::error!("cmd=import_backup failed path={} err={error}", path);
            return err(&format!("storage error: {error:?}"));
        }
    };
    log::info!(
        "cmd=import_backup loaded path={} tasks={} projects={}",
        path,
        data.tasks.len(),
        data.projects.len()
    );
    state.replace_projects(data.projects.clone());
    state.replace_tasks(data.tasks.clone());
    ctx.update_tray_count(&state.tasks(), &state.settings());
    let payload = StatePayload {
        tasks: state.tasks(),
        projects: state.projects(),
        settings: state.settings(),
    };
    ctx.emit_state_updated(payload);
    log::info!("cmd=import_backup ok path={}", path);
    ok(data.tasks)
}

fn export_default_path(root: &Path, ext: &str) -> PathBuf {
    let exports_dir = root.join("exports");
    let stamp = Local::now().format("%Y%m%d-%H%M%S").to_string();
    exports_dir.join(format!("mustdo-{stamp}.{ext}"))
}

#[cfg_attr(coverage, inline(never))]
fn write_atomic_bytes(path: &Path, bytes: &[u8]) -> Result<(), StorageError> {
    let tmp = path.with_extension("tmp");
    fs::create_dir_all(
        path.parent()
            .ok_or_else(|| StorageError::Io(std::io::Error::other("invalid export path")))?,
    )?;
    fs::write(&tmp, bytes)?;
    fs::rename(tmp, path)?;
    Ok(())
}

fn export_tasks_json_impl(ctx: &dyn CommandCtx, state: &AppState) -> CommandResult<String> {
    log::info!("cmd=export_tasks_json start");
    let root = match ctx.app_data_dir() {
        Ok(path) => path,
        Err(e) => return err(&format!("app_data_dir error: {e}")),
    };

    let path = export_default_path(&root, "json");
    let data = state.tasks_file();
    struct ForcedJsonError;

    impl serde::Serialize for ForcedJsonError {
        fn serialize<S>(&self, _serializer: S) -> Result<S::Ok, S::Error>
        where
            S: serde::Serializer,
        {
            Err(<S::Error as serde::ser::Error>::custom(
                "forced json serialization error",
            ))
        }
    }

    let json = match if ctx.force_json_serialize_error() {
        // `TasksFile` is expected to be always serializable. This branch exists solely for tests.
        serde_json::to_vec_pretty(&ForcedJsonError)
    } else {
        serde_json::to_vec_pretty(&data)
    } {
        Ok(bytes) => bytes,
        Err(e) => {
            log::error!("cmd=export_tasks_json json serialize failed err={e}");
            return err(&format!("json error: {e}"));
        }
    };

    if let Err(error) = write_atomic_bytes(&path, &json) {
        log::error!(
            "cmd=export_tasks_json write failed path={} err={error}",
            path.display()
        );
        return err(&format!("export error: {error:?}"));
    }

    log::info!(
        "cmd=export_tasks_json ok path={} tasks={} projects={}",
        path.display(),
        data.tasks.len(),
        data.projects.len()
    );
    ok(path.to_string_lossy().to_string())
}

fn csv_escape(value: &str) -> String {
    // Minimal CSV escaping: wrap in quotes and double any existing quotes.
    let escaped = value.replace('"', "\"\"");
    format!("\"{escaped}\"")
}

fn export_tasks_csv_impl(ctx: &impl CommandCtx, state: &AppState) -> CommandResult<String> {
    log::info!("cmd=export_tasks_csv start");
    let root = match ctx.app_data_dir() {
        Ok(path) => path,
        Err(e) => return err(&format!("app_data_dir error: {e}")),
    };

    let path = export_default_path(&root, "csv");
    let tasks = state.tasks();
    let tasks_len = tasks.len();

    let mut out = String::new();
    out.push_str("id,project_id,title,due_at,important,completed,quadrant,tags,notes,steps\n");
    for task in tasks {
        let tags = task.tags.join(";");
        let notes = task.notes.unwrap_or_default().replace("\r\n", "\n");
        let steps = task
            .steps
            .iter()
            .map(|s| {
                if s.completed {
                    format!("[x] {}", s.title)
                } else {
                    format!("[ ] {}", s.title)
                }
            })
            .collect::<Vec<_>>()
            .join(" | ");

        out.push_str(&csv_escape(&task.id));
        out.push(',');
        out.push_str(&csv_escape(&task.project_id));
        out.push(',');
        out.push_str(&csv_escape(&task.title));
        out.push(',');
        out.push_str(&task.due_at.to_string());
        out.push(',');
        out.push_str(if task.important { "true" } else { "false" });
        out.push(',');
        out.push_str(if task.completed { "true" } else { "false" });
        out.push(',');
        out.push_str(&task.quadrant.to_string());
        out.push(',');
        out.push_str(&csv_escape(&tags));
        out.push(',');
        out.push_str(&csv_escape(&notes));
        out.push(',');
        out.push_str(&csv_escape(&steps));
        out.push('\n');
    }

    if let Err(error) = write_atomic_bytes(&path, out.as_bytes()) {
        log::error!(
            "cmd=export_tasks_csv write failed path={} err={error}",
            path.display()
        );
        return err(&format!("export error: {error:?}"));
    }

    log::info!(
        "cmd=export_tasks_csv ok path={} tasks={}",
        path.display(),
        tasks_len
    );
    ok(path.to_string_lossy().to_string())
}

fn export_tasks_markdown_impl(ctx: &impl CommandCtx, state: &AppState) -> CommandResult<String> {
    log::info!("cmd=export_tasks_markdown start");
    let root = match ctx.app_data_dir() {
        Ok(path) => path,
        Err(e) => return err(&format!("app_data_dir error: {e}")),
    };

    let path = export_default_path(&root, "md");
    let now = Local::now();
    let now_ts = now.timestamp();
    let today = now.date_naive();

    let mut overdue: Vec<Task> = Vec::new();
    let mut today_list: Vec<Task> = Vec::new();
    let mut future: Vec<Task> = Vec::new();
    let mut done: Vec<Task> = Vec::new();

    for task in state.tasks() {
        if task.completed {
            done.push(task);
            continue;
        }
        if task.due_at < now_ts {
            overdue.push(task);
            continue;
        }
        let due = Local.timestamp_opt(task.due_at, 0).single();
        if let Some(due_time) = due {
            if due_time.date_naive() == today {
                today_list.push(task);
                continue;
            }
        }
        future.push(task);
    }

    overdue.sort_by_key(|t| t.due_at);
    today_list.sort_by_key(|t| t.due_at);
    future.sort_by_key(|t| t.due_at);
    done.sort_by_key(|t| t.due_at);

    let fmt_due = |ts: i64| {
        Local
            .timestamp_opt(ts, 0)
            .single()
            .map(|dt| dt.format("%Y-%m-%d %H:%M").to_string())
            .unwrap_or_else(|| ts.to_string())
    };

    let mut out = String::new();
    out.push_str("# MustDo Export\n\n");
    out.push_str(&format!(
        "Generated at: {}\n\n",
        now.format("%Y-%m-%d %H:%M:%S")
    ));

    let mut write_section = |title: &str, tasks: &[Task], checked: bool| {
        out.push_str(&format!("## {title}\n\n"));
        if tasks.is_empty() {
            out.push_str("_Empty_\n\n");
            return;
        }
        for task in tasks {
            let box_mark = if checked { "x" } else { " " };
            out.push_str(&format!(
                "- [{box_mark}] {} (due: {})\n",
                task.title,
                fmt_due(task.due_at)
            ));
            if !task.tags.is_empty() {
                let tags = task
                    .tags
                    .iter()
                    .map(|t| format!("#{t}"))
                    .collect::<Vec<_>>()
                    .join(" ");
                out.push_str(&format!("  - tags: {tags}\n"));
            }
            if let Some(notes) = &task.notes {
                let notes = notes.replace("\r\n", "\n").replace('\n', " ");
                if !notes.trim().is_empty() {
                    out.push_str(&format!("  - notes: {notes}\n"));
                }
            }
            if !task.steps.is_empty() {
                out.push_str("  - steps:\n");
                for step in &task.steps {
                    let s_mark = if step.completed { "x" } else { " " };
                    out.push_str(&format!("    - [{s_mark}] {}\n", step.title));
                }
            }
        }
        out.push('\n');
    };

    write_section("Overdue", &overdue, false);
    write_section("Due today", &today_list, false);
    write_section("Future", &future, false);
    write_section("Completed", &done, true);

    if let Err(error) = write_atomic_bytes(&path, out.as_bytes()) {
        log::error!(
            "cmd=export_tasks_markdown write failed path={} err={error}",
            path.display()
        );
        return err(&format!("export error: {error:?}"));
    }

    log::info!(
        "cmd=export_tasks_markdown ok path={} overdue={} today={} future={} done={}",
        path.display(),
        overdue.len(),
        today_list.len(),
        future.len(),
        done.len()
    );
    ok(path.to_string_lossy().to_string())
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

#[cfg(all(feature = "app", not(test)))]
#[tauri::command]
pub fn export_tasks_json(app: AppHandle, state: State<AppState>) -> CommandResult<String> {
    let ctx = TauriCommandCtx { app: &app };
    export_tasks_json_impl(&ctx, state.inner())
}

#[cfg(all(feature = "app", not(test)))]
#[tauri::command]
pub fn export_tasks_csv(app: AppHandle, state: State<AppState>) -> CommandResult<String> {
    let ctx = TauriCommandCtx { app: &app };
    export_tasks_csv_impl(&ctx, state.inner())
}

#[cfg(all(feature = "app", not(test)))]
#[tauri::command]
pub fn export_tasks_markdown(app: AppHandle, state: State<AppState>) -> CommandResult<String> {
    let ctx = TauriCommandCtx { app: &app };
    export_tasks_markdown_impl(&ctx, state.inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Step;
    use crate::models::{ReminderConfig, ReminderKind, RepeatRule, Task};
    use std::fs;
    use std::sync::Mutex;

    fn is_io(err: &StorageError) -> bool {
        matches!(err, StorageError::Io(_))
    }

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

    struct ForceJsonErrorCtx {
        inner: TestCtx,
    }

    impl ForceJsonErrorCtx {
        fn new() -> Self {
            Self {
                inner: TestCtx::new(),
            }
        }
    }

    impl CommandCtx for ForceJsonErrorCtx {
        fn app_data_dir(&self) -> Result<PathBuf, StorageError> {
            self.inner.app_data_dir()
        }

        fn emit_state_updated(&self, payload: StatePayload) {
            self.inner.emit_state_updated(payload);
        }

        fn update_tray_count(&self, tasks: &[Task], settings: &Settings) {
            self.inner.update_tray_count(tasks, settings);
        }

        fn shortcut_unregister_all(&self) {
            self.inner.shortcut_unregister_all();
        }

        fn shortcut_validate(&self, shortcut: &str) -> Result<(), String> {
            self.inner.shortcut_validate(shortcut)
        }

        fn shortcut_register(&self, shortcut: &str) -> Result<(), String> {
            self.inner.shortcut_register(shortcut)
        }

        fn force_json_serialize_error(&self) -> bool {
            true
        }
    }

    fn make_task(id: &str, due_at: i64) -> Task {
        Task {
            id: id.to_string(),
            project_id: "inbox".to_string(),
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
            tags: Vec::new(),
            sample_tag: None,
            reminder: ReminderConfig {
                kind: ReminderKind::Normal,
                ..ReminderConfig::default()
            },
            repeat: RepeatRule::None,
        }
    }

    fn make_state(tasks: Vec<Task>) -> AppState {
        AppState::new(tasks, Vec::new(), Settings::default())
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
        let state = AppState::new(vec![make_task("a", 1000)], Vec::new(), Settings::default());

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
        let payload = res.data.unwrap();
        assert!(payload.tasks.is_empty());
        assert_eq!(payload.settings.shortcut, Settings::default().shortcut);
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
    fn update_settings_normalizes_unknown_language_to_default() {
        let ctx = TestCtx::new();
        let state = make_state(Vec::new());

        let mut settings = state.settings();
        settings.language = "fr".into();

        let res = update_settings_impl(&ctx, &state, settings);
        assert!(res.ok);
        assert_eq!(state.settings().language, Settings::default().language);
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

        let ctx_del_invalid = TestCtx::new();
        fs::create_dir_all(ctx_del_invalid.root_path().join("backups")).unwrap();
        assert!(!delete_backup_impl(&ctx_del_invalid, "../data-test.json".into()).ok);

        let ctx_del_ok = TestCtx::new();
        fs::create_dir_all(ctx_del_ok.root_path().join("backups")).unwrap();
        fs::write(
            ctx_del_ok
                .root_path()
                .join("backups")
                .join("data-test.json"),
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

    #[test]
    fn export_commands_write_files_and_return_paths() {
        let ctx = TestCtx::new();
        let state = make_state(vec![make_task("a", 123)]);

        let json = export_tasks_json_impl(&ctx, &state);
        assert!(json.ok);
        let json_path = json.data.unwrap();
        assert!(std::path::Path::new(&json_path).exists());
        let json_text = std::fs::read_to_string(&json_path).unwrap();
        assert!(json_text.contains("\"tasks\""));

        let csv = export_tasks_csv_impl(&ctx, &state);
        assert!(csv.ok);
        let csv_path = csv.data.unwrap();
        assert!(std::path::Path::new(&csv_path).exists());
        let csv_text = std::fs::read_to_string(&csv_path).unwrap();
        assert!(csv_text
            .lines()
            .next()
            .unwrap()
            .contains("id,project_id,title,due_at"));

        let md = export_tasks_markdown_impl(&ctx, &state);
        assert!(md.ok);
        let md_path = md.data.unwrap();
        assert!(std::path::Path::new(&md_path).exists());
        let md_text = std::fs::read_to_string(&md_path).unwrap();
        assert!(md_text.contains("# MustDo Export"));
        assert!(md_text.contains("## Overdue"));
    }

    #[test]
    fn export_commands_fail_when_app_data_dir_is_not_a_directory() {
        let mut ctx = TestCtx::new();
        let file_root = ctx.root_path().join("not-a-dir");
        std::fs::write(&file_root, b"x").unwrap();
        ctx.set_app_data_dir_override(file_root);

        let state = make_state(vec![make_task("a", 123)]);
        let res = export_tasks_json_impl(&ctx, &state);
        assert!(!res.ok);
    }

    #[test]
    fn write_atomic_bytes_covers_invalid_path_and_io_error_branches() {
        // Invalid export path: no parent => ok_or_else branch.
        let err = write_atomic_bytes(std::path::Path::new(""), b"x")
            .expect_err("empty path should be rejected");
        assert!(format!("{err}").contains("invalid export path"));
        assert!(is_io(&err));

        // Ensure both branches of `is_io` are exercised for coverage.
        let json_err: StorageError = serde_json::from_str::<serde_json::Value>("oops")
            .unwrap_err()
            .into();
        assert!(!is_io(&json_err));

        // Force fs::write to fail by making the temp path a directory.
        let root = tempfile::tempdir().unwrap();
        let dest = root.path().join("out.json");
        let tmp = dest.with_extension("tmp");
        std::fs::create_dir_all(&tmp).unwrap();
        let err = write_atomic_bytes(&dest, b"x").expect_err("writing to a directory should fail");
        assert!(is_io(&err));

        // Force fs::rename to fail by making the destination a directory.
        let dest_dir = root.path().join("dest");
        std::fs::create_dir_all(&dest_dir).unwrap();
        let err =
            write_atomic_bytes(&dest_dir, b"x").expect_err("renaming onto a directory should fail");
        assert!(is_io(&err));
    }

    #[test]
    fn bulk_update_tasks_updates_multiple_tasks_and_persists_once() {
        let ctx = TestCtx::new();
        let state = make_state(vec![make_task("a", 100), make_task("b", 200)]);

        let mut a = make_task("a", 555);
        a.quadrant = 3;
        a.sort_order = 999;
        let mut b = make_task("b", 666);
        b.quadrant = 2;

        let res = bulk_update_tasks_impl(&ctx, &state, vec![a, b]);
        assert!(res.ok);

        let tasks = state.tasks();
        assert_eq!(tasks.len(), 2);
        let a = tasks.iter().find(|t| t.id == "a").unwrap();
        let b = tasks.iter().find(|t| t.id == "b").unwrap();
        assert_eq!(a.due_at, 555);
        assert_eq!(a.quadrant, 3);
        assert_eq!(b.due_at, 666);
        assert_eq!(b.quadrant, 2);

        // One persist => one state_updated emission.
        assert_eq!(ctx.emitted.lock().unwrap().len(), 1);
    }

    #[test]
    fn bulk_complete_tasks_marks_completed_and_spawns_next_for_repeat() {
        let ctx = TestCtx::new();
        let mut repeating = make_task("r", 1000);
        repeating.repeat = RepeatRule::Daily {
            workday_only: false,
        };

        let state = make_state(vec![make_task("a", 100), repeating.clone()]);
        let res = bulk_complete_tasks_impl(&ctx, &state, vec!["a".to_string(), "r".to_string()]);
        assert!(res.ok);

        let tasks = state.tasks();
        let a = tasks.iter().find(|t| t.id == "a").unwrap();
        let r_done = tasks.iter().find(|t| t.id == "r").unwrap();
        assert!(a.completed);
        assert!(r_done.completed);

        // A repeat task should spawn the next instance.
        let expected_next_due = next_due_timestamp(repeating.due_at, &repeating.repeat);
        let r_next = tasks
            .iter()
            .find(|t| t.id.starts_with("r-"))
            .expect("next repeat task should exist");
        assert!(!r_next.completed);
        assert_eq!(r_next.due_at, expected_next_due);

        // One persist => one state_updated emission.
        assert_eq!(ctx.emitted.lock().unwrap().len(), 1);
    }

    #[test]
    fn project_commands_cover_create_update_swap_and_delete_paths() {
        let ctx = TestCtx::new();
        let state = make_state(Vec::new());

        let project = Project {
            id: "p1".to_string(),
            name: "Project 1".to_string(),
            pinned: false,
            sort_order: 0,
            created_at: 0,
            updated_at: 0,
            sample_tag: None,
        };

        let res = create_project_impl(&ctx, &state, project.clone());
        assert!(res.ok);
        assert!(state.projects().iter().any(|p| p.id == "p1"));

        // Also cover the branches where created_at/sort_order are already set.
        let preset = Project {
            id: "p2".to_string(),
            name: "Project 2".to_string(),
            pinned: false,
            sort_order: 42,
            created_at: 123,
            updated_at: 0,
            sample_tag: None,
        };
        let res = create_project_impl(&ctx, &state, preset.clone());
        assert!(res.ok);
        let created = res.data.unwrap();
        assert_eq!(created.id, "p2");
        assert_eq!(created.created_at, 123);
        assert_eq!(created.sort_order, 42);

        let mut updated = project.clone();
        updated.name = "Updated".to_string();
        let res = update_project_impl(&ctx, &state, updated);
        assert!(res.ok);
        assert_eq!(
            state.projects().iter().find(|p| p.id == "p1").unwrap().name,
            "Updated"
        );

        let inbox_before = state
            .projects()
            .into_iter()
            .find(|p| p.id == "inbox")
            .unwrap();
        let p1_before = state.projects().into_iter().find(|p| p.id == "p1").unwrap();

        let res = swap_project_sort_order_impl(&ctx, &state, "inbox".into(), "p1".into());
        assert!(res.ok);

        let inbox_after = state
            .projects()
            .into_iter()
            .find(|p| p.id == "inbox")
            .unwrap();
        let p1_after = state.projects().into_iter().find(|p| p.id == "p1").unwrap();
        assert_eq!(inbox_after.sort_order, p1_before.sort_order);
        assert_eq!(p1_after.sort_order, inbox_before.sort_order);

        // update_project keeps inbox pinned.
        let mut inbox = inbox_after.clone();
        inbox.pinned = false;
        inbox.name = "Renamed".to_string();
        let res = update_project_impl(&ctx, &state, inbox);
        assert!(res.ok);
        assert!(
            state
                .projects()
                .iter()
                .find(|p| p.id == "inbox")
                .unwrap()
                .pinned
        );
        assert_eq!(
            state
                .projects()
                .iter()
                .find(|p| p.id == "inbox")
                .unwrap()
                .name,
            inbox_after.name
        );

        // delete_project moves tasks to inbox first.
        let mut task = make_task("x", 123);
        task.project_id = "p1".to_string();
        let res = create_task_impl(&ctx, &state, task);
        assert!(res.ok);
        assert_eq!(
            state
                .tasks()
                .iter()
                .find(|t| t.id == "x")
                .unwrap()
                .project_id,
            "p1"
        );

        // Include a task that does not belong to the deleted project so both branches of the
        // project_id check are exercised.
        let res = create_task_impl(&ctx, &state, make_task("y", 456));
        assert!(res.ok);
        assert_eq!(
            state
                .tasks()
                .iter()
                .find(|t| t.id == "y")
                .unwrap()
                .project_id,
            "inbox"
        );

        let res = delete_project_impl(&ctx, &state, "p1".to_string());
        assert!(res.ok);
        assert!(!state.projects().iter().any(|p| p.id == "p1"));
        assert_eq!(
            state
                .tasks()
                .iter()
                .find(|t| t.id == "x")
                .unwrap()
                .project_id,
            "inbox"
        );
        assert_eq!(
            state
                .tasks()
                .iter()
                .find(|t| t.id == "y")
                .unwrap()
                .project_id,
            "inbox"
        );

        let res = delete_project_impl(&ctx, &state, "inbox".to_string());
        assert!(!res.ok);
    }

    #[test]
    fn project_commands_cover_validation_and_persist_error_paths() {
        let ctx = TestCtx::new();
        let state = make_state(Vec::new());

        let base = Project {
            id: "p1".to_string(),
            name: "Project 1".to_string(),
            pinned: false,
            sort_order: 0,
            created_at: 0,
            updated_at: 0,
            sample_tag: None,
        };

        // create_project validations.
        let mut missing_id = base.clone();
        missing_id.id = "   ".to_string();
        let res = create_project_impl(&ctx, &state, missing_id);
        assert!(!res.ok);

        let mut missing_name = base.clone();
        missing_name.name = "   ".to_string();
        let res = create_project_impl(&ctx, &state, missing_name);
        assert!(!res.ok);

        // create_project duplicate check.
        assert!(create_project_impl(&ctx, &state, base.clone()).ok);
        let res = create_project_impl(&ctx, &state, base.clone());
        assert!(!res.ok);

        // create_project persist error.
        let ctx_fail = TestCtx::new();
        fs::write(ctx_fail.root_path().join("backups"), b"x").unwrap();
        let state_fail = make_state(Vec::new());
        let mut p2 = base.clone();
        p2.id = "p2".to_string();
        let res = create_project_impl(&ctx_fail, &state_fail, p2);
        assert!(!res.ok);

        // update_project validations and not-found.
        let mut empty_id = base.clone();
        empty_id.id = "   ".to_string();
        let res = update_project_impl(&ctx, &state, empty_id);
        assert!(!res.ok);

        let mut empty_name = base.clone();
        empty_name.name = "   ".to_string();
        let res = update_project_impl(&ctx, &state, empty_name);
        assert!(!res.ok);

        let mut missing = base.clone();
        missing.id = "missing".to_string();
        let res = update_project_impl(&ctx, &state, missing);
        assert!(!res.ok);

        // update_project persist error.
        let ctx_fail2 = TestCtx::new();
        fs::write(ctx_fail2.root_path().join("backups"), b"x").unwrap();
        let state_fail2 = make_state(Vec::new());
        state_fail2.add_project(base.clone());
        let mut updated = base.clone();
        updated.name = "Updated".to_string();
        let res = update_project_impl(&ctx_fail2, &state_fail2, updated);
        assert!(!res.ok);

        // swap_project_sort_order errors.
        let res = swap_project_sort_order_impl(&ctx, &state, "inbox".into(), "missing".into());
        assert!(!res.ok);

        let ctx_fail3 = TestCtx::new();
        fs::write(ctx_fail3.root_path().join("backups"), b"x").unwrap();
        let state_fail3 = make_state(Vec::new());
        state_fail3.add_project(base.clone());
        let res =
            swap_project_sort_order_impl(&ctx_fail3, &state_fail3, "inbox".into(), "p1".into());
        assert!(!res.ok);

        // delete_project errors.
        let res = delete_project_impl(&ctx, &state, "   ".to_string());
        assert!(!res.ok);
        let res = delete_project_impl(&ctx, &state, "missing".to_string());
        assert!(!res.ok);

        let ctx_fail4 = TestCtx::new();
        fs::write(ctx_fail4.root_path().join("backups"), b"x").unwrap();
        let state_fail4 = make_state(Vec::new());
        state_fail4.add_project(base.clone());
        let res = delete_project_impl(&ctx_fail4, &state_fail4, "p1".to_string());
        assert!(!res.ok);
    }

    #[test]
    fn task_commands_normalize_invalid_project_ids_and_cover_persist_errors() {
        let ctx = TestCtx::new();
        let state = make_state(Vec::new());

        let mut t = make_task("invalid-proj", 1000);
        t.project_id = "missing".to_string();
        let res = create_task_impl(&ctx, &state, t);
        assert!(res.ok);
        assert_eq!(res.data.as_ref().unwrap().project_id, "inbox");

        let mut edited = res.data.unwrap();
        edited.title = "edited".to_string();
        edited.project_id = "missing2".to_string();
        let res = update_task_impl(&ctx, &state, edited);
        assert!(res.ok);
        assert_eq!(res.data.as_ref().unwrap().project_id, "inbox");

        // bulk_update normalizes invalid project ids and hits persist error branch.
        let ctx_fail = TestCtx::new();
        fs::write(ctx_fail.root_path().join("backups"), b"x").unwrap();
        let state_fail = make_state(vec![make_task("bu1", 123)]);
        let mut update = make_task("bu1", 456);
        update.project_id = "missing".to_string();
        update.created_at = 2;
        update.sort_order = 0;
        let res = bulk_update_tasks_impl(&ctx_fail, &state_fail, vec![update]);
        assert!(!res.ok);
        assert_eq!(
            state_fail
                .tasks()
                .into_iter()
                .find(|t| t.id == "bu1")
                .unwrap()
                .project_id,
            "inbox"
        );
    }

    #[test]
    fn build_next_repeat_task_covers_reminder_none_and_forced_branches() {
        let mut none = make_task("none", 1000);
        none.reminder.kind = ReminderKind::None;
        none.reminder.remind_at = Some(900);
        let next = build_next_repeat_task(&none, 2000);
        assert_eq!(next.reminder.remind_at, None);

        let mut forced = make_task("forced", 1000);
        forced.reminder.kind = ReminderKind::Forced;
        forced.reminder.remind_at = None;
        let next = build_next_repeat_task(&forced, 3000);
        assert_eq!(next.reminder.remind_at, Some(3000));
    }

    #[test]
    fn bulk_complete_tasks_covers_missing_id_continue_and_persist_error() {
        let ctx = TestCtx::new();
        let mut task = make_task("repeat", 1000);
        task.repeat = RepeatRule::Daily {
            workday_only: false,
        };
        let state = make_state(vec![task]);
        let res = bulk_complete_tasks_impl(&ctx, &state, vec!["missing".into(), "repeat".into()]);
        assert!(res.ok);

        let ctx_fail = TestCtx::new();
        fs::write(ctx_fail.root_path().join("backups"), b"x").unwrap();
        let mut task2 = make_task("repeat2", 1000);
        task2.repeat = RepeatRule::Daily {
            workday_only: false,
        };
        let state2 = make_state(vec![task2]);
        let res = bulk_complete_tasks_impl(&ctx_fail, &state2, vec!["repeat2".into()]);
        assert!(!res.ok);
    }

    #[test]
    fn export_tasks_json_covers_app_data_dir_and_json_error_paths() {
        let state = make_state(Vec::new());

        let bad = TestCtx::with_app_data_dir_error("nope");
        let res = export_tasks_json_impl(&bad, &state);
        assert!(!res.ok);

        // success path hits default `force_json_serialize_error` implementation (returns false).
        let ok_ctx = TestCtx::new();
        let res = export_tasks_json_impl(&ok_ctx, &state);
        assert!(res.ok);

        // forced serialization error path.
        let err_ctx = ForceJsonErrorCtx::new();
        let res = export_tasks_json_impl(&err_ctx, &state);
        assert!(!res.ok);
    }

    #[test]
    fn force_json_error_ctx_forwards_all_trait_methods() {
        let ctx = ForceJsonErrorCtx::new();
        ctx.emit_state_updated(StatePayload {
            tasks: Vec::new(),
            projects: Vec::new(),
            settings: Settings::default(),
        });
        ctx.update_tray_count(&[], &Settings::default());
        ctx.shortcut_unregister_all();
        assert!(ctx.shortcut_validate("CommandOrControl+Shift+P").is_ok());
        assert!(ctx.shortcut_register("CommandOrControl+Shift+P").is_ok());
    }

    #[test]
    fn export_tasks_csv_and_markdown_cover_error_and_formatting_branches() {
        let now = Local::now();
        let now_ts = now.timestamp();
        let today = now.date_naive();
        let end_of_today = today.and_hms_opt(23, 59, 59).unwrap();
        let end_of_today_ts = Local
            .from_local_datetime(&end_of_today)
            .single()
            .unwrap()
            .timestamp();
        let tomorrow = today.succ_opt().unwrap();
        let end_of_tomorrow = tomorrow.and_hms_opt(23, 59, 59).unwrap();
        let end_of_tomorrow_ts = Local
            .from_local_datetime(&end_of_tomorrow)
            .single()
            .unwrap()
            .timestamp();

        let overdue = make_task("overdue", now_ts - 3600);

        let mut due_today = make_task("today", end_of_today_ts);
        due_today.tags = vec!["alpha".to_string(), "beta".to_string()];
        due_today.notes = Some("line1\r\nline2".to_string());
        due_today.steps = vec![
            Step {
                id: "s1".to_string(),
                title: "done".to_string(),
                completed: true,
                created_at: 1,
                completed_at: Some(1),
            },
            Step {
                id: "s2".to_string(),
                title: "todo".to_string(),
                completed: false,
                created_at: 1,
                completed_at: None,
            },
        ];

        let mut future = make_task("future", end_of_tomorrow_ts);
        future.important = true;

        let mut blank_notes = make_task("blank-notes", end_of_tomorrow_ts);
        blank_notes.notes = Some(" \r\n ".to_string());

        let invalid = make_task("invalid-ts", i64::MAX);

        let mut done = make_task("done", now_ts - 10);
        done.completed = true;

        let state = make_state(vec![overdue, due_today, future, blank_notes, invalid, done]);

        // app_data_dir error paths.
        let bad = TestCtx::with_app_data_dir_error("nope");
        assert!(!export_tasks_csv_impl(&bad, &state).ok);
        assert!(!export_tasks_markdown_impl(&bad, &state).ok);

        // Force write_atomic_bytes to fail by making `exports/` a file.
        let ctx = TestCtx::new();
        fs::write(ctx.root_path().join("exports"), b"x").unwrap();
        assert!(!export_tasks_csv_impl(&ctx, &state).ok);
        assert!(!export_tasks_markdown_impl(&ctx, &state).ok);
    }
}
