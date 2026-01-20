use crate::models::{ReminderKind, Task};
use crate::state::AppState;

#[cfg(all(feature = "app", not(test)))]
use crate::events::{StatePayload, EVENT_REMINDER, EVENT_STATE_UPDATED};
#[cfg(all(feature = "app", not(test)))]
use crate::storage::Storage;
#[cfg(all(feature = "app", not(test)))]
use crate::windows::show_reminder_window;
#[cfg(all(feature = "app", not(test)))]
use chrono::Utc;
#[cfg(all(feature = "app", not(test)))]
use std::time::Duration;
#[cfg(all(feature = "app", not(test)))]
use tauri::{AppHandle, Emitter, Manager};

#[cfg(all(feature = "app", not(test)))]
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

#[cfg(all(feature = "app", not(test)))]
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
        // At this point `reminder.kind` is Normal or Forced (None has already been skipped).
        let default_target = if reminder.kind == ReminderKind::Normal {
            task.due_at - 10 * 60
        } else {
            task.due_at
        };
        let target_time = reminder
            .snoozed_until
            .or(reminder.remind_at)
            .unwrap_or(default_target);

        let already_fired = reminder
            .last_fired_at
            .map_or(false, |last_fired| last_fired >= target_time);
        if !already_fired && now >= target_time {
            due.push(task.clone());
        }
    }
    due.sort_by_key(|task| (!task.important, task.due_at));
    due
}

#[cfg(test)]
mod tests {
    use super::collect_due_tasks;
    use crate::models::{ReminderConfig, ReminderKind, RepeatRule, Task};
    use crate::state::AppState;

    fn task_with_reminder(
        id: &str,
        due_at: i64,
        important: bool,
        completed: bool,
        reminder: ReminderConfig,
    ) -> Task {
        Task {
            id: id.to_string(),
            title: format!("task-{id}"),
            due_at,
            important,
            completed,
            completed_at: None,
            created_at: 1,
            updated_at: 1,
            sort_order: 1,
            quadrant: 1,
            notes: None,
            steps: Vec::new(),
            reminder,
            repeat: RepeatRule::None,
        }
    }

    #[test]
    fn collect_due_tasks_filters_and_sorts_correctly() {
        let now = 1000;

        let not_due_normal = task_with_reminder(
            "a",
            2000,
            false,
            false,
            ReminderConfig {
                kind: ReminderKind::Normal,
                ..ReminderConfig::default()
            },
        );

        let due_normal_important = task_with_reminder(
            "b",
            1500,
            true,
            false,
            ReminderConfig {
                kind: ReminderKind::Normal,
                ..ReminderConfig::default()
            },
        ); // target=900 => due

        let not_due_forced = task_with_reminder(
            "c",
            1100,
            false,
            false,
            ReminderConfig {
                kind: ReminderKind::Forced,
                ..ReminderConfig::default()
            },
        ); // target=1100 => not due

        let due_forced_by_snooze = task_with_reminder(
            "d",
            1100,
            false,
            false,
            ReminderConfig {
                kind: ReminderKind::Forced,
                snoozed_until: Some(900),
                ..ReminderConfig::default()
            },
        ); // snoozed_until wins => due

        let completed_task = task_with_reminder(
            "e",
            900,
            false,
            true,
            ReminderConfig {
                kind: ReminderKind::Normal,
                ..ReminderConfig::default()
            },
        );

        let none_reminder = task_with_reminder("f", 900, false, false, ReminderConfig::default());

        let forced_dismissed = task_with_reminder(
            "g",
            900,
            false,
            false,
            ReminderConfig {
                kind: ReminderKind::Forced,
                forced_dismissed: true,
                ..ReminderConfig::default()
            },
        );

        let already_fired = task_with_reminder(
            "h",
            1500,
            false,
            false,
            ReminderConfig {
                kind: ReminderKind::Normal,
                last_fired_at: Some(950),
                ..ReminderConfig::default()
            },
        ); // target=900; last_fired_at>=target => skip

        let state = AppState::new(
            vec![
                not_due_normal,
                due_normal_important.clone(),
                not_due_forced,
                due_forced_by_snooze.clone(),
                completed_task,
                none_reminder,
                forced_dismissed,
                already_fired,
            ],
            crate::models::Settings::default(),
        );

        let due = collect_due_tasks(&state, now);
        assert_eq!(due.len(), 2);
        // Important task should come first.
        assert_eq!(due[0].id, due_normal_important.id);
        assert_eq!(due[1].id, due_forced_by_snooze.id);
    }
}
