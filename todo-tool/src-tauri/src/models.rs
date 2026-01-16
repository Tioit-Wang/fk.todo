use serde::{Deserialize, Serialize};

pub type Timestamp = i64;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ReminderKind {
    None,
    Normal,
    Forced,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ReminderConfig {
    pub kind: ReminderKind,
    pub remind_at: Option<Timestamp>,
    pub snoozed_until: Option<Timestamp>,
    pub forced_dismissed: bool,
    pub last_fired_at: Option<Timestamp>,
}

impl Default for ReminderConfig {
    fn default() -> Self {
        Self {
            kind: ReminderKind::None,
            remind_at: None,
            snoozed_until: None,
            forced_dismissed: false,
            last_fired_at: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RepeatRule {
    None,
    Daily { workday_only: bool },
    Weekly { days: Vec<u8> },
    Monthly { day: u8 },
    Yearly { month: u8, day: u8 },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct Step {
    pub id: String,
    pub title: String,
    pub completed: bool,
    pub created_at: Timestamp,
    pub completed_at: Option<Timestamp>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct Task {
    pub id: String,
    pub title: String,
    pub due_at: Timestamp,
    pub important: bool,
    pub completed: bool,
    pub completed_at: Option<Timestamp>,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub quadrant: u8,
    pub notes: Option<String>,
    pub steps: Vec<Step>,
    pub reminder: ReminderConfig,
    pub repeat: RepeatRule,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CloseBehavior {
    HideToTray,
    Exit,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct Settings {
    pub shortcut: String,
    pub theme: String,
    pub sound_enabled: bool,
    pub close_behavior: CloseBehavior,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            shortcut: "CommandOrControl+Shift+T".to_string(),
            theme: "light".to_string(),
            sound_enabled: true,
            close_behavior: CloseBehavior::HideToTray,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct TasksFile {
    pub schema_version: u32,
    pub tasks: Vec<Task>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct SettingsFile {
    pub schema_version: u32,
    pub settings: Settings,
}
