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
    #[serde(default)]
    pub sort_order: Timestamp,
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
    #[serde(default)]
    pub quick_always_on_top: bool,
    #[serde(default)]
    pub quick_bounds: Option<WindowBounds>,
    #[serde(default = "default_quick_tab")]
    pub quick_tab: String,
    #[serde(default = "default_quick_sort")]
    pub quick_sort: String,
    #[serde(default = "default_forced_color")]
    pub forced_reminder_color: String,
    #[serde(default)]
    pub backup_schedule: BackupSchedule,
    #[serde(default)]
    pub last_backup_at: Option<Timestamp>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            shortcut: "CommandOrControl+Shift+T".to_string(),
            theme: "light".to_string(),
            sound_enabled: true,
            close_behavior: CloseBehavior::HideToTray,
            quick_always_on_top: false,
            quick_bounds: None,
            quick_tab: default_quick_tab(),
            quick_sort: default_quick_sort(),
            forced_reminder_color: default_forced_color(),
            backup_schedule: BackupSchedule::Daily,
            last_backup_at: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BackupSchedule {
    None,
    Daily,
    Weekly,
    Monthly,
}

impl Default for BackupSchedule {
    fn default() -> Self {
        BackupSchedule::Daily
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WindowBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

fn default_quick_tab() -> String {
    "todo".to_string()
}

fn default_quick_sort() -> String {
    "default".to_string()
}

fn default_forced_color() -> String {
    // Retro warm red; used as the default reminder banner background.
    "#C94D37".to_string()
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
