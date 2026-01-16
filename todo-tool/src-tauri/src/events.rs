use crate::models::{Settings, Task};

pub const EVENT_REMINDER: &str = "reminder_fired";
pub const EVENT_STATE_UPDATED: &str = "state_updated";

#[derive(Debug, Clone, serde::Serialize)]
pub struct StatePayload {
    pub tasks: Vec<Task>,
    pub settings: Settings,
}
