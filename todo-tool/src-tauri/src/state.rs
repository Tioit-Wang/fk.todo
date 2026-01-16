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

    pub fn update_task(&self, task: Task) {
        let mut guard = self.inner.lock().expect("state poisoned");
        if let Some(existing) = guard.tasks.iter_mut().find(|t| t.id == task.id) {
            *existing = task;
        }
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
