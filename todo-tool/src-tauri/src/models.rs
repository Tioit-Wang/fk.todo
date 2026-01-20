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
pub enum MinimizeBehavior {
    HideToTray,
    Minimize,
}

impl Default for MinimizeBehavior {
    fn default() -> Self {
        Self::HideToTray
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct Settings {
    pub shortcut: String,
    pub theme: String,
    pub sound_enabled: bool,
    pub close_behavior: CloseBehavior,
    #[serde(default)]
    pub minimize_behavior: MinimizeBehavior,
    #[serde(default)]
    pub quick_always_on_top: bool,
    #[serde(default = "default_quick_blur_enabled")]
    pub quick_blur_enabled: bool,
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
            minimize_behavior: MinimizeBehavior::HideToTray,
            quick_always_on_top: false,
            quick_blur_enabled: default_quick_blur_enabled(),
            quick_bounds: None,
            quick_tab: default_quick_tab(),
            quick_sort: default_quick_sort(),
            forced_reminder_color: default_forced_color(),
            backup_schedule: BackupSchedule::Daily,
            last_backup_at: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum BackupSchedule {
    None,
    #[default]
    Daily,
    Weekly,
    Monthly,
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

fn default_quick_blur_enabled() -> bool {
    true
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reminder_config_default_values() {
        let config = ReminderConfig::default();
        assert_eq!(config.kind, ReminderKind::None);
        assert_eq!(config.remind_at, None);
        assert_eq!(config.snoozed_until, None);
        assert!(!config.forced_dismissed);
        assert_eq!(config.last_fired_at, None);
    }

    #[test]
    fn settings_default_values() {
        let settings = Settings::default();
        assert_eq!(settings.shortcut, "CommandOrControl+Shift+T");
        assert_eq!(settings.theme, "light");
        assert!(settings.sound_enabled);
        assert!(matches!(settings.close_behavior, CloseBehavior::HideToTray));
        assert!(matches!(
            settings.minimize_behavior,
            MinimizeBehavior::HideToTray
        ));
        assert!(!settings.quick_always_on_top);
        assert!(settings.quick_blur_enabled);
        assert!(settings.quick_bounds.is_none());
        assert_eq!(settings.quick_tab, "todo");
        assert_eq!(settings.quick_sort, "default");
        assert_eq!(settings.forced_reminder_color, "#C94D37");
        assert!(matches!(settings.backup_schedule, BackupSchedule::Daily));
        assert_eq!(settings.last_backup_at, None);
    }

    #[test]
    fn settings_serde_applies_defaults_for_missing_optional_fields() {
        let json = r#"
        {
          "shortcut": "CommandOrControl+Shift+T",
          "theme": "dark",
          "sound_enabled": false,
          "close_behavior": "exit"
        }
        "#;

        let settings: Settings = serde_json::from_str(json).expect("settings should deserialize");
        assert_eq!(settings.shortcut, "CommandOrControl+Shift+T");
        assert_eq!(settings.theme, "dark");
        assert!(!settings.sound_enabled);
        assert!(matches!(settings.close_behavior, CloseBehavior::Exit));

        // These fields must be filled by serde defaults.
        assert!(matches!(
            settings.minimize_behavior,
            MinimizeBehavior::HideToTray
        ));
        assert!(!settings.quick_always_on_top);
        assert!(settings.quick_blur_enabled);
        assert!(settings.quick_bounds.is_none());
        assert_eq!(settings.quick_tab, "todo");
        assert_eq!(settings.quick_sort, "default");
        assert_eq!(settings.forced_reminder_color, "#C94D37");
        assert!(matches!(settings.backup_schedule, BackupSchedule::Daily));
        assert_eq!(settings.last_backup_at, None);
    }

    #[test]
    fn repeat_rule_serialization_uses_tagged_enum_layout() {
        let rule = RepeatRule::Daily { workday_only: true };
        let value = serde_json::to_value(&rule).expect("serialize repeat rule");
        assert_eq!(
            value,
            serde_json::json!({
              "type": "daily",
              "workday_only": true
            })
        );

        let back: RepeatRule = serde_json::from_value(value).expect("deserialize repeat rule");
        assert!(matches!(back, RepeatRule::Daily { workday_only: true }));
    }

    #[test]
    fn task_sort_order_defaults_to_zero_when_missing() {
        let json = r#"
        {
          "id": "t1",
          "title": "task",
          "due_at": 123,
          "important": false,
          "completed": false,
          "completed_at": null,
          "created_at": 1,
          "updated_at": 1,
          "quadrant": 1,
          "notes": null,
          "steps": [],
          "reminder": {
            "kind": "none",
            "remind_at": null,
            "snoozed_until": null,
            "forced_dismissed": false,
            "last_fired_at": null
          },
          "repeat": { "type": "none" }
        }
        "#;

        let task: Task = serde_json::from_str(json).expect("task should deserialize");
        assert_eq!(task.sort_order, 0);
    }
}
