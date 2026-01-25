use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use chrono::Utc;

use crate::models::{Project, Settings, SettingsFile, Task, TasksFile};

const SCHEMA_VERSION: u32 = 1;
const INBOX_PROJECT_ID: &str = "inbox";
const INBOX_PROJECT_DEFAULT_NAME: &str = "Inbox";

fn ensure_inbox_project(projects: &mut Vec<Project>, now: &chrono::DateTime<Utc>) {
    if projects
        .iter()
        .any(|project| project.id == INBOX_PROJECT_ID)
    {
        return;
    }
    projects.push(Project {
        id: INBOX_PROJECT_ID.to_string(),
        name: INBOX_PROJECT_DEFAULT_NAME.to_string(),
        pinned: true,
        sort_order: 0,
        created_at: now.timestamp(),
        updated_at: now.timestamp(),
        sample_tag: None,
    });
}

fn normalize_projects(projects: &mut Vec<Project>) {
    for project in projects {
        if project.sort_order == 0 {
            project.sort_order = project.created_at * 1000;
        }
    }
}

fn normalize_tasks(tasks: &mut Vec<Task>, projects: &[Project]) {
    let allowed: HashSet<&str> = projects.iter().map(|project| project.id.as_str()).collect();

    for task in tasks {
        if task.sort_order == 0 {
            task.sort_order = task.created_at * 1000;
        }
        if task.project_id.trim().is_empty() || !allowed.contains(task.project_id.as_str()) {
            task.project_id = INBOX_PROJECT_ID.to_string();
        }
    }
}

#[derive(Clone)]
pub struct AppState {
    inner: Arc<Mutex<AppData>>,
    // Runtime-only flag: when the user is recording a shortcut in Settings,
    // we temporarily ignore the global shortcut handler to avoid accidental triggers.
    shortcut_capture_active: Arc<AtomicBool>,
}

#[derive(Debug, Clone)]
pub struct AppStateSnapshot {
    pub tasks: Vec<Task>,
    pub projects: Vec<Project>,
    pub settings: Settings,
}

impl AppState {
    fn lock_inner(&self) -> MutexGuard<'_, AppData> {
        match self.inner.lock() {
            Ok(guard) => guard,
            Err(poisoned) => {
                // Prefer to keep the app bootable if a background task panicked.
                log::warn!("state mutex poisoned; continuing with recovered guard");
                poisoned.into_inner()
            }
        }
    }

    pub fn new(tasks: Vec<Task>, projects: Vec<Project>, settings: Settings) -> Self {
        let now = Utc::now();
        let mut tasks = tasks;
        let mut projects = projects;

        ensure_inbox_project(&mut projects, &now);
        normalize_projects(&mut projects);
        normalize_tasks(&mut tasks, &projects);
        Self {
            inner: Arc::new(Mutex::new(AppData {
                tasks,
                projects,
                settings,
            })),
            shortcut_capture_active: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn is_shortcut_capture_active(&self) -> bool {
        self.shortcut_capture_active.load(Ordering::Relaxed)
    }

    pub fn set_shortcut_capture_active(&self, active: bool) {
        self.shortcut_capture_active
            .store(active, Ordering::Relaxed);
    }

    pub fn snapshot(&self) -> AppStateSnapshot {
        let guard = self.lock_inner();
        AppStateSnapshot {
            tasks: guard.tasks.clone(),
            projects: guard.projects.clone(),
            settings: guard.settings.clone(),
        }
    }

    pub fn tasks_file(&self) -> TasksFile {
        let guard = self.lock_inner();
        TasksFile {
            schema_version: SCHEMA_VERSION,
            tasks: guard.tasks.clone(),
            projects: guard.projects.clone(),
        }
    }

    pub fn settings_file(&self) -> SettingsFile {
        let guard = self.lock_inner();
        SettingsFile {
            schema_version: SCHEMA_VERSION,
            settings: guard.settings.clone(),
        }
    }

    pub fn tasks(&self) -> Vec<Task> {
        let guard = self.lock_inner();
        guard.tasks.clone()
    }

    pub fn projects(&self) -> Vec<Project> {
        let guard = self.lock_inner();
        guard.projects.clone()
    }

    pub fn add_task(&self, task: Task) {
        let mut guard = self.lock_inner();
        guard.tasks.push(task);
    }

    pub fn add_project(&self, project: Project) {
        let mut guard = self.lock_inner();
        guard.projects.push(project);
    }

    pub fn replace_tasks(&self, tasks: Vec<Task>) {
        let mut guard = self.lock_inner();
        let mut next = tasks;
        normalize_tasks(&mut next, &guard.projects);
        guard.tasks = next;
    }

    pub fn replace_projects(&self, projects: Vec<Project>) {
        let mut guard = self.lock_inner();
        let now = Utc::now();
        let mut next = projects;
        ensure_inbox_project(&mut next, &now);
        normalize_projects(&mut next);
        guard.projects = next;

        // Any task referencing a now-missing project is moved to inbox.
        let projects_snapshot = guard.projects.clone();
        normalize_tasks(&mut guard.tasks, &projects_snapshot);
    }

    pub fn update_task(&self, task: Task) {
        let mut guard = self.lock_inner();
        if let Some(existing) = guard.tasks.iter_mut().find(|t| t.id == task.id) {
            let mut next = task;
            if next.sample_tag.is_none() {
                next.sample_tag = existing.sample_tag.clone();
            }
            *existing = next;
        }
    }

    pub fn update_project(&self, project: Project) {
        let mut guard = self.lock_inner();
        if let Some(existing) = guard.projects.iter_mut().find(|p| p.id == project.id) {
            *existing = project;
        }
    }

    pub fn remove_project(&self, project_id: &str) {
        let mut guard = self.lock_inner();
        if project_id == INBOX_PROJECT_ID {
            return;
        }
        guard.projects.retain(|project| project.id != project_id);
        let projects_snapshot = guard.projects.clone();
        normalize_tasks(&mut guard.tasks, &projects_snapshot);
    }

    pub fn swap_sort_order(&self, first_id: &str, second_id: &str, updated_at: i64) -> bool {
        let mut guard = self.lock_inner();
        let mut first_index = None;
        let mut second_index = None;
        for (index, task) in guard.tasks.iter().enumerate() {
            if task.id == first_id {
                first_index = Some(index);
            } else if task.id == second_id {
                second_index = Some(index);
            }
            if first_index.is_some() && second_index.is_some() {
                break;
            }
        }
        let (first_index, second_index) = match (first_index, second_index) {
            (Some(first), Some(second)) => (first, second),
            _ => return false,
        };
        let first_order = guard.tasks[first_index].sort_order;
        guard.tasks[first_index].sort_order = guard.tasks[second_index].sort_order;
        guard.tasks[second_index].sort_order = first_order;
        guard.tasks[first_index].updated_at = updated_at;
        guard.tasks[second_index].updated_at = updated_at;
        true
    }

    pub fn swap_project_sort_order(
        &self,
        first_id: &str,
        second_id: &str,
        updated_at: i64,
    ) -> bool {
        let mut guard = self.lock_inner();
        let mut first_index = None;
        let mut second_index = None;
        for (index, project) in guard.projects.iter().enumerate() {
            if project.id == first_id {
                first_index = Some(index);
            } else if project.id == second_id {
                second_index = Some(index);
            }
            if first_index.is_some() && second_index.is_some() {
                break;
            }
        }
        let (first_index, second_index) = match (first_index, second_index) {
            (Some(first), Some(second)) => (first, second),
            _ => return false,
        };
        let first_order = guard.projects[first_index].sort_order;
        guard.projects[first_index].sort_order = guard.projects[second_index].sort_order;
        guard.projects[second_index].sort_order = first_order;
        guard.projects[first_index].updated_at = updated_at;
        guard.projects[second_index].updated_at = updated_at;
        true
    }

    pub fn complete_task(&self, task_id: &str) -> Option<Task> {
        let mut guard = self.lock_inner();
        let now = Utc::now().timestamp();
        let mut completed_task: Option<Task> = None;
        if let Some(task) = guard.tasks.iter_mut().find(|t| t.id == task_id) {
            task.completed = true;
            task.completed_at = Some(now);
            task.updated_at = now;
            task.reminder.snoozed_until = None;
            task.reminder.last_fired_at = Some(now);
            completed_task = Some(task.clone());
        }
        completed_task
    }

    pub fn remove_task(&self, task_id: &str) {
        let mut guard = self.lock_inner();
        guard.tasks.retain(|task| task.id != task_id);
    }

    pub fn remove_tasks(&self, task_ids: &[String]) {
        let mut guard = self.lock_inner();
        let ids: HashSet<&str> = task_ids.iter().map(|id| id.as_str()).collect();
        guard.tasks.retain(|task| !ids.contains(task.id.as_str()));
    }

    pub fn mark_reminder_fired(&self, task: &Task, at: i64) {
        let mut guard = self.lock_inner();
        if let Some(existing) = guard.tasks.iter_mut().find(|t| t.id == task.id) {
            existing.reminder.last_fired_at = Some(at);
            existing.reminder.repeat_fired_count = existing
                .reminder
                .repeat_fired_count
                .max(0)
                .saturating_add(1);
            if let Some(snoozed_until) = existing.reminder.snoozed_until {
                if snoozed_until <= at {
                    existing.reminder.snoozed_until = None;
                }
            }
        }
    }

    pub fn settings(&self) -> Settings {
        let guard = self.lock_inner();
        guard.settings.clone()
    }

    pub fn update_settings(&self, settings: Settings) {
        let mut guard = self.lock_inner();
        guard.settings = settings;
    }
}

#[derive(Debug)]
struct AppData {
    tasks: Vec<Task>,
    projects: Vec<Project>,
    settings: Settings,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ReminderConfig, ReminderKind, RepeatRule, Task};

    fn make_task(id: &str, created_at: i64, sort_order: i64, due_at: i64) -> Task {
        Task {
            id: id.to_string(),
            project_id: "inbox".to_string(),
            title: format!("task-{id}"),
            due_at,
            important: false,
            completed: false,
            completed_at: None,
            created_at,
            updated_at: created_at,
            sort_order,
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

    #[test]
    fn new_fills_sort_order_when_zero() {
        let tasks = vec![make_task("a", 10, 0, 100), make_task("b", 20, 777, 200)];
        let state = AppState::new(tasks, Vec::new(), Settings::default());
        let out = state.tasks();
        let a = out.iter().find(|t| t.id == "a").unwrap();
        let b = out.iter().find(|t| t.id == "b").unwrap();
        assert_eq!(a.sort_order, 10 * 1000);
        assert_eq!(b.sort_order, 777);
    }

    #[test]
    fn shortcut_capture_flag_defaults_to_false_and_can_toggle() {
        let state = AppState::new(Vec::new(), Vec::new(), Settings::default());
        assert!(!state.is_shortcut_capture_active());
        state.set_shortcut_capture_active(true);
        assert!(state.is_shortcut_capture_active());
        state.set_shortcut_capture_active(false);
        assert!(!state.is_shortcut_capture_active());
    }

    #[test]
    fn tasks_file_and_settings_file_include_schema_version() {
        let state = AppState::new(Vec::new(), Vec::new(), Settings::default());
        let tasks_file = state.tasks_file();
        assert_eq!(tasks_file.schema_version, SCHEMA_VERSION);
        assert_eq!(tasks_file.tasks.len(), 0);
        assert!(tasks_file.projects.iter().any(|p| p.id == "inbox"));

        let settings_file = state.settings_file();
        assert_eq!(settings_file.schema_version, SCHEMA_VERSION);
        assert_eq!(
            settings_file.settings.shortcut,
            Settings::default().shortcut
        );
    }

    #[test]
    fn add_update_and_replace_tasks() {
        let state = AppState::new(Vec::new(), Vec::new(), Settings::default());
        state.add_task(make_task("a", 10, 0, 100));
        assert_eq!(state.tasks().len(), 1);

        let mut updated = make_task("a", 10, 0, 100);
        updated.title = "updated".to_string();
        state.update_task(updated.clone());
        let out = state.tasks();
        assert_eq!(out[0].title, "updated");

        // Updating a non-existent task should be a no-op.
        state.update_task(make_task("missing", 1, 0, 1));
        assert_eq!(state.tasks().len(), 1);

        // replace_tasks should also fill sort_order if missing.
        state.replace_tasks(vec![make_task("x", 7, 0, 1)]);
        let out = state.tasks();
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].id, "x");
        assert_eq!(out[0].sort_order, 7 * 1000);
    }

    #[test]
    fn swap_sort_order_success_and_failure() {
        let t1 = make_task("a", 1, 100, 10);
        let t2 = make_task("b", 2, 200, 20);
        let state = AppState::new(vec![t1, t2], Vec::new(), Settings::default());

        assert!(state.swap_sort_order("a", "b", 999));
        let out = state.tasks();
        let a = out.iter().find(|t| t.id == "a").unwrap();
        let b = out.iter().find(|t| t.id == "b").unwrap();
        assert_eq!(a.sort_order, 200);
        assert_eq!(b.sort_order, 100);
        assert_eq!(a.updated_at, 999);
        assert_eq!(b.updated_at, 999);

        // Missing IDs should return false.
        assert!(!state.swap_sort_order("a", "missing", 1));
    }

    #[test]
    fn complete_remove_and_mark_reminder() {
        let mut task = make_task("a", 1, 1, 10);
        task.reminder.snoozed_until = Some(123);
        let state = AppState::new(vec![task], Vec::new(), Settings::default());

        let completed = state.complete_task("a").expect("task exists");
        assert!(completed.completed);
        assert!(completed.completed_at.is_some());
        assert_eq!(completed.completed_at, Some(completed.updated_at));
        assert_eq!(completed.reminder.snoozed_until, None);
        assert_eq!(completed.reminder.last_fired_at, completed.completed_at);

        // Not found => None.
        assert!(state.complete_task("missing").is_none());

        // mark_reminder_fired should update last_fired_at if it exists.
        state.mark_reminder_fired(&completed, 777);
        let refreshed = state.tasks().into_iter().find(|t| t.id == "a").unwrap();
        assert_eq!(refreshed.reminder.last_fired_at, Some(777));

        // mark_reminder_fired on a missing task is a no-op.
        state.mark_reminder_fired(&make_task("missing", 1, 1, 1), 1);

        // remove_task and remove_tasks.
        state.add_task(make_task("b", 1, 1, 1));
        state.add_task(make_task("c", 1, 1, 1));
        state.remove_task("b");
        assert!(state.tasks().iter().all(|t| t.id != "b"));
        state.remove_tasks(&vec!["a".to_string(), "c".to_string()]);
        assert!(state.tasks().is_empty());
    }

    #[test]
    fn update_settings_replaces_previous_value() {
        let state = AppState::new(Vec::new(), Vec::new(), Settings::default());
        let mut next = Settings::default();
        next.theme = "dark".to_string();
        state.update_settings(next.clone());
        assert_eq!(state.settings().theme, "dark");
    }

    #[test]
    fn update_task_preserves_sample_tag_when_missing_in_update() {
        let mut task = make_task("sample", 1, 1, 10);
        task.sample_tag = Some("ai-novel-assistant-v1".to_string());
        let state = AppState::new(vec![task.clone()], Vec::new(), Settings::default());

        let mut edited = task.clone();
        edited.title = "edited".to_string();
        edited.sample_tag = None;
        state.update_task(edited);

        let updated = state.tasks().into_iter().find(|t| t.id == task.id).unwrap();
        assert_eq!(updated.sample_tag.as_deref(), Some("ai-novel-assistant-v1"));
    }

    #[test]
    fn update_task_overwrites_sample_tag_when_present() {
        let mut task = make_task("sample2", 1, 1, 10);
        task.sample_tag = Some("old-tag".to_string());
        let state = AppState::new(vec![task.clone()], Vec::new(), Settings::default());

        let mut edited = task.clone();
        edited.sample_tag = Some("new-tag".to_string());
        state.update_task(edited);

        let updated = state.tasks().into_iter().find(|t| t.id == task.id).unwrap();
        assert_eq!(updated.sample_tag.as_deref(), Some("new-tag"));
    }

    #[test]
    fn normalize_tasks_moves_invalid_or_blank_project_ids_into_inbox() {
        let mut task_missing = make_task("missing-project", 1, 0, 10);
        task_missing.project_id = "does-not-exist".to_string();
        let mut task_blank = make_task("blank-project", 1, 0, 10);
        task_blank.project_id = "   ".to_string();

        let state = AppState::new(
            vec![task_missing, task_blank],
            Vec::new(),
            Settings::default(),
        );
        let out = state.tasks();
        assert!(out.iter().all(|t| t.project_id == "inbox"));
    }

    #[test]
    fn remove_project_is_noop_for_inbox() {
        let state = AppState::new(Vec::new(), Vec::new(), Settings::default());
        state.remove_project("inbox");
        assert!(state.projects().iter().any(|p| p.id == "inbox"));
    }

    #[test]
    fn swap_project_sort_order_returns_false_when_ids_missing() {
        let state = AppState::new(Vec::new(), Vec::new(), Settings::default());
        assert!(!state.swap_project_sort_order("inbox", "missing", 123));
        assert!(!state.swap_project_sort_order("missing", "inbox", 123));
    }

    #[test]
    fn lock_inner_recovers_from_poisoned_mutex() {
        let state = AppState::new(Vec::new(), Vec::new(), Settings::default());

        let inner = state.inner.clone();
        let handle = std::thread::spawn(move || {
            let _guard = inner.lock().unwrap();
            panic!("poison the mutex while holding the lock");
        });
        let _ = handle.join();

        // The mutex is now poisoned. Calls that lock it should keep working.
        assert!(state.tasks().is_empty());
        assert!(state.projects().iter().any(|p| p.id == "inbox"));
    }

    #[test]
    fn mark_reminder_fired_clears_snoozed_until_when_due_or_past() {
        let mut task = make_task("a", 1, 1, 10);
        task.reminder.snoozed_until = Some(100);
        let state = AppState::new(vec![task.clone()], Vec::new(), Settings::default());

        state.mark_reminder_fired(&task, 100);
        let refreshed = state.tasks().into_iter().find(|t| t.id == "a").unwrap();
        assert_eq!(refreshed.reminder.snoozed_until, None);
    }

    #[test]
    fn mark_reminder_fired_keeps_snoozed_until_when_in_future() {
        let mut task = make_task("a", 1, 1, 10);
        task.reminder.snoozed_until = Some(200);
        let state = AppState::new(vec![task.clone()], Vec::new(), Settings::default());

        state.mark_reminder_fired(&task, 100);
        let refreshed = state.tasks().into_iter().find(|t| t.id == "a").unwrap();
        assert_eq!(refreshed.reminder.snoozed_until, Some(200));
    }

    #[test]
    fn update_project_is_noop_when_id_is_missing() {
        let state = AppState::new(Vec::new(), Vec::new(), Settings::default());
        let before = state.projects();

        state.update_project(Project {
            id: "missing".to_string(),
            name: "Missing".to_string(),
            pinned: false,
            sort_order: 1,
            created_at: 1,
            updated_at: 1,
            sample_tag: None,
        });

        let after = state.projects();
        assert_eq!(after.len(), before.len());
        assert!(after.iter().any(|p| p.id == "inbox"));
    }
}
