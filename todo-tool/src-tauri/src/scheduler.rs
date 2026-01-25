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
        let settings = state.settings();
        log::info!(
            "scheduler: started interval_sec=1 missed_tick=skip repeat_interval_sec={} repeat_max_times={}",
            settings.reminder_repeat_interval_sec,
            settings.reminder_repeat_max_times
        );

        let mut interval = tokio::time::interval(Duration::from_secs(1));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            let now = Utc::now().timestamp();
            let due_tasks = collect_due_tasks(&state, now);
            if !due_tasks.is_empty() {
                let has_forced = due_tasks
                    .iter()
                    .any(|task| task.reminder.kind == ReminderKind::Forced);
                log::info!(
                    "scheduler: reminder fired now={} count={} forced={} ids={}",
                    now,
                    due_tasks.len(),
                    has_forced,
                    format_task_ids(&due_tasks, 10)
                );
                for task in &due_tasks {
                    state.mark_reminder_fired(task, now);
                }
                persist_reminder_state(&app, &state);
                if let Err(err) = app.emit(EVENT_REMINDER, due_tasks) {
                    log::warn!("scheduler: failed to emit reminder event: {err}");
                }
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
        Err(err) => {
            log::error!("scheduler: app_data_dir failed: {err}");
            return;
        }
    };
    let storage = Storage::new(root);
    if let Err(err) = storage.ensure_dirs() {
        log::error!("scheduler: ensure_dirs failed: {err}");
        return;
    }
    if let Err(err) = storage.save_tasks(&state.tasks_file(), false) {
        log::error!("scheduler: save_tasks failed: {err}");
        return;
    }
    let payload = StatePayload {
        tasks: state.tasks(),
        projects: state.projects(),
        settings: state.settings(),
    };
    if let Err(err) = app.emit(EVENT_STATE_UPDATED, payload) {
        log::warn!("scheduler: failed to emit state_updated: {err}");
    }
    log::debug!("scheduler: persisted reminder state");
}

#[cfg(all(feature = "app", not(test)))]
fn format_task_ids(tasks: &[Task], limit: usize) -> String {
    let mut out = String::new();
    for (idx, task) in tasks.iter().take(limit).enumerate() {
        if idx > 0 {
            out.push(',');
        }
        out.push_str(&task.id);
    }
    if tasks.len() > limit {
        out.push_str(",...");
    }
    out
}

fn collect_due_tasks(state: &AppState, now: i64) -> Vec<Task> {
    let mut due = Vec::new();
    let settings = state.settings();
    let repeat_interval = settings.reminder_repeat_interval_sec.max(0);
    let repeat_max_times = settings.reminder_repeat_max_times;
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

        // Repeat reminders are intentionally scoped to Normal reminders.
        // Forced reminders already have a blocking overlay, and repeating the overlay tends to
        // feel like "spam" rather than "must handle".
        let effective_repeat_interval = if reminder.kind == ReminderKind::Normal {
            repeat_interval
        } else {
            0
        };

        if effective_repeat_interval <= 0 {
            // Single-shot: same semantics as before (last_fired_at de-dupes a given target_time).
            let already_fired = reminder
                .last_fired_at
                .is_some_and(|last_fired| last_fired >= target_time);
            if !already_fired && now >= target_time {
                due.push(task.clone());
            }
            continue;
        }

        // Repeat mode: once fired, keep reminding on a fixed cadence until completion (or limit).
        let fired_count = reminder.repeat_fired_count.max(0);
        if repeat_max_times > 0 && fired_count >= repeat_max_times {
            continue;
        }

        let last_fired_at = reminder.last_fired_at.unwrap_or(i64::MIN);
        let next_target = if let Some(snoozed_until) = reminder.snoozed_until {
            // Snooze always wins if it is later than the last fired time.
            if snoozed_until > last_fired_at {
                snoozed_until
            } else if let Some(last) = reminder.last_fired_at {
                last.saturating_add(effective_repeat_interval)
            } else {
                target_time
            }
        } else if let Some(last) = reminder.last_fired_at {
            last.saturating_add(effective_repeat_interval)
        } else {
            target_time
        };

        if now >= next_target {
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
            project_id: "inbox".to_string(),
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
            tags: Vec::new(),
            sample_tag: None,
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
            Vec::new(),
            crate::models::Settings::default(),
        );

        let due = collect_due_tasks(&state, now);
        assert_eq!(due.len(), 2);
        // Important task should come first.
        assert_eq!(due[0].id, due_normal_important.id);
        assert_eq!(due[1].id, due_forced_by_snooze.id);
    }

    #[test]
    fn collect_due_tasks_repeats_normal_reminders_when_interval_enabled() {
        let now = 1000;

        let repeating = task_with_reminder(
            "repeat",
            2000,
            false,
            false,
            ReminderConfig {
                kind: ReminderKind::Normal,
                last_fired_at: Some(700),
                repeat_fired_count: 1,
                ..ReminderConfig::default()
            },
        );

        let mut settings = crate::models::Settings::default();
        settings.reminder_repeat_interval_sec = 300;
        settings.reminder_repeat_max_times = 0;

        let state = AppState::new(vec![repeating], Vec::new(), settings);
        let out = collect_due_tasks(&state, now);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].id, "repeat");
    }

    #[test]
    fn collect_due_tasks_repeat_mode_respects_snooze_override_and_max_times() {
        let now = 1000;

        let snoozed = task_with_reminder(
            "snoozed",
            2000,
            false,
            false,
            ReminderConfig {
                kind: ReminderKind::Normal,
                last_fired_at: Some(700),
                snoozed_until: Some(1200),
                repeat_fired_count: 1,
                ..ReminderConfig::default()
            },
        );

        let maxed_out = task_with_reminder(
            "maxed",
            2000,
            false,
            false,
            ReminderConfig {
                kind: ReminderKind::Normal,
                last_fired_at: Some(700),
                repeat_fired_count: 2,
                ..ReminderConfig::default()
            },
        );

        let mut settings = crate::models::Settings::default();
        settings.reminder_repeat_interval_sec = 300;
        settings.reminder_repeat_max_times = 2;

        let state = AppState::new(vec![snoozed, maxed_out], Vec::new(), settings);
        let out = collect_due_tasks(&state, now);
        // snoozed_until wins (1200 > now), and maxed_out hits the repeat limit.
        assert!(out.is_empty());
    }

    #[test]
    fn collect_due_tasks_repeat_mode_uses_last_fired_when_snooze_is_not_later() {
        let now = 1000;

        let repeating = task_with_reminder(
            "repeat-snooze-too-early",
            2000,
            false,
            false,
            ReminderConfig {
                kind: ReminderKind::Normal,
                last_fired_at: Some(700),
                // snoozed_until is not later than last_fired_at, so we should fall back to
                // last_fired_at + interval.
                snoozed_until: Some(600),
                repeat_fired_count: 1,
                ..ReminderConfig::default()
            },
        );

        let mut settings = crate::models::Settings::default();
        settings.reminder_repeat_interval_sec = 300;
        settings.reminder_repeat_max_times = 0;

        let state = AppState::new(vec![repeating], Vec::new(), settings);
        let out = collect_due_tasks(&state, now);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].id, "repeat-snooze-too-early");
    }

    #[test]
    fn collect_due_tasks_repeat_mode_falls_back_to_target_time_when_never_fired() {
        let now = 0;

        // NOTE: This uses an extreme timestamp to exercise the `snoozed_until <= last_fired_at`
        // branch when `last_fired_at` is missing (treated as i64::MIN).
        let repeating = task_with_reminder(
            "repeat-snooze-min",
            2000,
            false,
            false,
            ReminderConfig {
                kind: ReminderKind::Normal,
                last_fired_at: None,
                snoozed_until: Some(i64::MIN),
                repeat_fired_count: 0,
                ..ReminderConfig::default()
            },
        );

        let mut settings = crate::models::Settings::default();
        settings.reminder_repeat_interval_sec = 300;
        settings.reminder_repeat_max_times = 0;

        let state = AppState::new(vec![repeating], Vec::new(), settings);
        let out = collect_due_tasks(&state, now);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].id, "repeat-snooze-min");
    }

    #[test]
    fn collect_due_tasks_does_not_repeat_forced_reminders() {
        let now = 2000;

        let forced = task_with_reminder(
            "forced",
            1100,
            false,
            false,
            ReminderConfig {
                kind: ReminderKind::Forced,
                last_fired_at: Some(1200),
                repeat_fired_count: 99,
                ..ReminderConfig::default()
            },
        );

        let mut settings = crate::models::Settings::default();
        settings.reminder_repeat_interval_sec = 300;
        settings.reminder_repeat_max_times = 0;

        let state = AppState::new(vec![forced], Vec::new(), settings);
        let out = collect_due_tasks(&state, now);
        assert!(out.is_empty());
    }
}
