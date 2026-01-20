use std::sync::{Arc, Mutex};

use chrono::Utc;

use crate::models::{Settings, SettingsFile, Task, TasksFile};

const SCHEMA_VERSION: u32 = 1;

#[derive(Clone)]
pub struct AppState {
    inner: Arc<Mutex<AppData>>,
}

impl AppState {
    pub fn new(tasks: Vec<Task>, settings: Settings) -> Self {
        let mut tasks = tasks;
        for task in &mut tasks {
            if task.sort_order == 0 {
                task.sort_order = task.created_at * 1000;
            }
        }
        Self {
            inner: Arc::new(Mutex::new(AppData { tasks, settings })),
        }
    }

    pub fn tasks_file(&self) -> TasksFile {
        let guard = self.inner.lock().expect("state poisoned");
        TasksFile {
            schema_version: SCHEMA_VERSION,
            tasks: guard.tasks.clone(),
        }
    }

    pub fn settings_file(&self) -> SettingsFile {
        let guard = self.inner.lock().expect("state poisoned");
        SettingsFile {
            schema_version: SCHEMA_VERSION,
            settings: guard.settings.clone(),
        }
    }

    pub fn tasks(&self) -> Vec<Task> {
        let guard = self.inner.lock().expect("state poisoned");
        guard.tasks.clone()
    }

    pub fn add_task(&self, task: Task) {
        let mut guard = self.inner.lock().expect("state poisoned");
        guard.tasks.push(task);
    }

    pub fn replace_tasks(&self, tasks: Vec<Task>) {
        let mut guard = self.inner.lock().expect("state poisoned");
        guard.tasks = tasks
            .into_iter()
            .map(|mut task| {
                if task.sort_order == 0 {
                    task.sort_order = task.created_at * 1000;
                }
                task
            })
            .collect();
    }

    pub fn update_task(&self, task: Task) {
        let mut guard = self.inner.lock().expect("state poisoned");
        if let Some(existing) = guard.tasks.iter_mut().find(|t| t.id == task.id) {
            *existing = task;
        }
    }

    pub fn swap_sort_order(&self, first_id: &str, second_id: &str, updated_at: i64) -> bool {
        let mut guard = self.inner.lock().expect("state poisoned");
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

    pub fn complete_task(&self, task_id: &str) -> Option<Task> {
        let mut guard = self.inner.lock().expect("state poisoned");
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
        let mut guard = self.inner.lock().expect("state poisoned");
        guard.tasks.retain(|task| task.id != task_id);
    }

    pub fn remove_tasks(&self, task_ids: &[String]) {
        let mut guard = self.inner.lock().expect("state poisoned");
        guard.tasks.retain(|task| !task_ids.contains(&task.id));
    }

    pub fn mark_reminder_fired(&self, task: &Task, at: i64) {
        let mut guard = self.inner.lock().expect("state poisoned");
        if let Some(existing) = guard.tasks.iter_mut().find(|t| t.id == task.id) {
            existing.reminder.last_fired_at = Some(at);
        }
    }

    pub fn settings(&self) -> Settings {
        let guard = self.inner.lock().expect("state poisoned");
        guard.settings.clone()
    }

    pub fn update_settings(&self, settings: Settings) {
        let mut guard = self.inner.lock().expect("state poisoned");
        guard.settings = settings;
    }
}

#[derive(Debug)]
struct AppData {
    tasks: Vec<Task>,
    settings: Settings,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ReminderConfig, ReminderKind, RepeatRule, Task};

    fn make_task(id: &str, created_at: i64, sort_order: i64, due_at: i64) -> Task {
        Task {
            id: id.to_string(),
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
        let state = AppState::new(tasks, Settings::default());
        let out = state.tasks();
        let a = out.iter().find(|t| t.id == "a").unwrap();
        let b = out.iter().find(|t| t.id == "b").unwrap();
        assert_eq!(a.sort_order, 10 * 1000);
        assert_eq!(b.sort_order, 777);
    }

    #[test]
    fn tasks_file_and_settings_file_include_schema_version() {
        let state = AppState::new(Vec::new(), Settings::default());
        let tasks_file = state.tasks_file();
        assert_eq!(tasks_file.schema_version, SCHEMA_VERSION);
        assert_eq!(tasks_file.tasks.len(), 0);

        let settings_file = state.settings_file();
        assert_eq!(settings_file.schema_version, SCHEMA_VERSION);
        assert_eq!(
            settings_file.settings.shortcut,
            Settings::default().shortcut
        );
    }

    #[test]
    fn add_update_and_replace_tasks() {
        let state = AppState::new(Vec::new(), Settings::default());
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
        let state = AppState::new(vec![t1, t2], Settings::default());

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
        let state = AppState::new(vec![task], Settings::default());

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
        let state = AppState::new(Vec::new(), Settings::default());
        let mut next = Settings::default();
        next.theme = "dark".to_string();
        state.update_settings(next.clone());
        assert_eq!(state.settings().theme, "dark");
    }
}
