use std::time::Duration;

use chrono::Utc;
use tauri::{AppHandle, Emitter};

use crate::models::{ReminderKind, Task};
use crate::state::AppState;
use crate::windows::show_reminder_window;

use crate::events::EVENT_REMINDER;

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
                let _ = app.emit(EVENT_REMINDER, due_tasks);
                show_reminder_window(&app);
            }
        }
    });
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
        if reminder.forced_dismissed {
            continue;
        }
        let target_time = reminder.snoozed_until.or(reminder.remind_at);
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
    due
}
