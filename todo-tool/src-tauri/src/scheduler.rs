use std::time::Duration;

use chrono::Utc;
use tauri::{AppHandle, Emitter, Manager};

use crate::models::{ReminderKind, Task};
use crate::state::AppState;
use crate::storage::Storage;
use crate::windows::show_reminder_window;

use crate::events::{StatePayload, EVENT_REMINDER, EVENT_STATE_UPDATED};

pub fn start_scheduler(app: AppHandle, state: AppState) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(1));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            let now = Utc::now().timestamp();
            let due_tasks = collect_due_tasks(&state, now);
            if !due_tasks.is_empty() {
                for task in &due_tasks {
                    state.mark_reminder_fired(task, now);
                }
                persist_reminder_state(&app, &state);
                let has_forced = due_tasks
                    .iter()
                    .any(|task| task.reminder.kind == ReminderKind::Forced);
                let _ = app.emit(EVENT_REMINDER, due_tasks);
                if has_forced {
                    show_reminder_window(&app);
                }
            }
        }
    });
}

fn persist_reminder_state(app: &AppHandle, state: &AppState) {
    let root = match app.path().app_data_dir() {
        Ok(path) => path,
        Err(_) => return,
    };
    let storage = Storage::new(root);
    if storage.ensure_dirs().is_err() {
        return;
    }
    if storage.save_tasks(&state.tasks_file(), false).is_err() {
        return;
    }
    let payload = StatePayload {
        tasks: state.tasks(),
        settings: state.settings(),
    };
    let _ = app.emit(EVENT_STATE_UPDATED, payload);
}

fn collect_due_tasks(state: &AppState, now: i64) -> Vec<Task> {
    let mut due = Vec::new();
    let tasks = state.tasks();
    for task in tasks {
        if task.completed {
            continue;
        }
        let reminder = &task.reminder;
        if reminder.kind == ReminderKind::None {
            continue;
        }
        if reminder.kind == ReminderKind::Forced && reminder.forced_dismissed {
            continue;
        }
        let default_target = match reminder.kind {
            ReminderKind::Normal => Some(task.due_at - 10 * 60),
            ReminderKind::Forced => Some(task.due_at),
            ReminderKind::None => None,
        };
        let target_time = reminder
            .snoozed_until
            .or(reminder.remind_at)
            .or(default_target);
        if let Some(target) = target_time {
            if let Some(last_fired) = reminder.last_fired_at {
                if last_fired >= target {
                    continue;
                }
            }
            if now >= target {
                due.push(task.clone());
            }
        }
    }
    due.sort_by(|a, b| {
        if a.important != b.important {
            return if a.important {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            };
        }
        a.due_at.cmp(&b.due_at)
    });
    due
}
