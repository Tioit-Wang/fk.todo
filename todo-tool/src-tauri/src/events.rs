use crate::models::{Settings, Task};

pub const EVENT_REMINDER: &str = "reminder_fired";
pub const EVENT_STATE_UPDATED: &str = "state_updated";
pub const EVENT_NAVIGATE: &str = "fk.todo:navigate";

#[derive(Debug, Clone, serde::Serialize)]
pub struct StatePayload {
    pub tasks: Vec<Task>,
    pub settings: Settings,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct NavigatePayload {
    pub hash: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ReminderConfig, RepeatRule, Task};

    fn make_task(id: &str) -> Task {
        Task {
            id: id.to_string(),
            title: format!("task-{id}"),
            due_at: 1,
            important: false,
            completed: false,
            completed_at: None,
            created_at: 1,
            updated_at: 1,
            sort_order: 1,
            quadrant: 1,
            notes: None,
            steps: Vec::new(),
            reminder: ReminderConfig::default(),
            repeat: RepeatRule::None,
        }
    }

    #[test]
    fn event_constants_and_payload_are_usable_and_serializable() {
        assert_eq!(EVENT_REMINDER, "reminder_fired");
        assert_eq!(EVENT_STATE_UPDATED, "state_updated");
        assert_eq!(EVENT_NAVIGATE, "fk.todo:navigate");

        let payload = StatePayload {
            tasks: vec![make_task("a")],
            settings: Settings::default(),
        };
        let value = serde_json::to_value(payload).unwrap();
        assert!(value.get("tasks").is_some());
        assert!(value.get("settings").is_some());

        let nav = NavigatePayload {
            hash: "#/main".to_string(),
        };
        let value = serde_json::to_value(nav).unwrap();
        assert_eq!(value.get("hash").and_then(|v| v.as_str()), Some("#/main"));
    }
}
